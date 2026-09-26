"""Chat history download: a user can export only their own conversations,
as PDF or plain text, with name, college, per-message times, and sources."""
import io
import os

from pypdf import PdfReader


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _upload_hostel_rules(client, admin_token, seed_pdf_path):
    with open(os.path.join(seed_pdf_path, "hostel_rules.docx"), "rb") as f:
        resp = client.post(
            "/api/documents/upload",
            headers=_auth(admin_token),
            files={"file": ("hostel_rules.docx", f.read(), "application/octet-stream")},
            data={"title": "Hostel Rules 2025-26", "document_type": "general_notice", "is_official": "true"},
        )
    assert resp.json()["status"] == "ready"


def _ask(client, token, message, session_id=None, language="en"):
    resp = client.post(
        "/api/chat/message",
        headers=_auth(token),
        json={"message": message, "session_id": session_id, "language": language},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _register_second_student(client, domain):
    resp = client.post(
        "/api/auth/register-student",
        json={"email": f"priya@{domain}", "full_name": "Priya K", "password": "pass1234"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _export(client, token, session_ids, fmt, tz_offset=None):
    params = [("session_id", i) for i in session_ids] + [("format", fmt)]
    if tz_offset is not None:
        params.append(("tz_offset", tz_offset))
    return client.get("/api/chat/export", headers=_auth(token), params=params)


def test_txt_export_has_name_college_times_questions_answers_and_sources(
    client, college_and_admin, student_token, seed_pdf_path
):
    admin_token, _ = college_and_admin
    _upload_hostel_rules(client, admin_token, seed_pdf_path)
    sid = _ask(client, student_token, "When is dinner served in the mess?")["session_id"]

    resp = _export(client, student_token, [sid], "txt", tz_offset=330)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert 'attachment; filename="campusmind-chat-' in resp.headers["content-disposition"]
    text = resp.content.decode("utf-8")
    assert "Name:     Nitesh N D" in text
    assert "College:  MIT Anna University" in text
    assert "(UTC+05:30)" in text
    assert "] Question\nWhen is dinner served in the mess?" in text
    assert "] Answer\n" in text
    # Numbered to match the [Source N] markers in the answer.
    assert "Sources:\n  [1] Hostel Rules 2025-26, Mess timings (trust " in text


def test_answer_markdown_becomes_plain_prose():
    from app.services.chat_export import _plain

    assert _plain("* **80%** per semester [Source 1]\n* *Regulation 2025* says 75%") == (
        "• 80% per semester [Source 1]\n• Regulation 2025 says 75%"
    )
    assert _plain("2 * 3 = 6") == "2 * 3 = 6"


def test_pdf_export_is_a_real_pdf_with_the_conversation(client, college_and_admin, student_token, seed_pdf_path):
    admin_token, _ = college_and_admin
    _upload_hostel_rules(client, admin_token, seed_pdf_path)
    sid = _ask(client, student_token, "When is dinner served in the mess?")["session_id"]

    resp = _export(client, student_token, [sid], "pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF-")
    # Shaped text is positioned glyph by glyph, so pypdf's extraction adds
    # stray spaces ("Univ ersity"); compare with whitespace removed.
    text = "".join("".join(page.extract_text().split()) for page in PdfReader(io.BytesIO(resp.content)).pages)
    for expected in ["Nitesh N D", "MIT Anna University", "When is dinner served in the mess?",
                     "SOURCES", "Hostel Rules 2025-26", "(UTC+00:00)"]:
        assert "".join(expected.split()) in text, expected


def test_several_past_conversations_export_together_in_order(client, college_and_admin, student_token):
    first = _ask(client, student_token, "What time is the hostel curfew?")["session_id"]
    second = _ask(client, student_token, "When does the library open?")["session_id"]

    text = _export(client, student_token, [second, first], "txt").content.decode("utf-8")
    assert "Conversations: 2" in text
    assert text.index("What time is the hostel curfew?") < text.index("When does the library open?")


def test_tamil_and_hindi_answers_render_in_the_pdf(client, college_and_admin, student_token):
    sid = _ask(client, student_token, "நூலகம் எப்போது திறக்கும்?", language="ta")["session_id"]
    _ask(client, student_token, "पुस्तकालय कब खुलता है?", session_id=sid, language="hi")

    resp = _export(client, student_token, [sid], "pdf")
    assert resp.status_code == 200
    fonts = set()
    for page in PdfReader(io.BytesIO(resp.content)).pages:
        for font in page["/Resources"]["/Font"].values():
            fonts.add(str(font.get_object()["/BaseFont"]))
    assert any("NotoSansTamil" in f for f in fonts), fonts
    assert any("NotoSansDevanagari" in f for f in fonts), fonts


def test_student_cannot_download_another_students_chat_by_changing_the_id(client, college_and_admin, student_token):
    _, domain = college_and_admin
    other_token = _register_second_student(client, domain)
    others_sid = _ask(client, other_token, "Private question about my fees")["session_id"]
    own_sid = _ask(client, student_token, "What time is the hostel curfew?")["session_id"]

    for fmt in ("pdf", "txt"):
        resp = _export(client, student_token, [others_sid], fmt)
        assert resp.status_code == 404
        assert b"Private question" not in resp.content
        # Smuggling it in alongside a conversation you do own fails too.
        resp = _export(client, student_token, [own_sid, others_sid], fmt)
        assert resp.status_code == 404
        assert b"Private question" not in resp.content

    assert _export(client, other_token, [others_sid], "txt").status_code == 200


def test_faculty_can_export_their_own_chat(client, college_and_admin):
    admin_token, domain = college_and_admin
    client.put("/api/admin/settings/faculty-domain", headers=_auth(admin_token),
               json={"faculty_domain": f"faculty.{domain}"})
    resp = client.post(
        "/api/auth/register-student",
        json={"email": f"ravi@faculty.{domain}", "full_name": "Ravi Kumar", "password": "facpass1234", "role": "faculty"},
    )
    assert resp.status_code == 200, resp.text
    faculty_token = resp.json()["access_token"]
    sid = _ask(client, faculty_token, "What is the exam fee?")["session_id"]

    text = _export(client, faculty_token, [sid], "txt").content.decode("utf-8")
    assert "Name:     Ravi Kumar" in text


def test_export_requires_sign_in_and_validates_input(client, student_token):
    sid = _ask(client, student_token, "What time is the hostel curfew?")["session_id"]
    assert client.get("/api/chat/export", params={"session_id": sid}).status_code == 401
    assert _export(client, student_token, [sid], "docx").status_code == 422
    assert _export(client, student_token, [], "pdf").status_code == 422
    assert _export(client, student_token, [sid], "txt", tz_offset=5000).status_code == 422


def test_chat_timestamps_are_marked_utc(client, student_token):
    # Without an offset, browsers read the time as local and every "Today"
    # grouping and export timestamp is shifted by the user's timezone.
    sid = _ask(client, student_token, "What time is the hostel curfew?")["session_id"]
    session = client.get("/api/chat/sessions", headers=_auth(student_token)).json()[0]
    assert session["created_at"].endswith(("Z", "+00:00"))
    messages = client.get(f"/api/chat/sessions/{sid}/messages", headers=_auth(student_token)).json()
    assert all(m["created_at"].endswith(("Z", "+00:00")) for m in messages)
