import os


def _upload(client, token, path, **fields):
    with open(path, "rb") as f:
        resp = client.post(
            "/api/documents/upload",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": (os.path.basename(path), f, "application/pdf")},
            data=fields,
        )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_document_upload_and_trust_scoring(client, college_and_admin, seed_pdf_path):
    admin_token, _ = college_and_admin
    doc = _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2025.pdf"),
        title="Attendance Regulations 2025-26",
        document_type="regulation",
        academic_year="2025-26",
        effective_date="2025-06-01",
        is_official="true",
    )
    assert doc["status"] == "ready"
    assert doc["trust_score"] > 0
    assert doc["trust_level"] in {"very_high", "high", "medium", "low"}


def test_malformed_pdf_fails_gracefully_not_500(client, college_and_admin):
    admin_token, _ = college_and_admin
    resp = client.post(
        "/api/documents/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("bad.pdf", b"not actually a pdf", "application/pdf")},
        data={"title": "Bad file", "document_type": "general_notice", "is_official": "true"},
    )
    # Ingestion failures must be reported cleanly, never a raw 500
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in {"failed", "ready"}


def test_conflicting_documents_are_detected_in_chat(client, college_and_admin, student_token, seed_pdf_path):
    admin_token, _ = college_and_admin
    old_doc = _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2025.pdf"),
        title="Attendance Regulations 2025-26",
        document_type="regulation",
        academic_year="2025-26",
        effective_date="2025-06-01",
        is_official="true",
    )
    _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2026.pdf"),
        title="Attendance Regulations 2026-27",
        document_type="regulation",
        academic_year="2026-27",
        effective_date="2026-06-01",
        is_official="true",
        supersedes_id=str(old_doc["id"]),
    )

    resp = client.post(
        "/api/chat/message",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"message": "What is the minimum attendance requirement?", "session_id": None, "language": "en"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_conflict"] is True
    assert len(body["conflicts"]) >= 1
    assert len(body["citations"]) >= 2


def test_superseded_document_still_visible_to_admin_but_archived(
    client, college_and_admin, seed_pdf_path
):
    admin_token, _ = college_and_admin
    old_doc = _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2025.pdf"),
        title="Attendance Regulations 2025-26",
        document_type="regulation",
        academic_year="2025-26",
        effective_date="2025-06-01",
        is_official="true",
    )
    _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2026.pdf"),
        title="Attendance Regulations 2026-27",
        document_type="regulation",
        academic_year="2026-27",
        effective_date="2026-06-01",
        is_official="true",
        supersedes_id=str(old_doc["id"]),
    )
    resp = client.get("/api/documents", headers={"Authorization": f"Bearer {admin_token}"})
    docs = {d["id"]: d for d in resp.json()}
    assert docs[old_doc["id"]]["status"] == "archived"


def test_admin_conflict_resolution_removes_it_from_open_list(
    client, college_and_admin, student_token, seed_pdf_path
):
    admin_token, _ = college_and_admin
    old_doc = _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2025.pdf"),
        title="Attendance Regulations 2025-26",
        document_type="regulation",
        academic_year="2025-26",
        effective_date="2025-06-01",
        is_official="true",
    )
    new_doc = _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2026.pdf"),
        title="Attendance Regulations 2026-27",
        document_type="regulation",
        academic_year="2026-27",
        effective_date="2026-06-01",
        is_official="true",
        supersedes_id=str(old_doc["id"]),
    )

    client.post(
        "/api/chat/message",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"message": "What is the minimum attendance requirement?", "session_id": None, "language": "en"},
    )

    resp = client.get("/api/admin/conflicts", headers={"Authorization": f"Bearer {admin_token}"})
    conflicts = resp.json()
    assert len(conflicts) >= 1
    conflict_id = conflicts[0]["id"]

    resp = client.post(
        f"/api/admin/conflicts/{conflict_id}/resolve",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"authoritative_document_id": new_doc["id"], "resolution_note": "Confirmed by registrar"},
    )
    assert resp.status_code == 200

    resp = client.get("/api/admin/conflicts", headers={"Authorization": f"Bearer {admin_token}"})
    assert all(c["id"] != conflict_id for c in resp.json())


def test_change_log_visible_to_student_not_just_admin(
    client, college_and_admin, student_token, seed_pdf_path
):
    """Feature 7 exists specifically so students see what changed - it
    must not be locked behind admin-only, unlike most analytics."""
    admin_token, _ = college_and_admin
    old_doc = _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2025.pdf"),
        title="Attendance Regulations 2025-26",
        document_type="regulation",
        academic_year="2025-26",
        effective_date="2025-06-01",
        is_official="true",
    )
    _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2026.pdf"),
        title="Attendance Regulations 2026-27",
        document_type="regulation",
        academic_year="2026-27",
        effective_date="2026-06-01",
        is_official="true",
        supersedes_id=str(old_doc["id"]),
    )

    resp = client.get(
        "/api/documents/changes", headers={"Authorization": f"Bearer {student_token}"}
    )
    assert resp.status_code == 200
    changes = resp.json()
    assert len(changes) >= 1
    assert changes[0]["old_document_title"] == "Attendance Regulations 2025-26"
    assert changes[0]["new_document_title"] == "Attendance Regulations 2026-27"
    assert changes[0]["impact_summary"]


def test_knowledge_health_reflects_uploaded_documents(client, college_and_admin, seed_pdf_path):
    admin_token, _ = college_and_admin
    _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "placement_notice.pdf"),
        title="Placement Drive Notice",
        document_type="placement_notice",
        department="CSE",
        effective_date="2026-08-01",
        is_official="true",
    )
    resp = client.get("/api/admin/knowledge-health", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["documents_indexed"] == 1
    assert 0 <= body["health_score"] <= 100


def test_search_returns_relevant_documents(client, college_and_admin, student_token, seed_pdf_path):
    admin_token, _ = college_and_admin
    _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "placement_notice.pdf"),
        title="Placement Drive Notice",
        document_type="placement_notice",
        department="CSE",
        effective_date="2026-08-01",
        is_official="true",
    )
    resp = client.get(
        "/api/search", headers={"Authorization": f"Bearer {student_token}"}, params={"q": "placement"}
    )
    assert resp.status_code == 200
    assert len(resp.json()) > 0


def test_notifications_are_role_targeted(client, college_and_admin, student_token, seed_pdf_path):
    admin_token, _ = college_and_admin
    old_doc = _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2025.pdf"),
        title="Attendance Regulations 2025-26",
        document_type="regulation",
        academic_year="2025-26",
        effective_date="2025-06-01",
        is_official="true",
    )
    _upload(
        client,
        admin_token,
        os.path.join(seed_pdf_path, "attendance_reg_2026.pdf"),
        title="Attendance Regulations 2026-27",
        document_type="regulation",
        academic_year="2026-27",
        effective_date="2026-06-01",
        is_official="true",
        supersedes_id=str(old_doc["id"]),
    )
    client.post(
        "/api/chat/message",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"message": "What is the minimum attendance requirement?", "session_id": None, "language": "en"},
    )

    student_notifs = client.get(
        "/api/notifications", headers={"Authorization": f"Bearer {student_token}"}
    ).json()
    admin_notifs = client.get(
        "/api/notifications", headers={"Authorization": f"Bearer {admin_token}"}
    ).json()

    assert any(n["category"] == "regulation_change" for n in student_notifs)
    assert all(n["category"] != "conflict" for n in student_notifs)
    assert any(n["category"] == "conflict" for n in admin_notifs)
