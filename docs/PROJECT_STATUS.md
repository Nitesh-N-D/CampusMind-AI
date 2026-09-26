# Project Status

Snapshot of CampusMind AI as of 2026-09-26. This is the state document (what
exists and what doesn't right now) — it complements, not replaces,
`ARCHITECTURE.md` (design/data-model detail) and `PROJECT_ROADMAP.md`
(feature-by-feature build log). Update this file whenever the facts below
change; don't let it drift like any other doc in this folder.

## 1. Project purpose

CampusMind AI is a multi-tenant SaaS assistant that answers student and staff
questions using a college's own official documents (regulations, circulars,
timetables, exam schedules, placement notices). It answers only from
retrieved, cited source text; every citation carries a visible 0-100 trust
score instead of being presented as ground truth; and when two official
documents disagree on the same regulated fact, it surfaces both instead of
silently picking one. Any college admin can create their own isolated
workspace, restricted to their own official email domain, without touching
code or infrastructure.

## 2. Architecture

Single FastAPI backend + single React SPA, no separate worker queue or
vector DB service (a deliberate free-tier scope choice — see
`docs/DEPLOYMENT.md` for how to graduate off it):

```
React SPA (Vite/TS/Tailwind)  <-- HTTPS/JSON -->  FastAPI backend
                                                        |
                                       +----------------+----------------+
                                       |                |                |
                                SQLite/Postgres    AI provider     Embedding provider
                                 (SQLAlchemy)      abstraction        abstraction
                                                (Gemini/OpenAI/     (Gemini/local)
                                                 Claude/mock)
```

- **Multi-tenancy**: every college-scoped table carries `college_id`; every
  query filters by the *authenticated user's* `college_id`, never a
  client-supplied one (`tests/test_auth.py` and `tests/test_login_events.py`
  verify cross-tenant isolation).
- **Roles**: admin / student / faculty. Students and faculty get chat and
  their profile only; documents, upload, conflicts, analytics, login
  activity, and settings are admin-only. Faculty sign up only on the
  admin-set faculty domain.
- **RAG** (`app/rag/pipeline.py`, `app/rag/text.py`): hybrid retrieval (BM25
  over stemmed title + heading + text, query-term coverage, embeddings),
  trust and temporal weighting (superseded docs down-weighted, not
  excluded), a relative score cutoff, abstention when nothing relevant is
  found, conflict detection, then LLM generation with citations.
- **Ingestion** (`app/ingestion/`): PDF, Word, Excel, CSV, text, and images;
  OCR (RapidOCR) for images and scanned PDF pages; heading-aware chunking;
  embeddings; trust scoring; `READY` or `FAILED` with a user-facing reason.
- **Schema upgrades**: `create_all` plus `app/db/migrations.py` at startup
  (adds new columns, drops tables of removed features). No Alembic.

Full pipeline diagrams, the data model, and the provider-abstraction
contract live in `docs/ARCHITECTURE.md` and are intentionally not
re-duplicated here to avoid drift.

## 3. Current implementation

Working end-to-end today: auth (JWT + bcrypt) with server-side RBAC across
three roles (admin/student/faculty); domain-restricted college signup with
faculty-domain gating; multi-format ingestion (PDF, .docx, .xlsx, .csv,
.txt, .jpg/.png) with OCR and trust/temporal/versioning metadata; RAG chat
with page/section citations, trust scores, and conflict banners; conflict
detection + admin resolution workflow; admin command center (Knowledge
Health score, usage analytics, conflict queue); admin login analytics
(student/faculty sign-ins and registrations, filterable by role and date
range, paginated); voice input (English/Tamil/Hindi via the Web Speech API);
Markdown conversation export; bulk drag-and-drop upload; Cloudinary-backed
profile pictures (clean 503 when unconfigured, no silent local-disk
fallback); light/dark theming via CSS custom properties; an account menu in
a consistent header; Privacy Policy/Terms pages; a global error-handling
layer (consistent single-string errors, an unhandled-exception handler that
never leaks internals, structured logging with a per-response
`X-Request-ID`).

Removed on purpose: student/faculty document browsing, the "What changed?"
page, the timeline, the search page, the command palette, and all
notifications (see `PROJECT_ROADMAP.md`).

## 4. Important files and directories

```
backend/app/
  main.py                    FastAPI app factory, router registration
  api/                       5 route modules: admin, auth, chat, documents, profile
  core/config.py             Settings (pydantic-settings, reads .env)
  core/security.py           JWT issuing/verification, password hashing
  db/models.py               SQLAlchemy models - single source of truth for
                             the data model
  db/database.py             Engine/session setup (SQLite or Postgres)
  db/migrations.py           Startup schema upgrades and removed-table drops
  rag/pipeline.py            Retrieval, scoring, generation orchestration
  rag/text.py                Tokenizer, stopwords, stemming for retrieval
  ingestion/pipeline.py      Upload -> extract -> chunk -> embed -> score
  ingestion/extractors.py    Per-format text extraction + OCR
  ingestion/chunker.py       Heading-aware, page/section-preserving chunking
  services/ai_provider.py    AI provider abstraction (Gemini/OpenAI/
                             Claude/mock)
  services/embedding_provider.py  Embedding provider abstraction
  services/trust_engine.py        Feature 1 - source trust scoring
  services/temporal_engine.py     Feature 2 - recency/supersession weighting
  services/conflict_engine.py     Feature 3 - cross-document contradiction
                                  detection
  services/cloudinary_service.py  Profile picture upload/validation
backend/tests/               conftest.py (fixtures), test_auth.py,
                             test_error_handling.py, test_faculty_domain.py,
                             test_ingestion_formats.py, test_login_events.py,
                             test_migrations.py, test_profile.py, test_rag.py,
                             test_retrieval_quality.py, test_roles.py
                             (91 tests)
backend/seed_data/           Demo documents in every supported format, all
                             labelled as fictional, plus
                             make_format_samples.py to regenerate them

frontend/src/
  App.tsx, main.tsx
  pages/                     14 pages (Landing, Login, RegisterCollege,
                             RegisterStudent, Chat, Profile, AdminDashboard,
                             AdminDocuments (+DocumentsUploadForm),
                             AdminConflicts, AdminLogins, AdminSettings,
                             Privacy, Terms, NotFound)
  layouts/                   AppShell, AuthLayout, LegalLayout
  components/                Seal (trust badge), UserMenu, ThemeToggle,
                             ToastContainer, RouteGuards, Brand, ui
  lib/                       api.ts (axios client), authStore.ts,
                             themeStore.ts, toastStore.ts,
                             exportConversation.ts
  hooks/useVoiceInput.ts     Web Speech API wrapper
  index.css                  Design system: CSS custom properties,
                             navy/paper/violet palette, dark overrides

docs/                        ARCHITECTURE.md, SETUP.md, DEPLOYMENT.md,
                             SECURITY.md, PROJECT_ROADMAP.md, this file
CLAUDE.md                    Working rules for Claude Code in this repo
```

