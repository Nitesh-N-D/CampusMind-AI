"""
Profile picture storage via Cloudinary.

Unlike documents (which stay on local disk / can be swapped to any object
store), avatars specifically need a stable public URL that the frontend can
render directly in <img> tags from any device, so this integration is not
behind the same kind of provider abstraction as AI/embeddings - Cloudinary
is used directly, matching what was asked for.

If CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET aren't set, upload_avatar raises
AvatarStorageNotConfigured, which the API layer turns into a clear 503
rather than silently failing or writing to local disk pretending to be
cloud storage.
"""
from __future__ import annotations

import io

import cloudinary
import cloudinary.uploader
from PIL import Image

from app.core.config import settings

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_DIMENSION = 2048  # px, images larger than this are rejected outright


class AvatarStorageNotConfigured(Exception):
    pass


class InvalidAvatarImage(Exception):
    pass


def _configured() -> bool:
    return bool(
        settings.cloudinary_cloud_name
        and settings.cloudinary_api_key
        and settings.cloudinary_api_secret
    )


def _ensure_configured() -> None:
    if not _configured():
        raise AvatarStorageNotConfigured(
            "Profile image uploads aren't set up yet. Add CLOUDINARY_CLOUD_NAME, "
            "CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to the backend's .env "
            "(free tier at https://cloudinary.com/users/register/free) and restart."
        )
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )


def validate_avatar_bytes(content_type: str, data: bytes) -> None:
    """Raises InvalidAvatarImage with a user-facing message on any problem.
    Validates content-type, actual decodable image content (not just the
    claimed content-type header), and dimensions - all before anything is
    sent to Cloudinary."""
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise InvalidAvatarImage("Profile pictures must be a JPEG, PNG, or WebP image.")

    max_bytes = settings.max_avatar_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise InvalidAvatarImage(f"Image is too large. Maximum size is {settings.max_avatar_mb}MB.")

    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
    except Exception as exc:  # noqa: BLE001
        raise InvalidAvatarImage("That file isn't a valid image.") from exc

    # Re-open after verify() (which leaves the file unusable for further reads)
    img = Image.open(io.BytesIO(data))
    width, height = img.size
    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        raise InvalidAvatarImage(f"Image dimensions must be {MAX_DIMENSION}x{MAX_DIMENSION}px or smaller.")
    if width < 32 or height < 32:
        raise InvalidAvatarImage("Image is too small to use as a profile picture.")


def upload_avatar(data: bytes, user_id: int) -> tuple[str, str]:
    """Uploads to Cloudinary under a per-user public_id so re-uploads
    overwrite the previous avatar rather than accumulating orphaned assets.
    Returns (secure_url, public_id)."""
    _ensure_configured()
    result = cloudinary.uploader.upload(
        io.BytesIO(data),
        folder="campusmind-ai/avatars",
        public_id=f"user_{user_id}",
        overwrite=True,
        invalidate=True,
        transformation=[{"width": 512, "height": 512, "crop": "fill", "gravity": "face"}],
    )
    return result["secure_url"], result["public_id"]


def delete_avatar(public_id: str) -> None:
    if not _configured() or not public_id:
        return
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )
    try:
        cloudinary.uploader.destroy(public_id)
    except Exception:  # noqa: BLE001
        # Best-effort cleanup - a failed delete of the old asset should never
        # block the user from having successfully set their new one.
        pass
