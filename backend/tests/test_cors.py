"""CORS behaviour the deployed frontend depends on. The browser hides every
error that lacks Access-Control-Allow-Origin behind "blocked by CORS", so a
500 without the header looks like a CORS misconfiguration."""
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.main import app

ORIGIN = "https://campus-mind-ai-delta.vercel.app"


@pytest.fixture(autouse=True)
def _allowed_origin(monkeypatch):
    monkeypatch.setattr(settings, "frontend_origin", f"http://localhost:5173,{ORIGIN}")
    # The middleware captured the list at import time, so rebuild the stack.
    monkeypatch.setattr(app, "middleware_stack", None)
    for m in app.user_middleware:
        if m.cls.__name__ == "CORSMiddleware":
            monkeypatch.setitem(m.kwargs, "allow_origins", settings.cors_origins)
    yield
    app.middleware_stack = None


def _quiet():
    return TestClient(app, raise_server_exceptions=False)


def test_preflight_for_notification_publish_allows_the_production_origin(client):
    r = client.options(
        "/api/notifications",
        headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == ORIGIN
    assert r.headers["access-control-allow-credentials"] == "true"


def test_unlisted_origin_is_not_allowed_and_never_a_wildcard(client):
    r = client.options(
        "/api/notifications",
        headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"},
    )
    assert r.headers.get("access-control-allow-origin") not in ("*", "https://evil.example.com")


def test_validation_and_auth_errors_carry_cors_headers(client):
    for headers in ({"Origin": ORIGIN}, {"Origin": ORIGIN, "Authorization": "Bearer garbage"}):
        r = client.post("/api/notifications", headers=headers, data={"title": "x"})
        assert r.status_code in (401, 403, 422)
        assert r.headers["access-control-allow-origin"] == ORIGIN


def test_unhandled_500_still_carries_cors_headers(college_and_admin, monkeypatch):
    admin_token, _ = college_and_admin

    def boom(*args, **kwargs):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr("app.api.notifications.create_notification", boom)
    r = _quiet().post(
        "/api/notifications",
        headers={"Origin": ORIGIN, "Authorization": f"Bearer {admin_token}"},
        data={"title": "Holiday", "body": "Closed.", "category": "holiday", "audience": "both"},
    )
    assert r.status_code == 500
    assert "secret internal detail" not in r.text
    assert r.headers["access-control-allow-origin"] == ORIGIN
    assert r.headers["x-request-id"] == r.json()["request_id"]


def test_unhandled_500_does_not_grant_cors_to_unlisted_origins(college_and_admin, monkeypatch):
    admin_token, _ = college_and_admin
    monkeypatch.setattr("app.api.notifications.create_notification", lambda *a, **k: 1 / 0)
    r = _quiet().post(
        "/api/notifications",
        headers={"Origin": "https://evil.example.com", "Authorization": f"Bearer {admin_token}"},
        data={"title": "Holiday", "body": "Closed.", "category": "holiday", "audience": "both"},
    )
    assert r.status_code == 500
    assert "access-control-allow-origin" not in r.headers
