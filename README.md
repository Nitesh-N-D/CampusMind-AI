# CampusMind AI

AI-powered smart college assistant. CampusMind AI answers student and staff
questions using a college's own official documents - regulations, circulars,
timetables, exam schedules, placement notices - with page- or section-level
citations and a visible, honestly-labeled trust score. It never invents a
fact it can't cite, and when two official sources disagree, it says so
instead of silently picking one.

It's built as **multi-tenant SaaS**: any college admin can spin up their own
private workspace in minutes, restricted to their own official email domain,
without touching code or infrastructure.

---

## Why this isn't "ChatGPT with a college logo"

| Feature | What it actually does |
|---|---|
| **Source-Trust Engine** | Every document gets a transparent 0-100 score from officiality, verification status, recency, and document type - shown on every citation, never presented as ground truth. |
| **Temporal-aware retrieval** | Knows which academic year/semester is current and heavily deprioritizes (not just hides) superseded documents. |
| **Conflict detection** | When two official sources disagree on the same regulated fact (e.g. attendance %), the assistant surfaces both, cites the newer one as *suggested*, and queues it for admin resolution - it never silently guesses. |
| **Personalized context** | Students set department/year/semester once; retrieval ranks around what's relevant to them. Fully editable and deletable - see `docs/SECURITY.md`. |
| **Role separation** | Students and faculty get a focused chat-first experience; only admins see and manage the document library. Students and faculty see documents only through cited answers. |
| **Faculty-domain gating** | Faculty can only sign up with an email on a faculty domain the admin has set in Settings. Until an admin sets one, faculty signup at that college is closed with a clear message. |
| **Multi-format ingestion** | PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx - each slide is cited by number and title, speaker notes included), CSV, plain text, and images (.jpg/.jpeg/.png). Scanned PDF pages and photos of notices are read with on-device OCR (RapidOCR - no system install). Renamed, corrupt, empty, or unsupported files are rejected with a specific message. |
| **Hybrid retrieval** | BM25 over stemmed terms (title + section heading + text), query-term coverage, and embedding similarity, trust- and recency-weighted. Unrelated questions abstain instead of citing a loosely related document. |
| **AI Campus Copilot** | Handles task-style requests ("summarize the latest placement circular", "give me a checklist for registration") not just lookup questions. |
| **Admin command center** | Knowledge Health score, conflict queue, usage analytics, verification workflow, and a login-activity log. |
| **Login analytics** | Admins see every student and faculty sign-in and registration (name, role, time), filterable by role and date range, paginated, and scoped to their own college. |

---

## Extras

| Feature | What it does |
|---|---|
| **Account menu** | One avatar menu in the top-right of every signed-in page for profile, light/dark theme, and sign-out. |
| **Voice input** | Ask questions by speaking, in English, Tamil, or Hindi, via the browser's native Web Speech API - degrades gracefully with a clear message on unsupported browsers rather than a broken button. |
| **Chat history download** | Students and faculty download their own conversations (the current one or any selection of past ones) as a PDF or plain-text file, with their name, college, the time of every message, and the sources each answer cited. |
| **Account export** | Admins download every student and faculty account in their college (name, email, role, status, signup date, last login) as CSV or Excel from the Login activity page. Password hashes are never included. |
| **Bulk document upload** | Drag and drop many files at once, in any supported format, with per-file title editing, sequential upload (kind to free-tier AI rate limits), and live per-file status including the reason a file failed. |

---

## Quickstart (local, free-tier, zero paid services required to boot)

### 1. Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then add your Gemini key (see below)
python3 -m uvicorn app.main:app --reload --port 8000
```

The backend runs on **SQLite by default** - no database server to install.
It boots and works even with zero API keys configured, using a clearly
labeled offline mode (`AI_PROVIDER=mock`) so you can develop the UI and
pipeline without spending anything.

To get real AI-generated answers, add a free-tier Google Gemini key to `.env`:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key-here
```

Get a key at <https://aistudio.google.com/apikey> - Gemini's free tier is
enough for a demo or small-department pilot.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env          # points VITE_API_BASE_URL at your backend
npm run dev
```

Open <http://localhost:5173>.

### 3. Try the end-to-end demo flow

1. Visit `/register-college`, create a workspace with a real domain (e.g.
   `mitindia.edu`) - you become its first admin.
2. Upload the sample files in `backend/seed_data/` (clearly marked demo data)
   from **Documents**: upload `attendance_reg_2025.pdf` first, then upload
   `attendance_reg_2026.pdf` and set "Supersedes" to the first one. The Word,
   Excel, PowerPoint, CSV, text, and image samples show multi-format ingestion
   (regenerate them with `python seed_data/make_format_samples.py`).
3. Optionally set a faculty domain under **Settings** to open faculty signup.
4. Sign out, register a student with an email on the same domain.
5. Ask: *"What is the minimum attendance requirement?"* - watch the
   assistant flag the conflict and cite both sources.
6. Back in the admin panel, resolve the conflict, check the Knowledge
   Health score, and see the student's registration and sign-in under
   **Login activity**.

---

## Project structure

```
campusmind-ai/
  backend/     FastAPI app - RAG pipeline, auth, ingestion, admin APIs
  frontend/    React + Vite + TypeScript + Tailwind SPA
  docs/        ARCHITECTURE.md, SETUP.md, SECURITY.md, DEPLOYMENT.md,
               PROJECT_ROADMAP.md, PROJECT_STATUS.md
```

See `docs/ARCHITECTURE.md` for the full RAG pipeline diagram and data model,
`docs/DEPLOYMENT.md` for going to production on free-tier hosting, and
`docs/SECURITY.md` for the auth/tenancy model.

## Status

This is a working prototype covering the full core loop (auth, multi-tenant
isolation, three roles - student/faculty/admin - with faculty-domain gating,
multi-format ingestion with OCR, RAG chat, trust scoring, temporal
retrieval, conflict detection, admin dashboard, login analytics, light/dark
theming) with a 124-test backend suite (`backend/tests/`) covering auth,
RBAC across all three roles, tenant isolation, ingestion of every supported
format, retrieval quality, login analytics, and the RAG/conflict pipeline.
Not yet built: streaming responses, and multilingual answers without an AI
provider (the language choice needs a real Gemini/OpenAI/Claude key to
actually translate). See `docs/PROJECT_ROADMAP.md`.
