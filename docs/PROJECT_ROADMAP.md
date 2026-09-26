# Project Roadmap

## Built and verified (backend test suite + manual integration testing)

- [x] Multi-tenant college workspaces, domain-restricted signup
- [x] JWT auth, bcrypt password hashing, server-side RBAC
- [x] Role separation: students and faculty get a chat-first experience
      (assistant + profile only); the document library, upload, conflicts,
      analytics, and settings are admin-only on both the API and the UI
- [x] Faculty-domain gating: faculty sign up only with an email on the
      faculty domain an admin sets in Settings; with no faculty domain set,
      faculty signup at that college is closed with a clear message
- [x] Multi-format ingestion: PDF, Word (.docx), Excel (.xlsx), PowerPoint
      (.pptx), CSV, plain text, and images (.jpg/.png). Heading-aware
      sections for Word/text, one section per sheet for Excel, one per
      slide for PowerPoint (text, tables, speaker notes, OCR for
      picture-only slides), table rows as "Header: value"
      sentences. Magic-byte checks reject renamed files; corrupt, empty,
      oversized, and unsupported files get specific messages
- [x] OCR for scanned PDF pages and images via RapidOCR (pip-only, no
      system Tesseract), exercised by the test suite against a real
      image-only PDF and a photographed notice
- [x] Feature 1 - Source-Trust Engine
- [x] Feature 2 - Temporal-aware retrieval
- [x] Feature 3 - Conflict detection + admin resolution workflow
- [x] Feature 4 - Personalized student context
- [x] Feature 5 - Task-oriented chat (summarize, checklist, compare)
- [x] Feature 9 - Hybrid retrieval: BM25 over stemmed title + heading +
      content terms, query-term coverage, provider-aware semantic weighting,
      a relative score cutoff, and abstention on unrelated questions
- [x] Feature 10 - Admin command center (Knowledge Health, analytics,
      conflict queue)
- [x] Login analytics: every successful student/faculty sign-in and
      registration is recorded; admins get a paginated log filterable by
      role and date range, scoped to their own college
- [x] Light/dark theme system, toggleable and system-preference aware,
      applied app-wide via CSS custom properties, with a contrast audit of
      every page (dedicated on-navy and brand tokens, readable trust-tier
      text colours in dark mode)
- [x] SaaS-style chat: full-height layout, date-grouped conversation list
      (drawer on phones/tablets), auto-growing composer
- [x] Consistent header with an account menu (profile, theme, sign-out) on
      every signed-in page; responsive layouts for phone, tablet, desktop
- [x] Privacy Policy and Terms of Service pages with real, system-specific
      content (including disclosure of the sign-in log)
- [x] Skeleton loading states across Documents, Login activity, Profile,
      Admin Dashboard, and Admin Conflicts (replacing generic spinners)
- [x] Cloudinary profile picture upload/removal, server-side validated
      (content-type, real image decode check, size, dimensions), with a
      clean 503 (never a silent failure or fake local save) when
      Cloudinary isn't configured
- [x] Editable full name and nickname, validated both client- and
      server-side (nickname character allowlist to prevent stored XSS,
      since it renders in the account menu and chat)
- [x] Global error handling overhaul: consistent single-string error
      responses, a global unhandled-exception handler that never leaks
      internals, and structured request logging with a traceable
      X-Request-ID on every response
- [x] Toast system replacing all `alert()` calls
- [x] Voice input for chat via the Web Speech API (English/Tamil/Hindi),
      with graceful degradation on unsupported browsers
- [x] Conversation export to Markdown, including citations and confidence
- [x] Bulk drag-and-drop document upload in any supported format, with
      per-file progress and failure reasons
- [x] Startup migrations (`app/db/migrations.py`) that add new columns to
      existing databases and drop tables of removed features
- [x] Full authorization audit: every route in `app/api/*.py` requires
      `get_current_user` or `require_role(...)` except the 3 public auth
      endpoints (register-college, register-student, login); `/api/health`
      is a public liveness probe
- [x] Provider abstraction for AI + embeddings (Gemini/OpenAI/Claude/local)
- [x] Full frontend: 14 pages, responsive, custom design system, real SEO
- [x] 100-test backend suite covering auth, RBAC, faculty gating, tenant
      isolation, ingestion of every format, retrieval quality, login
      analytics, migrations, RAG, and conflict detection and resolution

## Removed deliberately

These were built earlier and removed to keep the product focused. Their
endpoints, tables, and pages no longer exist:

- Student/faculty document browsing (documents are reached only through
  cited answers)
- "What changed?" page and diffing, deadline/event timeline, standalone
  search page, command palette (Cmd/Ctrl+K), and all notifications

## Partially built

- [~] Multilingual chat: the `language` parameter is threaded through
      `/api/chat/message` end-to-end and the UI lets users pick
      English/Tamil/Hindi, but actual translation needs a real AI provider
      key - untested against live translation output in this build.
- [~] RAG evaluation: `tests/test_retrieval_quality.py` checks the top
      citation for 14 labeled questions across 7 documents plus abstention
      on an unrelated question. There is no groundedness or answer-quality
      scoring yet.

## Not yet built

- [ ] Streaming chat responses (backend has a `stream()` method on the AI
      provider interface, ready to wire up; the chat endpoint currently
      returns a complete response rather than SSE/websocket streaming)
- [ ] Rate limiting on auth/chat endpoints
- [ ] Email verification for signup (currently domain-match only)
- [ ] Legacy Office formats (.doc, .xls, .ppt) - rejected with a message
      asking for the modern format
- [ ] CI pipeline running the test suite on push

## Known limitations to be upfront about

- The offline mock AI provider (used when no API key is set) produces
  clearly-labeled placeholder text for chat answers - it is not a real
  language model. Full chat quality requires a real provider key.
- With the offline local embedder, retrieval relies on the lexical signals
  (BM25 + term coverage); semantic similarity only contributes when a real
  embedding provider is configured.
- SQLite is the default database for zero-setup local development. It's
  not appropriate for concurrent production writes at scale - see
  `DEPLOYMENT.md` for moving to Supabase/Postgres.
- Trust and confidence scores are heuristic (officiality, verification
  status, recency, retrieval rank) and are always labeled as a system
  quality signal in the UI, never presented as a guarantee of correctness.
