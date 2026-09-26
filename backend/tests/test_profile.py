import io

from PIL import Image


def _make_jpeg(width=300, height=300):
    img = Image.new("RGB", (width, height), color=(120, 130, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    return buf.read()


def test_update_full_name_and_nickname(client, student_token):
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"full_name": "Nitesh Kumar", "nickname": "Nite"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["full_name"] == "Nitesh Kumar"
    assert body["nickname"] == "Nite"


def test_full_name_rejects_digits(client, student_token):
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"full_name": "Nitesh123"},
    )
    assert resp.status_code == 422


def test_full_name_rejects_empty_string(client, student_token):
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"full_name": "   "},
    )
    assert resp.status_code == 422


def test_nickname_rejects_invalid_characters(client, student_token):
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"nickname": "<script>alert(1)</script>"},
    )
    assert resp.status_code == 422


def test_nickname_too_short_rejected(client, student_token):
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"nickname": "N"},
    )
    assert resp.status_code == 422


def test_empty_nickname_clears_it(client, student_token):
    headers = {"Authorization": f"Bearer {student_token}"}
    client.put("/api/profile/me", headers=headers, json={"nickname": "Nite"})
    resp = client.put("/api/profile/me", headers=headers, json={"nickname": ""})
    assert resp.status_code == 200
    assert resp.json()["nickname"] is None


def test_preferred_language_rejects_unsupported_value(client, student_token):
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"preferred_language": "fr"},
    )
    assert resp.status_code == 422


def test_year_out_of_range_rejected(client, student_token):
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"year": 99},
    )
    assert resp.status_code == 422


def test_avatar_upload_without_cloudinary_configured_returns_clean_503(client, student_token):
    # The test environment intentionally has no Cloudinary credentials, so
    # this must fail loudly and clearly - never silently pretend to save
    # the image, and never a raw 500.
    jpeg_bytes = _make_jpeg()
    resp = client.post(
        "/api/profile/me/avatar",
        headers={"Authorization": f"Bearer {student_token}"},
        files={"file": ("avatar.jpg", jpeg_bytes, "image/jpeg")},
    )
    assert resp.status_code == 503
    assert "cloudinary" in resp.json()["detail"].lower() or "CLOUDINARY" in resp.text


def test_avatar_upload_rejects_non_image_file(client, student_token):
    resp = client.post(
        "/api/profile/me/avatar",
        headers={"Authorization": f"Bearer {student_token}"},
        files={"file": ("not-an-image.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400


def test_avatar_upload_rejects_oversized_dimensions(client, student_token):
    huge_jpeg = _make_jpeg(width=3000, height=3000)
    resp = client.post(
        "/api/profile/me/avatar",
        headers={"Authorization": f"Bearer {student_token}"},
        files={"file": ("huge.jpg", huge_jpeg, "image/jpeg")},
    )
    assert resp.status_code == 400


def test_avatar_upload_requires_auth(client):
    jpeg_bytes = _make_jpeg()
    resp = client.post(
        "/api/profile/me/avatar",
        files={"file": ("avatar.jpg", jpeg_bytes, "image/jpeg")},
    )
    assert resp.status_code == 401


def test_admin_cannot_set_academic_details(client, college_and_admin):
    admin_token, _ = college_and_admin
    headers = {"Authorization": f"Bearer {admin_token}"}
    for body in ({"year": 2}, {"academic_batch": "2024-2028"}, {"interests": ["AI"]}, {"department": "CSE"}):
        resp = client.put("/api/profile/me", headers=headers, json=body)
        assert resp.status_code == 400, body
    profile = client.get("/api/profile/me", headers=headers).json()
    assert profile["year"] is None
    assert profile["academic_batch"] is None
    assert profile["interests"] == []


def test_admin_can_still_update_name_and_language(client, college_and_admin):
    admin_token, _ = college_and_admin
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"full_name": "Dr. Admin Two", "preferred_language": "ta"},
    )
    assert resp.status_code == 200
    assert resp.json()["full_name"] == "Dr. Admin Two"
    assert resp.json()["preferred_language"] == "ta"


def test_student_can_still_set_academic_details(client, student_token):
    resp = client.put(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"year": 2, "academic_batch": "2024-2028", "interests": ["AI"]},
    )
    assert resp.status_code == 200
    assert resp.json()["year"] == 2
    assert resp.json()["interests"] == ["AI"]
