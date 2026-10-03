"""Admin-published notifications: audience targeting, per-user read state,
college isolation, reminders, attachments."""
import io
from datetime import datetime, timedelta

import pytest
from PIL import Image

from app.core.config import settings
from app.db import models
from app.db.database import get_db
from app.main import app
from app.services import notification_service as svc
from app.services import reminder_service
from app.services import storage_service


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _iso(delta: timedelta) -> str:
    return (datetime.utcnow() + delta).strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.fixture
def faculty_token(client, college_and_admin):
    admin_token, domain = college_and_admin
    client.put(
        "/api/admin/settings/faculty-domain", headers=_auth(admin_token), json={"faculty_domain": f"staff.{domain}"}
    )
    resp = client.post(
        "/api/auth/register-student",
        json={"email": f"prof@staff.{domain}", "full_name": "Prof Test", "password": "pass1234", "role": "faculty"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture
def other_college(client):
    resp = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "Other College",
            "official_domain": "other.edu",
            "admin_email": "admin@other.edu",
            "admin_full_name": "Other Admin",
            "admin_password": "adminpass123",
        },
    )
    assert resp.status_code == 200, resp.text
    admin = resp.json()["access_token"]
    student = client.post(
        "/api/auth/register-student",
        json={"email": "kid@other.edu", "full_name": "Other Kid", "password": "pass1234", "department": "CSE"},
    ).json()["access_token"]
    return admin, student


def publish(client, token, **overrides):
    data = {"title": "Holiday tomorrow", "body": "College closed.", "category": "holiday", "audience": "both"}
    data.update(overrides)
    return client.post("/api/notifications", headers=_auth(token), data=data)


