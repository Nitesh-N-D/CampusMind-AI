"""
Embedding provider abstraction. Swappable the same way as AIProvider.

`local` uses a deterministic hashing-based bag-of-words vectorizer so the
whole ingestion + retrieval pipeline works with zero external calls and zero
cost during development. Swap EMBEDDING_PROVIDER=gemini/openai in .env for
real semantic embeddings in production - nothing else in the pipeline changes
because both paths return a plain list[float] of the same declared dimension.
"""
from __future__ import annotations

import abc
import hashlib
import math
import re
from typing import List

from app.core.config import settings
from app.services.ai_provider import AIProviderError, _post_json

LOCAL_DIM = 384


class EmbeddingProvider(abc.ABC):
    dimension: int
    # False when vectors only capture word overlap (the local hashing
    # vectorizer) - retrieval then leans on keyword scoring instead.
    is_semantic: bool = True

    @abc.abstractmethod
    async def embed(self, text: str) -> List[float]:
        ...


class LocalEmbeddingProvider(EmbeddingProvider):
    """Hashing-trick vectorizer: stable, offline, good enough to demonstrate
    the retrieval pipeline end-to-end. Not a substitute for a real semantic
    embedding model in production."""

    dimension = LOCAL_DIM
    is_semantic = False

    def _tokenize(self, text: str) -> List[str]:
        return re.findall(r"[a-zA-Z0-9%]+", text.lower())

    async def embed(self, text: str) -> List[float]:
        vec = [0.0] * self.dimension
        tokens = self._tokenize(text)
        for tok in tokens:
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            idx = h % self.dimension
            sign = 1.0 if (h // self.dimension) % 2 == 0 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


class GeminiEmbeddingProvider(EmbeddingProvider):
    dimension = 768

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        # Without a key every call falls back to the local vectorizer.
        self.is_semantic = bool(api_key)
        self.model = model or "gemini-embedding-2"

    async def embed(self, text: str) -> List[float]:
        if not self.api_key:
            return await LocalEmbeddingProvider().embed(text)

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:embedContent"
        )

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }

        payload = {
            "content": {
                "parts": [
                    {"text": text}
                ]
            },
            "output_dimensionality": self.dimension,
        }

        data = await _post_json("Gemini embeddings", url, headers, payload, timeout=30)
        try:
            return data["embedding"]["values"]
        except (KeyError, TypeError):
            raise AIProviderError("The AI service returned an unreadable response. Please try again.")


class OpenAIEmbeddingProvider(EmbeddingProvider):
    dimension = 1536

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        # Without a key every call falls back to the local vectorizer.
        self.is_semantic = bool(api_key)
        self.model = model or "text-embedding-3-small"

    async def embed(self, text: str) -> List[float]:
        if not self.api_key:
            return await LocalEmbeddingProvider().embed(text)
        data = await _post_json(
            "OpenAI embeddings",
            "https://api.openai.com/v1/embeddings",
            {"Authorization": f"Bearer {self.api_key}"},
            {"model": self.model, "input": text},
            timeout=30,
        )
        try:
            return data["data"][0]["embedding"]
        except (KeyError, IndexError, TypeError):
            raise AIProviderError("The AI service returned an unreadable response. Please try again.")


def get_embedding_provider() -> EmbeddingProvider:
    provider = settings.embedding_provider.lower()
    if provider == "gemini":
        return GeminiEmbeddingProvider(settings.gemini_api_key, settings.embedding_model_name)
    if provider == "openai":
        return OpenAIEmbeddingProvider(settings.openai_api_key, settings.embedding_model_name)
    return LocalEmbeddingProvider()


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a)) or 1.0
    norm_b = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (norm_a * norm_b)
