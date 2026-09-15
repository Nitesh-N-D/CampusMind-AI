"""
FEATURE 1 - Source-Trust Engine

Produces a 0-100 *system confidence/quality score* (never presented as
ground truth) from concrete, explainable signals: officiality, verification
status, recency, and document type authority. The score is a weighted sum -
every factor is visible in the returned breakdown so admins and students can
see exactly why a document scored the way it did.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, Tuple

from app.db import models

TYPE_AUTHORITY = {
    "regulation": 30,
    "circular": 22,
    "timetable": 20,
    "exam_schedule": 24,
    "fee_notice": 20,
    "placement_notice": 18,
    "faculty_info": 16,
    "event_notice": 12,
    "general_notice": 10,
}


def score_document(doc: models.Document) -> Tuple[float, models.TrustLevel, Dict[str, float]]:
    breakdown: Dict[str, float] = {}

    breakdown["officiality"] = 25.0 if doc.is_official else 5.0
    breakdown["verification"] = 20.0 if doc.is_verified else 5.0
    breakdown["document_type_authority"] = float(
        TYPE_AUTHORITY.get(doc.document_type, 10)
    )

    # Recency: full marks inside 180 days, linear decay to 0 by 3 years old.
    reference_date = doc.effective_date or doc.published_date or doc.created_at
    if reference_date:
        age_days = max((datetime.utcnow() - reference_date).days, 0)
        if age_days <= 180:
            recency_score = 25.0
        elif age_days >= 1095:
            recency_score = 0.0
        else:
            recency_score = 25.0 * (1 - (age_days - 180) / (1095 - 180))
    else:
        recency_score = 10.0
    breakdown["recency"] = round(recency_score, 1)

    # Expiry penalty
    if doc.expiry_date and doc.expiry_date < datetime.utcnow():
        breakdown["validity_penalty"] = -20.0
    else:
        breakdown["validity_penalty"] = 0.0

    total = sum(breakdown.values())
    total = max(0.0, min(100.0, total))

    if total >= 85:
        level = models.TrustLevel.VERY_HIGH
    elif total >= 65:
        level = models.TrustLevel.HIGH
    elif total >= 40:
        level = models.TrustLevel.MEDIUM
    else:
        level = models.TrustLevel.LOW

    return round(total, 1), level, breakdown
