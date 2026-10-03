"""
Spots likely deadlines, holidays, exam dates and events in extracted text.

This only produces *suggestions* shown to the admin as "Detected events".
Nothing here publishes or notifies anyone; an admin has to approve each one.

Dates are read day-first for numeric forms (12/10/2026 is 12 October), the
convention in Indian colleges. A date needs an explicit year to be reported -
guessing one would risk announcing the wrong deadline.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable, List

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
_MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"

DATE_PATTERNS = [
    # October 12, 2026 / Oct 12th 2026
    (re.compile(rf"\b({_MONTH})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I), "mdy"),
    # 12 October 2026 / 12th Oct, 2026
    (re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({_MONTH})\.?,?\s+(\d{{4}})\b", re.I), "dmy"),
    # 2026-10-12
    (re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"), "ymd"),
    # 12/10/2026, 12-10-2026, 12.10.2026 (day first)
    (re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b"), "dmy_num"),
]

# Checked in order: the first group with a keyword in the line wins.
KINDS = [
    ("holiday", ("holiday", "remain closed", "vacation", "no classes", "closed on")),
    ("examination", ("examination", "exam", "viva", "practical test", "internal test", "hall ticket")),
    (
        "deadline",
        ("last date", "deadline", "due date", "due on", "due by", "submit", "closes", "closing date",
         "not later than", "registration"),
    ),
    ("event", ("event", "seminar", "workshop", "fest", "convocation", "orientation", "symposium", "meeting")),
]

MAX_EVENTS = 30


def _make_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _dates_in(line: str) -> Iterable[date]:
    for pattern, order in DATE_PATTERNS:
        for m in pattern.finditer(line):
            a, b, c = m.groups()
            if order == "mdy":
                d = _make_date(int(c), MONTHS[a.lower().rstrip(".")], int(b))
            elif order == "dmy":
                d = _make_date(int(c), MONTHS[b.lower().rstrip(".")], int(a))
            elif order == "ymd":
                d = _make_date(int(a), int(b), int(c))
            else:
                d = _make_date(int(c), int(b), int(a))
            if d and 2000 <= d.year <= 2100:
                yield d


def _kind_for(line: str) -> str:
    lowered = line.lower()
    for kind, words in KINDS:
        if any(w in lowered for w in words):
            return kind
    return "date"


def detect_events(texts: Iterable[str]) -> List[dict]:
    """Returns [{"kind", "date" (ISO), "text" (the line it came from)}],
    de-duplicated and sorted by date."""
    found: dict[tuple[str, str], dict] = {}
    for text in texts:
        for raw in text.splitlines():
            line = " ".join(raw.split())
            if len(line) < 6:
                continue
            for d in _dates_in(line):
                kind = _kind_for(line)
                key = (kind, d.isoformat())
                if key not in found:
                    found[key] = {"kind": kind, "date": d.isoformat(), "text": line[:300]}
    return sorted(found.values(), key=lambda e: (e["date"], e["kind"]))[:MAX_EVENTS]
