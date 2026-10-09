# CampusMind AI — Real integration and release-readiness report

Baseline commit `fdaf809` plus uncommitted changes (listed at the end). Nothing was committed, pushed or deployed. This report covers the real-service pass and the follow-up stabilization pass. `docs/TEST_REPORT.md` covers the earlier mock-only audit.

No secret value was printed or copied into code, scripts, logs or this report. No `.env` file was changed. A search of `e2e/`, `docs/`, `backend/tests/` and `backend/app/` for key, connection-string and private-key patterns found nothing.

## How the tests are separated

| Kind | What it means here | Where |
|---|---|---|
| **Real-service** | Real Gemini, Cloudinary, VAPID/WNS push; throwaway SQLite for all writes | `e2e/integration_real.py`, `faculty_real.mjs`, `browser_real.mjs`, `push_real.mjs`, `push_server_real.py`, `reminder_idempotency.py` |
| **Mocked integration** | Live uvicorn and browser, but mock AI, local embeddings and local storage | `e2e/api_journeys.py`, `e2e/browser_journeys.mjs` |
| **Automated unit/API** | pytest, in-memory SQLite, every external service faked or blanked | `backend/tests/` |
| **Blocked / unverified** | Listed in the last two sections | |

The configured `DATABASE_URL` is a shared Supabase database with live data. It was only read (connectivity, schema parity, counts). Every synthetic write went to a local SQLite file.

## Credentials and services (names and status only)

| Item | Status |
|---|---|
| `GEMINI_API_KEY` | Present. Generation and embeddings succeeded |
| `CLOUDINARY_*` (3 values) | Present. Upload, authenticated fetch and delete succeeded |
| `VAPID_*` | Present. Real push delivered to a browser-created test subscription |
| `DATABASE_URL` (Supabase) | Present. Read-only checks only |
| `CRON_SECRET` | Test servers used a throwaway value |

`ENVIRONMENT` in `backend/.env` is `production`; test servers overrode it to `development` through process environment variables only.

## Results matrix

| Integration | Test performed | Result | Evidence | Remaining issue |
|---|---|---|---|---|
| Gemini generation | Real answers via API and browser (student and faculty) | PASS | `integration_real.py` 46/46 on a fresh DB; faculty and student UI answers contained the correct facts and citations | Call counts are approximate: about 18 chat requests per `integration_real.py` run (run twice, plus once with a stale DB), plus 3 browser answers. Rate limiting under load not measured |
| Gemini embeddings | Probe plus uploads in every run | PASS | 768-dim vectors; paraphrased queries retrieve the right document | None |
| Real RAG | Paraphrase, abstention, versions, contradictions, injection, tenant, 9 formats | PASS | 46/46 | None |
| PostgreSQL / Supabase | Read-only connectivity and schema comparison; offline DDL compile for the Postgres dialect | PARTIAL | Live schema matches the models. `test_postgres_ddl.py` compiles every table and index for Postgres without connecting | **Not verified:** migrations, document, chat, notification, reminder and feedback persistence, rollback and tenant isolation on Postgres. No isolated Postgres was available (no `psql`, `pg_ctl` or docker, and `.env` has no test-database variable), so the shared database was left untouched |
| Cloudinary | Upload, signed fetch, delete, orphan check; fake-credential failure | PASS | "docs stored in cloudinary", "download matches upload", "asset destroyed on delete", "no leftover test assets"; all assets created by this phase were destroyed | None |
| Web Push | Real browser subscription, persistence, delivery, display, unsubscribe, disallowed host, expired-subscription cleanup | PARTIAL | `push_real.mjs` 9/9 in headed Edge with a persistent profile: real `wns2-…notify.windows.com` subscription, VAPID-signed delivery, notification displayed by the service worker, also displayed while no app tab was open. Expired-subscription cleanup (410 retires the subscription) was verified earlier against a synthetic FCM-style endpoint in `push_server_real.py` | **Notification click handling is not verified** (needs the OS toast). Delivery was tested with the browser process running and the app tab closed, not with the browser fully quit. Ephemeral (non-persistent) Playwright contexts are refused push registration by Edge, so the script needs a visible window |
| PDF processing | Real PDF through the live server | PASS | Text extracted and answered | A damaged PDF that passes the header check is recorded with status `failed` and HTTP 200 (a file with no PDF header is rejected 400) |
| Office documents | DOCX, XLSX, PPTX, CSV | PASS | Each uploaded, indexed and answered | None |
| Image/OCR processing | PNG, JPG, WebP | PASS | Each uploaded, OCR'd, indexed and answered | None |
| Admin journey | Browser: register college, upload, publish notice | PASS | `browser_real.mjs` 10/10 | Conflict resolution and export dialog were not clicked in the real-service phase (covered in the mock browser run only for page loads) |
| Student journey | Browser: register, real chat, citation, feedback click, notice, theme, session loss | PASS | `browser_real.mjs` 10/10 | The feedback check asserts that the button could be clicked, not the stored row |
| Faculty journey | Browser against real Gemini, synthetic accounts, isolated DB | PASS | `faculty_real.mjs` 11/11: login, real answer with correct fact (12 casual leaves), citation to the uploaded policy, feedback click, faculty-only and shared notices visible, student-only notice hidden, faculty reminder visible, logout re-protects `/chat`; the reverse direction (student does not see faculty-only) checked through the API | Feedback is a click check only. The reminder shown was created, not delivered |
| Reminder idempotency | Reminder created 40 s ahead, then the scheduler endpoint called after it came due | PASS | 0 sent before due, 1 sent on the first run after, 0 on later runs with the cron secret and with the admin token; unread count unchanged | No real subscriber, so `pushed` was 0 in that run |
| Tenant isolation | Cross-college access with real retrieval | PASS (SQLite) | No cross-college citations or file access | Not exercised on Postgres |
| Browser workflows | Edge against real Gemini | PASS | 10/10 and 11/11, no console errors, no 5xx | Mobile layouts, accessibility and the export dialog in real-service mode were not covered |

