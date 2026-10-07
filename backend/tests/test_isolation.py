"""Regression guards: the suite must never touch real services or read backend/.env."""
import pytest

from app.core.config import settings
from app.services import push_service, storage_service


def test_settings_do_not_come_from_dotenv():
    assert settings.environment == "test"
    assert settings.database_url == "sqlite:///./test_campusmind.db"
    assert settings.ai_provider == "mock"
    assert settings.embedding_provider == "local"
    assert settings.gemini_api_key == ""
    assert settings.cron_secret == ""


def test_cloudinary_is_disabled():
    assert not (settings.cloudinary_cloud_name or settings.cloudinary_api_key or settings.cloudinary_api_secret)
    assert storage_service.cloudinary_configured() is False


def test_web_push_is_disabled():
    assert push_service.is_configured() is False
    with pytest.raises(AssertionError, match="real external service"):
        push_service.webpush()


def test_real_cloudinary_upload_is_blocked():
    import cloudinary.uploader

    with pytest.raises(AssertionError, match="real external service"):
        cloudinary.uploader.upload(b"x")


def test_app_database_is_isolated_sqlite(client):
    from app.db.database import get_db
    from app.main import app

    # conftest swaps the DB dependency for an in-memory engine.
    assert get_db in app.dependency_overrides
    assert settings.database_url.startswith("sqlite")
