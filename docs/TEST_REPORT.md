# CampusMind AI — End-to-end test report

Baseline commit `fdaf809`. This pass covered the API, role and tenant isolation, and the main browser journeys. It did not cover everything in the brief; see "Not verified".

**Everything in this file used the mock AI provider.** Results against real Gemini, Cloudinary, Web Push and the faculty role are in `docs/REAL_INTEGRATION_TEST_REPORT.md`, which supersedes the "Not verified" items below where it says so.

## Test environment

- **Backend:** real `uvicorn` process with a throwaway SQLite file, `AI_PROVIDER=mock`, local embeddings, and blank Cloudinary, VAPID and Gemini credentials. `.env` files were not touched, and the process environment overrides them.
- **Frontend:** Vite dev server with `VITE_API_BASE_URL` pointed at the isolated backend.
- **Browser:** Microsoft Edge, headless, driven by `playwright-core`.
- **Scripts:** `e2e/serve_isolated.sh`, `e2e/api_journeys.py`, `e2e/browser_journeys.mjs`.
  - The API script needs a fresh database, because it registers fixed college domains.
  - Output goes to `tmp/e2e/`, which is not meant to be committed.

## Results

| Suite | Result |
|---|---|
| Backend pytest | 253 passed in this mock pass. After the later real-integration and stabilization work the suite is **272 passed**; see the real-integration report |
| Live API journeys (`api_journeys.py`) | 137 / 137 passed |
| Browser journeys (`browser_journeys.mjs`) | 38 / 38 passed |
| `tsc -b`, `npm run build` | clean |
| `npm run lint` | warnings only: `only-export-components` in `campus.tsx`, `AnswerBlock.tsx` and `notificationUi.tsx` |

The only browser console error was the expected 401 from the deliberate bad-password login.

## Feature matrix

| Feature | Admin | Student | Faculty | Result | Evidence |
|---|---|---|---|---|---|
| College registration and validation | yes | n/a | n/a | PASS | Domain mismatch, duplicate domain, short password, bad email, and extra-field (privilege smuggling) attempts were all rejected. |
| Student and faculty registration | n/a | yes | yes | PASS | Faculty can only register on the faculty domain. Wrong domain, duplicate email and `role=admin` were rejected. |
| Login and session | yes | yes | yes | PASS | Bad password, unknown account and missing fields were rejected. A garbage or forged-signature token and an expired token gave 401. A valid student token with `role=admin` forged into the claim gave 403, because the role is read from the database. In the browser, protected routes redirect anonymous users, and admin logout re-protects `/admin`. |
| Chat and RAG | n/a | yes | yes | PASS (mock AI) | The answer cites the correct uploaded document and carries `version`, `effective_date` and `status`. Multi-turn chat, history persistence, delete, and PDF and TXT export all worked. An unanswerable question gave confidence 0 with no citations. Hindi and Tamil queries returned 200 and were logged as unanswered. |
| Documents | yes | read-only | read-only | PARTIAL | A TXT upload and listing worked. Empty files and `.exe` were rejected, and students and faculty cannot upload or delete. Students open files only through notice attachments. Other formats rely on the existing `test_ingestion_formats.py`; I did not run them live. |
| Notifications | yes | yes | yes | PASS | Audience targeting is correct in both the API and the UI: student-only, faculty-only and both-audience notices, plus draft, edit, publish and archive. `high` is rejected as a priority. An `urgent` notice was published with a circular number. Read, unread and read-all work. A notice attachment opened for an allowed student and not for another college. |
| Reminders | yes | yes | yes | PASS (idempotency added later) | Create, audience filtering and role limits worked. The scheduler endpoint takes `X-Cron-Secret`, and a student or faculty token is refused. In this mock pass the test reminder was not yet due, so the live run sent 0 both times. A reminder that really became due was later sent once and then 0 times on repeated runs (`e2e/reminder_idempotency.py`). |
| Questions and feedback | yes | yes | n/a | PASS | Unanswered questions appear in admin insights and in the UI. Up and down feedback with a reason was accepted, and an invalid reason was rejected with 422. |
| Analytics, settings, login events | yes | denied | denied | PASS (access), PARTIAL (values) | All 8 admin endpoints return 200 for the admin and 403 for student and faculty. Anonymous requests get 401. I did not compare the displayed metrics to the database. |
| Profile | n/a | page renders | n/a | PARTIAL | The profile API and page load. Edit and avatar flows rely on the existing `test_profile.py`. |
| Web Push | n/a | status only | n/a | BLOCKED here | No VAPID keys were configured in this isolated run, so `/api/push/status` reports `configured: false`. Real delivery was tested later; see the real-integration report (click handling still unverified). |
| Tenant isolation | yes | yes | n/a | PASS | See below. |
| Responsive and theme | yes | yes | n/a | PASS (Light, Dark) | 15 routes across 8 widths (320 to 1440) and Light and Dark: no horizontal overflow. |
| SEO and PWA assets | n/a | n/a | n/a | PARTIAL | All 8 icons, the manifest, `robots.txt` and `sitemap.xml` return 200 with the correct MIME types. |