## Visiting-hours conflict (fixed)

- **Cause:** `TOPIC_PATTERNS` in `backend/app/services/conflict_engine.py` only knew attendance percentage, fee amount and CGPA. Two notices giving different visiting hours matched no topic, so `has_conflict` stayed false. The model still mentioned both values, which is luck rather than detection.
- **Fix:** a `visiting_hours` pattern that needs a time range (`10 AM to 12 noon`, `5:30 pm - 7:00 pm`) in the same sentence as "visiting hours" (or "visitor hours"). It cannot cross a sentence boundary. Values are normalised so "4 PM to 6 PM" and "4 pm - 6 pm" are not reported as a conflict.
- **Tests:** `test_conflict_patterns.py` covers extraction, three negative cases (other sentence, "visiting the dean", library hours), a contradiction flagged end to end in chat, and identical hours not flagged. They failed before the change. The fee tests and `test_rag.py` still pass.
- **Real check:** `integration_real.py` now requires the engine to flag it, not just the model to mention both days; it passes.
- **Remaining limit:** detection is regex-based. Only attendance, fees, CGPA and visiting hours are recognised. Different days with different hours in two documents are still flagged, and the admin must review them.

## Failure paths

| Scenario | Evidence | Kind |
|---|---|---|
| Gemini 429 retried then reported; timeout; unreachable; bad key not retried; empty reply | `test_ai_provider_errors.py` | Automated |
| Bad Gemini key through a live server | HTTP 503, friendly message with `request_id`, no chat session created | Real server, fake key |
| Gemini unavailable during upload | `test_upload_during_an_ai_outage_explains_the_file_is_fine` | Automated |
| Database connection failure | `test_database_outage_is_a_clear_503_not_a_generic_500` | Automated |
| Cloudinary upload failure | New `test_cloudinary_upload_failure_is_a_503_and_leaves_nothing_behind`: 503, no leaked detail, no document, no temp file. Also seen live with a fake Cloudinary config | Automated and real server |
| Scheduler failure | New `test_scheduler_failure_...`: a failure after the claim cannot cause a double send on retry (at-most-once). New `test_scheduler_endpoint_error_does_not_leak_internals` | Automated |
| Interrupted request | A failing AI call keeps no half-saved question (`test_chat_returns_a_clear_503_and_keeps_no_half_saved_question`); a failed upload leaves no record. A client abort mid-request was not simulated | Automated (partial) |
| Blank and oversized chat input | `test_blank_or_oversized_chat_message_is_rejected_and_creates_nothing` | Automated |
| Prompt injection in a retrieved document | New `test_instructions_inside_a_source_stay_in_the_data_part_of_the_prompt` (injected text stays in the sources part, never in the system prompt; rule 9 present). Real Gemini ignored 3 variants | Automated and real |
| Secrets in logs | Fake key and secret did not appear in the server log | Real server |

