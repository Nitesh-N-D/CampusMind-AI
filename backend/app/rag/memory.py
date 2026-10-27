"""
Conversation memory for chat.

Two kinds of context, both strictly the asking user's own:

* the recent turns of the *current* conversation, used to resolve follow-ups
  ("From which places?", "explain it in more detail");
* a few relevant turns from the user's *earlier* conversations, found by
  keyword overlap with the resolved question.

This is context for understanding the student, never evidence about college
documents - the prompt says so and these turns are never turned into citations.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.rag.text import content_terms

# Recent window of the current conversation: the last few messages only.
HISTORY_MESSAGES = 6
HISTORY_CHARS = 600

# Earlier conversations: scan the user's most recent messages, keep a few turns.
MEMORY_SCAN_MESSAGES = 400
MEMORY_TURNS = 3
MIN_MEMORY_COVERAGE = 0.6
MEMORY_CHARS = 500

INSUFFICIENT = "insufficient_evidence"


@dataclass
class MemoryTurn:
    when: datetime
    question: str
    answer: Optional[str]
    session_id: int


def _clip(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def recent_turns(session: Optional[models.ChatSession]) -> List[dict]:
    """The last few messages of the current conversation, oldest first."""
    if session is None:
        return []
    msgs = session.messages[-HISTORY_MESSAGES:]
    return [{"role": m.role, "content": _clip(m.content, HISTORY_CHARS)} for m in msgs]


def search_memory(
    db: Session, user_id: int, exclude_session_id: Optional[int], query: str
) -> List[MemoryTurn]:
    """Relevant turns from this user's other conversations, oldest first.

    Always filtered by user_id, so another user's history can never match.
    A turn is a question plus the answer that followed it; answers that were
    refusals carry no information and are left out."""
    terms = set(content_terms(query))
    if not terms:
        return []

    q = (
        db.query(models.ChatMessage, models.ChatSession.id)
        .join(models.ChatSession, models.ChatMessage.session_id == models.ChatSession.id)
        .filter(models.ChatSession.user_id == user_id)
    )
    if exclude_session_id is not None:
        q = q.filter(models.ChatSession.id != exclude_session_id)
    rows = q.order_by(models.ChatMessage.id.desc()).limit(MEMORY_SCAN_MESSAGES).all()

    turns: List[MemoryTurn] = []
    pending: dict = {}  # session id -> the user message waiting for its answer
    for msg, session_id in reversed(rows):  # oldest first
        if msg.role == "user":
            if session_id in pending:  # a question that never got an answer
                prev = pending.pop(session_id)
                turns.append(MemoryTurn(prev.created_at, prev.content, None, session_id))
            pending[session_id] = msg
        elif session_id in pending:
            asked = pending.pop(session_id)
            answered = getattr(msg, "answer_status", None) != INSUFFICIENT
            turns.append(MemoryTurn(asked.created_at, asked.content, msg.content if answered else None, session_id))
    for session_id, asked in pending.items():
        turns.append(MemoryTurn(asked.created_at, asked.content, None, session_id))

    scored = []
    for turn in turns:
        text = turn.question + (" " + turn.answer if turn.answer else "")
        coverage = len(terms & set(content_terms(text))) / len(terms)
        if coverage >= MIN_MEMORY_COVERAGE:
            scored.append((coverage, turn.when, turn))
    # Best match first, ties broken by recency; then shown oldest-first so the
    # model reads corrections after the statements they correct.
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    chosen = [t for _, _, t in scored[:MEMORY_TURNS]]
    chosen.sort(key=lambda t: t.when)
    return chosen


def format_history(history: List[dict]) -> str:
    return "\n".join(
        f"{'Student' if m['role'] == 'user' else 'CampusMind'}: {m['content']}" for m in history
    )


def format_memory(turns: List[MemoryTurn]) -> str:
    lines = []
    for i, t in enumerate(turns):
        latest = " (most recent)" if i == len(turns) - 1 and len(turns) > 1 else ""
        stamp = t.when.strftime("%Y-%m-%d %H:%M") if t.when else "unknown date"
        line = f"[{stamp}{latest}] Student: {_clip(t.question, MEMORY_CHARS)}"
        if t.answer:
            line += f"\n    CampusMind: {_clip(t.answer, MEMORY_CHARS)}"
        lines.append(line)
    return "\n".join(lines)
