"""Web Push subscriptions. Delivery lives in app/services/push_service.py."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.database import get_db
from app.schemas.push import PushStatus, PushSubscribeIn, PushUnsubscribeIn
from app.services import push_service

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/status", response_model=PushStatus)
def push_status(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    configured = push_service.is_configured()
    devices = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.user_id == user.id, models.PushSubscription.is_active.is_(True))
        .count()
    )
    # Only the public key is ever exposed.
    return PushStatus(
        configured=configured,
        public_key=settings.vapid_public_key if configured else None,
        subscribed=devices > 0,
        devices=devices,
    )


@router.post("/subscribe", response_model=PushStatus)
def subscribe(payload: PushSubscribeIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if user.role == models.UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Administrators publish notifications and don't receive them.")
    if not push_service.is_configured():
        raise HTTPException(status_code=503, detail="Background notifications aren't set up on this server.")
    if not push_service.endpoint_allowed(payload.endpoint):
        raise HTTPException(status_code=400, detail="That push service isn't supported.")

    for attempt in (1, 2):
        now = datetime.utcnow()
        sub = db.query(models.PushSubscription).filter(models.PushSubscription.endpoint == payload.endpoint).first()
        if sub is None:
            sub = models.PushSubscription(endpoint=payload.endpoint, created_at=now)
            db.add(sub)
        # Re-subscribing from the same browser on a different account rebinds the
        # device to whoever is signed in now, so a shared device never keeps
        # delivering the previous person's notices.
        sub.user_id = user.id
        sub.college_id = user.college_id
        sub.p256dh = payload.keys.p256dh
        sub.auth = payload.keys.auth
        sub.is_active = True
        sub.failure_count = 0
        sub.updated_at = now
        try:
            db.commit()
            break
        except IntegrityError:
            # Two requests registered the same new endpoint at once; the second
            # simply updates the row the first created.
            db.rollback()
            if attempt == 2:
                raise
    return push_status(db, user)


@router.delete("/subscribe", response_model=PushStatus)
def unsubscribe(payload: PushUnsubscribeIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    # Scoped to the caller: someone else's endpoint is indistinguishable from a missing one.
    sub = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.endpoint == payload.endpoint, models.PushSubscription.user_id == user.id)
        .first()
    )
    if sub is not None:
        db.delete(sub)
        db.commit()
    return push_status(db, user)
