from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


# ---------- Auth / Colleges ----------

class CollegeCreate(BaseModel):
    college_name: str = Field(..., min_length=2, max_length=255)
    official_domain: str = Field(..., min_length=3, max_length=255)
    admin_full_name: str
    admin_email: EmailStr
    admin_password: str = Field(..., min_length=8)


class StudentRegister(BaseModel):
    full_name: str
    email: EmailStr
    password: str = Field(..., min_length=8)
    role: str = "student"  # "student" or "faculty" - never "admin" via this endpoint
    department: Optional[str] = None
    year: Optional[int] = None
    semester: Optional[int] = None
    section: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    college_id: int
    college_name: str
    full_name: str


class CollegeOut(BaseModel):
    id: int
    name: str
    official_domain: str
    logo_url: Optional[str] = None

    class Config:
        from_attributes = True


# ---------- Profile ----------

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=120)
    nickname: Optional[str] = Field(None, max_length=60)
    department: Optional[str] = Field(None, max_length=120)
    year: Optional[int] = Field(None, ge=1, le=8)
    semester: Optional[int] = Field(None, ge=1, le=16)
    section: Optional[str] = Field(None, max_length=20)
    academic_batch: Optional[str] = Field(None, max_length=20)
    interests: Optional[List[str]] = None
    preferred_language: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def _clean_full_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Full name can't be empty.")
        if any(ch.isdigit() for ch in v):
            raise ValueError("Full name shouldn't contain numbers.")
        return v

    @field_validator("nickname")
    @classmethod
    def _clean_nickname(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None  # empty string clears the nickname
        if len(v) < 2:
            raise ValueError("Nickname must be at least 2 characters.")
        if not all(ch.isalnum() or ch in " _-." for ch in v):
            raise ValueError("Nickname can only contain letters, numbers, spaces, - _ and .")
        return v

    @field_validator("preferred_language")
    @classmethod
    def _validate_language(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in {"en", "ta", "hi"}:
            raise ValueError("Preferred language must be one of: en, ta, hi.")
        return v

    @field_validator("interests")
    @classmethod
    def _clean_interests(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        cleaned = [s.strip() for s in v if s.strip()]
        if len(cleaned) > 20:
            raise ValueError("No more than 20 interests, please.")
        for s in cleaned:
            if len(s) > 40:
                raise ValueError("Each interest must be 40 characters or fewer.")
        return cleaned


class ChangeLogOut(BaseModel):
    id: int
    old_document_id: int
    old_document_title: str
    new_document_id: int
    new_document_title: str
    topic: str
    old_value: Optional[str]
    new_value: Optional[str]
    impact_summary: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileOut(BaseModel):
    id: int
    email: str
    full_name: str
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    department: Optional[str]
    year: Optional[int]
    semester: Optional[int]
    section: Optional[str]
    academic_batch: Optional[str]
    interests: List[str] = []
    preferred_language: str

    class Config:
        from_attributes = True


# ---------- Documents ----------

class DocumentOut(BaseModel):
    id: int
    title: str
    document_type: str
    department: Optional[str]
    academic_year: Optional[str]
    semester: Optional[int]
    published_date: Optional[datetime]
    effective_date: Optional[datetime]
    expiry_date: Optional[datetime]
    version: int
    is_official: bool
    is_verified: bool
    trust_level: str
    trust_score: float
    status: str
    is_demo_data: bool
    page_count: int
    processing_error: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Chat ----------

class ChatRequest(BaseModel):
    session_id: Optional[int] = None
    message: str
    language: Optional[str] = "en"


class CitationOut(BaseModel):
    document_id: int
    document_title: str
    page: Optional[int]
    section: Optional[str]
    trust_level: Optional[str]
    trust_score: Optional[float]
    department: Optional[str]


class ChatResponse(BaseModel):
    session_id: int
    message_id: int
    answer: str
    citations: List[dict]
    confidence: float
    has_conflict: bool
    conflicts: List[dict]
    retrieval_ms: int
    llm_ms: int
    abstained: bool


class FeedbackRequest(BaseModel):
    feedback: str  # "up" | "down"
    note: Optional[str] = None


# ---------- Search ----------

class SearchResultOut(BaseModel):
    document_id: int
    document_title: str
    snippet: str
    page: Optional[int]
    department: Optional[str]
    date: Optional[datetime]
    trust_score: float
    relevance_score: float


# ---------- Timeline ----------

class EventOut(BaseModel):
    id: int
    title: str
    category: str
    event_date: datetime
    department: Optional[str]
    document_id: int

    class Config:
        from_attributes = True


# ---------- Admin ----------

class KnowledgeHealthOut(BaseModel):
    health_score: float
    documents_indexed: int
    verified: int
    outdated: int
    conflicting: int
    unprocessed: int
    low_confidence_topics: int


class ConflictOut(BaseModel):
    id: int
    topic: str
    document_a_id: int
    value_a: Optional[str]
    document_b_id: int
    value_b: Optional[str]
    suggested_authoritative_id: Optional[int]
    reasoning: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ConflictResolve(BaseModel):
    authoritative_document_id: int
    resolution_note: Optional[str] = None