## 5. Technologies and dependencies

**Backend** (`backend/requirements.txt`) — Python, FastAPI 0.115, Uvicorn
0.30 (standard extras), SQLAlchemy 2.0.35, Pydantic 2.9 / pydantic-settings
2.5, python-jose + bcrypt (JWT/password hashing), pypdf 4.3 (PDF text),
python-docx 1.2 (Word), openpyxl 3.1 (Excel), rapidocr-onnxruntime 1.4 +
onnxruntime 1.30 (OCR; pulls in opencv-python as a dependency), rank-bm25
0.2.2, numpy 2.4, httpx 0.27, tenacity 8.5 (retries), cloudinary 1.45 +
Pillow 12.1 (profile pictures and image handling), psycopg[binary] 3.2
(Postgres driver for production). Database: SQLite by default, Postgres via
`DATABASE_URL` with no code changes. AI/embeddings: pluggable Gemini /
OpenAI / Claude / local-mock via `AI_PROVIDER` and `EMBEDDING_PROVIDER` in
`.env`.

**Frontend** (`frontend/package.json`) — React 19.2, React Router 7.18,
Zustand 5.0 (state), Axios 1.19, Vite 8.2, TypeScript ~6.0, Tailwind CSS
v4.3 (via `@tailwindcss/vite`), oxlint 1.75 (linting).

## 6. Current progress

Verified on 2026-09-26:

- **Backend test suite: 91/91 passing** (`python -m pytest tests/ -v`):
  auth, RBAC across all three roles, faculty-domain gating, tenant
  isolation, ingestion of every supported format (including OCR and
  corrupt/renamed/empty files), retrieval quality on 14 labeled questions,
  login analytics filtering/pagination/isolation, migrations, and the
  RAG/conflict pipeline.
- **Frontend build: clean**, zero errors and zero warnings (`npm run build`).
- **Lint** (`npm run lint`): zero errors; two pre-existing
  `only-export-components` warnings (`Seal.tsx`, `Chat.tsx`).
- **Route audit**: every route in `app/api/*.py` has `get_current_user` or
  `require_role(...)` except the 3 public auth endpoints; `/api/health` in
  `main.py` is a public liveness probe.

Partially built: multilingual chat (the `language` parameter is wired
end-to-end, but real translation is untested against a live AI key); RAG
evaluation (top-citation and abstention checks only, no groundedness
scoring).

Not yet built: streaming chat responses, rate limiting on auth/chat
endpoints, email verification at signup, legacy Office formats, and a CI
pipeline.

## 7. Known issues

- **SQLAlchemy legacy API warnings**: `db.query(Model).get(id)` is still used
  in `app/api/admin.py` and `app/services/conflict_engine.py` and emits a
  `LegacyAPIWarning` under SQLAlchemy 2.0 (tests still pass; this is a
  deprecation warning, not a failure). The 2.0-native replacement is
  `db.get(Model, id)`.
- **Offline mock AI provider** produces clearly-labeled placeholder text
  when no API key is configured — expected behavior, not a bug, but chat
  answer quality requires a real Gemini/OpenAI/Claude key.
- **Offline local embedder**: retrieval quality with no embedding key comes
  from the lexical signals; chunks embedded before the title/heading
  context change keep their old vectors until re-uploaded.
- **OCR footprint**: onnxruntime and opencv add a large install; the OCR
  model loads on first use (several seconds), then stays cached.
- **`/api/health` is public** and reports the configured AI provider name
  and environment. It reveals no secrets, but consider trimming it if that
  is more than you want public.
- **SQLite default** is not appropriate for concurrent production writes;
  `DATABASE_URL` swap to Postgres is supported but not yet exercised
  against a live deployment.
- **No CI pipeline** — the test suite and frontend build are currently
  verified manually, not on every push.
- Trust/confidence scores are heuristic by design and always labeled as a
  system quality signal in the UI, never a correctness guarantee.

## 8. Commands to run / test the project

**Backend**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate   # or venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env                                # then add a Gemini key
uvicorn app.main:app --reload --port 8000           # dev server, http://localhost:8000
python -m pytest tests/ -v                          # full test suite (91 tests)
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env                                # points VITE_API_BASE_URL at the backend
npm run dev                                          # dev server, http://localhost:5173
npm run build                                        # production build; must be zero-error
npm run lint                                         # oxlint
npm run preview                                      # preview a production build locally
```
