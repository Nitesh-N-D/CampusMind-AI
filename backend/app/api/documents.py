from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_role
from app.db import models
from app.db.database import get_db
from app.ingestion.extractors import file_type_for
from app.schemas.schemas import DocumentOut
from app.services import storage_service
from app.services.document_upload import create_document, parse_dt
from app.services.notification_service import visible_query

router = APIRouter(prefix="/api/documents", tags=["documents"])


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
    document = await create_document(
        db,
        admin,
        file,
        title=title,
        document_type=document_type,
        department=department,
        academic_year=academic_year,
        semester=semester,
        published_date=parse_dt(published_date),
        effective_date=parse_dt(effective_date),
        expiry_date=parse_dt(expiry_date),
        is_official=is_official,
        is_verified=is_verified,
        supersedes_id=supersedes_id,
    )
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
        detected_events=doc.detected_events or [],
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
    # A published circular keeps its record: it just loses the attachment link.
    db.query(models.Notification).filter(models.Notification.document_id == doc.id).update(
        {"document_id": None}, synchronize_session=False
    )
    provider, key = doc.storage_provider, doc.storage_key
    db.delete(doc)
    db.commit()
    storage_service.delete_stored(provider, key)
    return {"status": "deleted"}


@router.get("/{document_id}/file")
def download_document_file(
    document_id: int,
    inline: bool = False,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Serves the original file. Admins can open any document in their
    college; students and faculty only a document attached to a notification
    they are allowed to see. Anything else is a 404, so existence isn't leaked."""
    doc = db.query(models.Document).filter(
        models.Document.id == document_id, models.Document.college_id == user.college_id
    ).first()
    allowed = doc is not None
    if allowed and user.role != models.UserRole.ADMIN:
        allowed = (
            visible_query(db, user).filter(models.Notification.document_id == document_id).first() is not None
        )
    if not allowed:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        data = storage_service.fetch_bytes(doc.storage_provider, doc.storage_key, doc.file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="The original file is no longer available.")
    except storage_service.StorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    ext = "." + doc.original_filename.rsplit(".", 1)[-1] if "." in (doc.original_filename or "") else ""
    mime = doc.mime_type or storage_service.mime_for(ext)
    name = storage_service.safe_display_name(doc.original_filename)
    # Only PDFs and images are shown in the browser; everything else downloads.
    viewable = mime == "application/pdf" or mime.startswith("image/")
    disposition = "inline" if inline and viewable else "attachment"
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f'{disposition}; filename="{name}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


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

