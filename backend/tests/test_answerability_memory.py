"""Reliable answers and conversation memory: unanswerable questions get a short
fallback with no sources, follow-ups are resolved from the conversation, and
the user's own earlier conversations help without ever acting as document
evidence or leaking between users."""
import pytest

from app.rag.pipeline import FALLBACK_MESSAGE, STANDALONE_PROMPT
from app.services import ai_provider

TRANSPORT = (
    "Bus routes\n"
    "Route 5 starts at Chromepet, departs 7:00 AM and arrives at campus 8:05 AM.\n"
    "Route 12 starts at Tambaram, departs 7:10 AM and arrives at campus 8:15 AM.\n"
    "Route 18 starts at Velachery, departs 6:55 AM and arrives at campus 8:10 AM.\n"
    "The annual transport fee is Rs. 18,000 and is payable before the odd semester."
)
EXAMS = "Semester examinations begin on 18 November 2026. The last date to pay the exam fee is 5 November 2026."
FALLBACK = FALLBACK_MESSAGE["en"]


class ScriptedAI(ai_provider.AIProvider):
    """A stand-in model: rewrites follow-ups through `rewrite` and otherwise
    answers with `reply`, recording every answering prompt."""

    def __init__(self, reply="OK [Source 1]", rewrite=None):
        self.reply = reply
        self.rewrite = rewrite
        self.calls = []

    async def generate(self, system_prompt, user_prompt):
        if system_prompt == STANDALONE_PROMPT:
            return self.rewrite
        self.calls.append((system_prompt, user_prompt))
        return self.reply

    async def stream(self, system_prompt, user_prompt):
        yield self.reply


