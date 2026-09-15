"""
FEATURE 6 - Deadline & Event Intelligence

Regex-based date/deadline extraction that runs during ingestion. This is a
deliberately transparent, debuggable first pass (dates + a nearby category
keyword); a production system could additionally send ambiguous sentences to
the LLM for confirmation, but the deterministic pass below already covers the
common college-document date formats and never fabricates a date the source
text doesn't contain.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

MONTHS = (
    "january|february|march|april|may|june|july|august|september|"
    "october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
)

DATE_PATTERN = re.compile(
    rf"\b(\d{{1,2}})\s*(?:st|nd|rd|th)?\s+({MONTHS})\s+(\d{{4}})\b"
    rf"|\b({MONTHS})\s+(\d{{1,2}})\s*(?:st|nd|rd|th)?,?\s+(\d{{4}})\b",
    re.IGNORECASE,
)

CATEGORY_KEYWORDS = {
    "exam": "exam",
    "examination": "exam",
    "placement": "placement",
    "registration": "deadline",
    "fee": "fees",
    "fees": "fees",
    "event": "event",
    "meeting": "event",
    "assignment": "deadline",
    "application": "deadline",
    "deadline": "deadline",
}

MONTH_MAP = {m[:3].lower(): i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"]
)}


@dataclass
class ExtractedEventCandidate:
    title: str
    category: str
    event_date: datetime
    snippet: str


def _parse_date(match: re.Match) -> Optional[datetime]:
    groups = match.groups()
    try:
        if groups[0]:
            day, month_str, year = groups[0], groups[1], groups[2]
        else:
            month_str, day, year = groups[3], groups[4], groups[5]
        month = MONTH_MAP.get(month_str[:3].lower())
        if not month:
            return None
        return datetime(int(year), month, int(day))
    except (ValueError, TypeError):
        return None


def _guess_category(context: str) -> str:
    lower = context.lower()
    for keyword, category in CATEGORY_KEYWORDS.items():
        if keyword in lower:
            return category
    return "academic"


def extract_events(text: str) -> List[ExtractedEventCandidate]:
    events: List[ExtractedEventCandidate] = []
    for match in DATE_PATTERN.finditer(text):
        date = _parse_date(match)
        if not date:
            continue
        start = max(0, match.start() - 80)
        end = min(len(text), match.end() + 80)
        context = text[start:end].strip()
        title_line = context.split(".")[0][:120].strip() or "Important date"
        events.append(
            ExtractedEventCandidate(
                title=title_line,
                category=_guess_category(context),
                event_date=date,
                snippet=context,
            )
        )
    return events
