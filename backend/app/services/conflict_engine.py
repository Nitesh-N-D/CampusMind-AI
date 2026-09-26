"""
FEATURE 3 - Smart Conflict Detection

Runs after retrieval, over the set of chunks returned for a query. Looks for
chunks that discuss the same regulated topic (attendance %, fee amount,
deadline date, etc.) but assert different values, using a small library of
topic patterns. When found, a DocumentConflict record is created/updated and
surfaced to the user instead of silently picking one source.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models

TOPIC_PATTERNS = {
    "attendance_percentage": re.compile(
        r"(?:minimum\s+)?attendance[^.\n%]{0,40}?(\d{1,3})\s*%", re.IGNORECASE
    ),
    "fee_amount": re.compile(
        r"(?:fee|fees)[^.\n₹Rs]{0,40}?(?:₹|Rs\.?)\s?([\d,]{3,10})", re.IGNORECASE
    ),
    "cgpa_requirement": re.compile(
        r"(?:minimum\s+)?CGPA[^.\n\d]{0,20}?(\d\.\d{1,2})", re.IGNORECASE
    ),
}


@dataclass
class TopicMatch:
    topic: str
    value: str
    chunk: models.DocumentChunk


def extract_topic_values(chunk: models.DocumentChunk) -> List[TopicMatch]:
    matches: List[TopicMatch] = []
    for topic, pattern in TOPIC_PATTERNS.items():
        m = pattern.search(chunk.content)
        if m:
            matches.append(TopicMatch(topic=topic, value=m.group(1), chunk=chunk))
    return matches


def detect_conflicts(
    db: Session, college_id: int, chunks: List[models.DocumentChunk]
) -> List[models.DocumentConflict]:
    by_topic: dict[str, List[TopicMatch]] = {}
    for chunk in chunks:
        for match in extract_topic_values(chunk):
            by_topic.setdefault(match.topic, []).append(match)

    found: List[models.DocumentConflict] = []
    for topic, matches in by_topic.items():
        distinct_values = {m.value for m in matches}
        if len(distinct_values) < 2:
            continue

        # Compare the two chunks belonging to different documents with the
        # most divergent values; skip if it's the same document (versions of
        # itself don't count as a live conflict).
        by_doc: dict[int, TopicMatch] = {}
        for m in matches:
            by_doc[m.chunk.document_id] = m
        doc_matches = list(by_doc.values())
        if len(doc_matches) < 2:
            continue

        a, b = doc_matches[0], doc_matches[1]
        doc_a = db.query(models.Document).get(a.chunk.document_id)
        doc_b = db.query(models.Document).get(b.chunk.document_id)
        if not doc_a or not doc_b or a.value == b.value:
            continue

        newer, older = (doc_a, doc_b) if (doc_a.effective_date or doc_a.created_at) >= (
            doc_b.effective_date or doc_b.created_at
        ) else (doc_b, doc_a)
        suggested = newer if newer.trust_score >= older.trust_score - 15 else older

        existing = (
            db.query(models.DocumentConflict)
            .filter(
                models.DocumentConflict.college_id == college_id,
                models.DocumentConflict.topic == topic,
                models.DocumentConflict.document_a_id.in_([doc_a.id, doc_b.id]),
                models.DocumentConflict.document_b_id.in_([doc_a.id, doc_b.id]),
                models.DocumentConflict.status == "open",
            )
            .first()
        )
        if existing:
            found.append(existing)
            continue

        conflict = models.DocumentConflict(
            college_id=college_id,
            topic=topic.replace("_", " "),
            document_a_id=doc_a.id,
            chunk_a_id=a.chunk.id,
            value_a=a.value,
            document_b_id=doc_b.id,
            chunk_b_id=b.chunk.id,
            value_b=b.value,
            suggested_authoritative_id=suggested.id,
            reasoning=(
                f"'{newer.title}' has a more recent effective date than "
                f"'{older.title}', so it is suggested as authoritative pending "
                f"admin review."
            ),
        )
        db.add(conflict)
        db.flush()
        found.append(conflict)

    return found
