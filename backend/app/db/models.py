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

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    college = relationship("College", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")
    events = relationship("ExtractedEvent", back_populates="document", cascade="all, delete-orphan")


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


class ExtractedEvent(Base):
    """Feature 6: Deadline & Event Intelligence"""

    __tablename__ = "extracted_events"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    title = Column(String(500), nullable=False)
    category = Column(String(60), nullable=False)  # academic, exam, placement, fees, event, deadline
    event_date = Column(DateTime, nullable=False)
    department = Column(String(120), nullable=True)
    source_snippet = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="events")


class DocumentChangeLog(Base):
    """Feature 7: What Changed? Intelligence"""

    __tablename__ = "document_change_logs"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    old_document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    new_document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    field_or_topic = Column(String(255), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    impact_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(255), default="New conversation")
    language = Column(String(20), default="en")
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


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


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # null = broadcast to whole college
    target_role = Column(String(20), nullable=True)  # null = everyone, else "admin" or "student"
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    category = Column(String(60), default="general")
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
