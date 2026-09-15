from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import require_role
from app.db import models
from app.db.database import get_db
from app.schemas.schemas import ConflictOut, ConflictResolve, KnowledgeHealthOut

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

    total_questions = db.query(models.ChatMessage).join(models.ChatSession).filter(
        models.ChatSession.college_id == cid, models.ChatMessage.role == "assistant"
    ).count()

    unanswered = db.query(models.SearchLog).filter(
        models.SearchLog.college_id == cid, models.SearchLog.was_answered.is_(False)
    ).count()

    low_confidence = db.query(models.ChatMessage).join(models.ChatSession).filter(
        models.ChatSession.college_id == cid,
        models.ChatMessage.role == "assistant",
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


@router.get("/change-logs")
def change_logs(db: Session = Depends(get_db), admin: models.User = Depends(require_role("admin"))):
    logs = (
        db.query(models.DocumentChangeLog)
        .filter(models.DocumentChangeLog.college_id == admin.college_id)
        .order_by(models.DocumentChangeLog.created_at.desc())
        .all()
    )
    return [
        {
            "id": l.id,
            "old_document_id": l.old_document_id,
            "new_document_id": l.new_document_id,
            "topic": l.field_or_topic,
            "old_value": l.old_value,
            "new_value": l.new_value,
            "impact_summary": l.impact_summary,
            "created_at": l.created_at,
        }
        for l in logs
    ]