@pytest.fixture
def ai(monkeypatch):
    fake = ScriptedAI()
    monkeypatch.setattr("app.api.chat.get_ai_provider", lambda: fake)
    return fake


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _upload(client, token, title, text):
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(token),
        files={"file": (f"{title}.txt", text.encode(), "text/plain")},
        data={"title": title, "document_type": "general_notice", "is_official": "true"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _ask(client, token, message, session_id=None):
    resp = client.post(
        "/api/chat/message",
        headers=_auth(token),
        json={"message": message, "session_id": session_id, "language": "en"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
def library(client, college_and_admin):
    admin_token, _ = college_and_admin
    return {
        "transport": _upload(client, admin_token, "Transport Schedule", TRANSPORT),
        "exams": _upload(client, admin_token, "Exam Schedule", EXAMS),
    }


@pytest.fixture
def other_student_token(client, college_and_admin):
    _, domain = college_and_admin
    resp = client.post(
        "/api/auth/register-student",
        json={
            "email": f"someone.else@{domain}",
            "full_name": "Someone Else",
            "password": "pass1234",
            "department": "CSE",
            "year": 2,
            "semester": 3,
            "section": "B",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _assert_fallback(body):
    assert body["answer"] == FALLBACK
    assert body["citations"] == []
    assert body["answer_status"] == "insufficient_evidence"
    assert body["basis"] is None
    assert body["abstained"] is True
    assert body["confidence"] == 0
    assert body["has_conflict"] is False


def test_a_unsupported_question_gets_short_fallback_and_no_sources(client, student_token, library, ai):
    body = _ask(client, student_token, "Who won the football world cup in 2018?")
    _assert_fallback(body)
    assert ai.calls == []  # nothing to answer from, so the model is never asked


def test_a_model_refusal_is_replaced_by_the_fallback_and_drops_sources(client, student_token, library, ai):
    # Retrieval finds the transport document, but the model says it can't answer.
    for refusal in (
        "INSUFFICIENT_EVIDENCE",
        "The provided documents do not contain information about the bus pass price.",
    ):
        ai.reply = refusal
        body = _ask(client, student_token, "How many bus routes are available?")
        _assert_fallback(body)
        assert ai.calls  # it was asked, then refused


def test_b_irrelevant_candidates_are_rejected(client, student_token, library, ai):
    body = _ask(client, student_token, "What is the hostel curfew time?")
    _assert_fallback(body)
    assert ai.calls == []


def test_c_supported_question_answers_with_only_the_transport_source(client, student_token, library, ai):
    ai.reply = "There are 3 bus routes available. [Source 1]"
    body = _ask(client, student_token, "How many bus routes are available?")
    assert body["answer_status"] == "answered"
    assert body["basis"] == "documents"
    assert body["abstained"] is False
    assert "3 bus routes" in body["answer"]
    assert "[Source" not in body["answer"]
    assert {c["document_id"] for c in body["citations"]} == {library["transport"]["id"]}


def test_d_follow_up_in_same_conversation_is_resolved(client, student_token, library, ai):
    ai.reply = "There are 3 bus routes available. [Source 1]"
    first = _ask(client, student_token, "How many bus routes are available?")

    ai.rewrite = "Which places do the bus routes start from?"
    ai.reply = "They start from Chromepet, Tambaram and Velachery. [Source 1]"
    body = _ask(client, student_token, "From which places?", first["session_id"])

    assert body["session_id"] == first["session_id"]
    assert body["answer_status"] == "answered"
    assert {c["document_id"] for c in body["citations"]} == {library["transport"]["id"]}
    prompt = ai.calls[-1][1]
    assert "Current conversation" in prompt
    assert "How many bus routes are available?" in prompt
    assert "Understood as: Which places do the bus routes start from?" in prompt


def test_d_follow_up_without_a_model_rewrite_uses_the_previous_question(client, student_token, library):
    # The offline provider cannot rewrite: the previous question is reused.
    first = _ask(client, student_token, "How many bus routes are available?")
    body = _ask(client, student_token, "From which places?", first["session_id"])
    assert body["answer_status"] == "answered"
    assert {c["document_id"] for c in body["citations"]} == {library["transport"]["id"]}


def test_a_follow_up_is_not_confused_with_a_new_unsupported_question(client, student_token, library, ai):
    ai.reply = "There are 3 bus routes available. [Source 1]"
    first = _ask(client, student_token, "How many bus routes are available?")
    ai.rewrite = "Who won the football world cup in 2018?"
    ai.reply = "INSUFFICIENT_EVIDENCE"  # what a compliant model says with nothing to go on
    body = _ask(client, student_token, "Who won the football world cup in 2018?", first["session_id"])
    _assert_fallback(body)


def test_e_context_from_a_previous_conversation_is_used(client, student_token, library, ai):
    ai.reply = "Noted."
    _ask(client, student_token, "My roommate is called Arjun.")
    ai.reply = "Your roommate is called Arjun."
    body = _ask(client, student_token, "What is my roommate called?")  # a new conversation

    assert body["answer_status"] == "answered"
    assert body["basis"] == "conversation"
    assert "Arjun" in body["answer"]
    # History is never presented as a document source.
    assert body["citations"] == []
    assert "Earlier conversations" in ai.calls[-1][1]


def test_f_unrelated_history_does_not_contaminate(client, student_token, library, ai):
    ai.reply = "Noted."
    _ask(client, student_token, "My roommate is called Arjun.")

    # Unsupported question: nothing relevant in the documents or the history.
    ai.calls.clear()
    _assert_fallback(_ask(client, student_token, "Who won the football world cup in 2018?"))
    assert ai.calls == []

    # Supported question: the unrelated history stays out of the prompt.
    ai.reply = "There are 3 bus routes available. [Source 1]"
    body = _ask(client, student_token, "How many bus routes are available?")
    assert body["answer_status"] == "answered"
    assert "Arjun" not in ai.calls[-1][1]
    assert "Earlier conversations" not in ai.calls[-1][1]


def test_g_a_later_correction_is_not_overridden(client, student_token, library, ai):
    ai.reply = "Noted."
    _ask(client, student_token, "My roommate is called Arjun.")
    _ask(client, student_token, "Correction: my roommate is called Vikram.")

    ai.reply = "Your roommate is called Vikram."
    body = _ask(client, student_token, "What is my roommate called?")
    assert "Vikram" in body["answer"] and "Arjun" not in body["answer"]

    prompt = ai.calls[-1][1]
    assert prompt.index("Arjun") < prompt.index("Vikram")  # oldest first, correction last
    vikram_line = next(line for line in prompt.splitlines() if "Vikram" in line)
    assert "(most recent)" in vikram_line
    assert "latest statement wins" in prompt


def test_h_another_users_history_is_never_used_or_reachable(
    client, student_token, other_student_token, library, ai
):
    ai.reply = "Noted."
    mine = _ask(client, student_token, "My roommate is called Arjun.")
    ai.calls.clear()

    body = _ask(client, other_student_token, "What is my roommate called?")
    _assert_fallback(body)
    assert ai.calls == []

    # Nor can they continue, read or export my conversation.
    resp = client.post(
        "/api/chat/message",
        headers=_auth(other_student_token),
        json={"message": "What is my roommate called?", "session_id": mine["session_id"], "language": "en"},
    )
    assert resp.status_code == 404
    assert client.get(f"/api/chat/sessions/{mine['session_id']}/messages", headers=_auth(other_student_token)).status_code == 404


def test_i_sources_do_not_leak_into_a_new_unanswered_message(client, student_token, library, ai):
    ai.reply = "There are 3 bus routes available. [Source 1]"
    first = _ask(client, student_token, "How many bus routes are available?")
    assert first["citations"]

    ai.reply = "INSUFFICIENT_EVIDENCE"
    second = _ask(client, student_token, "Who won the football world cup in 2018?", first["session_id"])
    _assert_fallback(second)

    msgs = client.get(f"/api/chat/sessions/{first['session_id']}/messages", headers=_auth(student_token)).json()
    answers = [m for m in msgs if m["role"] == "assistant"]
    assert answers[0]["answer_status"] == "answered" and answers[0]["citations"]
    assert answers[1]["answer_status"] == "insufficient_evidence"
    assert answers[1]["citations"] == []
    assert answers[1]["content"] == FALLBACK


def test_unanswered_question_is_logged_as_unanswered(client, student_token, library, ai):
    from app.db import models
    from tests.test_document_scope import TestingSessionLocal

    _ask(client, student_token, "Who won the football world cup in 2018?")
    db = TestingSessionLocal()
    try:
        log = db.query(models.SearchLog).order_by(models.SearchLog.id.desc()).first()
        assert log.was_answered is False
        assert log.result_count == 0
    finally:
        db.close()
