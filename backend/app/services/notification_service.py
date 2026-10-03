"""
Notification queries, validation and serialization.

Every query here is scoped by college_id, and by audience for students and
faculty - API routes never build their own notification queries, so the
visibility rules live in exactly one place.

Datetimes are naive UTC, like the rest of the schema.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session

from app.db import models
from app.ingestion.extractors import file_type_for
from app.schemas.notifications import AttachmentOut, NotificationOut
from app.services.storage_service import safe_display_name

CATEGORIES = {c.value for c in models.NotificationCategory}
PRIORITIES = {p.value for p in models.NotificationPriority}
AUDIENCES = {a.value for a in models.NotificationAudience}
STATUSES = {"draft", "published", "archived"}

# Document type recorded on an attached file, per notification category.
DOCUMENT_TYPE_FOR_CATEGORY = {
    "circular": "circular",
    "announcement": "announcement",
    "holiday": "holiday",
    "deadline": "deadline",
    "academic": "academic_calendar",
    "examination": "examination",
    "assignment": "assignment",
    "event": "event",
    "general": "general_notice",
}


class NotificationError(Exception):
    """A validation failure with a message safe to show to the admin."""


def utcnow() -> datetime:
    return datetime.utcnow()


def to_naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def parse_dt(value: Optional[str], label: str) -> Optional[datetime]:
    """Parses an ISO-8601 string from a form field (a trailing Z is allowed)."""
    if value is None or not value.strip():
        return None
    try:
        return to_naive_utc(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))
    except ValueError:
        raise NotificationError(f"{label} isn't a valid date.")


# ---------- visibility ----------

def audiences_for(role: models.UserRole) -> tuple[str, ...]:
    if role == models.UserRole.STUDENT:
        return ("student", "both")
    if role == models.UserRole.FACULTY:
        return ("faculty", "both")
    return ("student", "faculty", "both")


def visible_query(db: Session, user: models.User, now: Optional[datetime] = None) -> Query:
    """What this user may see: their college, published, active, already
    published_at, and addressed to their role. Expired items are included -
    callers decide whether to hide them."""
    now = now or utcnow()
    return db.query(models.Notification).filter(
        models.Notification.college_id == user.college_id,
        models.Notification.status == "published",
        models.Notification.is_active.is_(True),
        models.Notification.published_at <= now,
        models.Notification.audience.in_(audiences_for(user.role)),
    )


def _not_expired(now: datetime):
    return or_(models.Notification.expires_at.is_(None), models.Notification.expires_at > now)


def activity_column():
    """When the item last became interesting: publish time, or the latest reminder."""
    return func.coalesce(models.Notification.last_reminded_at, models.Notification.published_at)


def _read_ids(db: Session, user: models.User) -> set[int]:
    rows = db.query(models.NotificationRead.notification_id).filter(models.NotificationRead.user_id == user.id).all()
    return {r[0] for r in rows}


def unread_query(db: Session, user: models.User, now: Optional[datetime] = None) -> Query:
    now = now or utcnow()
    read = db.query(models.NotificationRead.notification_id).filter(models.NotificationRead.user_id == user.id)
    return visible_query(db, user, now).filter(_not_expired(now), ~models.Notification.id.in_(read))


def unread_count(db: Session, user: models.User) -> int:
    return unread_query(db, user).count()


def get_for_user(db: Session, user: models.User, notification_id: int) -> Optional[models.Notification]:
    """A single notification this user may see, or None (never reveals that
    another college's or audience's notification exists)."""
    if user.role == models.UserRole.ADMIN:
        return get_for_admin(db, user, notification_id)
    return visible_query(db, user).filter(models.Notification.id == notification_id).first()


def get_for_admin(db: Session, admin: models.User, notification_id: int) -> Optional[models.Notification]:
    return (
        db.query(models.Notification)
        .filter(models.Notification.id == notification_id, models.Notification.college_id == admin.college_id)
        .first()
    )


def mark_read(db: Session, user: models.User, notification: models.Notification) -> None:
    exists = (
        db.query(models.NotificationRead.id)
        .filter(models.NotificationRead.notification_id == notification.id, models.NotificationRead.user_id == user.id)
        .first()
    )
    if exists:
        return
    db.add(models.NotificationRead(notification_id=notification.id, user_id=user.id))
    try:
        db.commit()
    except IntegrityError:  # a concurrent request already marked it
        db.rollback()


def mark_all_read(db: Session, user: models.User) -> int:
    ids = [n.id for n in unread_query(db, user).with_entities(models.Notification.id).all()]
    for nid in ids:
        db.add(models.NotificationRead(notification_id=nid, user_id=user.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        for nid in ids:  # rare race: fall back to one at a time
            try:
                db.add(models.NotificationRead(notification_id=nid, user_id=user.id))
                db.commit()
            except IntegrityError:
                db.rollback()
    return len(ids)


# ---------- state ----------

def state_of(n: models.Notification, now: Optional[datetime] = None) -> str:
    now = now or utcnow()
    if n.status == "archived" or not n.is_active:
        return "archived"
    if n.status == "draft":
        return "draft"
    if n.published_at > now:
        return "scheduled"
    if n.expires_at is not None and n.expires_at <= now:
        return "expired"
    return "published"


def anchor_of(n: models.Notification) -> Optional[datetime]:
    """The date a reminder counts down to."""
    return n.deadline or n.event_date


# ---------- validation ----------

def validate_fields(data: dict, now: Optional[datetime] = None, existing: Optional[models.Notification] = None) -> dict:
    """Checks a create/update payload and returns normalized values. `data`
    only contains the keys being set; for updates, `existing` supplies the
    rest so cross-field rules (deadline vs publish time) still hold."""
    now = now or utcnow()
    out = dict(data)

    if "title" in out:
        out["title"] = (out["title"] or "").strip()
        if not out["title"]:
            raise NotificationError("A title is required.")
        if len(out["title"]) > 255:
            raise NotificationError("The title is too long (255 characters at most).")
    if "body" in out:
        out["body"] = (out["body"] or "").strip()
        if not out["body"]:
            raise NotificationError("A description is required.")
    if "category" in out and out["category"] not in CATEGORIES:
        raise NotificationError("Choose a valid category.")
    if "priority" in out and out["priority"] not in PRIORITIES:
        raise NotificationError("Choose a valid priority.")
    if "audience" in out and out["audience"] not in AUDIENCES:
        raise NotificationError("Please select at least one audience.")
    if "status" in out and out["status"] not in STATUSES:
        raise NotificationError("Choose a valid status.")
    for key in ("circular_number", "department"):
        if key in out:
            out[key] = (out[key] or "").strip() or None

    def current(key):
        if key in out:
            return out[key]
        return getattr(existing, key, None) if existing is not None else None

    published_at = current("published_at") or now
    deadline = current("deadline")
    expires_at = current("expires_at")

    if "deadline" in out and out["deadline"] is not None and out["deadline"] <= now:
        raise NotificationError("Deadline cannot be in the past.")
    if deadline is not None and deadline <= published_at:
        raise NotificationError("The deadline must be after the publish time.")
    if expires_at is not None and expires_at <= published_at:
        raise NotificationError("The expiry must be after the publish time.")
    return out


def validate_reminders(offsets: Iterable[int], reminder_date: Optional[datetime], anchor: Optional[datetime], now: datetime) -> None:
    if (offsets or reminder_date) and anchor is None:
        raise NotificationError("Reminders need a deadline or an event date to count down to.")
    for o in offsets:
        if o not in ALLOWED_OFFSETS:
            raise NotificationError("Reminder timing must be 7, 3, 1 or 0 days before.")
    if reminder_date is not None:
        if anchor is not None and reminder_date >= anchor:
            raise NotificationError("Reminder date must be before the deadline.")
        if reminder_date <= now:
            raise NotificationError("Reminder date cannot be in the past.")


ALLOWED_OFFSETS = (7, 3, 1, 0)


# ---------- serialization ----------

def _attachment(n: models.Notification) -> Optional[AttachmentOut]:
    doc = n.document
    if doc is None:
        return None
    filename = safe_display_name(doc.original_filename)
    file_type = file_type_for(doc.original_filename) or "unknown"
    return AttachmentOut(
        document_id=doc.id,
        filename=filename,
        mime_type=doc.mime_type,
        file_type=file_type,
        is_image=file_type == "image",
    )


def to_out(n: models.Notification, read_ids: Optional[set[int]] = None, admin: bool = False, now: Optional[datetime] = None) -> NotificationOut:
    now = now or utcnow()
    out = NotificationOut(
        id=n.id,
        title=n.title,
        body=n.body,
        category=n.category,
        priority=n.priority,
        audience=n.audience,
        circular_number=n.circular_number,
        department=n.department,
        event_date=n.event_date,
        deadline=n.deadline,
        effective_date=n.effective_date,
        expires_at=n.expires_at,
        published_at=n.published_at,
        activity_at=n.last_reminded_at or n.published_at,
        status=n.status,
        state=state_of(n, now),
        is_read=None if read_ids is None else n.id in read_ids,
        attachment=_attachment(n),
        verified=n.document.is_verified if n.document is not None else None,
    )
    if admin:
        pending = [r for r in n.reminders if r.status == "pending"]
        out.reminder_offsets = sorted({r.offset_days for r in n.reminders if r.status != "cancelled" and r.offset_days is not None}, reverse=True)
        out.scheduled_reminders = len(pending)
    return out


def serialize_for(db: Session, user: models.User, items: List[models.Notification]) -> List[NotificationOut]:
    now = utcnow()
    if user.role == models.UserRole.ADMIN:
        return [to_out(n, admin=True, now=now) for n in items]
    read = _read_ids(db, user)
    return [to_out(n, read, now=now) for n in items]
