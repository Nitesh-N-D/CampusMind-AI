"""Admin-only insight endpoints: unanswered questions, answer feedback, and
the shared feedback totals used by the analytics dashboard. Everything is
scoped to the admin's own college and carries no student identity."""
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.security import require_role
from app.db import models
from app.db.database import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


def feedback_totals(db: Session, college_id: int) -> tuple[int, int]:
    rows = (
        db.query(models.ChatMessage.feedback, func.count(models.ChatMessage.id))
        .join(models.ChatSession, models.ChatMessage.session_id == models.ChatSession.id)
        .filter(models.ChatSession.college_id == college_id, models.ChatMessage.feedback.in_(("up", "down")))
        .group_by(models.ChatMessage.feedback)
        .all()
    )
    totals = dict(rows)
    return totals.get("up", 0), totals.get("down", 0)


def _normalized_query():
    # The same question typed with different case/spacing counts once.
    return func.lower(func.trim(models.SearchLog.query))


class UnansweredResolve(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    document_id: Optional[int] = None


@router.get("/unanswered")
def unanswered_questions(
    status: Literal["open", "resolved", "all"] = "open",
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    """Questions the assistant could not answer, grouped by wording and ranked
    by how often they were asked."""
    norm = _normalized_query()
    open_rows = func.sum(case((models.SearchLog.resolved_at.is_(None), 1), else_=0))
    q = (
        db.query(
            norm.label("q"),
            func.count(models.SearchLog.id).label("n"),
            func.max(models.SearchLog.created_at).label("last_asked"),
            func.avg(models.SearchLog.top_confidence).label("avg_conf"),
            func.max(models.SearchLog.result_count).label("sources"),
            open_rows.label("open_n"),
            func.max(models.SearchLog.linked_document_id).label("doc_id"),
            func.max(models.SearchLog.reason).label("reason"),
        )
        .filter(models.SearchLog.college_id == admin.college_id, models.SearchLog.was_answered.is_(False))
        .group_by(norm)
    )
    if status == "open":
        q = q.having(open_rows > 0)
    elif status == "resolved":
        q = q.having(open_rows == 0)
    rows = (
        q.order_by(func.count(models.SearchLog.id).desc(), func.max(models.SearchLog.created_at).desc())
        .limit(limit)
        .all()
    )

    doc_titles: dict[int, str] = {}
    doc_ids = {r.doc_id for r in rows if r.doc_id}
    if doc_ids:
        doc_titles = dict(
            db.query(models.Document.id, models.Document.title)
            .filter(models.Document.college_id == admin.college_id, models.Document.id.in_(doc_ids))
            .all()
        )
    return [
        {
            "query": r.q,
            "frequency": r.n,
            "last_asked": r.last_asked,
            "avg_confidence": round(r.avg_conf, 1) if r.avg_conf is not None else None,
            "source_count": r.sources or 0,
            "reason": r.reason,
            "status": "open" if (r.open_n or 0) > 0 else "resolved",
            "linked_document": {"id": r.doc_id, "title": doc_titles[r.doc_id]} if r.doc_id in doc_titles else None,
        }
        for r in rows
    ]


@router.post("/unanswered/resolve")
def resolve_unanswered(
    payload: UnansweredResolve,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    if payload.document_id is not None:
        doc = (
            db.query(models.Document)
            .filter(models.Document.id == payload.document_id, models.Document.college_id == admin.college_id)
            .first()
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
    rows = (
        db.query(models.SearchLog)
        .filter(
            models.SearchLog.college_id == admin.college_id,
            models.SearchLog.was_answered.is_(False),
            models.SearchLog.resolved_at.is_(None),
            _normalized_query() == payload.query.strip().lower(),
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No open questions match that wording")
    now = datetime.utcnow()
    for row in rows:
        row.resolved_at = now
        row.linked_document_id = payload.document_id
    db.commit()
    return {"status": "resolved", "resolved": len(rows)}


@router.get("/feedback")
def feedback_summary(db: Session = Depends(get_db), admin: models.User = Depends(require_role("admin"))):
    """Aggregated thumbs up/down with reasons."""
    cid = admin.college_id
    up, down = feedback_totals(db, cid)
    reasons = dict(
        db.query(models.ChatMessage.feedback_reason, func.count(models.ChatMessage.id))
        .join(models.ChatSession, models.ChatMessage.session_id == models.ChatSession.id)
        .filter(
            models.ChatSession.college_id == cid,
            models.ChatMessage.feedback == "down",
            models.ChatMessage.feedback_reason.isnot(None),
        )
        .group_by(models.ChatMessage.feedback_reason)
        .all()
    )
    recent = (
        db.query(models.ChatMessage)
        .join(models.ChatSession, models.ChatMessage.session_id == models.ChatSession.id)
        .filter(models.ChatSession.college_id == cid, models.ChatMessage.feedback == "down")
        .order_by(models.ChatMessage.id.desc())
        .limit(20)
        .all()
    )
    return {
        "helpful": up,
        "not_helpful": down,
        "helpful_ratio": round(up / (up + down), 3) if (up + down) else None,
        "reasons": reasons,
        "recent_not_helpful": [
            {
                "message_id": m.id,
                "reason": m.feedback_reason,
                "note": m.feedback_note,
                "answer_excerpt": (m.content or "")[:240],
                "confidence": m.confidence,
                "created_at": m.created_at,
            }
            for m in recent
        ],
    }
