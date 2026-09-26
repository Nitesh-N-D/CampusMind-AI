import os
import shutil

import pytest

# Point the app's own module-level engine at a throwaway file before any
# app module is imported, so running tests never touches the real
# development database used by `uvicorn app.main:app`.
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_campusmind.db")
os.environ.setdefault("AI_PROVIDER", "mock")
os.environ.setdefault("EMBEDDING_PROVIDER", "local")
# Uploaded test files go to their own folder, removed after the run, so
# they never pile up next to real development uploads in ./uploads.
os.environ.setdefault("UPLOAD_DIR", "./test_uploads")

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
