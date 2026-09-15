from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db import models
from app.db.database import get_db
from app.schemas.schemas import EventOut

router = APIRouter(prefix="/api/timeline", tags=["timeline"])

RANGE_DAYS = {"today": 1, "week": 7, "month": 30, "upcoming": 365}


@router.get("", response_model=List[EventOut])
def get_timeline(
    range: str = Query("upcoming", pattern="^(today|week|month|upcoming)$"),
    category: Optional[str] = None,
    department: Optional[str] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    now = datetime.utcnow()
    end = now + timedelta(days=RANGE_DAYS.get(range, 365))

    q = (
        db.query(models.ExtractedEvent)
        .filter(models.ExtractedEvent.college_id == user.college_id)
        .filter(models.ExtractedEvent.event_date >= now - timedelta(days=1))
        .filter(models.ExtractedEvent.event_date <= end)
    )
    if category:
        q = q.filter(models.ExtractedEvent.category == category)
    if department:
        q = q.filter(
            (models.ExtractedEvent.department == department)
            | (models.ExtractedEvent.department.is_(None))
        )
    events = q.order_by(models.ExtractedEvent.event_date.asc()).all()
    return events
