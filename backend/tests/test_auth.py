def test_register_college_creates_admin(client):
    resp = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "MIT Anna University",
            "official_domain": "mitindia.edu",
            "admin_email": "admin@mitindia.edu",
            "admin_full_name": "Dr. Admin",
            "admin_password": "adminpass123",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "admin"
    assert body["college_name"] == "MIT Anna University"


def test_duplicate_college_domain_rejected(client, college_and_admin):
    resp = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "Another College",
            "official_domain": "mitindia.edu",
            "admin_email": "someone@mitindia.edu",
            "admin_full_name": "Someone",
            "admin_password": "adminpass123",
        },
    )
    assert resp.status_code == 409


def test_student_signup_rejects_wrong_domain(client, college_and_admin):
    resp = client.post(
        "/api/auth/register-student",
        json={"email": "student@gmail.com", "full_name": "Student", "password": "pass1234"},
    )
    assert resp.status_code == 400


def test_student_signup_accepts_matching_domain(client, college_and_admin):
    _, domain = college_and_admin
    resp = client.post(
        "/api/auth/register-student",
        json={"email": f"student@{domain}", "full_name": "Student", "password": "pass1234"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "student"


def test_login_rejects_wrong_password(client, college_and_admin, student_token):
    resp = client.post(
        "/api/auth/login",
        json={"email": "nitesh@mitindia.edu", "password": "wrong-password"},
    )
    assert resp.status_code == 401


def test_login_succeeds_with_correct_password(client, college_and_admin, student_token):
    resp = client.post(
        "/api/auth/login",
        json={"email": "nitesh@mitindia.edu", "password": "pass1234"},
    )
    assert resp.status_code == 200


def test_student_cannot_upload_documents(client, student_token):
    resp = client.post(
        "/api/documents/upload",
        headers={"Authorization": f"Bearer {student_token}"},
        files={"file": ("x.pdf", b"%PDF-1.4 fake", "application/pdf")},
        data={"title": "Sneaky upload", "document_type": "general_notice", "is_official": "true"},
    )
    assert resp.status_code == 403


def test_student_cannot_access_admin_dashboard(client, student_token):
    resp = client.get(
        "/api/admin/knowledge-health", headers={"Authorization": f"Bearer {student_token}"}
    )
    assert resp.status_code == 403


def test_unauthenticated_request_rejected(client):
    resp = client.get("/api/documents")
    assert resp.status_code == 401


def test_faculty_signup_and_access(client, college_and_admin):
    _, domain = college_and_admin
    resp = client.post(
        "/api/auth/register-student",
        json={
            "email": f"prof@{domain}",
            "full_name": "Prof. Rao",
            "password": "pass1234",
            "role": "faculty",
            "department": "CSE",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "faculty"
    faculty_token = body["access_token"]

    # Faculty can chat like a student...
    resp = client.get("/api/documents", headers={"Authorization": f"Bearer {faculty_token}"})
    assert resp.status_code == 200

    # ...but cannot access admin-only routes.
    resp = client.get(
        "/api/admin/knowledge-health", headers={"Authorization": f"Bearer {faculty_token}"}
    )
    assert resp.status_code == 403

    resp = client.post(
        "/api/documents/upload",
        headers={"Authorization": f"Bearer {faculty_token}"},
        files={"file": ("x.pdf", b"%PDF-1.4 fake", "application/pdf")},
        data={"title": "Faculty upload attempt", "document_type": "general_notice", "is_official": "true"},
    )
    assert resp.status_code == 403


def test_invalid_role_rejected(client, college_and_admin):
    _, domain = college_and_admin
    resp = client.post(
        "/api/auth/register-student",
        json={
            "email": f"someone@{domain}",
            "full_name": "Someone",
            "password": "pass1234",
            "role": "admin",
        },
    )
    assert resp.status_code == 400
    # College A
    r = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "College A",
            "official_domain": "college-a.edu",
            "admin_email": "admin@college-a.edu",
            "admin_full_name": "Admin A",
            "admin_password": "adminpass123",
        },
    )
    token_a = r.json()["access_token"]

    # College B
    r = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "College B",
            "official_domain": "college-b.edu",
            "admin_email": "admin@college-b.edu",
            "admin_full_name": "Admin B",
            "admin_password": "adminpass123",
        },
    )
    assert r.status_code == 200

    r = client.post(
        "/api/documents/upload",
        headers={"Authorization": f"Bearer {token_a}"},
        files={"file": ("x.pdf", b"%PDF-1.4 fake", "application/pdf")},
        data={"title": "College A doc", "document_type": "general_notice", "is_official": "true"},
    )
    assert r.status_code == 200

    # College B admin's document list must be empty - no cross-tenant leakage
    r = client.post(
        "/api/auth/login",
        json={"email": "admin@college-b.edu", "password": "adminpass123"},
    )
    token_b = r.json()["access_token"]
    r = client.get("/api/documents", headers={"Authorization": f"Bearer {token_b}"})
    assert r.status_code == 200
    assert r.json() == []
