"""General question understanding: the plan drawn from a question decides how
much evidence is retrieved, how it is gathered, and what shape the answer takes.
Nothing here is specific to one document or one question."""
import io
import os

import pytest
from openpyxl import Workbook

from app.rag.analysis import (
    BROAD,
    ENUMERATE,
    NARROW,
    analyze_question,
    needs_clarification,
)
from app.rag.pipeline import FALLBACK_MESSAGE, STANDALONE_PROMPT
from app.services import ai_provider

FALLBACK = FALLBACK_MESSAGE["en"]

SEM3 = (
    "Semester 3 subjects\n"
    "Semester 3 of the B.E. CSE programme has five subjects: Data Structures, Discrete Mathematics, "
    "Digital Logic, Object Oriented Programming and Probability. Total credits for Semester 3 are 22."
)
SEM4 = (
    "Semester 4 subjects\n"
    "Semester 4 of the B.E. CSE programme has six subjects: Algorithms, Operating Systems, Database "
    "Management, Computer Architecture, Software Engineering and Statistics. Total credits for Semester 4 are 24."
)
EXAMS = "Semester examinations begin on 18 November 2026. The last date to pay the exam fee is 5 November 2026."
SCHOLARSHIP = (
    "Merit scholarship\n"
    "A student is eligible for the merit scholarship if the minimum percentage in the previous semester "
    "is 85 percent and attendance is at least 90 percent. Applications close on 30 September."
)
TRANSPORT_FEE = "Transport fee\nThe annual transport fee is Rs. 18,000 per student."
HOSTEL_FEE = "Hostel fee\nThe annual hostel fee is Rs. 60,000 per student."


class ScriptedAI(ai_provider.AIProvider):
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


