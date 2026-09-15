from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

from app.ingestion.pdf_processor import PageContent

CHUNK_TARGET_CHARS = 900
CHUNK_OVERLAP_CHARS = 150


@dataclass
class Chunk:
    content: str
    page_number: int
    heading: str | None


def _split_sentences(text: str) -> List[str]:
    return re.split(r"(?<=[.!?])\s+", text)


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
