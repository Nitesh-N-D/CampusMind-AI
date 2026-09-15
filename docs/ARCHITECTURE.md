# Architecture

## System overview

```
+------------------+        HTTPS/JSON        +------------------------+
|  React SPA       | ------------------------> |  FastAPI backend        |
|  (Vite, TS,      | <------------------------ |  (single service)       |
|  Tailwind)        |                           |                         |
+------------------+                           +-----------+-------------+
                                                            |
                                    +-----------------------+----------------------+
                                    |                        |                      |
                          +---------v-------+   +------------v---------+  +---------v----------+
                          |  SQLite /        |   |  AI provider          |  |  Embedding provider |
                          |  Postgres        |   |  abstraction          |  |  abstraction         |
                          |  (SQLAlchemy)    |   |  Gemini/OpenAI/       |  |  Gemini/local TF-IDF |
                          +-----------------+   |  Claude/mock          |  +---------------------+
                                                 +-----------------------+
```

Everything runs as one FastAPI process for the free-tier MVP - no separate
worker queue, no vector database service. This is a deliberate scope choice
(see "Free-tier constraint" below), not an oversight; `DEPLOYMENT.md`
explains how to graduate off it.

## Multi-tenancy model

Every table that holds college-specific data carries a `college_id` foreign
key (`documents`, `document_chunks`, `chat_sessions`, `notifications`,
`document_conflicts`, `search_logs`, ...). Every query in `app/api/*.py` and
`app/rag/pipeline.py` filters by the **authenticated user's** `college_id` -
never a client-supplied one. This is what
`tests/test_auth.py::test_token_from_one_college_cannot_see_another_colleges_data`
verifies: College B's admin token returns zero documents from College A.

Signup is domain-restricted: `POST /api/auth/register-college` captures an
`official_domain` (e.g. `mitindia.edu`), and `POST /api/auth/register-student`
rejects any email whose domain doesn't match that college's domain. Roles
(`admin` / `student`) are stored server-side on the `users` row and
re-checked via `require_role()` on every protected endpoint - the frontend
never gets to assert its own role.

## RAG pipeline (`app/rag/pipeline.py`)

```
User question
  |
  v
Query embedding (embedding provider abstraction)
  |
  v
Candidate retrieval, scoped to college_id
  |-- BM25 keyword search over chunk text
  `-- Cosine similarity over chunk embeddings
  |
  v
Score fusion (weighted hybrid rank)
  |
  v
Trust scoring per chunk's parent document      (Feature 1 - trust_engine.py)
  |
  v
Temporal weighting                              (Feature 2 - temporal_engine.py)
  |   superseded/expired docs stay eligible but are heavily
  |   down-weighted rather than hard-excluded, so conflict
  |   detection and "what changed" can still see them
  v
Conflict detection across top candidates        (Feature 3 - conflict_engine.py)
  |   persists a DocumentConflict row + admin notification
  |   the first time a topic-level contradiction is found
  v
Context construction (top-K chunks, citations attached)
  |
  v
LLM generation (AI provider abstraction), strict grounding system prompt
  |
  v
Confidence estimate + abstention check
  |
  v
Final answer + citations + conflict banner (if any)
```

### Why superseded documents stay in the retrieval pool

An earlier version of this pipeline hard-excluded any document with
`status = ARCHIVED` from retrieval. That broke conflict detection: once a
newer regulation superseded an older one, the older one was archived and
therefore never retrieved, so the two versions could never be compared and
the "conflicting sources" banner never fired. The fix (see `rag/pipeline.py`)
includes `ARCHIVED` documents in the candidate pool and lets
`temporal_weight()` push them down in ranking instead, which is what
Feature 2 was already designed to do. This is the kind of interaction
between features that only shows up when you actually run the pipeline
end-to-end, not when you read each feature's code in isolation.

## Ingestion pipeline (`app/ingestion/pipeline.py`)

```
PDF upload (admin only, RBAC-checked)
  |
  v
File type + size validation
  |
  v
Text extraction (pypdf) + OCR fallback for scanned pages
  |
  v
Heading detection, page-preserving chunking
  |
  v
Embedding generation per chunk
  |
  v
Trust scoring (officiality, verification, recency, doc type)
  |
  v
Event/deadline extraction -> timeline entries              (Feature 6)
  |
  v
If `supersedes_id` set: diff old vs new, generate
"what changed" impact summary, archive the old version      (Feature 7)
  |
  v
Notifications: broadcast "new document" (students) or
"regulation updated" with the diff (students); conflict_engine
separately notifies admins if a contradiction is found on
the next relevant chat query
  |
  v
status = READY (or FAILED with a stored, user-facing
processing_error - ingestion failures are caught and
reported, never allowed to bubble up as a raw 500)
```

## Data model (selected tables)

- `colleges` - one row per tenant workspace, holds `official_domain`
- `users` - `role` (admin/student), `college_id`, personalization fields
- `documents` - trust/temporal/versioning metadata, `supersedes_id` self-FK
- `document_chunks` - page/section-tagged text + embedding vector
- `document_conflicts` - persisted contradictions awaiting admin resolution
- `change_logs` - old value -> new value -> impact summary, per topic
- `timeline_events` - extracted dates, categorized, filterable
- `notifications` - `target_role` nullable (null = everyone), college-scoped
- `search_logs` - query + top confidence, feeds Knowledge Health's
  low-confidence-topics metric

Full column-level detail is readable directly in `backend/app/db/models.py`
- it's the single source of truth and this document intentionally doesn't
duplicate every field, since that duplication would drift out of sync.

## Provider abstraction

`app/services/ai_provider.py` and `app/services/embedding_provider.py` each
expose a common interface (`generate`/`stream`, `embed`) with concrete
implementations for Gemini, OpenAI, Claude, and a local/mock fallback. The
active provider is chosen entirely by `AI_PROVIDER` / `EMBEDDING_PROVIDER`
in `.env` - no code changes needed to switch. When no API key is configured,
`MockProvider` returns a clearly-labeled offline response rather than
fabricating one, so the rest of the app is fully testable without a paid key.

## Free-tier constraint

Everything above runs on:
- **Frontend**: any static host (Vercel free tier, Netlify, GitHub Pages)
- **Backend**: a single small instance (Render/Fly.io free tier) - no
  worker queue, no message broker
- **Database**: SQLite by default; swap `DATABASE_URL` for Supabase/Postgres
  with zero code changes (SQLAlchemy handles the dialect difference; the one
  Postgres-only construct that slipped in during development - `DISTINCT
  ON` in the analytics query - was found by the test suite running against
  SQLite and replaced with a portable `COUNT(DISTINCT ...)`)
- **AI**: Gemini free tier

See `docs/DEPLOYMENT.md` for the concrete steps.
