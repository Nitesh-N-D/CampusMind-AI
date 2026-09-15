# Project Roadmap

## Built and verified (backend test suite + manual integration testing)

- [x] Multi-tenant college workspaces, domain-restricted signup
- [x] JWT auth, bcrypt password hashing, server-side RBAC
- [x] PDF ingestion: text extraction, page-preserving chunking, embeddings
- [x] Feature 1 - Source-Trust Engine
- [x] Feature 2 - Temporal-aware retrieval
- [x] Feature 3 - Conflict detection + admin resolution workflow
- [x] Feature 4 - Personalized student context
- [x] Feature 5 - Task-oriented chat (summarize, checklist, compare)
- [x] Feature 6 - Deadline/event extraction + timeline
- [x] Feature 7 - "What changed?" diffing
- [x] Feature 9 - Hybrid (BM25 + semantic) search
- [x] Feature 10 - Admin command center (Knowledge Health, analytics,
      conflict queue)
- [x] Notification system (role-targeted: students and faculty get
      new-document and regulation-change alerts, admins get conflict alerts)
- [x] Faculty role: separate signup path, role-tuned chat suggestions,
      same document/search/timeline access as students, no admin access
- [x] Light/dark theme system, toggleable and system-preference aware,
      applied app-wide via CSS custom properties (no per-component
      dark: variant duplication)
- [x] Privacy Policy and Terms of Service pages with real, system-specific
      content
- [x] Mobile-accessible chat history (slide-in drawer, previously desktop-only)
- [x] Skeleton loading states across Documents, Search, Timeline, Profile,
      Admin Dashboard, and Admin Conflicts (replacing generic spinners)
- [x] Cloudinary profile picture upload/removal, server-side validated
      (content-type, real image decode check, size, dimensions), with a
      clean 503 (never a silent failure or fake local save) when
      Cloudinary isn't configured
- [x] Editable full name and nickname, validated both client- and
      server-side (nickname character allowlist to prevent stored XSS,
      since it renders across the sidebar and chat)
- [x] Global error handling overhaul: fixed a real bug where FastAPI's
      default validation error shape (an array) would have broken every
      frontend error message; added consistent single-string error
      responses, a global unhandled-exception handler that never leaks
      internals, and structured request logging with a traceable
      X-Request-ID on every response
- [x] Toast notification system replacing all `alert()` calls
- [x] "What Changed?" dedicated page - closed a real gap where the backend
      endpoint existed but was admin-only and had no frontend consumer,
      despite the feature being meant for students
- [x] Command palette (⌘K / Ctrl+K) for navigation and quick actions
- [x] Voice input for chat via the Web Speech API (English/Tamil/Hindi),
      with graceful degradation on unsupported browsers
- [x] Conversation export to Markdown, including citations and confidence
- [x] Bulk drag-and-drop document upload with per-file progress, for admin
      onboarding of many documents at once
- [x] Full authorization audit: programmatically verified all 28 API
      routes require authentication except the 3 that must be public
- [x] Provider abstraction for AI + embeddings (Gemini/OpenAI/Claude/local)
- [x] Full frontend: 12 pages, responsive, custom design system, real SEO
- [x] 37-test backend suite covering auth, RBAC, tenant isolation, RAG,
      conflict detection and resolution, notifications

## Partially built

- [~] Feature 8 - Multi-modal document understanding: text-PDF extraction
      and page/heading-preserving chunking work; OCR fallback for scanned
      pages is implemented but not exercised by the test suite against a
      real scanned document yet.
- [~] Multilingual chat: the `language` parameter is threaded through
      `/api/chat/message` end-to-end and the UI lets students pick
      English/Tamil/Hindi, but actual translation quality depends on a real
      Gemini key - untested against live translation output in this build.

## Not yet built

- [ ] Streaming chat responses (backend has a `stream()` method on the AI
      provider interface, ready to wire up; the chat endpoint currently
      returns a complete response rather than SSE/websocket streaming)
- [ ] RAG evaluation harness (retrieval recall, citation accuracy,
      groundedness scoring against a labeled question set)
- [ ] Rate limiting on auth/chat endpoints
- [ ] Email verification for signup (currently domain-match only)
- [ ] Production deployment (see `DEPLOYMENT.md` for the intended path -
      not yet executed against a live Render/Vercel/Supabase stack)
- [ ] CI pipeline running the test suite on push

## Known limitations to be upfront about

- The offline mock AI provider (used when no API key is set) produces
  clearly-labeled placeholder text for chat answers - it is not a real
  language model. Structured fields like "what changed" impact summaries
  correctly bypass it with a deterministic sentence instead, but full chat
  quality requires a real provider key.
- SQLite is the default database for zero-setup local development. It's
  not appropriate for concurrent production writes at scale - see
  `DEPLOYMENT.md` for moving to Supabase/Postgres.
- Trust and confidence scores are heuristic (officiality, verification
  status, recency, retrieval rank) and are always labeled as a system
  quality signal in the UI, never presented as a guarantee of correctness.
