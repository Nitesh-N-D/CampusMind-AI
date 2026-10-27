"""Automatic document selection: the right document(s) are found from the
question alone, and the answer and the source list use the same evidence."""
import os

import pytest

from app.services import ai_provider

TRANSPORT = (
    "Bus routes\n"
    "Route 5 starts at Chromepet, departs 7:00 AM and arrives at campus 8:05 AM.\n"
    "Route 12 starts at Tambaram, departs 7:10 AM and arrives at campus 8:15 AM.\n"
    "Route 18 starts at Velachery, departs 6:55 AM and arrives at campus 8:10 AM.\n"
    "The annual transport fee is Rs. 18,000 and is payable before the odd semester."
)
SYLLABUS_83 = (
    "B.E. CSE Syllabus - Semester 5. Unit 1: Operating Systems covers process scheduling, "
    "deadlocks and memory management. Unit 2: Computer Networks covers the TCP/IP model, routing "
    "and congestion control. Students may choose from many elective courses; laboratory sessions "
    "are available every week. Unit 3: Database Management Systems covers normalization and transactions."
)
SYLLABUS_235 = (
    "B.E. CSE Syllabus - Semester 7. Unit 1: Machine Learning covers regression, classification "
    "and clustering. Unit 2: Cloud Computing covers virtualization and containers. Many project "
    "topics are available in the final year. Unit 3: Cryptography covers symmetric ciphers and hashing."
)
EXAMS = "Semester examinations begin on 18 November 2026. The last date to pay the exam fee is 5 November 2026."


class RecordingAI(ai_provider.AIProvider):
    """Stands in for the model: answers with a fixed reply that cites Source 1
    and records the prompts it was given."""

    def __init__(self, reply="OK [Source 1]"):
        self.reply = reply
        self.calls = []

    async def generate(self, system_prompt, user_prompt):
        self.calls.append((system_prompt, user_prompt))
        return self.reply

    async def stream(self, system_prompt, user_prompt):
        yield self.reply


@pytest.fixture
def ai(monkeypatch):
    fake = RecordingAI()
    monkeypatch.setattr("app.api.chat.get_ai_provider", lambda: fake)
    return fake


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _upload(client, token, title, text, **fields):
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(token),
        files={"file": (f"{title}.txt", text.encode(), "text/plain")},
        data={"title": title, "document_type": "general_notice", "is_official": "true", **fields},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _ask(client, token, message):
    resp = client.post(
        "/api/chat/message", headers=_auth(token), json={"message": message, "session_id": None, "language": "en"}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
def library(client, college_and_admin):
    admin_token, _ = college_and_admin
    return {
        "transport": _upload(client, admin_token, "Transport Schedule", TRANSPORT),
        "syl83": _upload(client, admin_token, "B.E. CSE Syllabus p83", SYLLABUS_83),
        "syl235": _upload(client, admin_token, "B.E. CSE Syllabus p235", SYLLABUS_235),
        "exams": _upload(client, admin_token, "Exam Schedule", EXAMS),
    }


def _doc_ids(body):
    return {c["document_id"] for c in body["citations"]}


def test_a_count_question_uses_transport_only_and_asks_for_a_count(client, student_token, library, ai):
    body = _ask(client, student_token, "How many bus routes are available?")
    assert _doc_ids(body) == {library["transport"]["id"]}
    system_prompt, user_prompt = ai.calls[-1]
    assert "Query type: count" in user_prompt
    assert "only the number" in user_prompt.lower()
    # Nothing from the syllabi reaches the model.
    assert "Syllabus" not in user_prompt


def test_b_route_list_question_is_a_list_from_transport_only(client, student_token, library, ai):
    body = _ask(client, student_token, "What are the available bus routes?")
    assert _doc_ids(body) == {library["transport"]["id"]}
    assert "Query type: list" in ai.calls[-1][1]


def test_c_syllabus_question_cites_only_syllabus_documents(client, student_token, library, ai):
    body = _ask(client, student_token, "What topics are covered in the B.E. CSE syllabus?")
    ids = _doc_ids(body)
    assert ids and ids <= {library["syl83"]["id"], library["syl235"]["id"]}


def test_d_unrelated_documents_never_reach_context_or_sources(client, student_token, library, ai):
    body = _ask(client, student_token, "How many bus routes are available?")
    assert _doc_ids(body).isdisjoint({library["syl83"]["id"], library["syl235"]["id"]})
    assert "Operating Systems" not in ai.calls[-1][1]
    assert "Machine Learning" not in ai.calls[-1][1]


def test_e_unsupported_question_is_not_answered(client, student_token, library, ai):
    body = _ask(client, student_token, "What is the swimming pool timing?")
    assert body["abstained"] is True
    assert body["citations"] == []
    assert not ai.calls


def test_f_multi_document_question_cites_both_contributors(client, student_token, library, ai):
    ai.reply = "Exams start 18 November 2026 [Source 1]; the transport fee is Rs. 18,000 [Source 2]."
    body = _ask(client, student_token, "When do semester examinations begin and what is the annual transport fee?")
    assert _doc_ids(body) == {library["exams"]["id"], library["transport"]["id"]}


def test_h_sources_are_the_ones_the_answer_cites(client, student_token, library, ai):
    ai.reply = "There are 3 bus routes available. [Source 1]"
    body = _ask(client, student_token, "How many bus routes are available?")
    assert body["answer"] == "There are 3 bus routes available."  # markers are not shown in the body
    assert len(body["citations"]) == 1
    assert body["citations"][0]["document_title"] == "Transport Schedule"


def test_sources_do_not_leak_between_questions(client, student_token, library, ai):
    first = _ask(client, student_token, "How many bus routes are available?")
    second = _ask(client, student_token, "When do semester examinations begin?")
    assert _doc_ids(first) == {library["transport"]["id"]}
    assert _doc_ids(second) == {library["exams"]["id"]}


def test_transport_seed_workbook_alone(client, college_and_admin, student_token, seed_pdf_path, ai):
    admin_token, _ = college_and_admin
    path = os.path.join(seed_pdf_path, "transport_schedule.xlsx")
    with open(path, "rb") as f:
        resp = client.post(
            "/api/documents/upload",
            headers=_auth(admin_token),
            files={"file": ("transport_schedule.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            data={"title": "Transport Schedule", "document_type": "timetable", "is_official": "true"},
        )
    assert resp.status_code == 200, resp.text
    _upload(client, admin_token, "B.E. CSE Syllabus p83", SYLLABUS_83)
    body = _ask(client, student_token, "How many bus routes are available?")
    assert {c["document_title"] for c in body["citations"]} == {"Transport Schedule"}


def test_g_chat_ui_has_no_manual_document_selector():
    """Source-level guard (the frontend has no unit-test runner): the chat page
    offers no document dropdown and never sends a document id."""
    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    chat = open(os.path.join(here, "frontend", "src", "pages", "Chat.tsx"), encoding="utf-8").read()
    api = open(os.path.join(here, "frontend", "src", "lib", "api.ts"), encoding="utf-8").read()
    for text in ("Ask about", "All documents", "No document selected", "chat-document"):
        assert text not in chat
    assert "document_id" not in chat
    assert "/api/chat/documents" not in api
