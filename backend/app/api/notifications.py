from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db import models
from app.db.database import get_db
from app.schemas.notification_schemas import NotificationOut

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _visible_query(db: Session, user: models.User):
    """A notification is visible to a user if it's a college-wide broadcast
    (user_id is null) or addressed to them directly, and its target_role
    (if set) matches their role. `target_role="student"` also reaches
    faculty - both are document-consuming end users who should hear about
    new documents and regulation changes; only "admin"-targeted alerts
    (like conflicts awaiting resolution) stay admin-only."""
    role_match = or_(
        models.Notification.target_role.is_(None),
        models.Notification.target_role == user.role.value,
        and_(
            models.Notification.target_role == "student",
            user.role == models.UserRole.FACULTY,
        ),
    )
    return (
        db.query(models.Notification)
        .filter(models.Notification.college_id == user.college_id)
        .filter(
            or_(
                models.Notification.user_id.is_(None),
                models.Notification.user_id == user.id,
            )
        )
        .filter(role_match)
    )


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    q = _visible_query(db, user)
    if unread_only:
        q = q.filter(models.Notification.is_read.is_(False))
    return q.order_by(models.Notification.created_at.desc()).limit(50).all()


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    count = _visible_query(db, user).filter(models.Notification.is_read.is_(False)).count()
    return {"count": count}


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    notif = _visible_query(db, user).filter(models.Notification.id == notification_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    db.commit()
    db.refresh(notif)
    return notif


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    _visible_query(db, user).filter(models.Notification.is_read.is_(False)).update(
        {"is_read": True}, synchronize_session=False
    )
    db.commit()
    return {"status": "ok"}
