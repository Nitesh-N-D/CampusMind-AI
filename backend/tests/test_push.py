"""Web Push: subscriptions, delivery rules, failure isolation, duplicates.
The network is never touched: push_service._send_one is replaced."""
import json
from datetime import datetime, timedelta

import pytest

from app.core.config import settings
from app.db import models
from app.db.database import get_db
from app.main import app
from app.services import push_service, reminder_service
from tests.test_notifications import _auth, _iso, faculty_token, other_college, publish  # noqa: F401

FCM = "https://fcm.googleapis.com/fcm/send/"


class FakePush:
    def __init__(self):
        self.calls = []
        self.fail = {}  # endpoint -> exception to raise

    def __call__(self, info, payload):
        self.calls.append((info["endpoint"], payload))
        if info["endpoint"] in self.fail:
            raise self.fail[info["endpoint"]]


class Gone(Exception):
    def __init__(self, status):
        super().__init__(str(status))
        self.response = type("R", (), {"status_code": status})()


@pytest.fixture
def push(monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "PUBLIC")
    monkeypatch.setattr(settings, "vapid_private_key", "PRIVATE")
    monkeypatch.setattr(settings, "vapid_subject", "mailto:ops@example.com")
    fake = FakePush()
    monkeypatch.setattr(push_service, "_send_one", fake)
    monkeypatch.setattr(push_service, "WebPushException", Gone)
    return fake


def sub_body(name="a"):
    return {"endpoint": FCM + name, "keys": {"p256dh": "k" + name, "auth": "s" + name}}


def subscribe(client, token, name="a"):
    return client.post("/api/push/subscribe", headers=_auth(token), json=sub_body(name))


def unsubscribe(client, token, name="a"):
    return client.request("DELETE", "/api/push/subscribe", headers=_auth(token), json={"endpoint": FCM + name})


def _db():
    gen = app.dependency_overrides[get_db]()
    return gen, next(gen)


def stored(name):
    gen, db = _db()
    try:
        return db.query(models.PushSubscription).filter_by(endpoint=FCM + name).first()
    finally:
        gen.close()


# ---------- status / configuration ----------

def test_endpoints_require_auth(client):
    assert client.get("/api/push/status").status_code == 401
    assert client.post("/api/push/subscribe", json=sub_body()).status_code == 401
    assert client.request("DELETE", "/api/push/subscribe", json={"endpoint": FCM + "a"}).status_code == 401


def test_status_unconfigured_hides_key(client, student_token, monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "")
    body = client.get("/api/push/status", headers=_auth(student_token)).json()
    assert body == {"configured": False, "public_key": None, "subscribed": False, "devices": 0}


def test_status_exposes_only_the_public_key(client, student_token, push):
    body = client.get("/api/push/status", headers=_auth(student_token)).json()
    assert body["configured"] and body["public_key"] == "PUBLIC"
    assert "PRIVATE" not in str(body)


def test_subscribe_503_when_unconfigured(client, student_token, monkeypatch):
    monkeypatch.setattr(settings, "vapid_private_key", "")
    assert subscribe(client, student_token).status_code == 503


def test_subject_must_be_mailto_or_https(monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "P")
    monkeypatch.setattr(settings, "vapid_private_key", "K")
    monkeypatch.setattr(settings, "vapid_subject", "ops@example.com")
    assert not push_service.is_configured()


# ---------- subscriptions ----------

def test_subscribe_upsert_and_multiple_devices(client, student_token, push):
    assert subscribe(client, student_token, "a").json()["devices"] == 1
    assert subscribe(client, student_token, "a").json()["devices"] == 1  # same device: no duplicate row
    assert subscribe(client, student_token, "b").json()["devices"] == 2


def test_user_and_college_come_from_the_token_not_the_client(client, student_token, push):
    body = sub_body()
    body.update({"user_id": 999, "college_id": 999})
    assert client.post("/api/push/subscribe", headers=_auth(student_token), json=body).status_code == 200
    s = stored("a")
    assert s.user_id != 999 and s.college_id != 999


