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
key (`documents`, `document_chunks`, `chat_sessions`, `document_conflicts`,
`search_logs`, `login_events`, ...). Every query in `app/api/*.py` and
`app/rag/pipeline.py` filters by the **authenticated user's** `college_id` -
never a client-supplied one. This is what
`tests/test_auth.py::test_token_from_one_college_cannot_see_another_colleges_data`
verifies: College B's admin token returns zero documents from College A.

Signup is domain-restricted: `POST /api/auth/register-college` captures an
`official_domain` (e.g. `mitindia.edu`), and `POST /api/auth/register-student`
rejects any email whose domain doesn't match that college's domain. Faculty
are matched only against the college's admin-set `faculty_domain`; while it
is unset, faculty signup at that college is closed. Roles
(`admin` / `student` / `faculty`) are stored server-side on the `users` row
and re-checked via `require_role()` on every protected endpoint - the
frontend never gets to assert its own role. The document library, upload,
conflicts, analytics, login log, and settings endpoints are admin-only;
students and faculty reach documents only through chat citations.

Every successful student/faculty login and registration writes a
`login_events` row (admin logins are not recorded). `GET
/api/admin/login-events` returns them newest first, filtered by role and a
`[start, end)` date range, paginated, and always scoped to the admin's own
college.

## RAG pipeline (`app/rag/pipeline.py`)

```
User question
  |
  v
Query embedding (embedding provider abstraction)
  |
  v
Candidate retrieval, scoped to college_id
  |-- BM25 over stemmed content terms of title + section heading + text
  |   (rag/text.py: tokenizer, stopwords, light suffix folding)
  |-- Query-term coverage (share of the question's terms a chunk contains)
  `-- Cosine similarity over chunk embeddings
  |   chunks containing under half of the query terms are dropped
  |   unless a real semantic embedder rates them a close paraphrase
  |   (cosine >= 0.75); one shared word like "fee" is not evidence
  v
Score fusion: keyword = 0.6 BM25 + 0.4 coverage; semantic weight
depends on the provider (lower for the offline local embedder)
  |
  v
Trust scoring per chunk's parent document      (Feature 1 - trust_engine.py)
  |
  v
Temporal weighting                              (Feature 2 - temporal_engine.py)
  |   superseded/expired docs stay eligible but are heavily
  |   down-weighted rather than hard-excluded, so conflict
  |   detection can still see them
  v
Relative cutoff: drop candidates below half the best score
(the superseding pair is kept); no candidates -> abstain
  |
  v
Conflict detection across top candidates        (Feature 3 - conflict_engine.py)
  |   persists a DocumentConflict row the first time a
  |   topic-level contradiction is found; it appears on the
  |   admin Conflicts page
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
Upload (admin only, RBAC-checked)
  |
  v
Validation: supported extension, non-empty, size limit, magic bytes
match the extension (renamed files rejected), `supersedes_id` must
belong to the same college
  |
  v
Text extraction (app/ingestion/extractors.py), one function per format:
  PDF   pypdf per page; pages with little text have their embedded
        images OCR'd (RapidOCR)
  Word  python-docx, split into sections by heading; tables become
        "Header: value" sentences
  Excel openpyxl, one section per sheet, rows as sentences
  PPTX  python-pptx, one section per slide ("Slide N: title"): text,
        tables, grouped shapes, speaker notes; picture-only slides
        are OCR'd
  CSV   sniffed delimiter, utf-8/BOM/utf-16/cp1252
  Text  split on markdown or title-like headings
  Image RapidOCR
  |
  v
Heading-aware chunking; PDFs keep page numbers, other formats
cite the section (heading or sheet name)
  |
  v
Embedding generation per chunk (title + heading + text)
  |
  v
Trust scoring (officiality, verification, recency, doc type)
  |
  v
If `supersedes_id` set: archive the old version (same college only)
  |
  v
status = READY (or FAILED with a stored, user-facing
processing_error - ingestion failures are caught and
reported, never allowed to bubble up as a raw 500)
```

## Data model (selected tables)

- `colleges` - one row per tenant workspace, holds `official_domain` and
  the optional admin-set `faculty_domain`
- `users` - `role` (admin/student/faculty), `college_id`, personalization fields
- `documents` - trust/temporal/versioning metadata, `supersedes_id` self-FK
- `document_chunks` - page/section-tagged text + embedding vector
  (`page_number` is null for non-paginated formats)
- `document_conflicts` - persisted contradictions awaiting admin resolution
- `search_logs` - question + top confidence, feeds Knowledge Health's
  low-confidence-topics metric and the most-asked list
- `login_events` - user, role, `login`/`register`, timestamp; the admin
  login log

There is no Alembic. Tables are created with `create_all`, and
`app/db/migrations.py` runs at startup to add columns introduced since a
database was created and to drop the tables of removed features
(`notifications`, `extracted_events`, `document_change_logs`), deleting any
rows they still hold.

Full column-level detail is readable directly in `backend/app/db/models.py`
- it's the single source of truth and this document intentionally doesn't
duplicate every field, since that duplication would drift out of sync.

## Exports

- `app/services/chat_export.py` builds a user's chat history as plain text
  or PDF (fpdf2). The PDF embeds IBM Plex from the design system, with Noto
  Sans Tamil/Devanagari as fallback fonts and HarfBuzz text shaping so
  Tamil and Hindi answers render correctly. Fonts live in
  `app/assets/fonts/` with their SIL OFL licences.
- `app/services/user_export.py` builds the admin account list as CSV (UTF-8
  with BOM so Excel detects the encoding) or `.xlsx` (openpyxl, write-only).
  Last login is the latest `login_events` row of type `login`.
- Timestamps are stored in UTC. Both endpoints take `tz_offset` (minutes
  east of UTC, sent by the browser) and label every time column with the
  offset used, e.g. `UTC+05:30`.

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
