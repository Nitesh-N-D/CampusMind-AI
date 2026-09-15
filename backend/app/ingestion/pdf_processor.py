"""
FEATURE 8 (part 1) - Multi-modal document understanding: text extraction.

Extracts text per-page from a PDF, preserving page numbers so citations can
point students to an exact page. If a page has (almost) no extractable text,
it's flagged as likely-scanned; a real deployment would route those pages to
an OCR engine (e.g. Tesseract or a cloud OCR API) before chunking - the hook
is `ocr_fallback()` below so that swap-in doesn't touch the rest of the
pipeline.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

from pypdf import PdfReader


@dataclass
class PageContent:
    page_number: int
    text: str
    likely_scanned: bool
    heading: str | None


HEADING_PATTERN = re.compile(r"^(?:[0-9]+(\.[0-9]+)*\.?\s+)?[A-Z][A-Za-z0-9 ,'&/-]{3,80}$")


def detect_heading(text: str) -> str | None:
    for line in text.splitlines():
        line = line.strip()
        if 4 <= len(line) <= 90 and HEADING_PATTERN.match(line):
            return line
    return None


def ocr_fallback(page_number: int) -> str:
    """Placeholder hook for a real OCR engine. Left unimplemented on purpose:
    wiring a specific OCR provider is an infra decision (Tesseract locally vs.
    a cloud OCR API) that should be made per deployment, not hard-coded here."""
    return ""


def extract_pdf(file_path: str) -> List[PageContent]:
    reader = PdfReader(file_path)
    pages: List[PageContent] = []
    for i, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        likely_scanned = len(text) < 30
        if likely_scanned:
            ocr_text = ocr_fallback(i + 1)
            text = ocr_text or text
        pages.append(
            PageContent(
                page_number=i + 1,
                text=text,
                likely_scanned=likely_scanned,
                heading=detect_heading(text) if text else None,
            )
        )
    return pages
