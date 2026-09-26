"""Faculty signup is gated on a per-college `faculty_domain` that only an
admin can set. There is no fallback to `official_domain`."""

FACULTY_DOMAIN = "faculty.mitindia.edu"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _register(client, email, role):
    return client.post(
        "/api/auth/register-student",
        json={"email": email, "full_name": "Test Person", "password": "pass1234", "role": role},
    )


def _set_faculty_domain(client, token, domain):
    return client.put(
        "/api/admin/settings/faculty-domain", headers=_auth(token), json={"faculty_domain": domain}
    )


def test_new_college_starts_with_faculty_domain_unset(client, college_and_admin):
    admin_token, domain = college_and_admin
    resp = client.get("/api/admin/settings", headers=_auth(admin_token))
    assert resp.status_code == 200
    assert resp.json() == {
        "college_name": "MIT Anna University",
        "official_domain": domain,
        "faculty_domain": None,
    }


def test_faculty_domain_cannot_be_set_at_college_registration(client):
    resp = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "Sneaky College",
            "official_domain": "sneaky.edu",
            "faculty_domain": "staff.sneaky.edu",
            "admin_email": "admin@sneaky.edu",
            "admin_full_name": "Admin",
            "admin_password": "adminpass123",
        },
    )
    assert resp.status_code == 422


# (a)
def test_faculty_signup_rejected_when_faculty_domain_unset(client, college_and_admin):
    _, domain = college_and_admin
    resp = _register(client, f"prof@{domain}", "faculty")
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "Faculty signup isn't set up for this college yet" in detail
    assert "no faculty email domain is registered" in detail
    assert "ask your admin to add a faculty domain" in detail.lower()


# (b)
def test_faculty_signup_accepted_once_admin_sets_faculty_domain(client, college_and_admin):
    admin_token, _ = college_and_admin
    resp = _set_faculty_domain(client, admin_token, FACULTY_DOMAIN)
    assert resp.status_code == 200
    assert resp.json()["faculty_domain"] == FACULTY_DOMAIN

    resp = _register(client, f"prof@{FACULTY_DOMAIN}", "faculty")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["role"] == "faculty"
    assert body["college_name"] == "MIT Anna University"


def test_faculty_signup_never_falls_back_to_official_domain(client, college_and_admin):
    admin_token, domain = college_and_admin
    assert _set_faculty_domain(client, admin_token, FACULTY_DOMAIN).status_code == 200
    resp = _register(client, f"prof@{domain}", "faculty")
    assert resp.status_code == 400
    # The faculty domain is not exposed to the person signing up.
    assert FACULTY_DOMAIN not in resp.json()["detail"]


# (c)
def test_faculty_signup_rejected_when_email_matches_neither_domain(client, college_and_admin):
    admin_token, _ = college_and_admin
    assert _set_faculty_domain(client, admin_token, FACULTY_DOMAIN).status_code == 200
    resp = _register(client, "prof@gmail.com", "faculty")
    assert resp.status_code == 400
    assert "isn't registered for faculty signup" in resp.json()["detail"]


# (d)
def test_student_signup_unaffected_by_faculty_domain(client, college_and_admin):
    admin_token, domain = college_and_admin

    before = _register(client, f"student1@{domain}", "student")
    assert before.status_code == 200
    assert before.json()["role"] == "student"

    assert _set_faculty_domain(client, admin_token, FACULTY_DOMAIN).status_code == 200

    after = _register(client, f"student2@{domain}", "student")
    assert after.status_code == 200
    assert after.json()["role"] == "student"

    # Students still validate against official_domain only.
    resp = _register(client, f"student3@{FACULTY_DOMAIN}", "student")
    assert resp.status_code == 400


# (e)
def test_faculty_domain_endpoint_is_admin_only(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    assert _set_faculty_domain(client, admin_token, FACULTY_DOMAIN).status_code == 200
    faculty = _register(client, f"prof@{FACULTY_DOMAIN}", "faculty")
    faculty_token = faculty.json()["access_token"]

    for token in (student_token, faculty_token):
        resp = _set_faculty_domain(client, token, "hijack.mitindia.edu")
        assert resp.status_code == 403
        assert client.get("/api/admin/settings", headers=_auth(token)).status_code == 403

    assert client.put(
        "/api/admin/settings/faculty-domain", json={"faculty_domain": "x.edu"}
    ).status_code == 401

    resp = client.get("/api/admin/settings", headers=_auth(admin_token))
    assert resp.json()["faculty_domain"] == FACULTY_DOMAIN


def test_clearing_faculty_domain_closes_faculty_signup(client, college_and_admin):
    admin_token, _ = college_and_admin
    assert _set_faculty_domain(client, admin_token, FACULTY_DOMAIN).status_code == 200
    resp = _set_faculty_domain(client, admin_token, None)
    assert resp.status_code == 200
    assert resp.json()["faculty_domain"] is None
    assert _register(client, f"prof@{FACULTY_DOMAIN}", "faculty").status_code == 400


def test_faculty_domain_validation_and_uniqueness(client, college_and_admin):
    admin_token, _ = college_and_admin
    assert _set_faculty_domain(client, admin_token, "not a domain").status_code == 422

    other = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "Other College",
            "official_domain": "other.edu",
            "admin_email": "admin@other.edu",
            "admin_full_name": "Other Admin",
            "admin_password": "adminpass123",
        },
    )
    other_token = other.json()["access_token"]

    # Can't claim another college's official domain or faculty domain.
    assert _set_faculty_domain(client, admin_token, "other.edu").status_code == 409
    assert _set_faculty_domain(client, other_token, "staff.other.edu").status_code == 200
    assert _set_faculty_domain(client, admin_token, "staff.other.edu").status_code == 409

    # Input is normalized: case and a leading "@" are stripped.
    resp = _set_faculty_domain(client, admin_token, "@Faculty.MITindia.edu")
    assert resp.status_code == 200
    assert resp.json()["faculty_domain"] == FACULTY_DOMAIN
