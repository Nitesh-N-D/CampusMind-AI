from datetime import datetime
from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: int
    title: str
    body: str
    category: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True
