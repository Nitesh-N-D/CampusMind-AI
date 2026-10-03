from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class AttachmentOut(BaseModel):
    # Only the document id: files are fetched through the authenticated
    # GET /api/documents/{id}/file, never by path or storage URL.
    document_id: int
    filename: str
    mime_type: Optional[str] = None
    file_type: str
    is_image: bool = False


class NotificationOut(BaseModel):
    id: int
    title: str
    body: str
    category: str
    priority: str
    audience: str
    circular_number: Optional[str] = None
    department: Optional[str] = None
    event_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    effective_date: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    published_at: datetime
    # Publish time, or the latest reminder - the key clients dedupe alerts on.
    activity_at: datetime
    status: str
    # draft | scheduled | published | expired | archived
    state: str
    # Only set for students and faculty.
    is_read: Optional[bool] = None
    attachment: Optional[AttachmentOut] = None
    verified: Optional[bool] = None
    # Admin only.
    reminder_offsets: Optional[List[int]] = None
    scheduled_reminders: Optional[int] = None


class UnreadSummary(BaseModel):
    unread: int
    # The few most recent unread items, so the client can raise a browser
    # alert without a second request.
    latest: List[NotificationOut]


class NotificationUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    audience: Optional[str] = None
    circular_number: Optional[str] = None
    department: Optional[str] = None
    event_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    effective_date: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    status: Optional[str] = None
    reminder_offsets: Optional[List[int]] = None
    reminder_date: Optional[datetime] = None


class ReminderCreate(BaseModel):
    title: str
    body: str
    category: str = "deadline"
    priority: str = "normal"
    audience: str
    event_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    department: Optional[str] = None
    document_id: Optional[int] = None
    reminder_offsets: List[int] = []
    reminder_date: Optional[datetime] = None


class ReminderBuckets(BaseModel):
    today: List[NotificationOut]
    this_week: List[NotificationOut]
    upcoming: List[NotificationOut]
    past: List[NotificationOut]


class AdminSummary(BaseModel):
    total: int
    active_circulars: int
    scheduled_reminders: int
    upcoming_deadlines: List[NotificationOut]
    upcoming_holidays: List[NotificationOut]
    recent: List[NotificationOut]
