"""Event detector unit tests, plus the document-lifecycle regression for
ObjectDeletedError.

NOTE: these run on SQLite. Session expiry / rollback semantics are the same in
SQLAlchemy, but PostgreSQL behaviour (e.g. a failed flush inside
process_document followed by a reload) still needs verification against the
production database after deploy.
"""
import io

import pytest

from PIL import Image

from app.db import models
from app.db.database import get_db
from app.main import app
from app.services import document_upload
from app.services.event_detector import detect_events


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _png():
    buf = io.BytesIO()
    Image.new("RGB", (400, 200), "white").save(buf, "PNG")
    return buf.getvalue()


# ---------- detector ----------

def test_detects_deadline_holiday_exam_event():
    found = detect_events(
        [
            "Last date to register: 12 October 2026.",
            "The college will remain closed on 21/10/2026 for Deepavali holiday.",
            "End semester examination commences on November 3, 2026.",
            "Annual Day event on 15 December 2026.",
        ]
    )
    by_kind = {e["kind"]: e["date"] for e in found}
    assert by_kind["deadline"] == "2026-10-12"
    assert by_kind["holiday"] == "2026-10-21"
    assert by_kind["examination"] == "2026-11-03"
    assert by_kind["event"] == "2026-12-15"
    assert all(set(e) == {"kind", "date", "text"} for e in found)


def test_detector_ignores_noise_and_invalid_dates():
    assert detect_events([]) == []
    assert detect_events(["No dates in this text at all."]) == []
    assert detect_events(["Deadline 31 February 2026"]) == []  # impossible date
    assert detect_events(["Submit by 12 October"]) == []  # no year: not guessed


def test_detector_deduplicates_and_caps():
    text = "Last date: 12 October 2026. Last date: 12 October 2026."
    assert len(detect_events([text])) == 1
    many = " ".join(f"Last date {d:02d} March 20{y}." for y in range(20, 30) for d in range(1, 8))
    assert len(detect_events([many])) <= 30


# ---------- ObjectDeletedError regression ----------

def test_create_document_survives_session_expiry_in_processing(client, college_and_admin, monkeypatch):
    """process_document commits/rolls back, expiring the Document instance.
    create_document must reload it by id rather than touching the stale object
    (previously raised ObjectDeletedError)."""
    admin_token, _ = college_and_admin

    async def expiring_process(db, document):
        document.status = models.DocumentStatus.READY
        db.commit()
        db.rollback()
        db.expire_all()

    monkeypatch.setattr(document_upload, "process_document", expiring_process)
    resp = client.post(
        "/api/notifications",
        headers=_auth(admin_token),
        data={"title": "T", "body": "B", "category": "circular", "audience": "both"},
        files={"file": ("n.png", _png(), "image/png")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["attachment"]["document_id"]


def test_failed_processing_cleans_up_storage_and_leaves_no_notification(client, college_and_admin, monkeypatch):
    admin_token, _ = college_and_admin
    deleted = []

    async def boom(db, document):
        raise RuntimeError("extraction exploded")

    monkeypatch.setattr(document_upload, "process_document", boom)
    monkeypatch.setattr(document_upload.storage_service, "delete_stored", lambda p, k: deleted.append((p, k)))
    # The error propagates (a 500 in production); what matters is the cleanup.
    with pytest.raises(RuntimeError):
        client.post(
            "/api/notifications",
            headers=_auth(admin_token),
            data={"title": "T", "body": "B", "category": "circular", "audience": "both"},
            files={"file": ("n.png", _png(), "image/png")},
        )
    assert deleted, "stored file should be cleaned up when ingestion crashes"
    assert client.get("/api/notifications", headers=_auth(admin_token)).json() == []