## Bugs fixed in this work

1. Fee-conflict regex skipped matching text and could cross sentences (`conflict_engine.py`; `test_conflict_patterns.py`).
2. Visiting-hours contradictions were never detected (above).
3. Production started silently with a keyless AI provider. `offline_fallbacks()` in `config.py` now logs which features would fall back (names only).
4. **New:** an unhandled-exception 500 carried `request_id` in the body but not the `X-Request-ID` header, because the response is built outside the logging middleware. Fixed in `backend/app/main.py`; `test_scheduler_endpoint_error_does_not_leak_internals` asserts the header equals the body value.
5. Earlier, still uncommitted: blank or oversized chat messages rejected; prompt-injection rule in `SYSTEM_PROMPT`.

## Final verification

| Check | Result |
|---|---|
| Backend pytest (`.venv/Scripts/python -m pytest -q`) | 272 passed, 1 warning (259 before this pass, plus 13 new) |
| `npx tsc -b` | clean |
| `npm run build` | clean |
| `npm run lint` | exit 0, warnings only (`only-export-components`) |
| Mock API journeys (`e2e/api_journeys.py`) | 137/137, assertions unchanged |
| Mock browser journeys (`e2e/browser_journeys.mjs`) | 38/38, assertions unchanged. The one console error is the deliberate bad-password 401 |
| Real integration (`e2e/integration_real.py`) | 46/46 on a fresh DB. A first rerun on a reused DB showed one failure for assets the earlier run had already destroyed; a fresh-DB rerun passed |
| Real faculty journey (`e2e/faculty_real.mjs`) | 11/11 |
| Real browser journey (`e2e/browser_real.mjs`) | 10/10 |
| Real push (`e2e/push_real.mjs`) | 9/9 |
| Reminder idempotency (`e2e/reminder_idempotency.py`) | PASS |

The e2e scripts need their servers: `e2e/serve_isolated.sh` (mock) or `e2e/serve_integration.sh` (real services, SQLite), plus Vite with `VITE_API_BASE_URL=http://127.0.0.1:8000`, and a `tmp/e2e/` directory. Both API scripts need a fresh database.

## Blocked or not verified

- PostgreSQL migrations and writes, as described above.
- Web Push notification click handling; delivery with the browser fully closed.
- Gemini rate limiting against the real API (only simulated); behaviour under load.
- Supabase being down (simulated through a faked connection error only).
- Accessibility, mobile menu interactions, and the export dialog against real services.
- Real student or faculty accounts and production data were deliberately not used.

## Remaining production requirements

- Run the migration and persistence checks on an isolated PostgreSQL before relying on Supabase.
- Set a real `SECRET_KEY` and `CRON_SECRET`, and schedule `process-reminders`.
- Check notification click-through in a normal browser profile.
- Decide whether damaged-but-valid-looking PDFs should be rejected rather than stored as `failed`.
- Extend conflict topics as the college's documents require.

## Files changed by this work (not committed)

Modified: `backend/app/core/config.py`, `backend/app/main.py`, `backend/app/rag/pipeline.py`, `backend/app/schemas/schemas.py`, `backend/app/services/conflict_engine.py`, `backend/tests/test_config_guard.py`, `backend/tests/test_error_handling.py`.

New: `backend/tests/test_conflict_patterns.py`, `backend/tests/test_failure_paths.py`, `backend/tests/test_postgres_ddl.py`, `docs/TEST_REPORT.md`, `docs/REAL_INTEGRATION_TEST_REPORT.md`, `e2e/` (scripts only). Temporary databases, logs, the browser profile and screenshots lived in `tmp/e2e/` and were deleted.
