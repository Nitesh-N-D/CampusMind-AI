import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.db.database import Base


class UserRole(str, enum.Enum):
    STUDENT = "student"
    FACULTY = "faculty"
    ADMIN = "admin"


class UserStatus(str, enum.Enum):
    PENDING = "pending"       # admin: awaiting nothing extra beyond email match; student: active once verified
    ACTIVE = "active"
    SUSPENDED = "suspended"


class DocumentStatus(str, enum.Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    ARCHIVED = "archived"


class TrustLevel(str, enum.Enum):
    VERY_HIGH = "very_high"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class College(Base):
    """A tenant. Each admin creates exactly one College workspace, sets its
    display name and the official email domain that gates student signup and
    scopes the entire knowledge base (documents, chat, search) to that college."""

    __tablename__ = "colleges"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    official_domain = Column(String(255), nullable=False, unique=True, index=True)
    # Gates faculty signup. Starts unset (faculty signup closed) and can only
    # be set by an admin via PUT /api/admin/settings/faculty-domain - never
    # at college registration, and never inferred from official_domain.
    faculty_domain = Column(String(255), nullable=True, unique=True, index=True)
    logo_url = Column(String(500), nullable=True)
    is_verified = Column(Boolean, default=True)  # reserved for future manual platform review
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="college")
    documents = relationship("Document", back_populates="college")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    nickname = Column(String(60), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    avatar_public_id = Column(String(255), nullable=True)  # Cloudinary asset id, needed to replace/delete old uploads
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.STUDENT, nullable=False)
    status = Column(Enum(UserStatus), default=UserStatus.ACTIVE, nullable=False)
    is_active = Column(Boolean, default=True)

    # Feature 4: personalized student context
    department = Column(String(120), nullable=True)
    year = Column(Integer, nullable=True)
    semester = Column(Integer, nullable=True)
    section = Column(String(20), nullable=True)
    academic_batch = Column(String(20), nullable=True)
    interests = Column(JSON, default=list)
    preferred_language = Column(String(20), default="en")

    created_at = Column(DateTime, default=datetime.utcnow)

    college = relationship("College", back_populates="users")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    title = Column(String(500), nullable=False)
    document_type = Column(String(80), nullable=False)  # regulation, circular, timetable, notice, faculty, event...
    department = Column(String(120), nullable=True)
    academic_year = Column(String(20), nullable=True)   # e.g. "2026-27"
    semester = Column(Integer, nullable=True)

    file_path = Column(String(500), nullable=False)
    original_filename = Column(String(500), nullable=False)

    published_date = Column(DateTime, nullable=True)
    effective_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    version = Column(Integer, default=1)
    supersedes_id = Column(Integer, ForeignKey("documents.id"), nullable=True)

    is_official = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)
    trust_level = Column(Enum(TrustLevel), default=TrustLevel.MEDIUM)
    trust_score = Column(Float, default=50.0)  # 0-100, system quality score, not "ground truth"

    status = Column(Enum(DocumentStatus), default=DocumentStatus.UPLOADED)
    is_demo_data = Column(Boolean, default=False)

    page_count = Column(Integer, default=0)
    processing_error = Column(Text, nullable=True)

    # Persistent storage metadata. All nullable: documents uploaded before
    # these existed only have file_path. storage_url is internal metadata and
    # is never returned to clients; files are served through an
    # authenticated endpoint.
    storage_provider = Column(String(20), nullable=True)  # cloudinary | local
    storage_key = Column(String(500), nullable=True)
    storage_url = Column(String(1000), nullable=True)
    mime_type = Column(String(120), nullable=True)
    file_size = Column(Integer, nullable=True)
    # Dates/deadlines/holidays spotted in the text. Suggestions only - nothing
    # is published until an admin approves it.
    detected_events = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    college = relationship("College", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False, index=True)

    chunk_index = Column(Integer, nullable=False)
    page_number = Column(Integer, nullable=True)
    heading = Column(String(500), nullable=True)
    section = Column(String(120), nullable=True)
    content = Column(Text, nullable=False)

    # Stored as JSON list of floats for the local/SQLite dev backend.
    # In production (DATABASE_URL pointing at Supabase), swap this column
    # for a pgvector `vector` column and use native <=> similarity search.
    embedding = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="chunks")


class DocumentConflict(Base):
    """Feature 3: Smart Conflict Detection"""

    __tablename__ = "document_conflicts"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    topic = Column(String(255), nullable=False)
    document_a_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    chunk_a_id = Column(Integer, ForeignKey("document_chunks.id"), nullable=True)
    value_a = Column(String(500), nullable=True)
    document_b_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    chunk_b_id = Column(Integer, ForeignKey("document_chunks.id"), nullable=True)
    value_b = Column(String(500), nullable=True)
    suggested_authoritative_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    reasoning = Column(Text, nullable=True)
    status = Column(String(30), default="open")  # open, resolved, dismissed
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolution_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)