def _upload(client, token, title, text, **fields):
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(token),
        files={"file": (f"{title}.txt", text.encode(), "text/plain")},
        data={"title": title, "document_type": "general_notice", "is_official": "true", **fields},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _upload_routes_xlsx(client, token, count=60):
    wb = Workbook()
    ws = wb.active
    ws.title = "Routes"
    ws.append(["Route No", "Starting Point", "Departure Time", "Arrival Time"])
    for n in range(1, count + 1):
        ws.append([f"R{n:02d}", f"Stop{n:02d}", f"6:{n % 60:02d} AM", f"8:{n % 60:02d} AM"])
    buf = io.BytesIO()
    wb.save(buf)
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(token),
        files={"file": ("Bus Routes.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"title": "Bus Routes", "document_type": "general_notice", "is_official": "true"},
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


def _doc_ids(body):
    return {c["document_id"] for c in body["citations"]}


# --- the plan itself -------------------------------------------------------


@pytest.mark.parametrize(
    "question,intent,breadth",
    [
        ("How many students are enrolled in CSE?", "count", ENUMERATE),
        ("List the subjects in Semester 3", "list", ENUMERATE),
        ("What are the available routes?", "list", ENUMERATE),
        ("What is a database?", "definition", NARROW),
        ("Explain the transport schedule.", "explanation", NARROW),
        ("Explain the complete syllabus.", "explanation", BROAD),
        ("How do I apply for a bonafide certificate?", "task", NARROW),
        ("Why is attendance mandatory?", "why", NARROW),
        ("Compare Semester 3 and Semester 4", "comparison", BROAD),
        ("What is the difference between a database and a file system?", "comparison", BROAD),
        ("When is the exam fee deadline?", "temporal", NARROW),
        ("Where does Route 5 start?", "location", NARROW),
        ("Who is eligible for the merit scholarship?", "eligibility", NARROW),
        ("What happens if I miss the end semester exam?", "conditional", NARROW),
        ("What is the total of the transport and hostel fee?", "numerical", NARROW),
        ("Summarize the hostel rules", "summarization", BROAD),
        ("Who is the principal?", "factual", NARROW),
    ],
)
def test_question_types_map_to_intent_and_breadth(question, intent, breadth):
    plan = analyze_question(question)
    assert plan.intent == intent
    assert plan.breadth == breadth


def test_comparison_sides_and_multi_part_are_extracted():
    plan = analyze_question("Compare Semester 3 and Semester 4 in terms of credits")
    assert plan.sides == ["Semester 3", "Semester 4"]
    assert plan.multi_document

    plan = analyze_question("How many routes are there and what time does Route 5 arrive?")
    assert plan.parts == ["How many routes are there", "what time does Route 5 arrive"]

    assert analyze_question("What is the total of the transport and hostel fee?").parts == []
    assert analyze_question("What is the total of the transport and hostel fee?").calculation


def test_clarification_only_when_nothing_says_what_is_asked():
    assert needs_clarification("tell me", has_history=False)
    assert needs_clarification("what about it?", has_history=False)
    assert not needs_clarification("tell me", has_history=True)  # the conversation supplies the subject
    assert not needs_clarification("What is the exam fee?", has_history=False)


# --- retrieval and answers by type ----------------------------------------


def test_count_over_a_spreadsheet_gets_every_row_not_just_the_top_few(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    doc = _upload_routes_xlsx(client, admin_token, count=60)
    ai.reply = "There are 60 routes available. [Source 1]"

    body = _ask(client, student_token, "How many routes are available?")
    prompt = ai.calls[-1][1]
    assert "Query type: count" in prompt and "every matching record" in prompt
    # Every one of the 60 rows reached the model, each still tied to its column headers.
    for n in (1, 30, 60):
        assert f"Stop{n:02d}" in prompt
    line = next(l for l in prompt.splitlines() if "Stop30" in l)
    assert "Route No" in line and "Starting Point" in line and "R30" in line
    assert body["answer"] == "There are 60 routes available."
    assert _doc_ids(body) == {doc["id"]}

    # A narrow factual question about the same data stays narrow.
    ai.reply = "Route R05 starts at Stop05. [Source 1]"
    _ask(client, student_token, "Where does route R05 start?")
    assert "Stop60" not in ai.calls[-1][1]


def test_direct_factual_and_list_questions_use_the_matching_style(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    _upload(client, admin_token, "Exam Schedule", EXAMS)
    _upload(client, admin_token, "Semester 3", SEM3)

    ai.reply = "Semester examinations begin on 18 November 2026. [Source 1]"
    body = _ask(client, student_token, "When do the semester examinations begin?")
    assert "Query type: temporal" in ai.calls[-1][1]
    assert "18 November 2026" in body["answer"]
    assert len(body["citations"]) == 1 and body["citations"][0]["document_title"] == "Exam Schedule"

    ai.reply = "Data Structures, Discrete Mathematics, Digital Logic, OOP and Probability. [Source 1]"
    body = _ask(client, student_token, "List the subjects in Semester 3")
    assert "Query type: list" in ai.calls[-1][1]
    assert len(body["citations"]) == 1 and body["citations"][0]["document_title"] == "Semester 3"


def test_comparison_retrieves_evidence_for_both_sides(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    s3 = _upload(client, admin_token, "Semester 3", SEM3)
    s4 = _upload(client, admin_token, "Semester 4", SEM4)
    _upload(client, admin_token, "Exam Schedule", EXAMS)

    ai.reply = "Semester 3 has five subjects [Source 1] and Semester 4 has six [Source 2]."
    body = _ask(client, student_token, "Compare Semester 3 and Semester 4")
    prompt = ai.calls[-1][1]
    assert "Query type: comparison" in prompt
    assert "Compare these on the same attributes: Semester 3 | Semester 4" in prompt
    assert "Digital Logic" in prompt and "Computer Architecture" in prompt  # both sides present
    assert "18 November" not in prompt  # unrelated document excluded
    assert _doc_ids(body) == {s3["id"], s4["id"]}


def test_multi_part_message_gets_evidence_for_each_part(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    s3 = _upload(client, admin_token, "Semester 3", SEM3)
    ex = _upload(client, admin_token, "Exam Schedule", EXAMS)

    ai.reply = "(1) Five subjects [Source 1]. (2) 18 November 2026 [Source 2]."
    body = _ask(client, student_token, "How many subjects are in Semester 3 and when do the semester examinations begin?")
    prompt = ai.calls[-1][1]
    assert "Answer each one separately" in prompt
    assert "Digital Logic" in prompt and "18 November 2026" in prompt
    assert _doc_ids(body) == {s3["id"], ex["id"]}


def test_partly_supported_message_answers_the_supported_part_and_flags_the_rest(
    client, college_and_admin, student_token, ai
):
    admin_token, _ = college_and_admin
    ex = _upload(client, admin_token, "Exam Schedule", EXAMS)

    ai.reply = "Examinations begin on 18 November 2026 [Source 1]. The documents do not say who won the cup."
    body = _ask(client, student_token, "When do the semester examinations begin and who won the football world cup in 2018?")
    prompt = ai.calls[-1][1]
    assert "No relevant passages were found for: who won the football world cup in 2018" in prompt
    assert body["answer_status"] == "answered"
    assert _doc_ids(body) == {ex["id"]}  # only the document that supported the answer


def test_structured_condition_question_uses_the_eligibility_style(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    doc = _upload(client, admin_token, "Merit Scholarship", SCHOLARSHIP)
    ai.reply = "The minimum percentage is 85 percent. [Source 1]"
    body = _ask(client, student_token, "Who is eligible for the merit scholarship?")
    assert "Query type: eligibility" in ai.calls[-1][1]
    assert _doc_ids(body) == {doc["id"]}


def test_cross_document_total_draws_on_both_documents(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    t = _upload(client, admin_token, "Transport Fee", TRANSPORT_FEE)
    h = _upload(client, admin_token, "Hostel Fee", HOSTEL_FEE)
    _upload(client, admin_token, "Exam Schedule", EXAMS)

    ai.reply = "The total is Rs. 78,000 (18,000 + 60,000). [Source 1][Source 2]"
    body = _ask(client, student_token, "What is the total of the transport fee and the hostel fee?")
    prompt = ai.calls[-1][1]
    assert "Rs. 18,000" in prompt and "Rs. 60,000" in prompt
    assert "Calculation:" in prompt and "never estimating" not in prompt
    assert "18 November" not in prompt
    assert _doc_ids(body) == {t["id"], h["id"]}


def test_ambiguous_question_asks_for_clarification_without_sources(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    _upload(client, admin_token, "Semester 3", SEM3)

    body = _ask(client, student_token, "tell me")
    assert body["citations"] == [] and body["answer_status"] == "answered"
    assert body["basis"] == "conversation"
    assert body["answer"].endswith("?")
    assert ai.calls == []  # nothing was retrieved or generated

    # The model can also ask: its question is passed on, with no sources.
    ai.reply = "CLARIFY: Which semester do you mean?"
    body = _ask(client, student_token, "What are the subjects?")
    assert body["answer"] == "Which semester do you mean?"
    assert body["citations"] == [] and body["confidence"] == 0


def test_follow_up_refers_to_an_item_from_the_previous_answer(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    _upload(client, admin_token, "Semester 3", SEM3)
    ai.reply = "Five subjects. [Source 1]"
    first = _ask(client, student_token, "List the subjects in Semester 3")

    ai.rewrite = "How many credits does Semester 3 carry?"
    ai.reply = "Semester 3 carries 22 credits. [Source 1]"
    body = _ask(client, student_token, "and how many credits does it carry?", first["session_id"])
    assert body["answer_status"] == "answered"
    assert "22 credits" in body["answer"]
    assert "Understood as: How many credits does Semester 3 carry?" in ai.calls[-1][1]


def test_citations_follow_the_answer_not_the_candidates(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    s3 = _upload(client, admin_token, "Semester 3", SEM3)
    s4 = _upload(client, admin_token, "Semester 4", SEM4)
    # Both documents are in the context, but the answer rests on one.
    ai.reply = "Semester 3 has five subjects [Source 1]."
    body = _ask(client, student_token, "Compare Semester 3 and Semester 4")
    assert len(body["citations"]) == 1
    cited = body["citations"][0]
    assert cited["document_id"] in {s3["id"], s4["id"]}
    assert "[Source" not in body["answer"]


def test_documents_outside_the_students_department_never_reach_the_prompt(
    client, college_and_admin, student_token, ai
):
    admin_token, _ = college_and_admin
    _upload(client, admin_token, "Semester 3", SEM3)
    _upload(client, admin_token, "Mech Semester 3", SEM3.replace("CSE", "MECH").replace("Digital Logic", "Thermodynamics"), department="MECH")
    ai.reply = "Five subjects. [Source 1]"
    _ask(client, student_token, "List the subjects in Semester 3")
    prompt = ai.calls[-1][1]
    assert "Digital Logic" in prompt
    assert "Thermodynamics" not in prompt


def test_unsupported_and_other_users_history_still_give_the_plain_fallback(client, college_and_admin, student_token, ai):
    admin_token, _ = college_and_admin
    _upload(client, admin_token, "Semester 3", SEM3)
    body = _ask(client, student_token, "What is the maximum speed of the campus helicopter?")
    assert body["answer"] == FALLBACK and body["citations"] == []


# --- source list presentation ---------------------------------------------


def test_source_list_expands_and_collapses_per_answer():
    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    block = open(os.path.join(here, "frontend", "src", "components", "AnswerBlock.tsx"), encoding="utf-8").read()
    chat = open(os.path.join(here, "frontend", "src", "pages", "Chat.tsx"), encoding="utf-8").read()

    assert "COLLAPSED_SOURCE_COUNT = 2" in block
    # State lives inside the component, so every answer expands independently.
    assert "useState(false)" in block and "setExpanded" in block
    assert "sources.length > COLLAPSED_SOURCE_COUNT" in block  # control only when more than two
    assert "seeLessLabel" in block and "seeMoreLabel" in block and "aria-expanded" in block
    assert "sources.length > 0" in block  # nothing rendered for an empty list
    assert 'trust !== "none"' in block  # no trust rating on an unanswered reply
    assert 'chat.seeMore' in chat and 'chat.seeLess' in chat
    # Presentation only: selection happens in the backend, never here.
    assert "slice(0, COLLAPSED_SOURCE_COUNT)" in block
