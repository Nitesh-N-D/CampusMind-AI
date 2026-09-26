"""Retrieval quality across formats: with one real document of every
supported type in the knowledge base, each question must retrieve the
document it's about as the top citation - not a neighbour that happens to
share a common word like "fee" or "time"."""
import os

import pytest

SEED_DOCS = [
    ("attendance_reg_2026.pdf", "Academic Regulations 2026-27", "regulation"),
    ("placement_notice.pdf", "Placement Drive Notice", "placement_notice"),
    ("hostel_rules.docx", "Hostel Rules 2025-26", "general_notice"),
    ("transport_schedule.xlsx", "College Bus Schedule", "timetable"),
    ("exam_fee_schedule.csv", "Exam Fee Schedule", "fee_notice"),
    ("scholarship_faq.txt", "Scholarship FAQ", "general_notice"),
    ("library_notice.png", "Library Notice", "general_notice"),
]

QUESTIONS = [
    # PDF
    ("What is the minimum attendance required to write exams?", "Academic Regulations 2026-27"),
    ("What CGPA do I need for the placement drive?", "Placement Drive Notice"),
    ("When does placement registration close?", "Placement Drive Notice"),
    # Word (.docx) - prose sections and a table
    ("What time is the hostel curfew for first year students?", "Hostel Rules 2025-26"),
    ("When is dinner served in the mess?", "Hostel Rules 2025-26"),
    ("Can visitors come into our rooms?", "Hostel Rules 2025-26"),
    # Excel (.xlsx) - rows and a second sheet
    ("When does the bus from Tambaram leave?", "College Bus Schedule"),
    ("How much is the transport fee?", "College Bus Schedule"),
    # CSV
    ("What is the semester exam fee for MCA?", "Exam Fee Schedule"),
    ("How much does revaluation cost per paper for M.E. students?", "Exam Fee Schedule"),
    # Plain text
    ("What is the deadline for the merit scholarship?", "Scholarship FAQ"),
    ("Is there a scholarship for first generation graduates?", "Scholarship FAQ"),
    # Image (OCR)
    ("What time does the library open?", "Library Notice"),
    ("What is the late fee for overdue library books?", "Library Notice"),
]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def knowledge_base(client, college_and_admin, seed_pdf_path):
    admin_token, _ = college_and_admin
    for filename, title, doc_type in SEED_DOCS:
        with open(os.path.join(seed_pdf_path, filename), "rb") as f:
            resp = client.post(
                "/api/documents/upload",
                headers=_auth(admin_token),
                files={"file": (filename, f.read(), "application/octet-stream")},
                data={"title": title, "document_type": doc_type, "is_official": "true"},
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "ready", resp.json()["processing_error"]


def _ask(client, token, question):
    resp = client.post(
        "/api/chat/message",
        headers=_auth(token),
        json={"message": question, "session_id": None, "language": "en"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_each_question_retrieves_its_document_first(client, student_token, knowledge_base):
    misses = []
    for question, expected in QUESTIONS:
        citations = _ask(client, student_token, question)["citations"]
        top = citations[0]["document_title"] if citations else None
        if top != expected:
            misses.append(f"{question!r}: expected {expected!r}, got {top!r}")
    assert not misses, "\n".join(misses)


def test_citations_stay_on_topic(client, student_token, knowledge_base):
    # Weakly related chunks from other documents shouldn't pad the citations.
    body = _ask(client, student_token, "When does the bus from Tambaram leave?")
    titles = {c["document_title"] for c in body["citations"]}
    assert titles == {"College Bus Schedule"}


def test_non_pdf_citations_name_their_section(client, student_token, knowledge_base):
    body = _ask(client, student_token, "When is dinner served in the mess?")
    top = body["citations"][0]
    assert top["page"] is None
    assert top["section"] == "Mess timings"


def test_unrelated_question_is_not_answered_from_random_documents(client, student_token, knowledge_base):
    body = _ask(client, student_token, "Who won the football world cup?")
    assert body["abstained"] is True


def test_keyword_normalization_folds_inflections_and_drops_glue_words():
    from app.rag.text import content_terms

    assert set(content_terms("What time does the library open?")) == set(content_terms("Library opens time"))
    assert set(content_terms("When is dinner served?")) == set(content_terms("dinner serving"))
    assert set(content_terms("fees for classes")) == set(content_terms("fee class"))
    assert content_terms("Minimum attendance is 75%") == ["minimum", "attendanc", "75%"]
    # Non-English text is tokenized rather than silently dropped.
    assert content_terms("நூலகம் திறக்கும் நேரம்")