class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(255), default="New conversation")
    language = Column(String(20), default="en")
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.id"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)  # user | assistant
    content = Column(Text, nullable=False)
    citations = Column(JSON, default=list)
    confidence = Column(Float, nullable=True)
    has_conflict = Column(Boolean, default=False)
    conflict_ids = Column(JSON, default=list)
    retrieval_ms = Column(Integer, nullable=True)
    llm_ms = Column(Integer, nullable=True)
    feedback = Column(String(20), nullable=True)  # up | down | null
    feedback_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("ChatSession", back_populates="messages")


class SearchLog(Base):
    __tablename__ = "search_logs"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    query = Column(String(500), nullable=False)
    result_count = Column(Integer, default=0)
    top_confidence = Column(Float, nullable=True)
    was_answered = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class LoginEvent(Base):
    """Successful student/faculty sign-ins and registrations, for the admin
    login log. Admin sign-ins aren't recorded - the log is about who is using
    the assistant."""

    __tablename__ = "login_events"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Role at the time of the event, so the log stays accurate if it changes.
    role = Column(String(20), nullable=False)
    event_type = Column(String(20), nullable=False)  # login, register
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    user = relationship("User")


class NotificationCategory(str, enum.Enum):
    CIRCULAR = "circular"
    ANNOUNCEMENT = "announcement"
    HOLIDAY = "holiday"
    DEADLINE = "deadline"
    ACADEMIC = "academic"
    EXAMINATION = "examination"
    ASSIGNMENT = "assignment"
    EVENT = "event"
    GENERAL = "general"


class NotificationPriority(str, enum.Enum):
    NORMAL = "normal"
    IMPORTANT = "important"
    URGENT = "urgent"


class NotificationAudience(str, enum.Enum):
    STUDENT = "student"
    FACULTY = "faculty"
    BOTH = "both"


class Notification(Base):
    """An official, admin-published communication (circular, holiday,
    deadline...). Read state is per user in NotificationRead, never here."""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    # Stored as plain strings validated against the enums above, so adding a
    # category later never needs a Postgres enum migration.
    category = Column(String(30), nullable=False, default="general")
    priority = Column(String(20), nullable=False, default="normal")
    audience = Column(String(20), nullable=False)
    published_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)

    circular_number = Column(String(80), nullable=True)
    department = Column(String(120), nullable=True)
    event_date = Column(DateTime, nullable=True)
    deadline = Column(DateTime, nullable=True)
    effective_date = Column(DateTime, nullable=True)

    # published_at in the future means "scheduled": hidden until it arrives.
    published_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    # Set when a scheduled reminder fires, so the item resurfaces as unread.
    last_reminded_at = Column(DateTime, nullable=True)
    # Set (atomically) the moment the initial Web Push for this notification is
    # claimed, so it is pushed at most once however many times anything runs.
    push_sent_at = Column(DateTime, nullable=True)

    status = Column(String(20), nullable=False, default="published")  # draft | published | archived
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    document = relationship("Document")
    reminders = relationship("ScheduledReminder", back_populates="notification", cascade="all, delete-orphan")


class NotificationRead(Base):
    """One row per (notification, user) who has read it."""

    __tablename__ = "notification_reads"
    __table_args__ = (UniqueConstraint("notification_id", "user_id", name="uq_notification_reads_user"),)

    id = Column(Integer, primary_key=True)
    notification_id = Column(Integer, ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    read_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ScheduledReminder(Base):
    __tablename__ = "scheduled_reminders"
    # The same notification can never have two reminders for the same moment.
    __table_args__ = (UniqueConstraint("notification_id", "scheduled_for", name="uq_scheduled_reminder_time"),)

    id = Column(Integer, primary_key=True)
    notification_id = Column(Integer, ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False, index=True)
    scheduled_for = Column(DateTime, nullable=False, index=True)
    reminder_type = Column(String(30), nullable=False)  # the notification's category
    offset_days = Column(Integer, nullable=True)  # null for a custom reminder date
    status = Column(String(20), nullable=False, default="pending")  # pending | sent | cancelled
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    notification = relationship("Notification", back_populates="reminders")


class PushSubscription(Base):
    """One browser/device a user has opted in to background notifications on.
    A user can have several. The endpoint is the push service's per-browser
    URL and acts as a bearer secret, so it is never returned by any API."""

    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False, index=True)
    endpoint = Column(String(1000), nullable=False, unique=True)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    failure_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_success_at = Column(DateTime, nullable=True)
    last_failure_at = Column(DateTime, nullable=True)
