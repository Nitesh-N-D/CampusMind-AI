"""
Scheduled reminders for deadlines and events.

Delivery model: in-app first. When a reminder fires, the
notification is marked unread again for every recipient (their read rows are
removed) and `last_reminded_at` moves forward, so the next poll of
/api/notifications/unread-count surfaces it and the browser alert logic
treats it as new. If Web Push is configured, the claim winner also pushes it
to subscribed devices (services/push_service.py). Audience and college scoping come for free from the same
visibility rules as the notification itself.

An external scheduler (Render Cron, GitHub Actions, cron-job.org...) calls
the process endpoint every 15-60 minutes. Each reminder is claimed with a
conditional UPDATE, so overlapping or repeated calls can never fire the same
reminder twice.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.services import push_service
from app.services.notification_service import anchor_of, utcnow

# "On the deadline day" fires this long before the deadline itself.
DAY_OF_LEAD = timedelta(hours=6)


def _desired_times(anchor: datetime, offsets: Iterable[int], reminder_date: Optional[datetime]) -> dict[datetime, Optional[int]]:
    times: dict[datetime, Optional[int]] = {}
    for offset in offsets:
        times[anchor - (timedelta(days=offset) if offset else DAY_OF_LEAD)] = offset
    if reminder_date is not None:
        times.setdefault(reminder_date, None)
    return times


def sync_reminders(
    db: Session,
    notification: models.Notification,
    offsets: Iterable[int],
    reminder_date: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> None:
    """Makes the notification's reminders match the requested schedule.
    Sent reminders are history and never touched; pending ones that are no
    longer wanted are cancelled; new ones are only created if still in the
    future, so editing a deadline never fires a burst of stale reminders."""
    now = now or utcnow()
    anchor = anchor_of(notification)
    desired = _desired_times(anchor, offsets, reminder_date) if anchor else {}
    existing = {r.scheduled_for: r for r in notification.reminders}

    for when, offset in desired.items():
        row = existing.get(when)
        if row is not None:
            if row.status == "cancelled":
                row.status = "pending"
            continue
        # A day-of reminder is still useful when created inside its lead window.
        if when > now or (offset == 0 and anchor > now):
            db.add(
                models.ScheduledReminder(
                    notification_id=notification.id,
                    scheduled_for=when,
                    reminder_type=notification.category,
                    offset_days=offset,
                )
            )
    for when, row in existing.items():
        if when not in desired and row.status == "pending":
            row.status = "cancelled"
    db.flush()


def cancel_pending(db: Session, notification: models.Notification) -> int:
    count = 0
    for r in notification.reminders:
        if r.status == "pending":
            r.status = "cancelled"
            count += 1
    return count


def process_due_reminders(db: Session, college_id: Optional[int] = None, now: Optional[datetime] = None) -> dict:
    """Fires every pending reminder whose time has come. Safe to call as
    often as you like: a reminder is claimed atomically before anything
    happens, so each one fires at most once."""
    now = now or utcnow()
    q = (
        db.query(models.ScheduledReminder, models.Notification)
        .join(models.Notification, models.Notification.id == models.ScheduledReminder.notification_id)
        .filter(models.ScheduledReminder.status == "pending", models.ScheduledReminder.scheduled_for <= now)
    )
    if college_id is not None:
        q = q.filter(models.Notification.college_id == college_id)
    due = [(r.id, n.id) for r, n in q.all()]

    sent = cancelled = deferred = pushed = 0
    for reminder_id, notification_id in due:
        n = db.get(models.Notification, notification_id)
        if n is None:
            continue
        if not n.is_active or n.status == "archived" or (n.expires_at is not None and n.expires_at <= now):
            target, counter = "cancelled", "cancelled"
        elif n.status != "published" or n.published_at > now:
            deferred += 1  # not live yet; try again on a later run
            continue
        else:
            target, counter = "sent", "sent"

        claimed = (
            db.query(models.ScheduledReminder)
            .filter(models.ScheduledReminder.id == reminder_id, models.ScheduledReminder.status == "pending")
            .update(
                {"status": target, "sent_at": now if target == "sent" else None},
                synchronize_session=False,
            )
        )
        if not claimed:  # another run got there first
            db.rollback()
            continue
        if target == "sent":
            db.query(models.NotificationRead).filter(models.NotificationRead.notification_id == n.id).delete(
                synchronize_session=False
            )
            n.last_reminded_at = now
            sent += 1
        else:
            cancelled += 1
        db.commit()
        if target == "sent":
            # Only the run that won the claim reaches this line, so a repeated
            # scheduler call can't push the same reminder twice. Never raises.
            if push_service.send_for_notification(db, n.id, reminder=True, now=now)["sent"]:
                pushed += 1
    return {"sent": sent, "cancelled": cancelled, "deferred": deferred, "pushed": pushed}
