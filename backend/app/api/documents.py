import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import require_role
from app.db import models
from app.db.database import get_db
from app.ingestion.extractors import content_matches_type, file_type_for, unsupported_type_message
from app.ingestion.pipeline import process_document
from app.schemas.schemas import DocumentOut

router = APIRouter(prefix="/api/documents", tags=["documents"])

FILE_TYPE_LABELS = {
    "pdf": "PDF",
    "word": "Word document",
    "excel": "Excel spreadsheet",
    "presentation": "PowerPoint presentation",
    "csv": "CSV spreadsheet",
    "text": "text file",
    "image": "image",
}


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
    filename = file.filename or ""
    file_type = file_type_for(filename)
    if file_type is None:
        raise HTTPException(status_code=400, detail=unsupported_type_message(filename))
    ext = os.path.splitext(filename)[1].lower()

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="This file is empty.")
    if len(contents) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.max_upload_mb}MB limit.")
    if not content_matches_type(file_type, contents[:8192]):
        raise HTTPException(
            status_code=400,
            detail=f"This file's contents don't look like a {FILE_TYPE_LABELS[file_type]}. "
            "It may be damaged or renamed from another format.",
        )

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
        original_filename=filename,
        published_date=parse_dt(published_date),
        effective_date=parse_dt(effective_date),
        expiry_date=parse_dt(expiry_date),
        is_official=is_official,
        is_verified=is_verified,
        supersedes_id=supersedes_id,
        status=models.DocumentStatus.UPLOADED,
    )
    if supersedes_id:
        old = (
            db.query(models.Document)
            .filter(models.Document.id == supersedes_id, models.Document.college_id == admin.college_id)
            .first()
        )
        if not old:
            os.remove(stored_path)
            raise HTTPException(status_code=400, detail="The document this replaces wasn't found in your workspace.")
        document.version = old.version + 1

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
        file_type=file_type_for(doc.original_filename or doc.file_path) or "unknown",
        processing_error=doc.processing_error,
        created_at=doc.created_at,
    )


@router.get("", response_model=List[DocumentOut])
def list_documents(
    department: Optional[str] = None,
    document_type: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_role("admin")),
):
    # Admin-only: students and faculty reach documents through chat answers
    # and their citations, not by browsing the library.
    q = db.query(models.Document).filter(models.Document.college_id == admin.college_id)
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

