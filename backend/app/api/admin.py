from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import require_role
from app.db import models
from app.db.database import get_db
from app.schemas.schemas import (
    ConflictOut,
    ConflictResolve,
    FacultyDomainUpdate,
    KnowledgeHealthOut,
    LoginEventOut,
    LoginEventPage,
    WorkspaceSettingsOut,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/knowledge-health", response_model=KnowledgeHealthOut)
def knowledge_health(
    db: Session = Depends(get_db), admin: models.User = Depends(require_role("admin"))
):
    cid = admin.college_id
    total = db.query(models.Document).filter(models.Document.college_id == cid).count()
    verified = db.query(models.Document).filter(
        models.Document.college_id == cid, models.Document.is_verified.is_(True)
    ).count()
    outdated = db.query(models.Document).filter(
        models.Document.college_id == cid,
        models.Document.expiry_date.isnot(None),
        models.Document.expiry_date < datetime.utcnow(),
    ).count()
    conflicting_doc_ids = set()
    open_conflicts = db.query(models.DocumentConflict).filter(
        models.DocumentConflict.college_id == cid, models.DocumentConflict.status == "open"
    ).all()
    for c in open_conflicts:
        conflicting_doc_ids.add(c.document_a_id)
        conflicting_doc_ids.add(c.document_b_id)
    unprocessed = db.query(models.Document).filter(
        models.Document.college_id == cid,
        models.Document.status.in_(
            [models.DocumentStatus.UPLOADED, models.DocumentStatus.PROCESSING, models.DocumentStatus.FAILED]
        ),
    ).count()

    # count() of a portable func.distinct() rather than .distinct(column),
    # since the latter compiles to Postgres-only DISTINCT ON syntax and is
    # silently wrong (uncounted) on SQLite, our default free-tier database.
    low_confidence_topics = (
        db.query(func.count(func.distinct(models.SearchLog.query)))
        .filter(
            models.SearchLog.college_id == cid,
            models.SearchLog.top_confidence.isnot(None),
            models.SearchLog.top_confidence < 40,
        )
        .scalar()
        or 0
    )

    if total == 0:
        health_score = 0.0
    else:
        verified_ratio = verified / total
        clean_ratio = 1 - (len(conflicting_doc_ids) / total)
        current_ratio = 1 - (outdated / total)
        processed_ratio = 1 - (unprocessed / total)
        health_score = round(
            100
            * (0.35 * verified_ratio + 0.25 * clean_ratio + 0.25 * current_ratio + 0.15 * processed_ratio),
            1,
        )

    return KnowledgeHealthOut(
        health_score=max(0.0, min(100.0, health_score)),
        documents_indexed=total,
        verified=verified,
        outdated=outdated,
        conflicting=len(conflicting_doc_ids),
        unprocessed=unprocessed,
        low_confidence_topics=low_confidence_topics,
    )


@router.get("/conflicts", response_model=List[ConflictOut])
def list_conflicts(
    status: str = "open",
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    return (
        db.query(models.DocumentConflict)
        .filter(models.DocumentConflict.college_id == admin.college_id, models.DocumentConflict.status == status)
        .order_by(models.DocumentConflict.created_at.desc())
        .all()
    )


@router.post("/conflicts/{conflict_id}/resolve", response_model=ConflictOut)
def resolve_conflict(
    conflict_id: int,
    payload: ConflictResolve,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    conflict = db.query(models.DocumentConflict).filter(
        models.DocumentConflict.id == conflict_id, models.DocumentConflict.college_id == admin.college_id
    ).first()
    if not conflict:
        raise HTTPException(status_code=404, detail="Conflict not found")
    if payload.authoritative_document_id not in (conflict.document_a_id, conflict.document_b_id):
        raise HTTPException(status_code=400, detail="Authoritative document must be one of the two in conflict")

    conflict.status = "resolved"
    conflict.resolved_by = admin.id
    conflict.resolution_note = payload.resolution_note
    conflict.suggested_authoritative_id = payload.authoritative_document_id

    losing_id = (
        conflict.document_b_id
        if payload.authoritative_document_id == conflict.document_a_id
        else conflict.document_a_id
    )
    losing_doc = db.query(models.Document).get(losing_id)
    if losing_doc:
        losing_doc.status = models.DocumentStatus.ARCHIVED

    db.commit()
    db.refresh(conflict)
    return conflict


@router.get("/analytics")
def analytics(db: Session = Depends(get_db), admin: models.User = Depends(require_role("admin"))):
    cid = admin.college_id
    since = datetime.utcnow() - timedelta(days=30)

    # Only student/faculty conversations count as usage - admin test
    # questions (sent to verify an upload) are excluded.
    end_user_answers = (
        db.query(models.ChatMessage)
        .join(models.ChatSession)
        .join(models.User, models.ChatSession.user_id == models.User.id)
        .filter(
            models.ChatSession.college_id == cid,
            models.ChatMessage.role == "assistant",
            models.User.role != models.UserRole.ADMIN,
        )
    )
    total_questions = end_user_answers.count()

    unanswered = db.query(models.SearchLog).filter(
        models.SearchLog.college_id == cid, models.SearchLog.was_answered.is_(False)
    ).count()

    low_confidence = end_user_answers.filter(
        models.ChatMessage.confidence.isnot(None),
        models.ChatMessage.confidence < 40,
    ).count()

    top_queries = (
        db.query(models.SearchLog.query, func.count(models.SearchLog.id).label("count"))
        .filter(models.SearchLog.college_id == cid, models.SearchLog.created_at >= since)
        .group_by(models.SearchLog.query)
        .order_by(func.count(models.SearchLog.id).desc())
        .limit(10)
        .all()
    )

    recent_uploads = (
        db.query(models.Document)
        .filter(models.Document.college_id == cid)
        .order_by(models.Document.created_at.desc())
        .limit(8)
        .all()
    )

    return {
        "total_questions_answered": total_questions,
        "unanswered_questions": unanswered,
        "low_confidence_responses": low_confidence,
        "top_queries": [{"query": q, "count": c} for q, c in top_queries],
        "recent_uploads": [
            {"id": d.id, "title": d.title, "status": d.status.value, "created_at": d.created_at}
            for d in recent_uploads
        ],
    }


def _as_naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    # Stored timestamps are naive UTC; bring timezone-aware filters in line.
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


@router.get("/login-events", response_model=LoginEventPage)
def login_events(
    role: Optional[Literal["student", "faculty"]] = None,
    start: Optional[datetime] = Query(None, description="Inclusive lower bound (ISO 8601)."),
    end: Optional[datetime] = Query(None, description="Exclusive upper bound (ISO 8601)."),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    """Student and faculty sign-ins and registrations for the admin's own
    college, newest first."""
    start, end = _as_naive_utc(start), _as_naive_utc(end)
    if start and end and start >= end:
        raise HTTPException(status_code=400, detail="The start of the date range must be before the end.")

    q = (
        db.query(models.LoginEvent, models.User)
        .join(models.User, models.LoginEvent.user_id == models.User.id)
        .filter(models.LoginEvent.college_id == admin.college_id)
    )
    if role:
        q = q.filter(models.LoginEvent.role == role)
    if start:
        q = q.filter(models.LoginEvent.created_at >= start)
    if end:
        q = q.filter(models.LoginEvent.created_at < end)

    total = q.count()
    rows = (
        q.order_by(models.LoginEvent.created_at.desc(), models.LoginEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return LoginEventPage(
        items=[
            LoginEventOut(
                id=event.id,
                user_id=user.id,
                full_name=user.full_name,
                email=user.email,
                role=event.role,
                event_type=event.event_type,
                created_at=event.created_at.replace(tzinfo=timezone.utc),
            )
            for event, user in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


def _settings_out(college: models.College) -> WorkspaceSettingsOut:
    return WorkspaceSettingsOut(
        college_name=college.name,
        official_domain=college.official_domain,
        faculty_domain=college.faculty_domain,
    )


@router.get("/settings", response_model=WorkspaceSettingsOut)
def get_workspace_settings(
    db: Session = Depends(get_db), admin: models.User = Depends(require_role("admin"))
):
    return _settings_out(admin.college)


@router.put("/settings/faculty-domain", response_model=WorkspaceSettingsOut)
def set_faculty_domain(
    payload: FacultyDomainUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    """The only place faculty_domain can be set, changed, or cleared.
    Clearing it (null) closes faculty signup again; existing faculty
    accounts are unaffected."""
    college = admin.college
    domain = payload.faculty_domain
    if domain is not None:
        taken = (
            db.query(models.College)
            .filter(models.College.id != college.id)
            .filter(
                (models.College.official_domain == domain)
                | (models.College.faculty_domain == domain)
            )
            .first()
        )
        if taken:
            raise HTTPException(
                status_code=409, detail="That domain is already registered to another college."
            )
    college.faculty_domain = domain
    db.commit()
    db.refresh(college)
    return _settings_out(college)
