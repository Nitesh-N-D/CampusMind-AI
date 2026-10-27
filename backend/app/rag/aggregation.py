"""
Deterministic counting over structured documents (spreadsheets, CSVs, tables).

Ingestion turns every table row into one sentence ("Route No: R3; Starting
Point: Velachery; ...."). A count such as "how many bus routes are there?"
must not depend on the model counting however many chunks retrieval returned
(capped), so the rows of the matched document are counted here, over *all* of
its chunks, and the exact figure is handed to the model.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db import models

# Above this many rows the full list is not sent to the model; only the exact
# total is, and the answer is told the list is not complete.
MAX_LISTED_ROWS = 150
MIN_ROWS = 2

_LABEL = re.compile(r"^([^:;]{1,60}):\s")
# A sentence boundary directly followed by the next "Label: value" sentence.
# Values such as "T. Nagar" or "Rs. 18,000" don't match: a ';' or end of text
# follows before any ':'.
_BOUNDARY = re.compile(r"(?<=\.)\s+(?=[^:;.\n]{1,60}:\s)")
_PAIR = re.compile(r"[^:;]{1,60}:\s*\S")


@dataclass
class RecordCount:
    document_id: int
    title: str
    rows: List[str]

    @property
    def total(self) -> int:
        return len(self.rows)

    @property
    def listed(self) -> bool:
        return self.total <= MAX_LISTED_ROWS


def _is_row(sentence: str) -> bool:
    return len(_PAIR.findall(sentence)) >= 2


def _sentences(content: str) -> List[str]:
    return [s.strip() for s in _BOUNDARY.split(content.strip()) if s.strip()]


def count_records(db: Session, document: models.Document) -> Optional[RecordCount]:
    """Every distinct table row of `document`, or None if it isn't tabular.

    Chunks overlap by trailing sentences, so rows are de-duplicated. Two rows
    that are word-for-word identical therefore count once, which is right for
    "how many distinct routes" and is the documented limitation otherwise."""
    chunks = (
        db.query(models.DocumentChunk)
        .filter(
            models.DocumentChunk.document_id == document.id,
            models.DocumentChunk.college_id == document.college_id,
        )
        .order_by(models.DocumentChunk.chunk_index)
        .all()
    )
    per_chunk = [_sentences(c.content) for c in chunks]
    firsts = Counter(
        m.group(1) for sents in per_chunk for s in sents if _is_row(s) and (m := _LABEL.match(s))
    )
    if not firsts:
        return None
    lead = firsts.most_common(1)[0][0]

    rows: List[str] = []
    seen = set()
    total_sentences = 0
    for sents in per_chunk:
        current: List[str] = []
        for i, s in enumerate(sents):
            m = _LABEL.match(s)
            if m and m.group(1) == lead:
                current.append(s)
            elif current:
                current[-1] = f"{current[-1]} {s}"  # a value that contained a sentence break
            # else: a leading fragment (older character-based overlap); its row
            # is complete in the previous chunk.
        total_sentences += len(sents)
        for s in current:
            key = re.sub(r"\s+", " ", s).strip().lower()
            if key not in seen:
                seen.add(key)
                rows.append(s)

    # Mostly-prose documents that happen to contain "Note: x; Other: y." lines
    # are not tables.
    if len(rows) < MIN_ROWS or len(rows) < 0.5 * total_sentences:
        return None
    return RecordCount(document.id, document.title, rows)


def record_count_block(counted: RecordCount) -> str:
    lines = [
        f'Exact record count: the document "{counted.title}" contains {counted.total} records (table rows) in '
        "total, counted programmatically over the whole document. If the question asks how many records or "
        f"items the document has, the answer is {counted.total}. Do not recount from the sources."
    ]
    if counted.listed:
        lines.append("Complete record list (use this, not the sources, for any filtered count):")
        lines.extend(f"{i}. {row}" for i, row in enumerate(counted.rows, start=1))
    else:
        lines.append(
            f"The full list is too long to show ({counted.total} records). For a count with a condition, say that "
            "only the exact total is certain and the filtered figure cannot be confirmed."
        )
    return "\n".join(lines)
