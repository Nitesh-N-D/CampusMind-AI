"""
AI provider abstraction.

The RAG pipeline only ever talks to `get_ai_provider()`. Swapping
AI_PROVIDER in .env changes which backend answers questions without
touching any retrieval, trust-scoring, or citation code.
"""
from __future__ import annotations

import abc
import asyncio
from typing import AsyncGenerator

import httpx

from app.core.config import settings
from app.core.logging_config import logger


class AIProviderError(Exception):
    """The AI service couldn't produce an answer. The message is written for
    the student; the technical cause is logged, never sent to the client."""


RETRYABLE = (429, 500, 502, 503, 504)


async def _post_json(provider: str, url: str, headers: dict, payload: dict, timeout: float = 60) -> dict:
    """POST with retries on rate limits and server errors, turning every
    failure into an AIProviderError with a message a student can act on."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(3):
            try:
                resp = await client.post(url, headers=headers, json=payload)
            except httpx.TimeoutException:
                logger.warning("%s timed out after %ss", provider, timeout)
                raise AIProviderError("The AI service took too long to answer. Please ask again in a moment.")
            except httpx.HTTPError as exc:
                logger.warning("%s unreachable: %r", provider, exc)
                raise AIProviderError("The AI service can't be reached right now. Please try again in a moment.")
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in RETRYABLE and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            break

    logger.error("%s returned %s: %s", provider, resp.status_code, resp.text[:500])
    if resp.status_code == 429:
        raise AIProviderError("The AI service is busy right now (usage limit reached). Please try again in a minute.")
    if resp.status_code in (400, 401, 403, 404):
        raise AIProviderError("The AI service isn't set up correctly. Please let your college administrator know.")
    raise AIProviderError("The AI service is unavailable right now. Please try again in a moment.")


def _require_text(provider: str, text: str | None) -> str:
    if not text or not text.strip():
        logger.warning("%s returned no text", provider)
        raise AIProviderError("The AI service didn't return an answer to this question. Try rephrasing it.")
    return text


class AIProvider(abc.ABC):
    @abc.abstractmethod
    async def generate(self, system_prompt: str, user_prompt: str) -> str:
        ...

    @abc.abstractmethod
    async def stream(self, system_prompt: str, user_prompt: str) -> AsyncGenerator[str, None]:
        ...


class GeminiProvider(AIProvider):
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model or "gemini-3.5-flash"
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    async def generate(self, system_prompt: str, user_prompt: str) -> str:
        if not self.api_key:
            return await MockProvider().generate(system_prompt, user_prompt)

        url = f"{self.base_url}/{self.model}:generateContent"

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

        payload = {
            "system_instruction": {
                "parts": [
                    {"text": system_prompt}
                ]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": user_prompt}
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2
            }
        }

        data = await _post_json("Gemini", url, headers, payload)
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError):
            # e.g. the answer was blocked by a safety filter
            text = None
        return _require_text("Gemini", text)

    async def stream(
        self,
        system_prompt: str,
        user_prompt: str
    ) -> AsyncGenerator[str, None]:
        # Simple non-streaming fallback chunked into words.
        text = await self.generate(system_prompt, user_prompt)

        for word in text.split(" "):
            yield word + " "


class OpenAIProvider(AIProvider):
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model or "gpt-4o-mini"

    async def generate(self, system_prompt: str, user_prompt: str) -> str:
        if not self.api_key:
            return await MockProvider().generate(system_prompt, user_prompt)
        data = await _post_json(
            "OpenAI",
            "https://api.openai.com/v1/chat/completions",
            {"Authorization": f"Bearer {self.api_key}"},
            {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.2,
            },
        )
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            text = None
        return _require_text("OpenAI", text)

    async def stream(self, system_prompt: str, user_prompt: str) -> AsyncGenerator[str, None]:
        text = await self.generate(system_prompt, user_prompt)
        for word in text.split(" "):
            yield word + " "


class ClaudeProvider(AIProvider):
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model or "claude-sonnet-4-6"

    async def generate(self, system_prompt: str, user_prompt: str) -> str:
        if not self.api_key:
            return await MockProvider().generate(system_prompt, user_prompt)
        data = await _post_json(
            "Claude",
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
            {
                "model": self.model,
                "max_tokens": 1024,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
        )
        return _require_text("Claude", "".join(b.get("text", "") for b in data.get("content", [])))

    async def stream(self, system_prompt: str, user_prompt: str) -> AsyncGenerator[str, None]:
        text = await self.generate(system_prompt, user_prompt)
        for word in text.split(" "):
            yield word + " "


class MockProvider(AIProvider):
    """No API key configured yet. Produces a clearly-labeled offline response
    so the rest of the app (retrieval, trust scoring, citations, UI) can be
    built and demoed without a paid key."""

    async def generate(self, system_prompt: str, user_prompt: str) -> str:
        return (
            "[Offline demo mode - no AI_PROVIDER key configured]\n\n"
            "I can't generate a grounded answer without a connected AI provider, "
            "but here is the retrieved context that would normally be sent to the model:\n\n"
            f"{user_prompt[:800]}"
        )

    async def stream(self, system_prompt: str, user_prompt: str) -> AsyncGenerator[str, None]:
        text = await self.generate(system_prompt, user_prompt)
        for word in text.split(" "):
            yield word + " "


def get_ai_provider() -> AIProvider:
    provider = settings.ai_provider.lower()
    if provider == "gemini":
        return GeminiProvider(settings.gemini_api_key, settings.ai_model_name)
    if provider == "openai":
        return OpenAIProvider(settings.openai_api_key, settings.ai_model_name)
    if provider == "claude":
        return ClaudeProvider(settings.anthropic_api_key, settings.ai_model_name)
    return MockProvider()
