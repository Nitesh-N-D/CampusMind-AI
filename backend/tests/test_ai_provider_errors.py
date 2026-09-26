"""AI provider failures (timeouts, usage limits, bad keys, empty replies)
reach the user as one plain sentence, never as a generic 500 or a fake answer."""
import asyncio
import os

import httpx
import pytest

from app.services import ai_provider
from app.services.ai_provider import AIProviderError, GeminiProvider
from app.services.embedding_provider import GeminiEmbeddingProvider

SECRET = "test-key-that-must-never-leak"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def gemini_replies(monkeypatch):
    """Scripts the HTTP layer: each item is a Response or an exception to raise."""
    calls = []
    script = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append(url)
        item = script.pop(0) if len(script) > 1 else script[0]
        if isinstance(item, Exception):
            raise item
        return item

    async def no_sleep(_):
        return None

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(ai_provider.asyncio, "sleep", no_sleep)
    return script, calls


def _generate():
    return asyncio.run(GeminiProvider(SECRET, "gemini-test").generate("system", "question"))


def test_timeout_says_the_ai_took_too_long(gemini_replies):
    script, _ = gemini_replies
    script.append(httpx.ReadTimeout("timed out"))
    with pytest.raises(AIProviderError, match="took too long to answer"):
        _generate()


def test_unreachable_provider_says_it_cant_be_reached(gemini_replies):
    script, _ = gemini_replies
    script.append(httpx.ConnectError("dns failure"))
    with pytest.raises(AIProviderError, match="can't be reached"):
        _generate()


def test_usage_limit_is_retried_then_reported_plainly(gemini_replies):
    script, calls = gemini_replies
    script.append(httpx.Response(429, text=f'{{"error": "quota", "key": "{SECRET}"}}'))
    with pytest.raises(AIProviderError) as err:
        _generate()
    assert len(calls) == 3
    assert "usage limit reached" in str(err.value)
    assert SECRET not in str(err.value)


def test_recovers_when_a_retry_succeeds(gemini_replies):
    script, calls = gemini_replies
    ok = httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Dinner is at 7:30 PM."}]}}]})
    script.extend([httpx.Response(503, text="overloaded"), ok])
    assert _generate() == "Dinner is at 7:30 PM."
    assert len(calls) == 2


def test_bad_api_key_is_not_retried_and_points_to_the_admin(gemini_replies):
    script, calls = gemini_replies
    script.append(httpx.Response(403, text="API key not valid"))
    with pytest.raises(AIProviderError, match="isn't set up correctly"):
        _generate()
    assert len(calls) == 1


def test_empty_or_blocked_reply_is_an_error_not_a_fake_answer(gemini_replies):
    script, _ = gemini_replies
    script.append(httpx.Response(200, json={"candidates": [{"finishReason": "SAFETY"}]}))
    with pytest.raises(AIProviderError, match="didn't return an answer"):
        _generate()


def test_embedding_timeout_is_reported_the_same_way(gemini_replies):
    script, _ = gemini_replies
    script.append(httpx.ReadTimeout("timed out"))
    with pytest.raises(AIProviderError, match="took too long"):
        asyncio.run(GeminiEmbeddingProvider(SECRET, "embed-test").embed("hello"))


class _FailingAI:
    async def generate(self, system_prompt, user_prompt):
        raise AIProviderError("The AI service took too long to answer. Please ask again in a moment.")


def test_chat_returns_a_clear_503_and_keeps_no_half_saved_question(
    client, college_and_admin, student_token, seed_pdf_path, monkeypatch
):
    admin_token, _ = college_and_admin
    with open(os.path.join(seed_pdf_path, "hostel_rules.docx"), "rb") as f:
        client.post(
            "/api/documents/upload",
            headers=_auth(admin_token),
            files={"file": ("hostel_rules.docx", f.read(), "application/octet-stream")},
            data={"title": "Hostel Rules", "document_type": "general_notice", "is_official": "true"},
        )
    monkeypatch.setattr("app.api.chat.get_ai_provider", lambda: _FailingAI())

    resp = client.post(
        "/api/chat/message",
        headers=_auth(student_token),
        json={"message": "When is dinner served in the mess?", "session_id": None, "language": "en"},
    )
    assert resp.status_code == 503
    assert resp.json()["detail"] == "The AI service took too long to answer. Please ask again in a moment."
    assert client.get("/api/chat/sessions", headers=_auth(student_token)).json() == []


class _FailingEmbedder:
    is_semantic = True

    async def embed(self, text):
        raise AIProviderError("The AI service is busy right now (usage limit reached). Please try again in a minute.")


def test_upload_during_an_ai_outage_explains_the_file_is_fine(client, college_and_admin, monkeypatch):
    admin_token, _ = college_and_admin
    monkeypatch.setattr("app.ingestion.pipeline.get_embedding_provider", lambda: _FailingEmbedder())
    resp = client.post(
        "/api/documents/upload",
        headers=_auth(admin_token),
        files={"file": ("notice.txt", b"The library opens at 8 AM on weekdays.", "text/plain")},
        data={"title": "Library Notice", "document_type": "general_notice", "is_official": "true"},
    )
    body = resp.json()
    assert body["status"] == "failed"
    assert body["processing_error"] == (
        "Couldn't index this document: The AI service is busy right now (usage limit reached). "
        "Please try again in a minute. The file itself is fine."
    )