def test_admin_cannot_subscribe(client, college_and_admin, push):
    admin_token, _ = college_and_admin
    assert subscribe(client, admin_token).status_code == 403


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/x",
        "https://evil.example.com/x",
        "https://169.254.169.254/x",
        "https://fcm.googleapis.com.evil.com/x",
    ],
)
def test_endpoint_allowlist_blocks_ssrf(client, student_token, push, endpoint):
    resp = client.post(
        "/api/push/subscribe",
        headers=_auth(student_token),
        json={"endpoint": endpoint, "keys": {"p256dh": "k", "auth": "a"}},
    )
    assert resp.status_code == 400


def test_endpoint_allowed_helper():
    assert push_service.endpoint_allowed("https://updates.push.services.mozilla.com/wpush/v2/x")
    assert push_service.endpoint_allowed("https://web.push.apple.com/x")
    assert not push_service.endpoint_allowed("https://user:pw@fcm.googleapis.com/x")


def test_unsubscribe_own_only(client, student_token, faculty_token, push):
    subscribe(client, student_token, "a")
    unsubscribe(client, faculty_token, "a")  # someone else's device: silently ignored
    assert stored("a") is not None
    resp = unsubscribe(client, student_token, "a")
    assert resp.status_code == 200 and resp.json()["devices"] == 0
    assert stored("a") is None


def test_resubscribe_from_another_account_rebinds_the_device(client, student_token, faculty_token, push):
    subscribe(client, student_token, "a")
    subscribe(client, faculty_token, "a")
    assert client.get("/api/push/status", headers=_auth(student_token)).json()["devices"] == 0
    assert client.get("/api/push/status", headers=_auth(faculty_token)).json()["devices"] == 1


# ---------- delivery on publish ----------

def test_publish_pushes_once_to_the_audience_only(client, college_and_admin, student_token, faculty_token, other_college, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token, "stu")
    subscribe(client, faculty_token, "fac")
    subscribe(client, other_college[1], "other")
    publish(client, admin_token, title="Students only", audience="student")
    assert [c[0] for c in push.calls] == [FCM + "stu"]


def test_audience_both_reaches_both_roles_but_not_other_colleges(
    client, college_and_admin, student_token, faculty_token, other_college, push
):
    admin_token, _ = college_and_admin
    subscribe(client, student_token, "stu")
    subscribe(client, faculty_token, "fac")
    subscribe(client, other_college[1], "other")
    publish(client, admin_token)
    assert sorted(c[0] for c in push.calls) == [FCM + "fac", FCM + "stu"]


def test_payload_is_minimal(client, college_and_admin, student_token, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token)
    publish(client, admin_token, title="T", body="B " * 300)
    data = json.loads(push.calls[0][1])
    assert set(data) == {"notification_id", "title", "body", "url", "category", "priority"}
    assert len(data["body"]) <= 140 and data["url"] == "/notifications"


def test_draft_scheduled_and_archived_do_not_push(client, college_and_admin, student_token, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token)
    publish(client, admin_token, status="draft")
    publish(client, admin_token, published_at=_iso(timedelta(days=1)))
    assert push.calls == []
    nid = publish(client, admin_token).json()["id"]
    push.calls.clear()
    client.delete(f"/api/notifications/{nid}", headers=_auth(admin_token))
    assert push.calls == []


def test_edit_does_not_push_again(client, college_and_admin, student_token, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token)
    nid = publish(client, admin_token).json()["id"]
    assert len(push.calls) == 1
    client.patch(f"/api/notifications/{nid}", headers=_auth(admin_token), json={"title": "Edited"})
    gen, db = _db()
    try:
        assert push_service.release_due_pushes(db) == 0
    finally:
        gen.close()
    assert len(push.calls) == 1


def test_scheduled_notification_pushed_once_when_it_goes_live(client, college_and_admin, student_token, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token)
    publish(client, admin_token, published_at=_iso(timedelta(hours=2)))
    gen, db = _db()
    try:
        later = datetime.utcnow() + timedelta(hours=3)
        assert push_service.release_due_pushes(db, now=later) == 1
        assert push_service.release_due_pushes(db, now=later) == 0
    finally:
        gen.close()
    assert len(push.calls) == 1


