"""The fee-amount pattern must see through ordinary wording between 'fee'
and the amount. It used to skip any word containing an 's' or 'R' (as in
'fee is Rs. 450'), so those conflicts were never detected."""
import pytest

from app.services.conflict_engine import TOPIC_PATTERNS


@pytest.mark.parametrize(
    "text, value",
    [
        ("Library membership fee is Rs. 450 per year.", "450"),
        ("The semester exam fee: Rs. 1500", "1500"),
        ("Hostel fees are payable, amount ₹12,000 annually", "12,000"),
        ("Late fee for this semester shall be Rs 500.", "500"),
    ],
)
def test_fee_amount_found_through_ordinary_words(text, value):
    m = TOPIC_PATTERNS["fee_amount"].search(text)
    assert m and m.group(1) == value


def test_fee_pattern_does_not_cross_sentences():
    assert TOPIC_PATTERNS["fee_amount"].search("No fee applies. Rs. 500 is a prize.") is None


# --- visiting hours -------------------------------------------------------

def _visiting(text):
    m = TOPIC_PATTERNS["visiting_hours"].search(text) if "visiting_hours" in TOPIC_PATTERNS else None
    return m.group(1) if m else None


@pytest.mark.parametrize(
    "text, value",
    [
        ("Visiting hours for parents are 10 AM to 12 noon on Sundays.", "10 AM to 12 noon"),
        ("Visiting hours are 4 PM to 6 PM on Saturdays.", "4 PM to 6 PM"),
        ("Hostel visitors hours: 5:30 pm - 7:00 pm", "5:30 pm - 7:00 pm"),
    ],
)
def test_visiting_hours_range_is_extracted(text, value):
    assert _visiting(text) == value


@pytest.mark.parametrize(
    "text",
    [
        "Visiting hours are listed on the notice board. The library is open 9 AM to 5 PM.",
        "Visiting the dean is allowed on request.",
        "Library hours are 9 AM to 5 PM.",
    ],
)
def test_visiting_hours_does_not_cross_sentences_or_match_other_topics(text):
    assert _visiting(text) is None


def _upload_txt(client, token, title, body, effective_date):
    resp = client.post(
        "/api/documents/upload",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": (title.replace(" ", "_") + ".txt", body.encode(), "text/plain")},
        data={"title": title, "document_type": "circular", "is_official": "true", "effective_date": effective_date},
    )
    assert resp.status_code == 200, resp.text


def test_contradictory_visiting_hours_are_flagged_in_chat(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    _upload_txt(client, admin_token, "Hostel Visiting Notice A", "Visiting hours for parents are 10 AM to 12 noon on Sundays.", "2026-02-01")
    _upload_txt(client, admin_token, "Hostel Visiting Notice B", "Visiting hours for parents are 4 PM to 6 PM on Saturdays.", "2026-03-01")
    resp = client.post(
        "/api/chat/message",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"message": "What are the parent visiting hours?", "language": "en"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_conflict"] is True
    assert any("visiting hours" in c["topic"] for c in body["conflicts"])


def test_matching_visiting_hours_are_not_a_conflict(client, college_and_admin, student_token):
    admin_token, _ = college_and_admin
    _upload_txt(client, admin_token, "Hostel Visiting Notice A", "Visiting hours for parents are 4 PM to 6 PM on Saturdays.", "2026-02-01")
    _upload_txt(client, admin_token, "Hostel Visiting Notice B", "Visiting hours are 4 PM to 6 PM on Saturdays for parents.", "2026-03-01")
    resp = client.post(
        "/api/chat/message",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"message": "What are the parent visiting hours?", "language": "en"},
    )
    assert resp.status_code == 200
    assert resp.json()["has_conflict"] is False
