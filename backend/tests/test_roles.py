"""Role separation: chat is for students and faculty; admins manage the
workspace and may only send test questions, which must not be counted as
end-user usage."""
import os


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _upload_placement_notice(client, admin_token, seed_pdf_path):
    with open(os.path.join(seed_pdf_path, "placement_notice.pdf"), "rb") as f:
        resp = client.post(
            "/api/documents/upload",
            headers=_auth(admin_token),
            files={"file": ("placement_notice.pdf", f, "application/pdf")},
            data={"title": "Placement Drive Notice", "document_type": "placement_notice", "is_official": "true"},
        )
    assert resp.status_code == 200, resp.text


def test_admin_test_question_is_answered_but_not_counted_as_usage(
    client, college_and_admin, seed_pdf_path
):
    admin_token, _ = college_and_admin
    _upload_placement_notice(client, admin_token, seed_pdf_path)

    resp = client.post(
        "/api/chat/message",
        headers=_auth(admin_token),
        json={"message": "When is the placement drive?", "session_id": None, "language": "en"},
    )
    assert resp.status_code == 200
    assert resp.json()["answer"]

    analytics = client.get("/api/admin/analytics", headers=_auth(admin_token)).json()
    assert analytics["total_questions_answered"] == 0
    assert analytics["top_queries"] == []


def test_student_question_is_counted_as_usage(client, college_and_admin, student_token, seed_pdf_path):
    admin_token, _ = college_and_admin
    _upload_placement_notice(client, admin_token, seed_pdf_path)

    resp = client.post(
        "/api/chat/message",
        headers=_auth(student_token),
        json={"message": "When is the placement drive?", "session_id": None, "language": "en"},
    )
    assert resp.status_code == 200

    analytics = client.get("/api/admin/analytics", headers=_auth(admin_token)).json()
    assert analytics["total_questions_answered"] == 1
    assert analytics["top_queries"] == [{"query": "When is the placement drive?", "count": 1}]
