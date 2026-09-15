"""
FEATURE 7 - "What Changed?" Intelligence

When a document is uploaded with `supersedes_id` set, compare the two
documents' chunks for the same regulated topics (reusing the conflict
engine's topic patterns, since "different value for the same topic across
versions" is exactly a change) and produce a structured, LLM-summarized
impact statement.
"""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models
from app.services.ai_provider import AIProvider
from app.services.conflict_engine import TOPIC_PATTERNS


async def detect_changes(
    db: Session,
    old_doc: models.Document,
    new_doc: models.Document,
    ai: AIProvider,
) -> List[models.DocumentChangeLog]:
    old_text = " ".join(c.content for c in old_doc.chunks)
    new_text = " ".join(c.content for c in new_doc.chunks)

    logs: List[models.DocumentChangeLog] = []
    for topic, pattern in TOPIC_PATTERNS.items():
        old_match = pattern.search(old_text)
        new_match = pattern.search(new_text)
        if not old_match or not new_match:
            continue
        old_value, new_value = old_match.group(1), new_match.group(1)
        if old_value == new_value:
            continue

        impact = await _summarize_impact(ai, topic, old_value, new_value)
        log = models.DocumentChangeLog(
            college_id=new_doc.college_id,
            old_document_id=old_doc.id,
            new_document_id=new_doc.id,
            field_or_topic=topic.replace("_", " "),
            old_value=old_value,
            new_value=new_value,
            impact_summary=impact,
        )
        db.add(log)
        logs.append(log)

    db.flush()
    return logs


async def _summarize_impact(ai: AIProvider, topic: str, old_value: str, new_value: str) -> str:
    fallback = f"{topic.replace('_', ' ').title()} changed from {old_value} to {new_value}."

    system = (
        "You explain regulation changes to college students in one plain, "
        "neutral sentence. Never invent extra facts beyond the two values given."
    )
    prompt = (
        f"Topic: {topic.replace('_', ' ')}\nOld value: {old_value}\nNew value: {new_value}\n"
        "Write one short sentence describing the practical impact of this change for students."
    )
    try:
        result = await ai.generate(system, prompt)
    except Exception:
        return fallback

    # Every real provider wraps MockProvider when it has no API key configured
    # (see GeminiProvider/OpenAIProvider/ClaudeProvider.generate). Its raw
    # prompt dump is useful in chat but not for this short structured field,
    # so detect the marker and use the deterministic sentence instead.
    if "[Offline demo mode" in result:
        return fallback
    return result
