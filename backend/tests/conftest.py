import os
import shutil

import pytest

# Test isolation. These are ASSIGNED, not setdefault'd: pydantic-settings
# ranks real environment variables above backend/.env, so forcing them here
# guarantees a developer's .env (real Cloudinary / VAPID / Gemini / database
# credentials) can never leak into a test run. Must happen before any app
# module is imported.
_ISOLATED_ENV = {
    "ENVIRONMENT": "test",
    "DATABASE_URL": "sqlite:///./test_campusmind.db",
    "AI_PROVIDER": "mock",
    "EMBEDDING_PROVIDER": "local",
    "UPLOAD_DIR": "./test_uploads",
    "SECRET_KEY": "test-only-secret-key-" + "x" * 32,
    "GEMINI_API_KEY": "",
    "OPENAI_API_KEY": "",
    "ANTHROPIC_API_KEY": "",
    "CLOUDINARY_CLOUD_NAME": "",
    "CLOUDINARY_API_KEY": "",
    "CLOUDINARY_API_SECRET": "",
    "CRON_SECRET": "",
    "VAPID_PUBLIC_KEY": "",
    "VAPID_PRIVATE_KEY": "",
    "VAPID_SUBJECT": "",
}
os.environ.update(_ISOLATED_ENV)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.db.database import Base, get_db
from app.main import app

TEST_DB_URL = "sqlite:///:memory:"

engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def _clean_test_uploads():
    yield
    from app.core.config import settings

    if os.path.basename(os.path.normpath(settings.upload_dir)) == "test_uploads":
        shutil.rmtree(settings.upload_dir, ignore_errors=True)


@pytest.fixture(autouse=True)
def _no_real_external_services(monkeypatch):
    """Belt and braces on top of the blanked credentials: any code path that
    reaches the real Cloudinary or Web Push libraries fails loudly. Tests that
    exercise those paths monkeypatch these again with their own fakes."""
    import cloudinary.uploader

    def _blocked(*args, **kwargs):
        raise AssertionError("A test tried to call a real external service")

    monkeypatch.setattr(cloudinary.uploader, "upload", _blocked)
    monkeypatch.setattr(cloudinary.uploader, "destroy", _blocked)
    from app.services import push_service

    monkeypatch.setattr(push_service, "webpush", _blocked)


@pytest.fixture(autouse=True)
def _fresh_db():
    """Every test gets a clean schema so tests never leak state into each other."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def seed_pdf_path():
    import os

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "seed_data")


@pytest.fixture
def college_and_admin(client):
    """Registers a college workspace and returns (admin_token, college_domain)."""
    resp = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "MIT Anna University",
            "official_domain": "mitindia.edu",
            "admin_email": "admin@mitindia.edu",
            "admin_full_name": "Dr. Admin",
            "admin_password": "adminpass123",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"], "mitindia.edu"


@pytest.fixture
def student_token(client, college_and_admin):
    _, domain = college_and_admin
    resp = client.post(
        "/api/auth/register-student",
        json={
            "email": f"nitesh@{domain}",
            "full_name": "Nitesh N D",
            "password": "pass1234",
            "department": "CSE",
            "year": 3,
            "semester": 5,
            "section": "A",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]
