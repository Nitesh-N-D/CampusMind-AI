from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db import models
from app.db.database import get_db
from app.rag.pipeline import retrieve
from app.schemas.schemas import SearchResultOut

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=List[SearchResultOut])
async def search(
    q: str = Query(..., min_length=1),
    department: Optional[str] = None,
    document_type: Optional[str] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    results = await retrieve(db, user.college_id, q, student=user, department_filter=department)

    if document_type:
        results = [r for r in results if r.document.document_type == document_type]

    db.add(
        models.SearchLog(
            college_id=user.college_id,
            user_id=user.id,
            query=q,
            result_count=len(results),
            top_confidence=results[0].relevance * 100 if results else 0,
            was_answered=bool(results),
        )
    )
    db.commit()

    out = []
    for r in results:
        snippet = r.chunk.content[:220].strip()
        out.append(
            SearchResultOut(
                document_id=r.document.id,
                document_title=r.document.title,
                snippet=snippet + ("..." if len(r.chunk.content) > 220 else ""),
                page=r.chunk.page_number,
                department=r.document.department,
                date=r.document.effective_date or r.document.published_date,
                trust_score=r.trust_score,
                relevance_score=round(r.relevance * 100, 1),
            )
        )
    return out
