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

        async with httpx.AsyncClient(timeout=60) as client:
            last_response = None

            for attempt in range(3):
                resp = await client.post(
                    url,
                    headers=headers,
                    json=payload,
                )

                last_response = resp

                # Successful response
                if resp.status_code == 200:
                    data = resp.json()

                    try:
                        return data["candidates"][0]["content"]["parts"][0]["text"]
                    except (KeyError, IndexError, TypeError):
                        return "Gemini returned an unexpected response format."

                # Retry temporary server/rate-limit errors
                if resp.status_code in (429, 500, 502, 503, 504):
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                        continue

                # Permanent/error response
                break

            # IMPORTANT:
            # Show Gemini's actual error message, but never show the API key.
            error_body = last_response.text if last_response is not None else "No response"

            raise RuntimeError(
                f"Gemini API error {last_response.status_code if last_response else 'unknown'}: "
                f"{error_body}"
            )

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
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.2,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

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
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": self.model,
                    "max_tokens": 1024,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_prompt}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return "".join(b.get("text", "") for b in data.get("content", []))

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
