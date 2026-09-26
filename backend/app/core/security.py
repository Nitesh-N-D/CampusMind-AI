from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.db import models

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


# One message for every invalid-token case: an expired, tampered, or orphaned
# token all mean the same thing to the user, and saying which one it was
# would only help someone forging tokens.
SESSION_EXPIRED = "Your session has expired. Please sign in again."
ACCOUNT_INACTIVE = "This account isn't active. Contact your college administrator."


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=SESSION_EXPIRED)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> models.User:
    payload = decode_token(token)
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail=SESSION_EXPIRED)
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail=SESSION_EXPIRED)
    if not user.is_active:
        raise HTTPException(status_code=403, detail=ACCOUNT_INACTIVE)
    return user


def require_role(*roles: str):
    """Backend-enforced role check. The frontend role claim is never trusted on its own;
    this dependency re-reads the role from the DB record tied to the verified JWT subject."""

    def dependency(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in roles:
            who = " and ".join(f"{r}s" for r in roles)
            raise HTTPException(status_code=403, detail=f"Your account doesn't have access to this. It's only for {who}.")
        return user

    return dependency
