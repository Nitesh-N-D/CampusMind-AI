"""Counts over spreadsheets are computed over every row of the document, not
by the model counting a capped set of retrieved chunks."""
import io

import pytest
from openpyxl import Workbook

from app.rag.aggregation import MAX_LISTED_ROWS, count_records
from tests.test_answerability_memory import ScriptedAI, _ask, _auth
from tests.test_document_scope import TestingSessionLocal
from app.db import models


def _sheet(rows, header=("Route No", "Starting Point", "Destination", "Departure Time", "Campus Arrival Time")):
    wb = Workbook()
    ws = wb.active
    ws.append(list(header))
    for row in rows:
        ws.append(list(row))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload_xlsx(client, token, title, data):
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(token),
        files={"file": (f"{title}.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"title": title, "document_type": "general_notice", "is_official": "true"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _routes(n):
    return [(f"R{i}", f"Stop {i}", "Guindy", "6:45 AM", "8:00 AM") for i in range(1, n + 1)]


@pytest.fixture
def ai(monkeypatch):
    fake = ScriptedAI(reply="There are routes. [Source 1]")
    monkeypatch.setattr("app.api.chat.get_ai_provider", lambda: fake)
    return fake


def _count(doc_id):
    db = TestingSessionLocal()
    try:
        return count_records(db, db.get(models.Document, doc_id))
    finally:
        db.close()


def test_every_row_is_counted_even_beyond_the_retrieval_cap(client, college_and_admin):
    admin, _ = college_and_admin
    doc = _upload_xlsx(client, admin, "Bus Schedule", _sheet(_routes(60)))
    counted = _count(doc["id"])
    assert counted.total == 60
    assert counted.listed
    assert counted.rows[0].startswith("Route No: R1;") and counted.rows[-1].startswith("Route No: R60;")


def test_values_with_periods_do_not_split_rows(client, college_and_admin):
    admin, _ = college_and_admin
    rows = [("R1", "T. Nagar", "Guindy", "6:45 AM", "8:00 AM"), ("R2", "Rs. 5 Stop", "Adyar", "7:00 AM", "8:10 AM")]
    counted = _count(_upload_xlsx(client, admin, "Bus Schedule", _sheet(rows))["id"])
    assert counted.total == 2
    assert "T. Nagar" in counted.rows[0]


def test_prose_is_not_treated_as_a_table(client, college_and_admin):
    admin, _ = college_and_admin
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(admin),
        files={"file": ("Notice.txt", b"Exams begin on 18 November. Fees are due on 5 November.", "text/plain")},
        data={"title": "Notice", "document_type": "general_notice", "is_official": "true"},
    )
    assert _count(resp.json()["id"]) is None


def test_the_exact_total_and_full_list_reach_the_model(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    _upload_xlsx(client, admin, "Bus Schedule", _sheet(_routes(40)))
    body = _ask(client, student_token, "How many bus routes are available?")
    prompt = ai.calls[-1][1]
    assert 'contains 40 records' in prompt
    assert "40. Route No: R40;" in prompt  # nothing past the 24-chunk cap is dropped
    assert body["answer_status"] == "answered"
    assert {c["document_title"] for c in body["citations"]} == {"Bus Schedule"}


def test_a_very_long_table_gives_the_total_but_flags_the_missing_list(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    n = MAX_LISTED_ROWS + 20
    _upload_xlsx(client, admin, "Bus Schedule", _sheet(_routes(n)))
    _ask(client, student_token, "How many bus routes are available?")
    prompt = ai.calls[-1][1]
    assert f"contains {n} records" in prompt
    assert "too long to show" in prompt
    assert "Complete record list" not in prompt


def test_non_count_questions_do_not_get_the_count_block(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    _upload_xlsx(client, admin, "Bus Schedule", _sheet(_routes(10)))
    _ask(client, student_token, "What is the destination of Route R3?")
    assert "Exact record count" not in ai.calls[-1][1]


def test_clarification_text_never_carries_source_markers(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    _upload_xlsx(client, admin, "Bus Schedule", _sheet(_routes(5)))
    ai.reply = "CLARIFY: Which route do you mean? [Source 1]"
    body = _ask(client, student_token, "What is the destination of the bus route?")
    assert body["answer"] == "Which route do you mean?"
    assert body["citations"] == []


# --- partial answers and multi-source calculations --------------------------------

def _text_doc(client, token, title, text):
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(token),
        files={"file": (f"{title}.txt", text.encode(), "text/plain")},
        data={"title": title, "document_type": "general_notice", "is_official": "true"},
    )
    assert resp.status_code == 200, resp.text


def test_partially_supported_message_keeps_the_supported_part(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    _text_doc(client, admin, "Exam Schedule", "Semester examinations begin on 18 November 2026.")
    ai.reply = "(1) Exams begin on 18 November 2026 [Source 1].\n(2) INSUFFICIENT_EVIDENCE"
    body = _ask(client, student_token, "When do exams begin and who is the dean of mechanical engineering?")
    assert body["answer_status"] == "answered"
    assert "18 November 2026" in body["answer"]
    assert "INSUFFICIENT_EVIDENCE" not in body["answer"] and "(not found" in body["answer"]
    assert {c["document_title"] for c in body["citations"]} == {"Exam Schedule"}


def test_a_bare_refusal_token_is_still_the_fallback(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    _text_doc(client, admin, "Exam Schedule", "Semester examinations begin on 18 November 2026.")
    ai.reply = "INSUFFICIENT_EVIDENCE"
    body = _ask(client, student_token, "When do exams begin?")
    assert body["answer_status"] == "insufficient_evidence" and body["citations"] == []


def test_total_of_two_fees_retrieves_both_documents(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    _text_doc(client, admin, "Transport Fee", "The annual transport fee is Rs. 18,000 per student.")
    _text_doc(client, admin, "Hostel Fee", "The annual hostel fee is Rs. 60,000 per student.")
    ai.reply = "The total is Rs. 78,000. [Source 1] [Source 2]"
    body = _ask(client, student_token, "What is the total of the transport fee and the hostel fee?")
    assert {c["document_title"] for c in body["citations"]} == {"Transport Fee", "Hostel Fee"}


def test_different_kinds_of_fee_are_not_a_conflict(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    _text_doc(client, admin, "Transport Fee", "The annual transport fee is Rs. 18,000 per student.")
    _text_doc(client, admin, "Hostel Fee", "The annual hostel fee is Rs. 60,000 per student.")
    ai.reply = "The total is Rs. 78,000. [Source 1] [Source 2]"
    body = _ask(client, student_token, "What is the total of the transport fee and the hostel fee?")
    assert body["has_conflict"] is False


def test_same_fee_with_different_amounts_is_still_a_conflict(client, student_token, college_and_admin, ai):
    admin, _ = college_and_admin
    _text_doc(client, admin, "Hostel Fee 2025", "The annual hostel fee is Rs. 50,000 per student.")
    _text_doc(client, admin, "Hostel Fee 2026", "The annual hostel fee is Rs. 60,000 per student.")
    ai.reply = "The hostel fee is Rs. 60,000. [Source 1] [Source 2]"
    body = _ask(client, student_token, "What is the annual hostel fee?")
    assert body["has_conflict"] is True


def test_a_statement_is_acknowledged_not_treated_as_an_unanswerable_question(client, student_token, college_and_admin, ai):
    body = _ask(client, student_token, "My roommate is called Arjun and I take bus route R6.")
    assert body["answer_status"] == "answered"
    assert body["basis"] == "conversation" and body["citations"] == []
    assert body["answer"].startswith("Noted")
    assert ai.calls == []
    # ... and it is available later.
    ai.reply = "Your roommate is called Arjun."
    later = _ask(client, student_token, "What is my roommate called?")
    assert "Earlier conversations" in ai.calls[-1][1] and "Arjun" in later["answer"]


def test_questions_are_not_mistaken_for_statements():
    from app.rag.analysis import is_statement

    assert is_statement("I take bus route R6.")
    assert is_statement("Actually, correction: I take bus route R6, not R3.")
    assert not is_statement("Which bus route do I take?")
    assert not is_statement("I want to know the exam dates")  # "know" is not a command; see below
