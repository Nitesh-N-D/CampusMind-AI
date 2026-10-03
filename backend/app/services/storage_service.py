"""
Persistent storage for official documents and notification attachments.

Production (Render) has an ephemeral disk, so uploads go to Cloudinary as
`authenticated` raw assets: nobody can fetch them from a guessable URL. The
API streams them back through an endpoint that checks the caller's college
and audience (see api/documents.py). Documents that predate this feature
only have a local file_path and are served from there.

Without Cloudinary credentials, local disk is used for development and
tests only; in production an upload is refused instead of silently landing
on a disk that is wiped on every deploy.
"""
from __future__ import annotations

import io
import os
import re
import uuid
from dataclasses import dataclass
from typing import Optional

import cloudinary
import cloudinary.uploader
import cloudinary.utils
import httpx

from app.core.config import settings
from app.core.logging_config import logger

FOLDER = "campusmind-ai/documents"

MIME_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


class StorageNotConfigured(Exception):
    """Production upload attempted without Cloudinary credentials."""


class StorageError(Exception):
    """Cloudinary rejected or couldn't complete the request."""


@dataclass
class StoredFile:
    provider: str  # cloudinary | local
    key: str
    url: Optional[str]
    mime_type: str
    size: int


def cloudinary_configured() -> bool:
    return bool(settings.cloudinary_cloud_name and settings.cloudinary_api_key and settings.cloudinary_api_secret)


def _configure() -> None:
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )


def mime_for(ext: str) -> str:
    return MIME_TYPES.get(ext.lower(), "application/octet-stream")


def safe_display_name(filename: str) -> str:
    """Strips any directory part and characters that are unsafe in a header
    or a path. Used for display and Content-Disposition only - stored names
    are always random."""
    name = os.path.basename((filename or "").replace("\\", "/"))
    name = re.sub(r"[^\w.\- ()]", "_", name).strip(" .")
    return name[:150] or "document"


def store_upload(data: bytes, ext: str) -> StoredFile:
    """Persists the bytes and returns where they went. The caller is still
    responsible for the temporary local copy it extracted text from."""
    mime = mime_for(ext)
    if cloudinary_configured():
        _configure()
        try:
            result = cloudinary.uploader.upload(
                io.BytesIO(data),
                resource_type="raw",
                type="authenticated",
                folder=FOLDER,
                public_id=f"{uuid.uuid4().hex}{ext}",  # raw assets keep the extension in the id
            )
        except Exception as exc:  # noqa: BLE001 - cloudinary raises assorted error types
            logger.exception("Cloudinary document upload failed")
            raise StorageError("The file couldn't be saved to storage. Please try again.") from exc
        return StoredFile("cloudinary", result["public_id"], result.get("secure_url"), mime, len(data))

    if settings.environment == "production":
        raise StorageNotConfigured(
            "Document storage isn't configured on the server. Set the Cloudinary credentials and try again."
        )
    logger.warning("Cloudinary not configured; storing document on local disk (development only)")
    os.makedirs(settings.upload_dir, exist_ok=True)
    key = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(settings.upload_dir, key), "wb") as f:
        f.write(data)
    return StoredFile("local", key, None, mime, len(data))


def fetch_bytes(provider: Optional[str], key: Optional[str], file_path: str) -> bytes:
    """Returns the stored file's content for the authenticated download
    endpoint. Raises FileNotFoundError when it's gone (e.g. a pre-Cloudinary
    upload lost in a Render redeploy)."""
    if provider == "cloudinary" and key:
        _configure()
        url = cloudinary.utils.cloudinary_url(
            key, resource_type="raw", type="authenticated", sign_url=True, secure=True
        )[0]
        try:
            resp = httpx.get(url, timeout=30, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise StorageError("The file couldn't be retrieved right now. Please try again.") from exc
        if resp.status_code == 404:
            raise FileNotFoundError(key)
        if resp.status_code != 200:
            raise StorageError("The file couldn't be retrieved right now. Please try again.")
        return resp.content

    path = os.path.join(settings.upload_dir, key) if provider == "local" and key else file_path
    with open(path, "rb") as f:
        return f.read()


def delete_stored(provider: Optional[str], key: Optional[str]) -> None:
    """Best-effort cleanup of a stored asset; never raises."""
    try:
        if provider == "cloudinary" and key and cloudinary_configured():
            _configure()
            cloudinary.uploader.destroy(key, resource_type="raw", type="authenticated")
        elif provider == "local" and key:
            os.remove(os.path.join(settings.upload_dir, key))
    except Exception:  # noqa: BLE001
        logger.warning("Couldn't remove stored file %s/%s", provider, key)