def test_publish_succeeds_when_push_fails(client, college_and_admin, student_token, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token)
    push.fail[FCM + "a"] = RuntimeError("network down")
    assert publish(client, admin_token).status_code == 200


def test_publish_without_push_configuration_still_works(client, college_and_admin, monkeypatch):
    admin_token, _ = college_and_admin
    monkeypatch.setattr(settings, "vapid_public_key", "")
    assert publish(client, admin_token).status_code == 200


# ---------- failure handling ----------

def test_one_failing_device_does_not_stop_others_and_dead_ones_deactivate(
    client, college_and_admin, student_token, faculty_token, push
):
    admin_token, _ = college_and_admin
    subscribe(client, student_token, "dead")
    subscribe(client, student_token, "flaky")
    subscribe(client, faculty_token, "good")
    push.fail[FCM + "dead"] = Gone(410)
    push.fail[FCM + "flaky"] = Gone(500)
    publish(client, admin_token)
    assert len(push.calls) == 3
    dead, flaky, good = stored("dead"), stored("flaky"), stored("good")
    assert dead.is_active is False and dead.last_failure_at is not None
    assert flaky.is_active is True and flaky.failure_count == 1 and flaky.last_failure_at is not None
    assert good.is_active is True and good.last_success_at is not None and good.failure_count == 0
    # A deactivated subscription is not tried again.
    push.calls.clear()
    publish(client, admin_token, title="Second")
    assert FCM + "dead" not in [c[0] for c in push.calls]


def test_persistently_failing_subscription_is_eventually_retired(client, college_and_admin, student_token, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token, "stale")
    push.fail[FCM + "stale"] = Gone(403)
    for i in range(push_service.MAX_CONSECUTIVE_FAILURES - 1):
        publish(client, admin_token, title=f"n{i}")
    assert stored("stale").is_active is True
    publish(client, admin_token, title="last")
    assert stored("stale").is_active is False
    # Signing in again re-registers it as active with a clean count.
    subscribe(client, student_token, "stale")
    assert stored("stale").is_active is True and stored("stale").failure_count == 0


# ---------- reminders ----------

def test_reminder_pushes_once_and_repeat_scheduler_runs_do_not(client, college_and_admin, student_token, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token)
    publish(
        client, admin_token, category="deadline", audience="student", deadline=_iso(timedelta(days=2)), reminder_offsets="1"
    )
    assert len(push.calls) == 1  # the publish itself
    gen, db = _db()
    try:
        later = datetime.utcnow() + timedelta(days=1, hours=1)
        first = reminder_service.process_due_reminders(db, now=later)
        second = reminder_service.process_due_reminders(db, now=later)
    finally:
        gen.close()
    assert first["sent"] == 1 and first["pushed"] == 1
    assert second["sent"] == 0 and second["pushed"] == 0
    assert len(push.calls) == 2
    assert "Reminder:" in push.calls[1][1]


def test_process_endpoint_reports_pushed(client, college_and_admin, push):
    admin_token, _ = college_and_admin
    body = client.post("/api/notifications/process-reminders", headers=_auth(admin_token)).json()
    assert {"sent", "cancelled", "deferred", "pushed"} <= set(body)


def test_reminders_do_not_cross_audiences_or_colleges(
    client, college_and_admin, student_token, faculty_token, other_college, push
):
    admin_token, _ = college_and_admin
    subscribe(client, faculty_token, "fac")
    subscribe(client, other_college[1], "other")
    publish(
        client, admin_token, category="deadline", audience="student", deadline=_iso(timedelta(days=2)), reminder_offsets="1"
    )
    push.calls.clear()
    gen, db = _db()
    try:
        reminder_service.process_due_reminders(db, now=datetime.utcnow() + timedelta(days=1, hours=1))
    finally:
        gen.close()
    assert push.calls == []


# ---------- polling dedupe / regression ----------

def test_push_creates_no_extra_notification_records(client, college_and_admin, student_token, push):
    admin_token, _ = college_and_admin
    subscribe(client, student_token)
    publish(client, admin_token)
    assert client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()["unread"] == 1
    assert len(client.get("/api/notifications", headers=_auth(student_token)).json()) == 1
