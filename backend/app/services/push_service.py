"""
Web Push delivery (VAPID). An additional channel next to the notification
center and 60s polling - the database notification id stays the source of
truth, and nothing here can make publishing or reminder processing fail.

Who gets a push: active students/faculty of the notification's own college
whose role matches its audience, on each of their active subscriptions.
When: once when a notification goes live, and once per fired reminder. Edits
and archiving never push.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging_config import logger
from app.db import models

try:  # the dependency is optional at import time so the API still boots without it
    from pywebpush import WebPushException, webpush
except ImportError:  # pragma: no cover
    webpush = None  # type: ignore[assignment]
    WebPushException = Exception  # type: ignore[assignment,misc]

# Push services answer 404/410 when a subscription is gone for good.
PERMANENT_FAILURES = {404, 410}
# Endpoints are only ever one of the browsers' push services. The backend makes
# a request to this URL, so an arbitrary client-supplied host would be an SSRF.
ALLOWED_ENDPOINT_HOSTS = (
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "notify.windows.com",
    "push.apple.com",
)
# A subscription that keeps failing for any other reason (e.g. one created under
# a rotated VAPID key) is retired; signing in again re-registers a working one.
MAX_CONSECUTIVE_FAILURES = 10
MAX_WORKERS = 8
SEND_TIMEOUT_SECONDS = 10
PAYLOAD_BODY_CHARS = 140


def is_configured() -> bool:
    subject = settings.vapid_subject
    return bool(
        settings.vapid_public_key
        and settings.vapid_private_key
        and (subject.startswith("mailto:") or subject.startswith("https://"))
    )


def endpoint_allowed(endpoint: str) -> bool:
    try:
        parsed = urlparse(endpoint)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    return any(host == h or host.endswith("." + h) for h in ALLOWED_ENDPOINT_HOSTS)


def roles_for_audience(audience: str) -> list[models.UserRole]:
    if audience == "student":
        return [models.UserRole.STUDENT]
    if audience == "faculty":
        return [models.UserRole.FACULTY]
    return [models.UserRole.STUDENT, models.UserRole.FACULTY]


def build_payload(n: models.Notification, reminder: bool = False) -> dict:
    """Deliberately minimal: no ids of other records, no file info, no secrets."""
    body = " ".join(n.body.split())
    return {
        "notification_id": n.id,
        "title": ("Reminder: " if reminder else "") + n.title[:120],
        "body": body[:PAYLOAD_BODY_CHARS],
        "url": "/notifications",
        "category": n.category,
        "priority": n.priority,
    }


def _send_one(info: dict, payload: str) -> None:
    """One delivery attempt; raises on failure. Replaced in tests."""
    webpush(
        subscription_info=info,
        data=payload,
        vapid_private_key=settings.vapid_private_key,
        # A fresh dict every call: pywebpush adds the audience to it.
        vapid_claims={"sub": settings.vapid_subject},
        ttl=24 * 60 * 60,
        timeout=SEND_TIMEOUT_SECONDS,
    )


def _attempt(info: dict, payload: str) -> Optional[int]:
    """None on success, otherwise the HTTP status (0 when there was none)."""
    try:
        _send_one(info, payload)
        return None
    except WebPushException as exc:
        return getattr(getattr(exc, "response", None), "status_code", None) or 0
    except Exception:  # network error, bad key, anything: never propagate
        return 0


def _eligible_subscriptions(db: Session, n: models.Notification) -> list[models.PushSubscription]:
    return (
        db.query(models.PushSubscription)
        .join(models.User, models.User.id == models.PushSubscription.user_id)
        .filter(
            models.PushSubscription.is_active.is_(True),
            models.PushSubscription.college_id == n.college_id,
            models.User.college_id == n.college_id,
            models.User.is_active.is_(True),
            models.User.role.in_(roles_for_audience(n.audience)),
        )
        .all()
    )


def send_for_notification(
    db: Session, notification_id: int, *, reminder: bool = False, now: Optional[datetime] = None
) -> dict:
    """Pushes a live notification to its audience's devices. Never raises."""
    result = {"sent": 0, "failed": 0, "deactivated": 0, "skipped": 0}
    try:
        if not is_configured() or webpush is None:
            result["skipped"] = 1
            return result
        now = now or datetime.utcnow()
        n = db.get(models.Notification, notification_id)
        if (
            n is None
            or n.status != "published"
            or not n.is_active
            or n.published_at > now
            or (n.expires_at is not None and n.expires_at <= now)
        ):
            result["skipped"] = 1
            return result

        subs = _eligible_subscriptions(db, n)
        if not subs:
            return result
        payload = json.dumps(build_payload(n, reminder), separators=(",", ":"))
        jobs = [
            (s.id, {"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}) for s in subs
        ]
        # Devices are independent: one slow or dead subscription never holds
        # up or cancels the others.
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            statuses = list(pool.map(lambda job: _attempt(job[1], payload), jobs))

        for (sub_id, _), status in zip(jobs, statuses):
            sub = db.get(models.PushSubscription, sub_id)
            if sub is None:
                continue
            if status is None:
                sub.last_success_at = now
                sub.failure_count = 0
                result["sent"] += 1
            else:
                sub.last_failure_at = now
                sub.failure_count = (sub.failure_count or 0) + 1
                result["failed"] += 1
                if status in PERMANENT_FAILURES or sub.failure_count >= MAX_CONSECUTIVE_FAILURES:
                    sub.is_active = False
                    result["deactivated"] += 1
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("push delivery failed for notification %s", notification_id)
    return result


def claim_initial_push(db: Session, notification_id: int, now: Optional[datetime] = None) -> bool:
    """Atomically marks the notification's initial push as taken. True for
    exactly one caller, and only while the notification is actually live
    (published, active, due, unexpired), so scheduled and draft items wait."""
    now = now or datetime.utcnow()
    claimed = db.execute(
        update(models.Notification)
        .where(
            models.Notification.id == notification_id,
            models.Notification.push_sent_at.is_(None),
            models.Notification.status == "published",
            models.Notification.is_active.is_(True),
            models.Notification.published_at <= now,
        )
        .values(push_sent_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount
    db.commit()
    return bool(claimed)


def release_due_pushes(db: Session, college_id: Optional[int] = None, now: Optional[datetime] = None) -> int:
    """Pushes notifications that went live after being created (scheduled
    ones, or drafts later published). Run from the same scheduler call as
    reminders; each is claimed first, so repeated runs never repeat a push."""
    now = now or datetime.utcnow()
    q = db.query(models.Notification.id).filter(
        models.Notification.push_sent_at.is_(None),
        models.Notification.status == "published",
        models.Notification.is_active.is_(True),
        models.Notification.published_at <= now,
    )
    if college_id is not None:
        q = q.filter(models.Notification.college_id == college_id)
    pushed = 0
    for (nid,) in q.all():
        if claim_initial_push(db, nid, now):
            send_for_notification(db, nid, now=now)
            pushed += 1
    return pushed


def push_initial_in_background(bind, notification_id: int) -> None:
    """BackgroundTasks entry point. Runs after the response is sent, so it
    opens its own session (the request's is already closed) and swallows every
    error: a push problem must never affect a publish that already succeeded."""
    try:
        with Session(bind=bind) as db:
            if claim_initial_push(db, notification_id):
                send_for_notification(db, notification_id)
    except Exception:
        logger.exception("background push failed for notification %s", notification_id)
