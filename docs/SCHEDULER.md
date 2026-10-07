# Reminder scheduler

Scheduled reminders (7, 3, 1 days before, and the day of) are only sent when something calls the processor. Nothing in this repository runs it automatically.

**Status: IMPLEMENTED and TESTED (unit/integration tests). NOT DEPLOYED. NOT PRODUCTION VERIFIED.** No cron job has been created or observed running by this work.

## Two ways to run it

Target frequency: every 15 minutes, cron expression `*/15 * * * *`. Render Cron Jobs and GitHub Actions schedules use **UTC**.

1. **HTTP endpoint** (works with any external scheduler):

   ```
   curl -X POST https://<your-backend>/api/notifications/process-reminders -H "X-Cron-Secret: $CRON_SECRET"
   ```

   Requires `CRON_SECRET` to be set on the backend. Without it the endpoint refuses every call.

2. **Script** (for a Render Cron Job that shares the backend's environment):

   ```
   cd backend && python scripts/process_reminders.py
   ```

   It calls the same reminder processor and the same background-push release step in-process, exits 0 on success and 1 on failure. On failure it prints only the exception type, never connection strings or secrets.

Both paths are idempotent: each reminder is claimed atomically, so overlapping runs do not send duplicates.

## Environment variables

| Variable | Needed by | Purpose |
| --- | --- | --- |
| `CRON_SECRET` | endpoint | Shared secret in the `X-Cron-Secret` header |
| `DATABASE_URL` | script | Same database as the web service |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | both | Web Push signing; without them pushes are skipped |

## Verifying after you deploy it

1. Trigger the job once by hand and check for exit code 0 / HTTP 200.
2. Create a notification with a due date a few minutes ahead and a reminder, then confirm it is delivered once.
3. Only after that should it be treated as production verified.

## Tests

`backend/tests/test_insights.py` covers the script (success and a failure that must not leak the exception message). The test suite never sends real Web Push or touches real Cloudinary or Supabase; `backend/tests/conftest.py` forces an isolated environment.
