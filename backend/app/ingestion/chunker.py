from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from app.ingestion.extractors import PageContent

CHUNK_TARGET_CHARS = 900
CHUNK_OVERLAP_CHARS = 150


@dataclass
class Chunk:
    content: str
    # None for formats without pages (Word, spreadsheets, text, images).
    page_number: Optional[int]
    heading: str | None


def _split_sentences(text: str) -> List[str]:
    # Line breaks are boundaries too: spreadsheet rows, list items and OCR
    # lines rarely end in punctuation, and must not be glued mid-row.
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def chunk_pages(pages: List[PageContent]) -> List[Chunk]:
    chunks: List[Chunk] = []
    for page in pages:
        if not page.text:
            continue
        sentences = _split_sentences(page.text)
        buf = ""
        for sentence in sentences:
            if len(buf) + len(sentence) > CHUNK_TARGET_CHARS and buf:
                chunks.append(Chunk(content=buf.strip(), page_number=page.page_number, heading=page.heading))
                buf = buf[-CHUNK_OVERLAP_CHARS:] + " " + sentence
            else:
                buf = (buf + " " + sentence).strip()
        if buf.strip():
            chunks.append(Chunk(content=buf.strip(), page_number=page.page_number, heading=page.heading))
    return chunks
