from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db import models
from app.db.database import get_db
from app.rag.memory import recent_turns
from app.rag.pipeline import answer_question
from app.schemas.schemas import ChatRequest, ChatResponse, FeedbackRequest
from app.services.ai_provider import get_ai_provider
from app.services.chat_export import build_pdf, build_txt

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _utc(value: Optional[datetime]) -> Optional[datetime]:
    # Stored naive UTC; mark it so browsers don't read it as local time.
    return value.replace(tzinfo=timezone.utc) if value else None


def _selectable_documents(db: Session, user: models.User):
    """Documents this user may scope a question to: their own college's READY
    documents, narrowed for students to their department (or college-wide
    ones) - the same visibility rule the unscoped search applies."""
    q = db.query(models.Document).filter(
        models.Document.college_id == user.college_id,
        models.Document.status == models.DocumentStatus.READY,
    )
    if user.role == models.UserRole.STUDENT and user.department:
        q = q.filter(
            (models.Document.department == user.department) | (models.Document.department.is_(None))
        )
    return q


@router.get("/documents")
def list_chat_documents(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    docs = _selectable_documents(db, user).order_by(models.Document.title, models.Document.id).all()
    return [
        {
            "id": d.id,
            "title": d.title,
            "filename": d.original_filename,
            "document_type": d.document_type,
            "department": d.department,
            "page_count": d.page_count,
            "uploaded_at": _utc(d.created_at),
        }
        for d in docs
    ]


def _resolve_scope(db: Session, user: models.User, document_id: int) -> models.Document:
    """Validates a client-supplied document id on the server. Unknown ids,
    other colleges' documents and ones outside the user's visibility all look
    the same (404) so existence isn't leaked."""
    doc = db.query(models.Document).filter(
        models.Document.id == document_id, models.Document.college_id == user.college_id
    ).first()
    if doc is not None and user.role == models.UserRole.STUDENT and user.department:
        if doc.department and doc.department != user.department:
            doc = None
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status in (models.DocumentStatus.UPLOADED, models.DocumentStatus.PROCESSING):
        raise HTTPException(status_code=409, detail="This document is still being processed. Try again in a moment.")
    if doc.status == models.DocumentStatus.FAILED:
        raise HTTPException(
            status_code=409,
            detail=doc.processing_error or "This document could not be processed, so it can't be searched.",
        )
    if not db.query(models.DocumentChunk.id).filter(models.DocumentChunk.document_id == doc.id).first():
        raise HTTPException(status_code=409, detail="This document has no readable text, so it can't be searched.")
    return doc


@router.post("/message", response_model=ChatResponse)
async def send_message(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    session = None
    if payload.session_id:
        session = db.query(models.ChatSession).filter(
            models.ChatSession.id == payload.session_id,
            models.ChatSession.user_id == user.id,
        ).first()
        if not session:
            raise HTTPException(status_code=404, detail="Conversation not found")

    if payload.document_id is not None:
        _resolve_scope(db, user, payload.document_id)

    asked_at = datetime.utcnow()
    ai = get_ai_provider()
    result = await answer_question(
        db=db,
        college_id=user.college_id,
        query=payload.message,
        ai=ai,
        student=user if user.role == models.UserRole.STUDENT else None,
        response_language=payload.language or "en",
        document_id=payload.document_id,
        history=recent_turns(session),
        user_id=user.id,
        session_id=session.id if session else None,
    )

    # Written only once there is an answer: if the AI call fails, the user
    # isn't left with a conversation holding an unanswered question.
    if session is None:
        session = models.ChatSession(
            college_id=user.college_id,
            user_id=user.id,
            title=payload.message[:60],
            language=payload.language or "en",
            created_at=asked_at,
        )
        db.add(session)
        db.flush()
    db.add(models.ChatMessage(session_id=session.id, role="user", content=payload.message, created_at=asked_at))
    db.flush()

    assistant_msg = models.ChatMessage(
        session_id=session.id,
        role="assistant",
        content=result.answer,
        citations=result.citations,
        confidence=result.confidence,
        has_conflict=result.has_conflict,
        conflict_ids=[c["id"] for c in result.conflicts],
        answer_status=result.answer_status,
        answer_basis=result.basis,
        retrieval_ms=result.retrieval_ms,
        llm_ms=result.llm_ms,
    )
    db.add(assistant_msg)

    # Chat is built for students and faculty. Admins can send test questions
    # to verify an upload, but those must not skew the usage analytics and
    # low-confidence metrics that describe what real end users are asking.
    if user.role != models.UserRole.ADMIN:
        db.add(
            models.SearchLog(
                college_id=user.college_id,
                user_id=user.id,
                query=payload.message[:500],  # the column is VARCHAR(500)
                result_count=len(result.citations),
                top_confidence=result.confidence,
                was_answered=not result.abstained,
                reason=result.reason,
                language=payload.language or "en",
            )
        )

    db.commit()
    db.refresh(assistant_msg)

    return ChatResponse(
        session_id=session.id,
        message_id=assistant_msg.id,
        answer=result.answer,
        citations=result.citations,
        confidence=result.confidence,
        has_conflict=result.has_conflict,
        conflicts=result.conflicts,
        retrieval_ms=result.retrieval_ms,
        llm_ms=result.llm_ms,
        abstained=result.abstained,
        answer_status=result.answer_status,
        basis=result.basis,
    )


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    sessions = (
        db.query(models.ChatSession)
        .filter(models.ChatSession.user_id == user.id)
        .order_by(models.ChatSession.created_at.desc())
        .all()
    )
    return [{"id": s.id, "title": s.title, "created_at": _utc(s.created_at)} for s in sessions]


@router.get("/export")
def export_conversations(
    session_id: List[int] = Query(..., min_length=1, max_length=50),
    fmt: Literal["pdf", "txt"] = Query("pdf", alias="format"),
    tz_offset: int = Query(0, ge=-840, le=840, description="Reader's offset from UTC, in minutes"),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    wanted = set(session_id)
    sessions = (
        db.query(models.ChatSession)
        .filter(models.ChatSession.id.in_(wanted), models.ChatSession.user_id == user.id)
        .order_by(models.ChatSession.created_at, models.ChatSession.id)
        .all()
    )
    # Someone else's conversation looks exactly like a missing one.
    if len(sessions) != len(wanted):
        raise HTTPException(status_code=404, detail="Conversation not found")

    build = build_pdf if fmt == "pdf" else build_txt
    content, filename = build(user, sessions, tz_offset)
    return Response(
        content=content,
        media_type="application/pdf" if fmt == "pdf" else "text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sessions/{session_id}/messages")
def get_messages(
    session_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
):
    session = db.query(models.ChatSession).filter(
        models.ChatSession.id == session_id, models.ChatSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "citations": m.citations,
            "confidence": m.confidence,
            "has_conflict": m.has_conflict,
            "answer_status": m.answer_status,
            "basis": m.answer_basis,
            "created_at": _utc(m.created_at),
        }
        for m in session.messages
    ]


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
):
    session = db.query(models.ChatSession).filter(
        models.ChatSession.id == session_id, models.ChatSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
    return {"status": "deleted"}


@router.post("/messages/{message_id}/feedback")
def submit_feedback(
    message_id: int,
    payload: FeedbackRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    msg = (
        db.query(models.ChatMessage)
        .join(models.ChatSession)
        .filter(models.ChatMessage.id == message_id, models.ChatSession.user_id == user.id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    msg.feedback = payload.feedback
    # Reasons only make sense for a thumbs-down; a later thumbs-up clears them.
    msg.feedback_reason = payload.reason if payload.feedback == "down" else None
    msg.feedback_note = payload.note
    db.commit()
    return {"status": "recorded"}
