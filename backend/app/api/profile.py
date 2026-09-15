from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db import models
from app.db.database import get_db
from app.schemas.schemas import ProfileOut, ProfileUpdate
from app.services.cloudinary_service import (
    AvatarStorageNotConfigured,
    InvalidAvatarImage,
    delete_avatar,
    upload_avatar,
    validate_avatar_bytes,
)

router = APIRouter(prefix="/api/profile", tags=["profile"])


def _to_profile_out(user: models.User) -> ProfileOut:
    return ProfileOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        nickname=user.nickname,
        avatar_url=user.avatar_url,
        role=user.role.value,
        department=user.department,
        year=user.year,
        semester=user.semester,
        section=user.section,
        academic_batch=user.academic_batch,
        interests=user.interests or [],
        preferred_language=user.preferred_language,
    )


@router.get("/me", response_model=ProfileOut)
def get_profile(user: models.User = Depends(get_current_user)):
    return _to_profile_out(user)


@router.put("/me", response_model=ProfileOut)
def update_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return _to_profile_out(user)


@router.delete("/me")
def delete_profile_data(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Respect privacy: lets a student clear the personalization fields
    without deleting their account/history. Name, nickname, and avatar are
    identity, not academic-personalization data, so they're left untouched -
    use the dedicated avatar DELETE endpoint to remove a profile picture."""
    user.department = None
    user.year = None
    user.semester = None
    user.section = None
    user.academic_batch = None
    user.interests = []
    db.commit()
    return {"status": "profile_cleared"}


@router.post("/me/avatar", response_model=ProfileOut)
async def upload_profile_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    data = await file.read()

    try:
        validate_avatar_bytes(file.content_type or "", data)
    except InvalidAvatarImage as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        secure_url, public_id = upload_avatar(data, user.id)
    except AvatarStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail="Couldn't reach image storage right now. Please try again."
        ) from exc

    old_public_id = user.avatar_public_id
    user.avatar_url = secure_url
    user.avatar_public_id = public_id
    db.commit()
    db.refresh(user)

    # Cloudinary uploads overwrite the same public_id on re-upload, so this
    # only matters if the public_id scheme ever changes - kept for safety.
    if old_public_id and old_public_id != public_id:
        delete_avatar(old_public_id)

    return _to_profile_out(user)


@router.delete("/me/avatar", response_model=ProfileOut)
def remove_profile_avatar(
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
):
    if user.avatar_public_id:
        delete_avatar(user.avatar_public_id)
    user.avatar_url = None
    user.avatar_public_id = None
    db.commit()
    db.refresh(user)
    return _to_profile_out(user)
