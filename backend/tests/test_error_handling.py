def test_validation_error_returns_single_string_not_array(client, student_token):
    """FastAPI's default validation error shape is {"detail": [ {...} ]} -
    an array of objects. If that ever leaks through unfixed, frontend code
    doing `err.message` (a string) breaks silently. This must always be a
    plain string."""
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"full_name": "abc123"},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert detail == "Full name shouldn't contain numbers."


def test_missing_field_validation_error_names_the_field(client):
    resp = client.post("/api/auth/login", json={"email": "x@x.com"})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "password" in detail.lower()


def test_every_response_carries_a_request_id_header(client):
    resp = client.get("/api/health")
    assert "x-request-id" in {k.lower() for k in resp.headers.keys()}


def test_health_requires_sign_in_and_reveals_nothing(client, student_token):
    assert client.get("/api/health").status_code == 401
    resp = client.get("/api/health", headers={"Authorization": f"Bearer {student_token}"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_unknown_route_returns_consistent_detail_shape(client):
    resp = client.get("/api/this-route-does-not-exist")
    assert resp.status_code == 404
    assert isinstance(resp.json()["detail"], str)


def test_intentional_http_exceptions_pass_through_unchanged(client, college_and_admin):
    _, domain = college_and_admin
    resp = client.post(
        "/api/auth/register-student",
        json={"email": "wrong@gmail.com", "full_name": "X", "password": "pass1234"},
    )
    assert resp.status_code == 400
    assert isinstance(resp.json()["detail"], str)
    assert len(resp.json()["detail"]) > 0


def test_expired_or_forged_token_says_sign_in_again(client, student_token):
    from datetime import timedelta
    from app.core.security import create_access_token

    expired = create_access_token({"sub": "1"}, expires_delta=timedelta(minutes=-1))
    not_a_user_id = create_access_token({"sub": "abc"})
    missing_user = create_access_token({"sub": "999999"})
    for token in (expired, not_a_user_id, missing_user, student_token[:-4] + "xxxx"):
        resp = client.get("/api/profile/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Your session has expired. Please sign in again."


def test_wrong_password_message_is_plain_and_does_not_reveal_which_part(client, college_and_admin):
    _, domain = college_and_admin
    wrong_pw = client.post("/api/auth/login", json={"email": f"admin@{domain}", "password": "nope-nope"})
    no_user = client.post("/api/auth/login", json={"email": f"ghost@{domain}", "password": "nope-nope"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json()["detail"] == no_user.json()["detail"] == (
        "That email and password don't match. Check both and try again."
    )


def test_database_outage_is_a_clear_503_not_a_generic_500(client, student_token):
    from sqlalchemy.exc import OperationalError
    from app.db.database import get_db
    from app.main import app

    def _unreachable_db():
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))
        yield  # pragma: no cover

    original = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = _unreachable_db
    try:
        resp = client.get("/api/profile/me", headers={"Authorization": f"Bearer {student_token}"})
    finally:
        app.dependency_overrides[get_db] = original
    assert resp.status_code == 503
    body = resp.json()
    assert body["detail"] == "The database is temporarily unreachable. Please try again in a minute."
    assert body["request_id"] == resp.headers["x-request-id"]
    assert "connection refused" not in resp.text


def test_forbidden_says_who_the_page_is_for(client, student_token):
    resp = client.get("/api/admin/settings", headers={"Authorization": f"Bearer {student_token}"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Your account doesn't have access to this. It's only for admins."
