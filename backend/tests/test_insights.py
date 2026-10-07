"""Unanswered questions, answer feedback, analytics and multilingual answers.
Everything is college-scoped and carries no student identity."""
import asyncio

from app.db import models
from app.db.database import get_db
from app.main import app
from app.rag import pipeline


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _db():
    gen = app.dependency_overrides[get_db]()
    return gen, next(gen)


def _ask(client, token, message, **extra):
    resp = client.post("/api/chat/message", headers=_auth(token), json={"message": message, **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _other_college_admin(client):
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
    return resp.json()["access_token"]


# ---------- unanswered questions ----------

def test_unanswered_questions_are_grouped_and_ranked(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    for text in ("What is the hostel application deadline?", "what is the hostel application deadline? ", "Where is the canteen"):
        _ask(client, student_token, text)
    rows = client.get("/api/admin/unanswered", headers=_auth(admin_token)).json()
    assert rows[0]["query"] == "what is the hostel application deadline?"
    assert rows[0]["frequency"] == 2
    assert rows[0]["status"] == "open" and rows[0]["reason"] == "no_sources"
    assert rows[0]["source_count"] == 0
    assert {r["query"] for r in rows} == {"what is the hostel application deadline?", "where is the canteen"}


def test_unanswered_questions_expose_no_user_identity(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    _ask(client, student_token, "Where is the canteen")
    row = client.get("/api/admin/unanswered", headers=_auth(admin_token)).json()[0]
    assert set(row) == {
        "query", "frequency", "last_asked", "avg_confidence", "source_count", "reason", "status", "linked_document",
    }


def test_unanswered_questions_are_college_isolated_and_admin_only(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    _ask(client, student_token, "Where is the canteen")
    other_admin = _other_college_admin(client)
    assert client.get("/api/admin/unanswered", headers=_auth(other_admin)).json() == []
    assert client.get("/api/admin/unanswered", headers=_auth(student_token)).status_code == 403
    assert client.get("/api/admin/unanswered").status_code in (401, 403)
    # The other college's admin cannot resolve this college's question either.
    resp = client.post("/api/admin/unanswered/resolve", headers=_auth(other_admin), json={"query": "where is the canteen"})
    assert resp.status_code == 404
    assert len(client.get("/api/admin/unanswered", headers=_auth(admin_token)).json()) == 1


def test_resolving_hides_the_question_until_it_is_asked_again(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    _ask(client, student_token, "Where is the canteen")
    resp = client.post(
        "/api/admin/unanswered/resolve", headers=_auth(admin_token), json={"query": "Where is the canteen"}
    )
    assert resp.json() == {"status": "resolved", "resolved": 1}
    assert client.get("/api/admin/unanswered", headers=_auth(admin_token)).json() == []
    resolved = client.get("/api/admin/unanswered?status=resolved", headers=_auth(admin_token)).json()
    assert resolved[0]["status"] == "resolved"
    _ask(client, student_token, "Where is the canteen")  # still failing -> reopens
    assert client.get("/api/admin/unanswered", headers=_auth(admin_token)).json()[0]["frequency"] == 2


def test_resolve_rejects_another_colleges_document(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    _ask(client, student_token, "Where is the canteen")
    gen, db = _db()
    try:
        other = models.College(name="Z", official_domain="z.edu")
        db.add(other)
        db.flush()
        doc = models.Document(
            college_id=other.id, title="Foreign", document_type="general_notice", file_path="x", original_filename="x.pdf"
        )
        db.add(doc)
        db.commit()
        doc_id = doc.id
    finally:
        gen.close()
    resp = client.post(
        "/api/admin/unanswered/resolve",
        headers=_auth(admin_token),
        json={"query": "where is the canteen", "document_id": doc_id},
    )
    assert resp.status_code == 404


def test_admin_test_questions_are_not_logged_as_unanswered(client, college_and_admin):
    admin_token, _ = college_and_admin
    _ask(client, admin_token, "Where is the canteen")
    assert client.get("/api/admin/unanswered", headers=_auth(admin_token)).json() == []


# ---------- feedback ----------

def test_feedback_reason_is_stored_and_aggregated(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    first = _ask(client, student_token, "Where is the canteen")
    second = _ask(client, student_token, "Where is the library")
    client.post(f"/api/chat/messages/{first['message_id']}/feedback", headers=_auth(student_token), json={"feedback": "up"})
    r = client.post(
        f"/api/chat/messages/{second['message_id']}/feedback",
        headers=_auth(student_token),
        json={"feedback": "down", "reason": "outdated", "note": "old timings"},
    )
    assert r.status_code == 200
    summary = client.get("/api/admin/feedback", headers=_auth(admin_token)).json()
    assert summary["helpful"] == 1 and summary["not_helpful"] == 1
    assert summary["helpful_ratio"] == 0.5
    assert summary["reasons"] == {"outdated": 1}
    assert summary["recent_not_helpful"][0]["note"] == "old timings"
    assert "user_id" not in summary["recent_not_helpful"][0]


def test_feedback_validation_and_reason_cleared_on_thumbs_up(client, college_and_admin, student_token):
    msg = _ask(client, student_token, "Where is the canteen")["message_id"]
    url = f"/api/chat/messages/{msg}/feedback"
    assert client.post(url, headers=_auth(student_token), json={"feedback": "meh"}).status_code == 422
    assert client.post(url, headers=_auth(student_token), json={"feedback": "down", "reason": "bogus"}).status_code == 422
    client.post(url, headers=_auth(student_token), json={"feedback": "down", "reason": "incorrect"})
    client.post(url, headers=_auth(student_token), json={"feedback": "up", "reason": "incorrect"})
    gen, db = _db()
    try:
        assert db.get(models.ChatMessage, msg).feedback_reason is None
    finally:
        gen.close()


def test_feedback_is_college_scoped(client, college_and_admin, student_token):
    msg = _ask(client, student_token, "Where is the canteen")["message_id"]
    client.post(f"/api/chat/messages/{msg}/feedback", headers=_auth(student_token), json={"feedback": "down"})
    other_admin = _other_college_admin(client)
    summary = client.get("/api/admin/feedback", headers=_auth(other_admin)).json()
    assert summary["helpful"] == 0 and summary["not_helpful"] == 0 and summary["helpful_ratio"] is None
    # Another user cannot rate a message that is not theirs.
    assert client.post(
        f"/api/chat/messages/{msg}/feedback", headers=_auth(other_admin), json={"feedback": "up"}
    ).status_code == 404


# ---------- analytics ----------

def test_analytics_has_college_scoped_metrics(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    msg = _ask(client, student_token, "Where is the canteen")["message_id"]
    client.post(f"/api/chat/messages/{msg}/feedback", headers=_auth(student_token), json={"feedback": "up"})
    data = client.get("/api/admin/analytics", headers=_auth(admin_token)).json()
    assert data["unanswered_questions"] == 1
    assert data["answered_questions"] == 0
    assert data["active_users_30d"] == 1
    assert data["feedback_helpful"] == 1 and data["feedback_helpful_ratio"] == 1.0
    for key in ("documents_total", "documents_ready", "notifications_published", "reminders_pending"):
        assert data[key] == 0
    other = client.get("/api/admin/analytics", headers=_auth(_other_college_admin(client))).json()
    assert other["unanswered_questions"] == 0 and other["active_users_30d"] == 0
    assert other["feedback_helpful_ratio"] is None
    assert client.get("/api/admin/analytics", headers=_auth(student_token)).status_code == 403


# ---------- multilingual ----------

def test_abstain_message_follows_the_selected_language(client, college_and_admin, student_token):
    english = _ask(client, student_token, "Where is the canteen")["answer"]
    tamil = _ask(client, student_token, "Where is the canteen", language="ta")["answer"]
    hindi = _ask(client, student_token, "Where is the canteen", language="hi")["answer"]
    fallback = _ask(client, student_token, "Where is the canteen", language="xx")["answer"]
    assert english == pipeline.NO_SOURCES_MESSAGE["en"] == fallback
    assert tamil == pipeline.NO_SOURCES_MESSAGE["ta"] and tamil != english
    assert hindi == pipeline.NO_SOURCES_MESSAGE["hi"]


def test_tamil_question_is_normalised_for_retrieval_only():
    class FakeAI:
        async def generate(self, system, user):
            assert "Translate" in system
            return "What is the minimum attendance requirement?"

    tamil = "குறைந்தபட்ச வருகை தேவை என்ன?"
    assert pipeline._needs_translation(tamil)
    assert not pipeline._needs_translation("What is the minimum attendance requirement?")
    assert asyncio.run(pipeline._retrieval_query(FakeAI(), tamil)) == "What is the minimum attendance requirement?"
    # English is never sent for translation.
    assert asyncio.run(pipeline._retrieval_query(FakeAI(), "attendance rule")) == "attendance rule"


def test_translation_failure_or_chatty_output_falls_back_to_original():
    tamil = "வருகை விதி"

    class Broken:
        async def generate(self, system, user):
            raise RuntimeError("provider down")

    class Chatty:
        async def generate(self, system, user):
            return "Sure!\nHere is the translation:\nattendance rule"

    assert asyncio.run(pipeline._retrieval_query(Broken(), tamil)) == tamil
    assert asyncio.run(pipeline._retrieval_query(Chatty(), tamil)) == tamil


def test_every_supported_language_has_all_messages():
    for table in (pipeline.NO_SOURCES_MESSAGE, pipeline.LOW_CONFIDENCE_MESSAGE, pipeline.CAUTION_NOTE):
        assert set(table) == set(pipeline.LANGUAGE_NAMES)


# ---------- scheduler command ----------

def test_scheduler_script_runs_a_pass_and_reports_failure(monkeypatch, capsys):
    import importlib.util
    import os

    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "process_reminders.py")
    spec = importlib.util.spec_from_file_location("process_reminders_script", path)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)

    monkeypatch.setattr(script, "run", lambda: {"sent": 2, "pushed": 1})
    assert script.main() == 0
    assert "process_reminders ok" in capsys.readouterr().out

    def boom():
        raise RuntimeError("secret-looking detail postgres://user:pw@host")

    monkeypatch.setattr(script, "run", boom)
    assert script.main() == 1
    err = capsys.readouterr().err
    assert "RuntimeError" in err and "postgres://" not in err
