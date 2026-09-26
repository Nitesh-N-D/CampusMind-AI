"""
Core RAG pipeline, following:

  query preprocessing -> query classification -> hybrid retrieval
  (semantic + keyword) -> metadata filtering -> trust scoring ->
  temporal weighting -> re-ranking -> conflict detection ->
  context construction -> LLM generation -> citation extraction ->
  confidence estimation -> response validation
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import List, Optional

from rank_bm25 import BM25Okapi
from sqlalchemy.orm import Session

from app.db import models
from app.rag.text import content_terms
from app.services.ai_provider import AIProvider
from app.services.conflict_engine import detect_conflicts
from app.services.embedding_provider import cosine_similarity, get_embedding_provider
from app.services.temporal_engine import temporal_weight

TOP_K_FINAL = 6
SEMANTIC_WEIGHT = 0.6
LEXICAL_EMBEDDING_WEIGHT = 0.25
PARAPHRASE_SIMILARITY = 0.75
MIN_TERM_COVERAGE = 0.5
RELATIVE_SCORE_CUTOFF = 0.5

SYSTEM_PROMPT = """You are CampusMind AI, an assistant that answers ONLY using the official \
college context provided below. Follow these rules strictly:

1. Use only the retrieved context - never invent college-specific facts, dates, names, or regulations.
2. Never fabricate a citation. Only cite [Source N] entries that are actually in the context.
3. If the context does not contain enough information to answer confidently, say so plainly \
instead of guessing.
4. If the context includes a CONFLICT NOTICE, disclose the conflict to the user instead of \
silently picking one side.
5. Do not claim something is "official" unless its source is marked official/verified in the context.
6. Keep the answer concise, clear, and written for a college student.
7. Respond in the requested response language, but keep official document titles as given.
"""


@dataclass
class RetrievedChunk:
    chunk: models.DocumentChunk
    document: models.Document
    relevance: float
    trust_score: float
    temporal_multiplier: float
    final_score: float


@dataclass
class RagResult:
    answer: str
    citations: List[dict]
    confidence: float
    has_conflict: bool
    conflicts: List[dict]
    retrieval_ms: int
    llm_ms: int
    abstained: bool


def _classify_query(query: str) -> str:
    q = query.lower()
    if any(w in q for w in ["compare", "difference between", "vs", "old and new"]):
        return "comparison"
    if any(w in q for w in ["summarize", "summary of"]):
        return "summarization"
    if any(w in q for w in ["deadline", "when is", "due date", "last date"]):
        return "temporal"
    if any(w in q for w in ["checklist", "steps to", "how do i", "what should i do"]):
        return "task"
    return "factual"


def _chunk_terms(chunk: models.DocumentChunk, doc: models.Document) -> List[str]:
    # Title and section heading count as part of every chunk: a chunk from
    # the "Curfew" section of "Hostel Rules" is about the hostel curfew even
    # if its sentences never repeat either word.
    return content_terms(f"{doc.title}\n{chunk.heading or ''}\n{chunk.content}")


async def retrieve(
    db: Session,
    college_id: int,
    query: str,
    student: Optional[models.User] = None,
    department_filter: Optional[str] = None,
) -> List[RetrievedChunk]:
    embedder = get_embedding_provider()
    query_vector = await embedder.embed(query)
    query_terms = content_terms(query)

    q = (
        db.query(models.DocumentChunk, models.Document)
        .join(models.Document, models.DocumentChunk.document_id == models.Document.id)
        .filter(models.DocumentChunk.college_id == college_id)
        # READY docs are the current knowledge base. ARCHIVED docs (superseded
        # by a newer version) stay eligible too, so conflict detection can
        # still see them - temporal_weight() below heavily deprioritizes them
        # rather than hiding them outright.
        .filter(
            models.Document.status.in_(
                [models.DocumentStatus.READY, models.DocumentStatus.ARCHIVED]
            )
        )
    )
    if department_filter:
        q = q.filter(
            (models.Document.department == department_filter)
            | (models.Document.department.is_(None))
        )
    rows = q.limit(2000).all()
    if not rows:
        return []

    # --- Keyword search (BM25 over stemmed content terms) ---
    corpus = [_chunk_terms(chunk, doc) for chunk, doc in rows]
    bm25 = BM25Okapi(corpus)
    bm25_scores = bm25.get_scores(query_terms) if query_terms else [0.0] * len(rows)
    max_bm25 = max(bm25_scores)
    unique_query_terms = set(query_terms)

    # The local vectorizer only measures word overlap (stopwords included),
    # so it gets a small say; real embedding models capture meaning and lead.
    semantic_weight = SEMANTIC_WEIGHT if embedder.is_semantic else LEXICAL_EMBEDDING_WEIGHT

    candidates: List[RetrievedChunk] = []
    for (chunk, doc), terms, bm25_score in zip(rows, corpus, bm25_scores):
        # --- Semantic search ---
        semantic = max(0.0, cosine_similarity(query_vector, chunk.embedding or []))
        keyword_norm = bm25_score / max_bm25 if max_bm25 > 0 else 0.0
        # Share of the question's terms this chunk actually contains - keeps
        # one rare word from outranking a chunk that answers the whole question.
        coverage = len(unique_query_terms & set(terms)) / len(unique_query_terms) if unique_query_terms else 0.0

        # Off-topic filter: a chunk must contain at least half of the
        # question's terms, unless a semantic model finds it a close
        # paraphrase. Sharing one word ("fee" in "parking fee for staff cars")
        # isn't evidence - and embedding models score every chunk from the
        # same college 0.55-0.70, so raw similarity alone can't be either.
        if coverage < MIN_TERM_COVERAGE and not (embedder.is_semantic and semantic >= PARAPHRASE_SIMILARITY):
            continue

        keyword = 0.6 * keyword_norm + 0.4 * coverage
        relevance = semantic_weight * semantic + (1 - semantic_weight) * keyword

        # Feature 4: personalization boost - prefer the student's own
        # department/year/semester when the document specifies one
        if student:
            if doc.department and student.department and doc.department == student.department:
                relevance += 0.08
            if doc.semester and student.semester and doc.semester == student.semester:
                relevance += 0.04

        temporal_mult = temporal_weight(doc)
        trust_component = (doc.trust_score or 50.0) / 100.0

        final_score = relevance * temporal_mult * (0.6 + 0.4 * trust_component)

        candidates.append(
            RetrievedChunk(
                chunk=chunk,
                document=doc,
                relevance=round(relevance, 4),
                trust_score=doc.trust_score or 50.0,
                temporal_multiplier=temporal_mult,
                final_score=round(final_score, 4),
            )
        )

    if not candidates:
        return []
    candidates.sort(key=lambda c: c.final_score, reverse=True)
    # Drop the long tail: chunks far weaker than the best match are noise in
    # the context and in the citations. Archived versions of the top document
    # are exempt so superseded-regulation conflicts are still detected.
    best = candidates[0]
    floor = best.final_score * RELATIVE_SCORE_CUTOFF
    kept = [
        c
        for c in candidates
        if c.final_score >= floor
        or (c.document.id == best.document.supersedes_id and c.relevance >= best.relevance * RELATIVE_SCORE_CUTOFF)
    ]
    return kept[:TOP_K_FINAL]


def _build_context(results: List[RetrievedChunk], conflicts: List[models.DocumentConflict]) -> str:
    parts = []
    for i, r in enumerate(results, start=1):
        location = f"page {r.chunk.page_number}" if r.chunk.page_number else f"section: {r.chunk.section or 'main'}"
        parts.append(
            f"[Source {i}] \"{r.document.title}\" ({location}, "
            f"department: {r.document.department or 'general'}, "
            f"official: {r.document.is_official}, verified: {r.document.is_verified}, "
            f"trust: {r.trust_score}/100)\n{r.chunk.content}"
        )
    if conflicts:
        for c in conflicts:
            parts.append(
                f"[CONFLICT NOTICE] Regarding '{c.topic}': one source states '{c.value_a}', "
                f"another states '{c.value_b}'. {c.reasoning}"
            )
    return "\n\n".join(parts)


def _estimate_confidence(results: List[RetrievedChunk], has_conflict: bool) -> float:
    if not results:
        return 0.0
    avg_relevance = sum(r.relevance for r in results[:3]) / min(3, len(results))
    avg_trust = sum(r.trust_score for r in results[:3]) / min(3, len(results)) / 100.0
    confidence = 0.55 * avg_relevance + 0.45 * avg_trust
    if has_conflict:
        confidence *= 0.7
    return round(max(0.0, min(1.0, confidence)) * 100, 1)


async def answer_question(
    db: Session,
    college_id: int,
    query: str,
    ai: AIProvider,
    student: Optional[models.User] = None,
    response_language: str = "en",
) -> RagResult:
    t0 = time.perf_counter()
    query_type = _classify_query(query)
    department_filter = student.department if student else None
    results = await retrieve(db, college_id, query, student, department_filter)
    retrieval_ms = int((time.perf_counter() - t0) * 1000)

    if not results:
        return RagResult(
            answer=(
                "I don't have sufficient verified information in the college knowledge "
                "base to answer that yet. Try rephrasing, or check back once the relevant "
                "document has been uploaded."
            ),
            citations=[],
            confidence=0.0,
            has_conflict=False,
            conflicts=[],
            retrieval_ms=retrieval_ms,
            llm_ms=0,
            abstained=True,
        )

    conflicts = detect_conflicts(db, college_id, [r.chunk for r in results])
    db.commit()

    context = _build_context(results, conflicts)
    confidence = _estimate_confidence(results, bool(conflicts))

    user_prompt = (
        f"Query type: {query_type}\n"
        f"Response language: {response_language}\n"
        f"Student context: department={getattr(student, 'department', None)}, "
        f"year={getattr(student, 'year', None)}\n\n"
        f"Retrieved context:\n{context}\n\n"
        f"Student question: {query}\n\n"
        "Answer using ONLY the sources above, citing them as [Source N]."
    )

    t1 = time.perf_counter()
    abstained = confidence < 25.0
    if abstained:
        answer = (
            "I found some related material, but it isn't reliable or specific enough for me "
            "to give you a confident answer. I'd rather say that than guess - please check with "
            "your department office, or try a more specific question."
        )
    else:
        answer = await ai.generate(SYSTEM_PROMPT, user_prompt)
    llm_ms = int((time.perf_counter() - t1) * 1000)

    citations = [
        {
            "document_id": r.document.id,
            "document_title": r.document.title,
            "page": r.chunk.page_number,
            "section": r.chunk.section,
            "trust_level": r.document.trust_level.value if r.document.trust_level else None,
            "trust_score": r.trust_score,
            "department": r.document.department,
        }
        for r in results
    ]

    return RagResult(
        answer=answer,
        citations=citations,
        confidence=confidence,
        has_conflict=bool(conflicts),
        conflicts=[
            {
                "id": c.id,
                "topic": c.topic,
                "value_a": c.value_a,
                "value_b": c.value_b,
                "reasoning": c.reasoning,
            }
            for c in conflicts
        ],
        retrieval_ms=retrieval_ms,
        llm_ms=llm_ms,
        abstained=abstained,
    )
