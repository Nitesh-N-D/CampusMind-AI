"""
FEATURE 2 - Temporal-Aware College Brain

Applies a validity/recency multiplier on top of relevance so retrieval
prefers the currently-active academic year and the latest valid version of a
document, and filters out documents that have explicitly expired.
"""
from __future__ import annotations

from datetime import datetime

from app.db import models


def is_currently_valid(doc: models.Document, as_of: datetime | None = None) -> bool:
    as_of = as_of or datetime.utcnow()
    if doc.effective_date and doc.effective_date > as_of:
        return False
    if doc.expiry_date and doc.expiry_date < as_of:
        return False
    if doc.status == models.DocumentStatus.ARCHIVED:
        return False
    return True


def temporal_weight(doc: models.Document, as_of: datetime | None = None) -> float:
    """Returns a multiplier in [0.15, 1.15] applied to a chunk's relevance score."""
    as_of = as_of or datetime.utcnow()

    if not is_currently_valid(doc, as_of):
        return 0.15  # heavily deprioritize but don't fully hide - still explainable if asked

    weight = 1.0
    # Prefer documents with a higher version number among the same lineage.
    if doc.version and doc.version > 1:
        weight += min(doc.version * 0.02, 0.1)

    # Prefer the academic year that overlaps "now" most closely, if parseable
    # as "YYYY-YY".
    if doc.academic_year:
        try:
            start_year = int(doc.academic_year.split("-")[0])
            current_academic_start = as_of.year if as_of.month >= 6 else as_of.year - 1
            distance = abs(current_academic_start - start_year)
            weight += max(0.0, 0.05 - 0.02 * distance)
        except (ValueError, IndexError):
            pass

    return round(min(weight, 1.15), 3)
