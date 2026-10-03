"""
Reminders are notifications that count down to a deadline or event date.
`{id}` below is therefore a notification id: there is no separate reminder
record to keep in sync. The scheduled firing times live in scheduled_reminders.
"""
from datetime import timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.notifications import create_notification, load_document, update_notification
from app.core.security import get_current_user, require_role
from app.db import models
from app.db.database import get_db
from app.schemas.notifications import NotificationOut, NotificationUpdate, ReminderBuckets, ReminderCreate
from app.services import notification_service as svc
from app.services import reminder_service

router = APIRouter(prefix="/api/reminders", tags=["reminders"])

PAST_LIMIT = 50


@router.get("", response_model=ReminderBuckets)
def list_reminders(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Everything with a date this user may see, grouped by when it falls:
    today, the next 7 days, later, and past."""
    now = svc.utcnow()
    due_at = func.coalesce(models.Notification.deadline, models.Notification.event_date)
    if user.role == models.UserRole.ADMIN:
        q = db.query(models.Notification).filter(
            models.Notification.college_id == user.college_id,
            models.Notification.status == "published",
            models.Notification.is_active.is_(True),
        )
    else:
        q = svc.visible_query(db, user, now)
    items = (
        q.filter(or_(models.Notification.deadline.isnot(None), models.Notification.event_date.isnot(None)))
        .options(joinedload(models.Notification.document), joinedload(models.Notification.reminders))
        .order_by(due_at.asc())
        .all()
    )

    today = now.date()
    week_end = today + timedelta(days=7)
    buckets: dict[str, list] = {"today": [], "this_week": [], "upcoming": [], "past": []}
    for n in items:
        day = svc.anchor_of(n).date()
        if day < today:
            buckets["past"].append(n)
        elif day == today:
            buckets["today"].append(n)
        elif day <= week_end:
            buckets["this_week"].append(n)
        else:
            buckets["upcoming"].append(n)
    buckets["past"] = list(reversed(buckets["past"]))[:PAST_LIMIT]  # most recent first
    return ReminderBuckets(**{k: svc.serialize_for(db, user, v) for k, v in buckets.items()})


@router.post("", response_model=NotificationOut)
def create_reminder(
    payload: ReminderCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    document = load_document(db, admin, payload.document_id)
    fields = {
        "title": payload.title,
        "body": payload.body,
        "category": payload.category,
        "priority": payload.priority,
        "audience": payload.audience,
        "department": payload.department,
        "event_date": svc.to_naive_utc(payload.event_date),
        "deadline": svc.to_naive_utc(payload.deadline),
    }
    if fields["event_date"] is None and fields["deadline"] is None:
        raise HTTPException(status_code=400, detail="A reminder needs a deadline or an event date.")
    n = create_notification(
        db, admin, fields, sorted(set(payload.reminder_offsets), reverse=True), svc.to_naive_utc(payload.reminder_date), document, background
    )
    return svc.to_out(n, admin=True)


@router.patch("/{notification_id}", response_model=NotificationOut)
def update_reminder(
    notification_id: int,
    payload: NotificationUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    return update_notification(notification_id, payload, db, admin)


@router.delete("/{notification_id}")
def cancel_reminders(
    notification_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    """Cancels the pending scheduled reminders. The notification stays."""
    n = svc.get_for_admin(db, admin, notification_id)
    if n is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    cancelled = reminder_service.cancel_pending(db, n)
    db.commit()
    return {"cancelled": cancelled}
