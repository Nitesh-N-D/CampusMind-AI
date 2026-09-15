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
