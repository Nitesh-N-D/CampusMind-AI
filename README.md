# CampusMind AI

AI-powered smart college assistant. CampusMind AI answers student and staff
questions using a college's own official documents - regulations, circulars,
timetables, exam schedules, placement notices - with page-level citations
and a visible, honestly-labeled trust score. It never invents a fact it
can't cite, and when two official sources disagree, it says so instead of
silently picking one.

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
| **Personalized context** | Students set department/year/semester once; retrieval ranks around what's relevant to them. Fully editable and deletable - see `PRIVACY` in `SECURITY.md`. |
| **Separate student/faculty/admin experience** | Faculty get their own signup path, their own chat suggestions (circular summaries, curriculum changes), and their own notification stream - distinct from students and from the admin command center. |
| **AI Campus Copilot** | Handles task-style requests ("summarize the latest placement circular", "give me a checklist for registration") not just lookup questions. |
| **Deadline & event intelligence** | Extracts dates from uploaded documents into a filterable campus timeline. |
| **"What changed?"** | Diffs superseded regulations against their replacement and states the practical impact in one sentence. |
| **Multi-modal ingestion** | PDF text + OCR fallback, page/section-preserving chunking, page-level citations. |
| **Hybrid search** | BM25 keyword + embedding-based semantic search, trust-weighted ranking. |
| **Admin command center** | Knowledge Health score, conflict queue, usage analytics, verification workflow. |

---

## The 5 signature extras

Beyond the 10 core features, these make it feel like a real product rather
than a class-project chatbot:

| Feature | What it does |
|---|---|
| **"What changed?" page** | A dedicated, student-visible diff view (not admin-only) showing every regulation update side-by-side with its practical impact - closes a real gap where this data existed on the backend but had no UI. |
| **Command palette (⌘K / Ctrl+K)** | Jump to any page or run an action (new chat, sign out) from anywhere, keyboard-first, the same pattern as Linear/Notion/Vercel. |
| **Voice input** | Ask questions by speaking, in English, Tamil, or Hindi, via the browser's native Web Speech API - degrades gracefully with a clear message on unsupported browsers rather than a broken button. |
| **Conversation export** | Download any chat as a clean Markdown file with citations and confidence scores intact - useful for keeping a record of an official answer. |
| **Bulk document upload** | Drag and drop dozens of PDFs at once for admin onboarding, with per-file title editing, sequential upload (kind to free-tier AI rate limits), and live per-file status. |

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
labeled offline mode (see `AI_PROVIDER=mock` behavior in `RAG.md`) so you
can develop the UI and pipeline without spending anything.

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
2. Upload the sample PDFs in `backend/seed_data/` (clearly marked demo data)
   from the Documents page: upload `attendance_reg_2025.pdf` first, then
   upload `attendance_reg_2026.pdf` and set "Supersedes" to the first one.
3. Log out, register a student with an email on the same domain.
4. Ask: *"What is the minimum attendance requirement?"* - watch the
   assistant flag the conflict and cite both sources.
5. Back in the admin panel, resolve the conflict, check the Knowledge
   Health score, and look at the Timeline for extracted dates.

---

## Project structure

```
campusmind-ai/
  backend/     FastAPI app - RAG pipeline, auth, ingestion, admin APIs
  frontend/    React + Vite + TypeScript + Tailwind SPA
  docs/        ARCHITECTURE.md, SETUP.md, SECURITY.md, RAG.md, DEPLOYMENT.md
```

See `docs/ARCHITECTURE.md` for the full RAG pipeline diagram and data model,
`docs/DEPLOYMENT.md` for going to production on free-tier hosting, and
`docs/SECURITY.md` for the auth/tenancy model.

## Status

This is a working prototype covering the full core loop (auth, multi-tenant
isolation, three roles - student/faculty/admin, ingestion, RAG chat, trust
scoring, temporal retrieval, conflict detection, notifications, search,
timeline, admin dashboard, light/dark theming) with a 37-test backend suite
(`backend/tests/`) covering auth, RBAC across all three roles, tenant
isolation, and the RAG/conflict pipeline. Not yet built: streaming
responses, full multilingual answer generation (the language parameter is
wired through the API but needs a real Gemini key to actually translate),
and a production deployment. See `docs/PROJECT_ROADMAP.md`.
