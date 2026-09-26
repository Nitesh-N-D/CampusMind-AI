"""Admin login log: every successful student/faculty login and registration
is recorded, filterable by role and date range, paginated, admin-only, and
scoped to the admin's own college."""
from datetime import datetime

from app.db import models
from app.db.database import get_db
from app.main import app

FACULTY_DOMAIN = "faculty.mitindia.edu"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _events(client, token, **params):
    return client.get("/api/admin/login-events", headers=_auth(token), params=params)


def _register(client, email, role="student", name="Test Person"):
    resp = client.post(
        "/api/auth/register-student",
        json={"email": email, "full_name": name, "password": "pass1234", "role": role},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _login(client, email, password="pass1234"):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def _add_faculty(client, admin_token, email="prof@faculty.mitindia.edu"):
    resp = client.put(
        "/api/admin/settings/faculty-domain", headers=_auth(admin_token), json={"faculty_domain": FACULTY_DOMAIN}
    )
    assert resp.status_code == 200
    return _register(client, email, role="faculty", name="Prof. Rao")


def _set_event_times(times_by_user_email):
    """Backdates events so date filters can be tested deterministically."""
    session_gen = app.dependency_overrides[get_db]()
    db = next(session_gen)
    try:
        for email, when in times_by_user_email.items():
            user = db.query(models.User).filter(models.User.email == email).one()
            for event in db.query(models.LoginEvent).filter(models.LoginEvent.user_id == user.id):
                event.created_at = when
        db.commit()
    finally:
        session_gen.close()


def test_registration_and_login_are_recorded(client, college_and_admin, student_token):
    admin_token, domain = college_and_admin
    assert _login(client, f"nitesh@{domain}").status_code == 200

    body = _events(client, admin_token).json()
    assert body["total"] == 2
    assert [e["event_type"] for e in body["items"]] == ["login", "register"]
    first = body["items"][0]
    assert first["full_name"] == "Nitesh N D"
    assert first["email"] == f"nitesh@{domain}"
    assert first["role"] == "student"
    # Timestamps are explicit UTC so browsers convert them to local time.
    assert first["created_at"].endswith(("Z", "+00:00"))


def test_failed_logins_and_admin_logins_are_not_recorded(client, college_and_admin, student_token):
    admin_token, domain = college_and_admin
    assert _login(client, f"nitesh@{domain}", password="wrong-password").status_code == 401
    assert _login(client, f"admin@{domain}", password="adminpass123").status_code == 200

    body = _events(client, admin_token).json()
    assert body["total"] == 1
    assert body["items"][0]["event_type"] == "register"


def test_filter_by_role(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    _add_faculty(client, admin_token)
    _login(client, "prof@faculty.mitindia.edu")

    students = _events(client, admin_token, role="student").json()
    faculty = _events(client, admin_token, role="faculty").json()
    everyone = _events(client, admin_token).json()

    assert {e["role"] for e in students["items"]} == {"student"}
    assert students["total"] == 1
    assert {e["role"] for e in faculty["items"]} == {"faculty"}
    assert faculty["total"] == 2
    assert everyone["total"] == 3

    assert _events(client, admin_token, role="admin").status_code == 422


def test_filter_by_date_range(client, college_and_admin):
    admin_token, domain = college_and_admin
    for name in ("june", "july", "august"):
        _register(client, f"{name}@{domain}")
    _set_event_times(
        {
            f"june@{domain}": datetime(2026, 6, 15, 10, 0),
            f"july@{domain}": datetime(2026, 7, 15, 10, 0),
            f"august@{domain}": datetime(2026, 8, 15, 10, 0),
        }
    )

    def emails(**params):
        return [e["email"] for e in _events(client, admin_token, **params).json()["items"]]

    assert emails(start="2026-07-01T00:00:00Z", end="2026-08-01T00:00:00Z") == [f"july@{domain}"]
    assert emails(start="2026-07-01T00:00:00Z") == [f"august@{domain}", f"july@{domain}"]
    assert emails(end="2026-07-01T00:00:00Z") == [f"june@{domain}"]
    # Start is inclusive, end is exclusive.
    assert emails(start="2026-07-15T10:00:00Z", end="2026-07-15T10:00:01Z") == [f"july@{domain}"]
    assert emails(start="2026-07-15T10:00:01Z", end="2026-08-15T10:00:00Z") == []
    # Timezone offsets are honoured: 15:30 in India is 10:00 UTC.
    assert emails(start="2026-07-15T15:30:00+05:30", end="2026-07-15T15:30:01+05:30") == [f"july@{domain}"]

    resp = _events(client, admin_token, start="2026-08-01T00:00:00Z", end="2026-07-01T00:00:00Z")
    assert resp.status_code == 400
    assert "start of the date range" in resp.json()["detail"]
    assert _events(client, admin_token, start="not-a-date").status_code == 422


def test_pagination(client, college_and_admin):
    admin_token, domain = college_and_admin
    for i in range(5):
        _register(client, f"s{i}@{domain}")

    page1 = _events(client, admin_token, page=1, page_size=2).json()
    page3 = _events(client, admin_token, page=3, page_size=2).json()
    past_end = _events(client, admin_token, page=4, page_size=2).json()

    assert page1["total"] == 5 and page1["page"] == 1 and page1["page_size"] == 2
    assert len(page1["items"]) == 2
    assert len(page3["items"]) == 1
    assert past_end["items"] == [] and past_end["total"] == 5
    # Newest first, no overlap between pages.
    page2 = _events(client, admin_token, page=2, page_size=2).json()
    ids = [e["id"] for p in (page1, page2, page3) for e in p["items"]]
    assert ids == sorted(ids, reverse=True) and len(set(ids)) == 5

    assert _events(client, admin_token, page_size=101).status_code == 422
    assert _events(client, admin_token, page=0).status_code == 422


def test_login_log_is_admin_only(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    faculty_token = _add_faculty(client, admin_token)
    assert _events(client, student_token).status_code == 403
    assert _events(client, faculty_token).status_code == 403
    assert client.get("/api/admin/login-events").status_code == 401


def test_login_log_is_isolated_per_college(client, college_and_admin, student_token):
    admin_a, _ = college_and_admin
    resp = client.post(
        "/api/auth/register-college",
        json={
            "college_name": "Other College",
            "official_domain": "other.edu",
            "admin_email": "admin@other.edu",
            "admin_full_name": "Other Admin",
            "admin_password": "adminpass123",
        },
    )
    admin_b = resp.json()["access_token"]
    _register(client, "someone@other.edu", name="Other Student")
    _login(client, "someone@other.edu")

    a_events = _events(client, admin_a).json()
    b_events = _events(client, admin_b).json()

    assert {e["email"] for e in a_events["items"]} == {"nitesh@mitindia.edu"}
    assert a_events["total"] == 1
    assert {e["email"] for e in b_events["items"]} == {"someone@other.edu"}
    assert b_events["total"] == 2
    # Filters can't be used to reach across colleges either.
    assert _events(client, admin_a, role="student", start="2000-01-01T00:00:00Z").json()["total"] == 1
