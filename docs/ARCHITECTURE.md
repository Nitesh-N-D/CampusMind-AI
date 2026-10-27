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
`official_domain` (e.g. `greenfield.edu`), and `POST /api/auth/register-student`
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

## Error handling

Every error response is `{"detail": "<one plain sentence>"}`, plus a
`request_id` on 5xx responses that matches the `X-Request-ID` header and the
server log line.

| Failure | Status | Where it's handled |
|---|---|---|
| Validation error | 422 | `validation_exception_handler` in `app/main.py` |
| Expired, tampered, or orphaned token | 401 | `get_current_user`: one message, "Your session has expired. Please sign in again." |
| Wrong role | 403 | `require_role`: says who the page is for |
| AI provider timeout, usage limit, bad key, empty/blocked reply | 503 | `AIProviderError` from `app/services/ai_provider.py` (`_post_json` retries 429/5xx twice) |
| Database unreachable | 503 | `OperationalError` handler in `app/main.py` |
| Anything else | 500 | Generic message; the stack trace goes only to the log |

A chat question is written to the database only after the answer exists, so
a failed AI call leaves no half-saved conversation. Upload failures never
return an error status; the document is marked `failed` with a
`processing_error` the admin can read.

In the browser, `src/lib/api.ts` turns every failure into an `ApiError` with
a readable message: no response at all (server down, offline, CORS) becomes
"Can't reach the CampusMind server", non-JSON error pages get a message
chosen by status (413, 429, 502-504), 5xx messages carry the reference ID,
and a 401 on a signed-in request signs the user out with a toast explaining
why.

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

## Document-scoped chat

`POST /api/chat/message` accepts an optional `document_id`. When present:

- The backend validates it (same college; students also limited to their department or college-wide documents; document must be processed and have text). Anything else is a 404/409, never a fallback to all documents.
- `rag.pipeline.retrieve` adds `document_chunks.document_id = :id` to the candidate query, so scoring and top-k run only inside that document. Conflict detection (which compares across documents) is skipped.
- A dedicated system prompt allows answers only from the excerpts and mandates the reply "The selected document does not contain enough information to answer this question." when they are insufficient.
- `GET /api/chat/documents` lists the documents the caller may scope to. The chat UI no longer has a selector: the relevant document is found automatically from the question (see below). `document_id` remains a validated API option.

Schema: `document_chunks` has a unique index on `(document_id, chunk_index)` (created by `create_all` for new databases and by `app/db/migrations.py` at startup for existing ones; skipped with a warning if legacy duplicates exist). Re-processing a document deletes and rebuilds only its own chunks; deleting a document cascades to its chunks.

## Answerability and conversation memory

Every assistant message carries `answer_status` (`answered` | `insufficient_evidence`) and `basis` (`documents` | `conversation` | null), persisted on `chat_messages` (`answer_status`, `answer_basis`; added by the startup migration).

- **Insufficient evidence.** If no relevant passages survive retrieval (term-coverage and relative-score cutoffs, then a minimum confidence), or the model replies `INSUFFICIENT_EVIDENCE` (or a refusal that cites nothing), the pipeline returns one short fixed message (`FALLBACK_MESSAGE`, en/ta/hi) with `citations = []`, confidence 0, no conflicts and `abstained = true`. Sources are dropped in the backend, not hidden in the UI, so nothing from a previous message or a rejected candidate can appear.
- **Follow-ups.** The last 6 messages of the current conversation (clipped) are loaded server-side. A message that leans on them ("From which places?", "explain it more") is rewritten into a standalone question by the model; without one (mock provider, or a failed call) the previous question is prepended. A message that is already self-contained is left alone.
- **Memory.** Relevant turns from the same user's *other* conversations are found by keyword coverage over their most recent 400 messages (always filtered by `chat_sessions.user_id`), at most 3, shown oldest-first with the newest marked "(most recent)" and an instruction that the latest statement wins. The current conversation takes priority because it is passed separately.
- **Separation.** History and memory are prompt context only: labelled "NOT evidence about college documents", never cited, and never converted into citations. An answer resting only on conversation has `basis = conversation` and no sources or trust indicator. Memory lookups are skipped for document-scoped questions.
- **Ownership.** Sessions are looked up by `(id, user_id)`; another user's session id is a 404, and memory never crosses users or colleges.

## Question understanding (`app/rag/analysis.py`)

Before retrieval, the resolved question (follow-ups already rewritten, translated to English for retrieval) is turned into a `QuestionPlan`. It is rule-based: no extra model call, no added cost, and it describes the question without ever supplying facts.

| Field | Meaning |
| --- | --- |
| `intent` | count, list, factual, temporal, location, definition, explanation, why, task (how-to), comparison, summarization, eligibility, conditional, numerical |
| `breadth` | `narrow` (one fact: 6 chunks), `enumerate` (count/list: up to 24 chunks, looser relative cutoff, so every matching record reaches the model), `broad` (summary, comparison, "complete/in detail": 12 chunks) |
| `parts` | several questions in one message, split on `?`, `;` and "and <wh-word>" |
| `sides` | the two things compared ("Compare A and B", "difference between A and B", "A vs B") |
| `calculation` | the answer needs arithmetic |

`retrieve_for_plan` follows the plan. A single question gets one search sized by its breadth. A comparison or multi-part message gets one search per side/part, interleaved so none is crowded out; sides/parts with nothing relevant are named in the prompt so the model answers the supported ones and says what is missing. Each search keeps the existing term-coverage and document-level relevance cutoffs, so extra breadth never admits an unrelated document. Command words ("list", "explain") and operation words ("total", "average") are optional search terms when no document contains them; subject words never are.

The prompt carries the intent's answer-style rule plus per-plan lines (compare these on the same attributes, answer each part separately, show the working and never estimate a missing value, use all retrieved records when counting). A message with no content words and no conversation to borrow from ("tell me") gets a short clarifying question back; the model can do the same by replying `CLARIFY: <question>`. Clarifications carry no sources and no trust rating.

Ingestion keeps meaning: spreadsheet and Word-table rows are indexed as self-contained sentences that carry their column headers, sheet/section headings are stored per chunk, and chunk overlap repeats whole trailing sentences (rows), never a fragment.

Source list (frontend): `AnswerBlock` shows up to two sources and a "See more"/"See less" toggle beyond that, with state per answer. It only affects presentation; the source list itself is chosen by the backend. No Sources section and no trust meter render for an unanswered reply.


### Exact counts over tables (`app/rag/aggregation.py`)

Spreadsheet and table rows are ingested as one "Header: value; ..." sentence each. For a `count` question the model is not left to count the (capped) retrieved chunks: the best-matching document's chunks are all read, rows are de-duplicated (chunks overlap), and the exact total is put in the prompt ("Exact record count ... N"). Up to 150 rows the full row list is included too, so filtered counts ("routes from Tambaram") are exact; beyond that only the total is given and the model is told a filtered figure can't be confirmed. Documents that are mostly prose are not treated as tables. Limitation: word-for-word identical rows count once.

### Other answer-handling rules

* Calculations over several values ("total of the transport fee and the hostel fee") search each operand separately and use a looser document-level cutoff, so every document holding a figure is retrieved.
* A multi-part reply where the model marks only some parts `INSUFFICIENT_EVIDENCE` keeps the supported (cited) parts and replaces the marker with "(not found in the available documents)"; only a reply with nothing supported becomes the fallback.
* A first-person remark ("I take bus route R6") is acknowledged without a search or model call; it stays in the chat history for later questions.
* Conflict detection compares fee amounts only between fees of the same kind (a transport fee and a hostel fee are not a conflict).
