from typing import Optional

from pydantic import BaseModel, Field


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscribeIn(BaseModel):
    """The browser's PushSubscription.toJSON(). User and college are never
    read from here - they come from the signed-in user."""

    endpoint: str = Field(min_length=1, max_length=1000)
    keys: PushKeys


class PushUnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1000)


class PushStatus(BaseModel):
    configured: bool
    public_key: Optional[str] = None
    subscribed: bool = False
    devices: int = 0
