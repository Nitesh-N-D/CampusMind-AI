import hmac
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.security import decode_token, get_current_user, require_role
from app.db import models
from app.db.database import get_db
from app.schemas.notifications import AdminSummary, NotificationOut, NotificationUpdate, UnreadSummary
from app.services import notification_service as svc
from app.services import push_service, reminder_service
from app.services.document_upload import create_document

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

NOT_FOUND = "Notification not found"


def _fail(exc: svc.NotificationError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def _parse_offsets(raw: Optional[str]) -> List[int]:
    if not raw or not raw.strip():
        return []
    try:
        return sorted({int(x) for x in raw.split(",") if x.strip()}, reverse=True)
    except ValueError:
        raise HTTPException(status_code=400, detail="Reminder timing must be 7, 3, 1 or 0 days before.")


def load_document(db: Session, admin: models.User, document_id: Optional[int]) -> Optional[models.Document]:
    if document_id is None:
        return None
    doc = db.query(models.Document).filter(
        models.Document.id == document_id, models.Document.college_id == admin.college_id
    ).first()
    if doc is None:
        raise HTTPException(status_code=400, detail="That document wasn't found in your workspace.")
    return doc


def create_notification(
    db: Session,
    admin: models.User,
    fields: dict,
    offsets: List[int],
    reminder_date,
    document: Optional[models.Document],
    background: Optional[BackgroundTasks] = None,
) -> models.Notification:
    """Validated insert shared by POST /api/notifications and POST /api/reminders.
    A notification that is live right away is pushed after the response; drafts
    and scheduled ones are pushed by the scheduler once they go live."""
    now = svc.utcnow()
    try:
        fields = svc.validate_fields(fields, now)
        anchor = fields.get("deadline") or fields.get("event_date")
        svc.validate_reminders(offsets, reminder_date, anchor, now)
    except svc.NotificationError as exc:
        raise _fail(exc)

    notification = models.Notification(
        college_id=admin.college_id,
        published_by=admin.id,
        document_id=document.id if document else None,
        published_at=fields.pop("published_at", None) or now,
        status=fields.pop("status", "published"),
        **fields,
    )
    db.add(notification)
    db.flush()
    reminder_service.sync_reminders(db, notification, offsets, reminder_date, now)
    db.commit()
    db.refresh(notification)
    if background is not None and notification.status == "published" and notification.published_at <= now:
        background.add_task(push_service.push_initial_in_background, db.get_bind(), notification.id)
    return notification


@router.post("", response_model=NotificationOut)
async def publish_notification(
    title: str = Form(""),
    body: str = Form(""),
    category: str = Form("general"),
    priority: str = Form("normal"),
    audience: str = Form(""),
    circular_number: Optional[str] = Form(None),
    department: Optional[str] = Form(None),
    event_date: Optional[str] = Form(None),
    deadline: Optional[str] = Form(None),
    effective_date: Optional[str] = Form(None),
    expires_at: Optional[str] = Form(None),
    published_at: Optional[str] = Form(None),
    status: str = Form("published"),
    reminder_offsets: Optional[str] = Form(None),
    reminder_date: Optional[str] = Form(None),
    document_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None),
    background: BackgroundTasks = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    try:
        fields = {
            "title": title,
            "body": body,
            "category": category,
            "priority": priority,
            "audience": audience,
            "circular_number": circular_number,
            "department": department,
            "event_date": svc.parse_dt(event_date, "The date"),
            "deadline": svc.parse_dt(deadline, "The deadline"),
            "effective_date": svc.parse_dt(effective_date, "The effective date"),
            "expires_at": svc.parse_dt(expires_at, "The expiry"),
            "status": status,
        }
        scheduled = svc.parse_dt(published_at, "The publish time")
        if scheduled is not None:
            fields["published_at"] = scheduled
        reminder_at = svc.parse_dt(reminder_date, "The reminder date")
        offsets = _parse_offsets(reminder_offsets)
        # Validate everything before storing a file, so a bad form never
        # leaves an orphaned document behind.
        checked = svc.validate_fields(dict(fields))
        svc.validate_reminders(offsets, reminder_at, checked.get("deadline") or checked.get("event_date"), svc.utcnow())
    except svc.NotificationError as exc:
        raise _fail(exc)

    document = load_document(db, admin, document_id)
    has_file = file is not None and bool(file.filename)
    if has_file and document is not None:
        raise HTTPException(status_code=400, detail="Attach a new file or choose an existing document, not both.")
    if has_file:
        document = await create_document(
            db,
            admin,
            file,
            title=checked["title"],
            document_type=svc.DOCUMENT_TYPE_FOR_CATEGORY[checked["category"]],
            department=checked.get("department"),
            published_date=checked.get("published_at") or svc.utcnow(),
            effective_date=checked.get("effective_date"),
            is_official=True,
        )

    notification = create_notification(db, admin, fields, offsets, reminder_at, document, background)
    return svc.to_out(notification, admin=True)


# ---- fixed paths first so they are never swallowed by /{notification_id} ----

@router.get("/unread-count", response_model=UnreadSummary)
def unread_count(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if user.role == models.UserRole.ADMIN:
        return UnreadSummary(unread=0, latest=[])
    q = svc.unread_query(db, user)
    total = q.count()
    latest = q.options(joinedload(models.Notification.document)).order_by(svc.activity_column().desc()).limit(5).all()
    return UnreadSummary(unread=total, latest=svc.serialize_for(db, user, latest))


@router.post("/read-all")
def read_all(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return {"marked": svc.mark_all_read(db, user) if user.role != models.UserRole.ADMIN else 0}


@router.get("/summary", response_model=AdminSummary)
def admin_summary(db: Session = Depends(get_db), admin: models.User = Depends(require_role("admin"))):
    now = svc.utcnow()
    base = db.query(models.Notification).filter(
        models.Notification.college_id == admin.college_id,
        models.Notification.is_active.is_(True),
        models.Notification.status == "published",
    )
    live = base.filter(
        (models.Notification.expires_at.is_(None)) | (models.Notification.expires_at > now)
    )
    pending = (
        db.query(models.ScheduledReminder)
        .join(models.Notification, models.Notification.id == models.ScheduledReminder.notification_id)
        .filter(models.Notification.college_id == admin.college_id, models.ScheduledReminder.status == "pending")
        .count()
    )

    def upcoming(category: str):
        date = models.Notification.deadline if category == "deadline" else models.Notification.event_date
        rows = (
            live.filter(models.Notification.category == category, date >= now)
            .order_by(date.asc())
            .limit(5)
            .all()
        )
        return [svc.to_out(n, admin=True, now=now) for n in rows]

    recent = base.order_by(svc.activity_column().desc()).limit(5).all()
    return AdminSummary(
        total=base.count(),
        active_circulars=live.filter(models.Notification.category == "circular").count(),
        scheduled_reminders=pending,
        upcoming_deadlines=upcoming("deadline"),
        upcoming_holidays=upcoming("holiday"),
        recent=[svc.to_out(n, admin=True, now=now) for n in recent],
    )


def cron_or_admin(
    request: Request,
    x_cron_secret: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Optional[models.User]:
    """The scheduler authenticates with the shared CRON_SECRET (returns None:
    all colleges); a signed-in admin may also run it for their own college.
    Everyone else is refused."""
    if x_cron_secret is not None:
        if settings.cron_secret and hmac.compare_digest(x_cron_secret, settings.cron_secret):
            return None
        raise HTTPException(status_code=403, detail="Invalid scheduler credentials.")
    scheme, token = get_authorization_scheme_param(request.headers.get("Authorization"))
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(token)
    try:
        user = db.get(models.User, int(payload["sub"]))
    except (KeyError, TypeError, ValueError):
        user = None
    if user is None or not user.is_active or user.role != models.UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only administrators can run reminders.")
    return user


@router.post("/process-reminders")
def process_reminders(db: Session = Depends(get_db), actor: Optional[models.User] = Depends(cron_or_admin)):
    college_id = actor.college_id if actor else None
    result = reminder_service.process_due_reminders(db, college_id=college_id)
    # Notifications that went live since the last run (scheduled / drafts published later).
    result["pushed"] = result.get("pushed", 0) + push_service.release_due_pushes(db, college_id)
    return result


@router.get("", response_model=List[NotificationOut])
def list_notifications(
    category: Optional[str] = None,
    audience: Optional[str] = None,
    status: Optional[str] = None,
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    now = svc.utcnow()

    if user.role == models.UserRole.ADMIN:
        q = db.query(models.Notification).filter(models.Notification.college_id == user.college_id)
        if audience in svc.AUDIENCES:
            q = q.filter(models.Notification.audience == audience)
        if status == "draft":
            q = q.filter(models.Notification.status == "draft", models.Notification.is_active.is_(True))
        elif status == "archived":
            q = q.filter((models.Notification.status == "archived") | (models.Notification.is_active.is_(False)))
        else:
            q = q.filter(models.Notification.status == "published", models.Notification.is_active.is_(True))
            if status == "scheduled":
                q = q.filter(models.Notification.published_at > now)
            elif status == "expired":
                q = q.filter(models.Notification.published_at <= now, models.Notification.expires_at <= now)
            elif status == "published":
                q = q.filter(
                    models.Notification.published_at <= now,
                    (models.Notification.expires_at.is_(None)) | (models.Notification.expires_at > now),
                )
    else:
        q = svc.unread_query(db, user, now) if unread_only else svc.visible_query(db, user, now)

    if category in svc.CATEGORIES:
        q = q.filter(models.Notification.category == category)
    items = (
        q.options(joinedload(models.Notification.document), joinedload(models.Notification.reminders))
        .order_by(svc.activity_column().desc(), models.Notification.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return svc.serialize_for(db, user, items)


@router.get("/{notification_id}", response_model=NotificationOut)
def get_notification(notification_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    n = svc.get_for_user(db, user, notification_id)
    if n is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return svc.serialize_for(db, user, [n])[0]


@router.post("/{notification_id}/read")
def read_one(notification_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    n = svc.get_for_user(db, user, notification_id)
    if n is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    if user.role != models.UserRole.ADMIN:
        svc.mark_read(db, user, n)
    return {"status": "read"}


@router.patch("/{notification_id}", response_model=NotificationOut)
def update_notification(
    notification_id: int,
    payload: NotificationUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    n = svc.get_for_admin(db, admin, notification_id)
    if n is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    sent = payload.model_fields_set
    schedule_keys = {"reminder_offsets", "reminder_date"}
    now = svc.utcnow()
    try:
        fields = {
            k: (svc.to_naive_utc(getattr(payload, k)) if k.endswith(("_date", "_at")) or k == "deadline" else getattr(payload, k))
            for k in sent - schedule_keys
        }
        for required in ("title", "body", "category", "priority", "audience", "status"):
            if required in fields and fields[required] is None:
                fields.pop(required)
        fields = svc.validate_fields(fields, now, existing=n)
        if "published_at" in fields and fields["published_at"] is None:
            fields.pop("published_at")

        merged_anchor = (fields["deadline"] if "deadline" in fields else n.deadline) or (
            fields["event_date"] if "event_date" in fields else n.event_date
        )
        offsets = payload.reminder_offsets
        reminder_at = svc.to_naive_utc(payload.reminder_date)
        if offsets is None:
            offsets = sorted({r.offset_days for r in n.reminders if r.status != "cancelled" and r.offset_days is not None}, reverse=True)
        if "reminder_date" not in sent:
            custom = [r.scheduled_for for r in n.reminders if r.status != "cancelled" and r.offset_days is None]
            reminder_at = custom[0] if custom else None
            check_date = None  # an existing custom reminder was validated when it was created
        else:
            check_date = reminder_at
        svc.validate_reminders(offsets if schedule_keys & sent else [], check_date, merged_anchor, now)
    except svc.NotificationError as exc:
        raise _fail(exc)

    for key, value in fields.items():
        setattr(n, key, value)
    if n.status == "archived":
        n.is_active = False
    elif "status" in fields:
        n.is_active = True
    db.flush()
    anchor_changed = bool({"deadline", "event_date"} & sent)
    if schedule_keys & sent or anchor_changed:
        if n.status == "archived":
            reminder_service.cancel_pending(db, n)
        else:
            reminder_service.sync_reminders(db, n, offsets, reminder_at, now)
    elif n.status == "archived":
        reminder_service.cancel_pending(db, n)
    db.commit()
    db.refresh(n)
    return svc.to_out(n, admin=True)


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    """Soft delete: official records are archived, not erased. The attached
    document (and its place in the knowledge base) is left alone."""
    n = svc.get_for_admin(db, admin, notification_id)
    if n is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    n.status = "archived"
    n.is_active = False
    reminder_service.cancel_pending(db, n)
    db.commit()
    return {"status": "archived"}
