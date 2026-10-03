"""
Validates, stores and indexes an uploaded document. Shared by the admin
document upload and by "publish notification with attachment", so both go
through identical checks and the same RAG ingestion - the attachment *is* a
normal Document, never a second copy.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import models
from app.ingestion.extractors import content_matches_type, file_type_for, unsupported_type_message
from app.ingestion.pipeline import process_document
from app.services import storage_service

FILE_TYPE_LABELS = {
    "pdf": "PDF",
    "word": "Word document",
    "excel": "Excel spreadsheet",
    "presentation": "PowerPoint presentation",
    "csv": "CSV spreadsheet",
    "text": "text file",
    "image": "image",
}


def parse_dt(v: Optional[str]) -> Optional[datetime]:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        return None


async def read_and_validate(file: UploadFile) -> tuple[str, str, str, bytes]:
    """Returns (display filename, extension, file_type, content) or raises a
    400 with a message safe to show the admin."""
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
    return filename, ext, file_type, contents


async def create_document(
    db: Session,
    admin: models.User,
    file: UploadFile,
    *,
    title: str,
    document_type: str,
    department: Optional[str] = None,
    academic_year: Optional[str] = None,
    semester: Optional[int] = None,
    published_date: Optional[datetime] = None,
    effective_date: Optional[datetime] = None,
    expiry_date: Optional[datetime] = None,
    is_official: bool = True,
    is_verified: bool = False,
    supersedes_id: Optional[int] = None,
) -> models.Document:
    filename, ext, _file_type, contents = await read_and_validate(file)

    version = 1
    if supersedes_id:
        old = (
            db.query(models.Document)
            .filter(models.Document.id == supersedes_id, models.Document.college_id == admin.college_id)
            .first()
        )
        if not old:
            raise HTTPException(status_code=400, detail="The document this replaces wasn't found in your workspace.")
        version = old.version + 1

    try:
        stored = storage_service.store_upload(contents, ext)
    except storage_service.StorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except storage_service.StorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    # Text extraction needs a local file. Local storage already has one; for
    # Cloudinary a short-lived temp copy is used and removed afterwards.
    if stored.provider == "local":
        work_path = os.path.join(settings.upload_dir, stored.key)
    else:
        os.makedirs(settings.upload_dir, exist_ok=True)
        work_path = os.path.join(settings.upload_dir, f"tmp-{uuid.uuid4().hex}{ext}")
        with open(work_path, "wb") as f:
            f.write(contents)

    document = models.Document(
        college_id=admin.college_id,
        uploaded_by=admin.id,
        title=title,
        document_type=document_type,
        department=department,
        academic_year=academic_year,
        semester=semester,
        file_path=work_path,
        original_filename=filename,
        storage_provider=stored.provider,
        storage_key=stored.key,
        storage_url=stored.url,
        mime_type=stored.mime_type,
        file_size=stored.size,
        published_date=published_date,
        effective_date=effective_date,
        expiry_date=expiry_date,
        version=version,
        is_official=is_official,
        is_verified=is_verified,
        supersedes_id=supersedes_id,
        status=models.DocumentStatus.UPLOADED,
    )
    try:
        db.add(document)
        db.commit()
        db.refresh(document)
        document_id = document.id

        await process_document(db, document)

        # process_document commits (and may roll back), which expires the
        # instance; reload before touching it again.
        document = db.get(models.Document, document_id)
        if stored.provider == "cloudinary":
            # The durable copy is in Cloudinary; never expose or keep the temp path.
            document.file_path = f"cloudinary:{stored.key}"
            db.commit()
            db.refresh(document)
    except Exception:
        db.rollback()
        storage_service.delete_stored(stored.provider, stored.key)
        raise
    finally:
        if stored.provider == "cloudinary":
            try:
                os.remove(work_path)
            except OSError:
                pass
    return document