### Tenant isolation (college A vs college B)

Checked in the live run:
- B's admin and users cannot read, download, delete or verify A's documents.
- B cannot see, patch or delete A's notices, or see A's reminders.
- B's users cannot read A's chat sessions or leave feedback on A's messages.
- B's users get no citations from A's documents.
- B's admin cannot resolve A's unanswered questions.
- A's user export contains no college B users.

Unauthorized access returns 403 or 404.

## Bugs found and fixed

1. **Blank or oversized chat messages were accepted.** A whitespace-only message created an empty conversation, and a 33,000-character message was accepted.
   - **Fix:** `ChatRequest` in `backend/app/schemas/schemas.py` now trims the message, rejects empty text, and caps it at 2000 characters.
   - **Regression test:** `test_blank_or_oversized_chat_message_is_rejected_and_creates_nothing`.
2. **No prompt-injection guard in the system prompt.** Nothing told the model to treat source text as data. I added rule 9 to `SYSTEM_PROMPT` in `backend/app/rag/pipeline.py`.
   - This is hardening only. It cannot be verified without a live model, and the mock provider ignores the prompt.

The chat page does not cap input length, so a student who types more than 2000 characters gets a validation error. This is unchanged.

## Not verified

- **Real Gemini, Cloudinary and Supabase/Postgres.** All AI answers in this pass came from the mock provider. Real Gemini and Cloudinary were tested later (real-integration report), including prompt-injection resistance. Hindi and Tamil answer quality and PostgreSQL migrations and writes remain unverified.
- **Web Push delivery.** Not tested in this pass. Tested later with a real browser subscription, including delivery with the app tab closed; notification click is still unverified.
- **Document formats other than TXT through the live server.** (Tested later: PDF, DOCX, XLSX, PPTX, CSV, PNG, JPG and WebP all passed against the live server.)
- **Conflict and version workflows in the browser.** They are covered only by existing unit tests.
- **System theme resolution, grayscale and no-logo tests.**
- **Accessibility.** Not tested for dialogs, focus traps, Escape handling, contrast or screen readers. No automated accessibility tool was run.
- **Mobile navigation interactions.** The admin More drawer and mobile keyboard layout were not clicked through.
- **Interactions not clicked in the browser.** Document upload, notice publishing, reminder creation, the export dialog and feedback buttons were tested through the API only. The browser run did not exercise registration forms, the document upload form, the notice composer, reminder creation, the export dialog or conflict resolution.
- **Error paths.** Backend down, database down, Gemini timeout and rate limits, and network interruption.
- **Performance.** Nothing was measured beyond a successful build.
- **Duplicate-submission protection.**
- **Faculty-specific features.** Faculty uses the same chat and notification pages as students, with different audience targeting. There is no faculty dashboard, and none was added. The faculty journey against real Gemini was tested later (11/11).

## Deployment requirements still open

- Set a real `SECRET_KEY` and `CRON_SECRET`, configure the VAPID keys, and schedule `process_reminders`.
- Real Gemini and Cloudinary checks are done. A check on an isolated PostgreSQL is still open.