def titles(client, token, path="/api/notifications"):
    resp = client.get(path, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return [n["title"] for n in resp.json()]


# ---------- publishing is admin-only ----------

def test_admin_can_publish(client, college_and_admin):
    admin_token, _ = college_and_admin
    resp = publish(client, admin_token, priority="urgent")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["state"] == "published" and body["priority"] == "urgent" and body["audience"] == "both"


@pytest.mark.parametrize("who", ["student_token", "faculty_token"])
def test_students_and_faculty_cannot_publish_or_manage(client, college_and_admin, request, who):
    token = request.getfixturevalue(who)
    admin_token, _ = college_and_admin
    nid = publish(client, admin_token).json()["id"]

    assert publish(client, token).status_code == 403
    assert client.patch(f"/api/notifications/{nid}", headers=_auth(token), json={"title": "x"}).status_code == 403
    assert client.delete(f"/api/notifications/{nid}", headers=_auth(token)).status_code == 403
    assert client.get("/api/notifications/summary", headers=_auth(token)).status_code == 403
    assert client.post("/api/notifications/process-reminders", headers=_auth(token)).status_code == 403
    reminder = {"title": "t", "body": "b", "audience": "both", "deadline": _iso(timedelta(days=5))}
    assert client.post("/api/reminders", headers=_auth(token), json=reminder).status_code == 403
    assert client.patch(f"/api/reminders/{nid}", headers=_auth(token), json={"title": "x"}).status_code == 403
    assert client.delete(f"/api/reminders/{nid}", headers=_auth(token)).status_code == 403


def test_unauthenticated_requests_are_rejected(client):
    assert client.get("/api/notifications").status_code == 401
    assert client.get("/api/notifications/unread-count").status_code == 401
    assert client.post("/api/notifications/process-reminders").status_code == 401


# ---------- audience targeting ----------

def test_audience_targeting(client, college_and_admin, student_token, faculty_token):
    admin_token, _ = college_and_admin
    publish(client, admin_token, title="For students", audience="student")
    publish(client, admin_token, title="For faculty", audience="faculty")
    publish(client, admin_token, title="For everyone", audience="both")

    assert sorted(titles(client, student_token)) == ["For everyone", "For students"]
    assert sorted(titles(client, faculty_token)) == ["For everyone", "For faculty"]
    assert sorted(titles(client, admin_token)) == ["For everyone", "For faculty", "For students"]


def test_audience_is_enforced_on_direct_access(client, college_and_admin, student_token, faculty_token):
    admin_token, _ = college_and_admin
    nid = publish(client, admin_token, audience="faculty").json()["id"]
    assert client.get(f"/api/notifications/{nid}", headers=_auth(faculty_token)).status_code == 200
    assert client.get(f"/api/notifications/{nid}", headers=_auth(student_token)).status_code == 404
    assert client.post(f"/api/notifications/{nid}/read", headers=_auth(student_token)).status_code == 404


def test_audience_required_and_validated(client, college_and_admin):
    admin_token, _ = college_and_admin
    resp = publish(client, admin_token, audience="")
    assert resp.status_code == 400 and "at least one audience" in resp.json()["detail"]
    assert publish(client, admin_token, audience="everyone").status_code == 400
    assert publish(client, admin_token, category="nonsense").status_code == 400
    assert publish(client, admin_token, priority="whenever").status_code == 400
    assert publish(client, admin_token, title="  ").status_code == 400
    assert publish(client, admin_token, body="").status_code == 400


# ---------- college isolation ----------

def test_college_isolation(client, college_and_admin, student_token, other_college):
    admin_token, _ = college_and_admin
    other_admin, other_student = other_college
    nid = publish(client, admin_token, title="College A only").json()["id"]
    other_id = publish(client, other_admin, title="College B only").json()["id"]

    assert titles(client, student_token) == ["College A only"]
    assert titles(client, other_student) == ["College B only"]
    assert titles(client, other_admin) == ["College B only"]

    # ID guessing across colleges never works, for any verb.
    for token in (other_student, other_admin):
        assert client.get(f"/api/notifications/{nid}", headers=_auth(token)).status_code == 404
    assert client.post(f"/api/notifications/{nid}/read", headers=_auth(other_student)).status_code == 404
    assert client.patch(f"/api/notifications/{nid}", headers=_auth(other_admin), json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/notifications/{nid}", headers=_auth(other_admin)).status_code == 404
    assert client.delete(f"/api/reminders/{nid}", headers=_auth(other_admin)).status_code == 404
    assert client.get(f"/api/notifications/{other_id}", headers=_auth(student_token)).status_code == 404


# ---------- read state ----------

def test_unread_count_and_mark_read_are_per_user(client, college_and_admin, student_token):
    admin_token, domain = college_and_admin
    second = client.post(
        "/api/auth/register-student",
        json={"email": f"second@{domain}", "full_name": "Second Student", "password": "pass1234", "department": "ECE"},
    ).json()["access_token"]
    ids = [publish(client, admin_token, title=f"N{i}", audience="student").json()["id"] for i in range(3)]

    assert client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()["unread"] == 3
    assert client.post(f"/api/notifications/{ids[0]}/read", headers=_auth(student_token)).status_code == 200
    assert client.post(f"/api/notifications/{ids[0]}/read", headers=_auth(student_token)).status_code == 200  # idempotent

    mine = client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()
    assert mine["unread"] == 2 and {n["id"] for n in mine["latest"]} == set(ids[1:])
    # Another student's state is independent.
    assert client.get("/api/notifications/unread-count", headers=_auth(second)).json()["unread"] == 3

    listed = {n["id"]: n["is_read"] for n in client.get("/api/notifications", headers=_auth(student_token)).json()}
    assert listed == {ids[0]: True, ids[1]: False, ids[2]: False}


def test_mark_all_read(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    for i in range(3):
        publish(client, admin_token, title=f"N{i}", audience="both")
    assert client.post("/api/notifications/read-all", headers=_auth(student_token)).json() == {"marked": 3}
    assert client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()["unread"] == 0
    assert client.post("/api/notifications/read-all", headers=_auth(student_token)).json() == {"marked": 0}
    publish(client, admin_token, title="Later")
    assert client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()["unread"] == 1


def test_read_state_lives_in_its_own_table(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    nid = publish(client, admin_token).json()["id"]
    client.post(f"/api/notifications/{nid}/read", headers=_auth(student_token))
    assert "is_read" not in {c.name for c in models.Notification.__table__.columns}
    session_gen = app.dependency_overrides[get_db]()
    db = next(session_gen)
    try:
        assert db.query(models.NotificationRead).filter_by(notification_id=nid).count() == 1
    finally:
        session_gen.close()


# ---------- expiry, scheduling, archive ----------

def test_expired_notifications_stay_listed_but_stop_counting(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    nid = publish(client, admin_token, expires_at=_iso(timedelta(hours=1))).json()["id"]
    session_gen = app.dependency_overrides[get_db]()
    db = next(session_gen)
    try:
        n = db.get(models.Notification, nid)
        n.expires_at = datetime.utcnow() - timedelta(minutes=1)
        db.commit()
    finally:
        session_gen.close()

    item = client.get("/api/notifications", headers=_auth(student_token)).json()[0]
    assert item["state"] == "expired"
    assert client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()["unread"] == 0
    expired = client.get("/api/notifications?status=expired", headers=_auth(admin_token)).json()
    assert [n["id"] for n in expired] == [nid]


def test_scheduled_notification_is_hidden_until_its_time(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    resp = publish(client, admin_token, published_at=_iso(timedelta(days=1)))
    assert resp.json()["state"] == "scheduled"
    assert titles(client, student_token) == []
    assert [n["state"] for n in client.get("/api/notifications?status=scheduled", headers=_auth(admin_token)).json()] == ["scheduled"]


def test_archive_hides_but_keeps_the_record(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    nid = publish(client, admin_token).json()["id"]
    assert client.delete(f"/api/notifications/{nid}", headers=_auth(admin_token)).status_code == 200
    assert titles(client, student_token) == []
    archived = client.get("/api/notifications?status=archived", headers=_auth(admin_token)).json()
    assert [n["id"] for n in archived] == [nid]


def test_admin_can_edit_and_filter(client, college_and_admin):
    admin_token, _ = college_and_admin
    nid = publish(client, admin_token, category="circular", audience="student").json()["id"]
    publish(client, admin_token, title="Other", category="event", audience="faculty")
    resp = client.patch(f"/api/notifications/{nid}", headers=_auth(admin_token), json={"title": "Renamed", "priority": "urgent"})
    assert resp.status_code == 200 and resp.json()["title"] == "Renamed"
    only = client.get("/api/notifications?category=circular&audience=student", headers=_auth(admin_token)).json()
    assert [n["title"] for n in only] == ["Renamed"]


# ---------- validation ----------

def test_deadline_validation(client, college_and_admin):
    admin_token, _ = college_and_admin
    past = publish(client, admin_token, deadline=_iso(timedelta(days=-1)))
    assert past.status_code == 400 and "Deadline cannot be in the past" in past.json()["detail"]
    ok = publish(client, admin_token, deadline=_iso(timedelta(days=5)))
    assert ok.status_code == 200
    reminder_after = publish(
        client, admin_token, deadline=_iso(timedelta(days=5)), reminder_date=_iso(timedelta(days=6))
    )
    assert "Reminder date must be before the deadline" in reminder_after.json()["detail"]
    no_anchor = publish(client, admin_token, reminder_offsets="1")
    assert no_anchor.status_code == 400
    assert publish(client, admin_token, deadline=_iso(timedelta(days=5)), reminder_offsets="5").status_code == 400


# ---------- reminders ----------

def _db():
    gen = app.dependency_overrides[get_db]()
    return gen, next(gen)


def test_deadline_reminders_are_scheduled_at_the_chosen_offsets(client, college_and_admin):
    admin_token, _ = college_and_admin
    deadline = datetime.utcnow() + timedelta(days=10)
    resp = publish(
        client, admin_token, category="deadline", deadline=deadline.strftime("%Y-%m-%dT%H:%M:%SZ"), reminder_offsets="7,3,1,0"
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reminder_offsets"] == [7, 3, 1, 0]
    gen, db = _db()
    try:
        rows = db.query(models.ScheduledReminder).filter_by(notification_id=resp.json()["id"]).all()
        assert len(rows) == 4 and {r.status for r in rows} == {"pending"}
        assert {r.offset_days for r in rows} == {7, 3, 1, 0}
    finally:
        gen.close()


def test_stale_reminders_are_not_created(client, college_and_admin):
    admin_token, _ = college_and_admin
    resp = publish(client, admin_token, deadline=_iso(timedelta(days=2)), reminder_offsets="7,3,1,0")
    assert resp.json()["reminder_offsets"] == [1, 0]  # 7 and 3 days before are already behind us


def test_reminder_processing_is_idempotent(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    nid = publish(
        client, admin_token, category="deadline", audience="student", deadline=_iso(timedelta(days=2)), reminder_offsets="1"
    ).json()["id"]
    client.post(f"/api/notifications/{nid}/read", headers=_auth(student_token))
    assert client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()["unread"] == 0

    # Nothing is due yet.
    assert client.post("/api/notifications/process-reminders", headers=_auth(admin_token)).json()["sent"] == 0

    gen, db = _db()
    try:
        later = datetime.utcnow() + timedelta(days=1, hours=1)
        first = reminder_service.process_due_reminders(db, now=later)
        second = reminder_service.process_due_reminders(db, now=later)
        third = reminder_service.process_due_reminders(db, now=later + timedelta(days=1))
        rows = db.query(models.ScheduledReminder).filter_by(notification_id=nid).all()
    finally:
        gen.close()
    assert first["sent"] == 1 and second["sent"] == 0 and third["sent"] == 0
    assert [r.status for r in rows] == ["sent"] and rows[0].sent_at is not None
    # The reminder resurfaces the item as unread, for its audience only.
    assert client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()["unread"] == 1


def test_reminders_never_cross_audiences_or_colleges(client, college_and_admin, student_token, faculty_token, other_college):
    admin_token, _ = college_and_admin
    _, other_student = other_college
    publish(client, admin_token, audience="faculty", deadline=_iso(timedelta(days=2)), reminder_offsets="1")
    gen, db = _db()
    try:
        reminder_service.process_due_reminders(db, now=datetime.utcnow() + timedelta(days=1, hours=1))
    finally:
        gen.close()
    assert client.get("/api/notifications/unread-count", headers=_auth(faculty_token)).json()["unread"] == 1
    assert client.get("/api/notifications/unread-count", headers=_auth(student_token)).json()["unread"] == 0
    assert client.get("/api/notifications/unread-count", headers=_auth(other_student)).json()["unread"] == 0


def test_archived_notification_reminders_are_cancelled_not_sent(client, college_and_admin):
    admin_token, _ = college_and_admin
    nid = publish(client, admin_token, deadline=_iso(timedelta(days=2)), reminder_offsets="1").json()["id"]
    client.delete(f"/api/notifications/{nid}", headers=_auth(admin_token))
    gen, db = _db()
    try:
        result = reminder_service.process_due_reminders(db, now=datetime.utcnow() + timedelta(days=3))
        statuses = [r.status for r in db.query(models.ScheduledReminder).filter_by(notification_id=nid)]
    finally:
        gen.close()
    assert result["sent"] == 0 and statuses == ["cancelled"]


def test_editing_the_deadline_resyncs_without_duplicates(client, college_and_admin):
    admin_token, _ = college_and_admin
    nid = publish(client, admin_token, deadline=_iso(timedelta(days=10)), reminder_offsets="3,1").json()["id"]
    new_deadline = _iso(timedelta(days=14))
    resp = client.patch(f"/api/notifications/{nid}", headers=_auth(admin_token), json={"deadline": new_deadline})
    assert resp.status_code == 200, resp.text
    gen, db = _db()
    try:
        rows = db.query(models.ScheduledReminder).filter_by(notification_id=nid).all()
    finally:
        gen.close()
    assert len([r for r in rows if r.status == "pending"]) == 2
    assert len([r for r in rows if r.status == "cancelled"]) == 2


def test_cron_secret_protects_the_processor(client, college_and_admin, monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "s3cret-value")
    assert client.post("/api/notifications/process-reminders", headers={"X-Cron-Secret": "wrong"}).status_code == 403
    ok = client.post("/api/notifications/process-reminders", headers={"X-Cron-Secret": "s3cret-value"})
    assert ok.status_code == 200 and ok.json()["sent"] == 0


def test_cron_secret_unset_disables_header_path(client, monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "")
    assert client.post("/api/notifications/process-reminders", headers={"X-Cron-Secret": ""}).status_code == 403


def test_reminders_endpoint_groups_by_date_and_respects_audience(client, college_and_admin, student_token, faculty_token):
    admin_token, _ = college_and_admin
    publish(client, admin_token, title="Soon", audience="student", deadline=_iso(timedelta(days=3)), category="deadline")
    publish(client, admin_token, title="Far", audience="both", event_date=_iso(timedelta(days=30)), category="event")
    publish(client, admin_token, title="No date", audience="both")

    student = client.get("/api/reminders", headers=_auth(student_token)).json()
    assert [n["title"] for n in student["this_week"]] == ["Soon"]
    assert [n["title"] for n in student["upcoming"]] == ["Far"]
    faculty = client.get("/api/reminders", headers=_auth(faculty_token)).json()
    assert [n["title"] for n in faculty["this_week"]] == []
    assert [n["title"] for n in faculty["upcoming"]] == ["Far"]


def test_reminders_api_create_and_cancel(client, college_and_admin):
    admin_token, _ = college_and_admin
    body = {
        "title": "Exam Registration",
        "body": "Register now.",
        "category": "deadline",
        "audience": "student",
        "deadline": _iso(timedelta(days=9)),
        "reminder_offsets": [7, 1],
    }
    created = client.post("/api/reminders", headers=_auth(admin_token), json=body)
    assert created.status_code == 200, created.text
    assert created.json()["reminder_offsets"] == [7, 1]
    nid = created.json()["id"]
    assert client.delete(f"/api/reminders/{nid}", headers=_auth(admin_token)).json() == {"cancelled": 2}
    assert client.delete(f"/api/reminders/{nid}", headers=_auth(admin_token)).json() == {"cancelled": 0}
    missing = dict(body, deadline=None)
    assert client.post("/api/reminders", headers=_auth(admin_token), json=missing).status_code == 400


def test_admin_summary(client, college_and_admin):
    admin_token, _ = college_and_admin
    publish(client, admin_token, category="circular")
    publish(client, admin_token, category="holiday", event_date=_iso(timedelta(days=4)))
    publish(client, admin_token, category="deadline", deadline=_iso(timedelta(days=4)), reminder_offsets="1,0")
    s = client.get("/api/notifications/summary", headers=_auth(admin_token)).json()
    assert s["total"] == 3 and s["active_circulars"] == 1 and s["scheduled_reminders"] == 2
    assert len(s["upcoming_holidays"]) == 1 and len(s["upcoming_deadlines"]) == 1


# ---------- attachments ----------

def _png(text_lines=("Exam registration closes 12 October 2026",)):
    from PIL import ImageDraw, ImageFont

    img = Image.new("RGB", (1200, 90 * len(text_lines) + 80), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 44)
    except OSError:
        font = ImageFont.load_default(size=44)
    for i, line in enumerate(text_lines):
        draw.text((50, 40 + i * 90), line, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def publish_with_file(client, token, filename, content, **overrides):
    data = {"title": "Circular", "body": "See attached.", "category": "circular", "audience": "student"}
    data.update(overrides)
    return client.post(
        "/api/notifications", headers=_auth(token), data=data, files={"file": (filename, content, "application/octet-stream")}
    )


def test_attachment_is_ingested_and_linked_not_duplicated(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    resp = publish_with_file(client, admin_token, "../../evil name?.png", _png())
    assert resp.status_code == 200, resp.text
    attachment = resp.json()["attachment"]
    assert attachment["is_image"] and attachment["file_type"] == "image"
    assert "/" not in attachment["filename"] and "?" not in attachment["filename"]
    docs = client.get("/api/documents", headers=_auth(admin_token)).json()
    assert [d["id"] for d in docs] == [attachment["document_id"]]  # the Document is the attachment
    assert docs[0]["status"] == "ready" and docs[0]["document_type"] == "circular"
    assert "12 October 2026" in " ".join(e["text"] for e in docs[0]["detected_events"])
    # The wire format never carries paths or storage URLs.
    dumped = str(resp.json()) + str(docs)
    assert "uploads" not in dumped and "storage_url" not in dumped and "file_path" not in dumped


def test_webp_and_docx_and_pdf_attachments(client, college_and_admin, seed_pdf_path):
    import os

    admin_token, _ = college_and_admin
    buf = io.BytesIO()
    Image.open(io.BytesIO(_png(("Library closed on Sunday",)))).save(buf, "WEBP")
    assert publish_with_file(client, admin_token, "notice.webp", buf.getvalue()).status_code == 200
    for name in ("hostel_rules.docx", "placement_notice.pdf"):
        with open(os.path.join(seed_pdf_path, name), "rb") as f:
            resp = publish_with_file(client, admin_token, name, f.read())
        assert resp.status_code == 200, resp.text
        assert resp.json()["attachment"]["filename"] == name


def test_unsupported_and_legacy_and_oversized_attachments_rejected(client, college_and_admin, monkeypatch):
    admin_token, _ = college_and_admin
    bad = publish_with_file(client, admin_token, "run.exe", b"MZ\x90\x00")
    assert bad.status_code == 400 and "Unsupported file type" in bad.json()["detail"]
    legacy = publish_with_file(client, admin_token, "old.doc", b"\xd0\xcf\x11\xe0")
    assert legacy.status_code == 400 and "Save it as .docx" in legacy.json()["detail"]
    disguised = publish_with_file(client, admin_token, "fake.pdf", b"not really a pdf")
    assert disguised.status_code == 400
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    big = publish_with_file(client, admin_token, "big.png", _png())
    assert big.status_code == 400 and "exceeds" in big.json()["detail"]
    # None of the rejected uploads created a notification or document.
    assert client.get("/api/notifications", headers=_auth(admin_token)).json() == []
    assert client.get("/api/documents", headers=_auth(admin_token)).json() == []


def test_invalid_form_does_not_store_the_file(client, college_and_admin):
    admin_token, _ = college_and_admin
    resp = publish_with_file(client, admin_token, "notice.png", _png(), audience="")
    assert resp.status_code == 400
    assert client.get("/api/documents", headers=_auth(admin_token)).json() == []


def test_attachment_access_is_authorized(client, college_and_admin, student_token, faculty_token, other_college):
    admin_token, _ = college_and_admin
    other_admin, other_student = other_college
    png = _png()
    doc_id = publish_with_file(client, admin_token, "circular.png", png, audience="student").json()["attachment"]["document_id"]
    url = f"/api/documents/{doc_id}/file"

    ok = client.get(url, headers=_auth(student_token))
    assert ok.status_code == 200 and ok.content == png and ok.headers["content-type"] == "image/png"
    assert "attachment" in ok.headers["content-disposition"]
    assert "inline" in client.get(url + "?inline=true", headers=_auth(student_token)).headers["content-disposition"]
    assert client.get(url, headers=_auth(admin_token)).status_code == 200
    # Wrong audience, wrong college, no login.
    assert client.get(url, headers=_auth(faculty_token)).status_code == 404
    assert client.get(url, headers=_auth(other_student)).status_code == 404
    assert client.get(url, headers=_auth(other_admin)).status_code == 404
    assert client.get(url).status_code == 401


def test_unpublished_attachment_is_not_downloadable(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    created = publish_with_file(client, admin_token, "circular.png", _png(), audience="student").json()
    doc_id = created["attachment"]["document_id"]
    client.delete(f"/api/notifications/{created['id']}", headers=_auth(admin_token))
    assert client.get(f"/api/documents/{doc_id}/file", headers=_auth(student_token)).status_code == 404


def test_deleting_a_document_keeps_the_notification(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    created = publish_with_file(client, admin_token, "circular.png", _png()).json()
    assert client.delete(f"/api/documents/{created['attachment']['document_id']}", headers=_auth(admin_token)).status_code == 200
    after = client.get(f"/api/notifications/{created['id']}", headers=_auth(student_token)).json()
    assert after["attachment"] is None


def test_publish_existing_document_without_uploading_again(client, college_and_admin):
    admin_token, _ = college_and_admin
    doc = client.post(
        "/api/documents/upload",
        headers=_auth(admin_token),
        files={"file": ("calendar.png", _png(), "image/png")},
        data={"title": "Calendar", "document_type": "academic_calendar"},
    ).json()
    resp = publish(client, admin_token, document_id=str(doc["id"]), category="academic")
    assert resp.status_code == 200 and resp.json()["attachment"]["document_id"] == doc["id"]
    assert len(client.get("/api/documents", headers=_auth(admin_token)).json()) == 1


def test_document_from_another_college_cannot_be_attached(client, college_and_admin, other_college):
    admin_token, _ = college_and_admin
    other_admin, _ = other_college
    doc = client.post(
        "/api/documents/upload",
        headers=_auth(other_admin),
        files={"file": ("calendar.png", _png(), "image/png")},
        data={"title": "Theirs", "document_type": "general_notice"},
    ).json()
    assert publish(client, admin_token, document_id=str(doc["id"])).status_code == 400


# ---------- Cloudinary storage ----------

class _FakeResponse:
    def __init__(self, content, status_code=200):
        self.content, self.status_code = content, status_code


def test_cloudinary_attachment_storage_and_authenticated_access(client, college_and_admin, student_token, monkeypatch):
    admin_token, _ = college_and_admin
    for name in ("cloudinary_cloud_name", "cloudinary_api_key", "cloudinary_api_secret"):
        monkeypatch.setattr(settings, name, "test-value")
    uploads, store = [], {}

    def fake_upload(data, **kwargs):
        uploads.append(kwargs)
        store[kwargs["public_id"]] = data.read()
        return {"public_id": f"{kwargs['folder']}/{kwargs['public_id']}", "secure_url": "https://res.cloudinary.test/x"}

    def fake_get(url, **kwargs):
        assert "authenticated" in url and "s--" in url, "download URL must be signed"
        key = next(k for k in store if k in url)
        return _FakeResponse(store[key])

    monkeypatch.setattr("cloudinary.uploader.upload", fake_upload)
    monkeypatch.setattr(storage_service.httpx, "get", fake_get)

    png = _png()
    resp = publish_with_file(client, admin_token, "circular.png", png, audience="student")
    assert resp.status_code == 200, resp.text
    assert uploads[0]["type"] == "authenticated" and uploads[0]["resource_type"] == "raw"

    doc_id = resp.json()["attachment"]["document_id"]
    gen, db = _db()
    try:
        doc = db.get(models.Document, doc_id)
        assert doc.storage_provider == "cloudinary" and doc.storage_key.startswith("campusmind-ai/documents/")
        assert doc.storage_url.startswith("https://") and doc.mime_type == "image/png" and doc.file_size == len(png)
        assert doc.status == models.DocumentStatus.READY
        assert doc.file_path.startswith("cloudinary:")  # the temp path is gone
    finally:
        gen.close()
    import os

    assert not [f for f in os.listdir(settings.upload_dir) if f.startswith("tmp-")]
    served = client.get(f"/api/documents/{doc_id}/file", headers=_auth(student_token))
    assert served.status_code == 200 and served.content == png


def test_production_refuses_uploads_without_cloudinary(client, college_and_admin, monkeypatch):
    admin_token, _ = college_and_admin
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "cloudinary_cloud_name", "")
    resp = publish_with_file(client, admin_token, "circular.png", _png())
    assert resp.status_code == 503 and "storage isn't configured" in resp.json()["detail"]
    assert client.get("/api/documents", headers=_auth(admin_token)).json() == []


def test_legacy_document_without_storage_fields_is_still_served(client, college_and_admin, student_token):
    """Documents uploaded before the storage columns existed only have file_path."""
    admin_token, _ = college_and_admin
    created = publish_with_file(client, admin_token, "circular.png", _png(), audience="student").json()
    doc_id = created["attachment"]["document_id"]
    gen, db = _db()
    try:
        doc = db.get(models.Document, doc_id)
        doc.storage_provider = doc.storage_key = doc.storage_url = doc.mime_type = doc.file_size = None
        db.commit()
    finally:
        gen.close()
    assert client.get(f"/api/documents/{doc_id}/file", headers=_auth(student_token)).status_code == 200


# ---------- event detection ----------

def test_detected_events_are_suggestions_only(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    text = (
        "Last date for registration: October 12, 2026\n"
        "College will remain closed on 21 October 2026 on account of Deepavali.\n"
        "End semester examination starts 03/11/2026\n"
    ).encode()
    doc = client.post(
        "/api/documents/upload",
        headers=_auth(admin_token),
        files={"file": ("calendar.txt", text, "text/plain")},
        data={"title": "Calendar", "document_type": "academic_calendar"},
    ).json()
    found = {(e["kind"], e["date"]) for e in doc["detected_events"]}
    assert ("deadline", "2026-10-12") in found
    assert ("holiday", "2026-10-21") in found
    assert ("examination", "2026-11-03") in found
    # Detection never publishes anything.
    assert client.get("/api/notifications", headers=_auth(admin_token)).json() == []
    assert client.get("/api/notifications", headers=_auth(student_token)).json() == []
