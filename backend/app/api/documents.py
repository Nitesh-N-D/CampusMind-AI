import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_current_user, require_role
from app.db import models
from app.db.database import get_db
from app.ingestion.pipeline import process_document
from app.schemas.schemas import ChangeLogOut, DocumentOut

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf"}


@router.post("/upload", response_model=DocumentOut)
async def upload_document(
    title: str = Form(...),
    document_type: str = Form(...),
    department: Optional[str] = Form(None),
    academic_year: Optional[str] = Form(None),
    semester: Optional[int] = Form(None),
    published_date: Optional[str] = Form(None),
    effective_date: Optional[str] = Form(None),
    expiry_date: Optional[str] = Form(None),
    is_official: bool = Form(True),
    is_verified: bool = Form(False),
    supersedes_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF files are supported right now.")

    contents = await file.read()
    if len(contents) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.max_upload_mb}MB limit.")

    os.makedirs(settings.upload_dir, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(settings.upload_dir, stored_name)
    with open(stored_path, "wb") as f:
        f.write(contents)

    def parse_dt(v: Optional[str]) -> Optional[datetime]:
        if not v:
            return None
        try:
            return datetime.fromisoformat(v)
        except ValueError:
            return None

    document = models.Document(
        college_id=admin.college_id,
        uploaded_by=admin.id,
        title=title,
        document_type=document_type,
        department=department,
        academic_year=academic_year,
        semester=semester,
        file_path=stored_path,
        original_filename=file.filename,
        published_date=parse_dt(published_date),
        effective_date=parse_dt(effective_date),
        expiry_date=parse_dt(expiry_date),
        is_official=is_official,
        is_verified=is_verified,
        supersedes_id=supersedes_id,
        status=models.DocumentStatus.UPLOADED,
    )
    if supersedes_id:
        old = db.query(models.Document).get(supersedes_id)
        document.version = (old.version + 1) if old else 1

    db.add(document)
    db.commit()
    db.refresh(document)

    await process_document(db, document)
    db.refresh(document)

    return _to_out(document)


def _to_out(doc: models.Document) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        title=doc.title,
        document_type=doc.document_type,
        department=doc.department,
        academic_year=doc.academic_year,
        semester=doc.semester,
        published_date=doc.published_date,
        effective_date=doc.effective_date,
        expiry_date=doc.expiry_date,
        version=doc.version,
        is_official=doc.is_official,
        is_verified=doc.is_verified,
        trust_level=doc.trust_level.value if doc.trust_level else "medium",
        trust_score=doc.trust_score,
        status=doc.status.value,
        is_demo_data=doc.is_demo_data,
        page_count=doc.page_count,
        processing_error=doc.processing_error,
        created_at=doc.created_at,
    )


@router.get("", response_model=List[DocumentOut])
def list_documents(
    department: Optional[str] = None,
    document_type: Optional[str] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    q = db.query(models.Document).filter(models.Document.college_id == user.college_id)
    if department:
        q = q.filter(models.Document.department == department)
    if document_type:
        q = q.filter(models.Document.document_type == document_type)
    docs = q.order_by(models.Document.created_at.desc()).all()
    return [_to_out(d) for d in docs]


@router.delete("/{document_id}")
def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    doc = db.query(models.Document).filter(
        models.Document.id == document_id, models.Document.college_id == admin.college_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(doc)
    db.commit()
    return {"status": "deleted"}


@router.post("/{document_id}/verify")
def verify_document(
    document_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    doc = db.query(models.Document).filter(
        models.Document.id == document_id, models.Document.college_id == admin.college_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.is_verified = True
    from app.services.trust_engine import score_document

    score, level, _ = score_document(doc)
    doc.trust_score = score
    doc.trust_level = level
    db.commit()
    return _to_out(doc)


@router.get("/changes", response_model=List[ChangeLogOut])
def list_changes(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Feature 7 - 'What Changed?' Intelligence. Unlike most admin
    analytics, this is intentionally visible to every role (student,
    faculty, admin): it's the whole point of the feature that students see
    what changed in a regulation that affects them, not just admins."""
    logs = (
        db.query(models.DocumentChangeLog)
        .filter(models.DocumentChangeLog.college_id == user.college_id)
        .order_by(models.DocumentChangeLog.created_at.desc())
        .all()
    )
    doc_ids = {l.old_document_id for l in logs} | {l.new_document_id for l in logs}
    docs_by_id = {
        d.id: d
        for d in db.query(models.Document).filter(models.Document.id.in_(doc_ids)).all()
    }
    return [
        ChangeLogOut(
            id=l.id,
            old_document_id=l.old_document_id,
            old_document_title=docs_by_id[l.old_document_id].title
            if l.old_document_id in docs_by_id
            else "Deleted document",
            new_document_id=l.new_document_id,
            new_document_title=docs_by_id[l.new_document_id].title
            if l.new_document_id in docs_by_id
            else "Deleted document",
            topic=l.field_or_topic,
            old_value=l.old_value,
            new_value=l.new_value,
            impact_summary=l.impact_summary,
            created_at=l.created_at,
        )
        for l in logs
    ]
