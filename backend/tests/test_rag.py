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
    # Rejected up front with a clear message, never a raw 500. Damaged files
    # that pass this check are covered in test_ingestion_formats.py.
    assert resp.status_code == 400
    assert "don't look like a PDF" in resp.json()["detail"]


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


def test_supersedes_must_be_a_document_in_the_same_workspace(client, college_and_admin, seed_pdf_path):
    admin_token, _ = college_and_admin
    other = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "Other College",
            "official_domain": "other.edu",
            "admin_email": "admin@other.edu",
            "admin_full_name": "Other Admin",
            "admin_password": "adminpass123",
        },
    ).json()["access_token"]
    theirs = _upload(
        client,
        other,
        os.path.join(seed_pdf_path, "attendance_reg_2025.pdf"),
        title="Their regulations",
        document_type="regulation",
        is_official="true",
    )

    with open(os.path.join(seed_pdf_path, "attendance_reg_2026.pdf"), "rb") as f:
        resp = client.post(
            "/api/documents/upload",
            headers={"Authorization": f"Bearer {admin_token}"},
            files={"file": ("attendance_reg_2026.pdf", f, "application/pdf")},
            data={"title": "Ours", "document_type": "regulation", "supersedes_id": str(theirs["id"])},
        )
    assert resp.status_code == 400
    # The other college's document is untouched.
    docs = client.get("/api/documents", headers={"Authorization": f"Bearer {other}"}).json()
    assert [d["status"] for d in docs] == ["ready"]


def test_document_library_is_admin_only(client, college_and_admin, student_token):
    assert client.get("/api/documents", headers={"Authorization": f"Bearer {student_token}"}).status_code == 403


def test_removed_features_have_no_endpoints(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    for token in (student_token, admin_token):
        headers = {"Authorization": f"Bearer {token}"}
        for path in (
            "/api/notifications",
            "/api/search?q=attendance",
            "/api/timeline",
            "/api/documents/changes",
            "/api/admin/change-logs",
        ):
            assert client.get(path, headers=headers).status_code in (404, 405), path
