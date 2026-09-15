# Security

## Authentication & authorization coverage (audited)

Every route in `app/api/` was checked programmatically for an auth
dependency. Result: all 28 API routes require a valid JWT via
`get_current_user` or `require_role(...)`, except the three that are
supposed to be public - `POST /api/auth/register-college`,
`POST /api/auth/register-student`, `POST /api/auth/login` - which is
correct, since those are how you get a token in the first place. No route
was found unintentionally open. Frontend-side, every functional page is
wrapped in `<RequireAuth>` (`src/components/RouteGuards.tsx`), which
redirects to `/login` if there's no session - but that's a UX convenience,
not the actual security boundary, since a client-side redirect can be
bypassed by anyone calling the API directly. The real boundary is the
backend's independent, unconditional JWT check on every protected route,
confirmed by `tests/test_auth.py::test_unauthenticated_request_rejected`
and equivalent checks throughout the suite.

## Authentication

- Passwords hashed with bcrypt (via `passlib`), never stored in plain text.
- JWT bearer tokens (`python-jose`), expiry configurable via
  `ACCESS_TOKEN_EXPIRE_MINUTES`.
- `SECRET_KEY` must be overridden in production - the default in
  `config.py` is explicitly a dev placeholder. Generate one with
  `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.

## Authorization

- Two roles: `admin`, `student`. Stored server-side on the `users` table.
- Every protected endpoint depends on `require_role(...)` or
  `get_current_user`, both of which re-derive the user from the verified
  JWT - the role is never trusted from a request body or query parameter.
- Verified in `tests/test_auth.py`: students get `403` on document upload
  and on every `/api/admin/*` route.

## Multi-tenant isolation

- Every college-scoped table has a `college_id` column.
- Every query filters by `current_user.college_id`, derived from the token
  - never from a client-supplied college ID.
- Verified in `tests/test_auth.py::test_token_from_one_college_cannot_see_another_colleges_data`.

## Domain-restricted signup

- Each college workspace declares one `official_domain` at creation time.
- Student (and additional admin) signup checks the email's domain against
  it server-side and rejects mismatches with `400`.
- This is a lightweight admission control suited to a class project /
  small-department pilot. For a larger production rollout, layer on actual
  email verification (magic link or OTP) so a domain match alone isn't
  sufficient - see `PROJECT_ROADMAP.md`.

## Input validation & upload safety

- Only `.pdf` files accepted (`ALLOWED_EXTENSIONS` in `app/api/documents.py`).
- Size capped by `MAX_UPLOAD_MB` (default 25MB).
- Uploaded files are stored under a generated UUID filename, not the
  user-supplied one, avoiding path traversal via filename.
- Ingestion failures (corrupt PDFs, OCR errors, provider outages) are
  caught in `app/ingestion/pipeline.py` and recorded on the document as a
  `processing_error` - they never propagate as an unhandled 500. Covered by
  `tests/test_rag.py::test_malformed_pdf_fails_gracefully_not_500`.

## Profile pictures (Cloudinary)

- Avatars are validated server-side before ever reaching Cloudinary:
  content-type allowlist (JPEG/PNG/WebP only), size cap (`MAX_AVATAR_MB`,
  default 5MB), the file is actually decoded as an image (not just trusted
  by its claimed content-type header), and dimensions are bounded
  (32px-2048px) - see `app/services/cloudinary_service.py::validate_avatar_bytes`.
- Each user's avatar is stored under a stable per-user Cloudinary
  `public_id` (`campusmind-ai/avatars/user_<id>`), so re-uploads overwrite
  the old image rather than accumulating orphaned assets, and removing an
  avatar actively deletes it from Cloudinary rather than just clearing the
  database reference.
- If Cloudinary isn't configured (`CLOUDINARY_CLOUD_NAME` /
  `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` unset), the upload endpoint
  returns a clear `503` explaining why - it never silently no-ops or writes
  to local disk pretending to be cloud storage. Covered by
  `tests/test_profile.py::test_avatar_upload_without_cloudinary_configured_returns_clean_503`.
- Names and nicknames are validated server-side (`ProfileUpdate` in
  `app/schemas/schemas.py`): full name can't be empty or contain digits,
  nicknames are restricted to a safe character set to prevent stored XSS in
  a field that renders across the sidebar, chat, and admin views.

## Secrets

- No API keys are ever sent to the frontend. `GEMINI_API_KEY` lives only in the
  backend's `.env` and is read server-side by the provider abstraction.
- `.env` is gitignored; `.env.example` (committed) documents every variable
  with no real values.

## CORS

- Configured via `FRONTEND_ORIGIN` in `app/main.py`'s `CORSMiddleware` -
  restrict this to your actual deployed frontend origin in production
  rather than leaving it wide open.

## Privacy (personalization data)

- Students opt into department/year/semester/section/interests - none of
  it is required to use the assistant.
- `PUT /api/profile/me` lets a student update it at any time.
- `DELETE /api/profile/me` clears the personalization fields without
  deleting the account or chat history (`app/api/profile.py`).

## Known gaps for a production rollout

These are intentionally out of scope for a class-project MVP but should be
addressed before handling real student data at scale:

- No rate limiting yet on auth or chat endpoints.
- No email verification step - domain match is the only signup gate.
- SQLite has no row-level security; if you promote to Postgres/Supabase,
  turn on RLS policies keyed on `college_id` as a second line of defense
  rather than relying solely on application-layer filtering.
- No refresh-token rotation - tokens are long-lived until
  `ACCESS_TOKEN_EXPIRE_MINUTES` expiry.
