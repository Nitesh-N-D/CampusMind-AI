# Deployment - Step by Step

This deploys CampusMind AI to the internet on free-tier infrastructure:
**Vercel** (frontend), **Render** (backend), **Supabase** (database),
**Cloudinary** (profile pictures), **Google Gemini** (AI). None of these
require a credit card at the free tier used here.

Total time: roughly 30-45 minutes for a first deployment.

---

## Step 1 - Push the code to GitHub

```bash
cd campusmind-ai
git init
git add .
git commit -m "Initial commit"
```

Create a new (private is fine) repository on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/campusmind-ai.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `.env`, `node_modules/`, `venv/`, and local
database files - you won't accidentally commit secrets.

## Step 2 - Database (Supabase)

1. Go to <https://supabase.com>, sign up free, create a new project.
2. Wait for it to finish provisioning (~2 minutes).
3. Go to **Project Settings → Database → Connection string**, copy the
   **URI** format connection string (starts with `postgresql://`).
4. Replace `postgresql://` with `postgresql+psycopg://` at the start - this
   tells SQLAlchemy which driver to use. Keep this string handy for Step 3.

You don't need to create any tables manually - the backend creates them
automatically on first boot via `Base.metadata.create_all`, then runs
`app/db/migrations.py`. On a database created by an older version, that
step adds any new columns and **drops the tables of removed features**
(`notifications`, `extracted_events`, `document_change_logs`), deleting
their rows. Back up first if you want to keep that data.

## Step 3 - Backend (Render)

1. Go to <https://render.com>, sign up free (GitHub sign-in is easiest).
2. **New → Web Service**, connect your GitHub repo.
3. Settings:
   - **Root Directory**: `backend`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: Free
4. Under **Environment**, add these variables (values from your own
   accounts). **`SECRET_KEY` is mandatory on Render.** With
   `ENVIRONMENT=production` the backend refuses to start (the deploy fails
   with a `SECRET_KEY is missing or still a development placeholder` error in
   the logs) if `SECRET_KEY` is unset, is a placeholder such as the one in
   `.env.example`, or is shorter than 32 characters. Without this check anyone
   could forge login tokens, because the built-in development key is public.
   The error never prints the key. Changing `SECRET_KEY` later signs everyone
   out.

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the `postgresql+psycopg://...` string from Step 2 |
   | `ENVIRONMENT` | `production` (turns on the startup safety checks below; see also the storage note under "Notifications, reminders and attachments") |
   | `SECRET_KEY` | **required.** Run `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` locally and paste the result (at least 32 characters) |
   | `AI_PROVIDER` | `gemini` |
   | `GEMINI_API_KEY` | your key from <https://aistudio.google.com/apikey> |
   | `EMBEDDING_PROVIDER` | `gemini` |
   | `FRONTEND_ORIGIN` | leave as `http://localhost:5173` for now - you'll update this in Step 5 once you know your real frontend URL |
   | `CLOUDINARY_CLOUD_NAME` | from your Cloudinary dashboard (optional) |
   | `CLOUDINARY_API_KEY` | from your Cloudinary dashboard (optional) |
   | `CLOUDINARY_API_SECRET` | from your Cloudinary dashboard (optional) |

5. The Postgres driver (`psycopg[binary]`) is already in
   `backend/requirements.txt`, so nothing to add.
6. Click **Create Web Service**. Wait for the build and deploy to finish.
   The OCR dependencies (`rapidocr-onnxruntime`, which pulls in
   `onnxruntime` and `opencv-python`) make this a fairly large install, so
   the first build takes longer than a plain FastAPI app. `uharfbuzz`
   (text shaping for Tamil/Hindi in chat PDF exports) ships prebuilt Linux
   wheels, so no compiler is needed. The PDF fonts are committed under
   `backend/app/assets/fonts/`, so nothing is downloaded at runtime.
7. Once live, visit `https://your-service.onrender.com/api/health`. A
   `401 {"detail":"Not authenticated"}` response confirms the API is up -
   the health check requires sign-in by design. Leave Render's "Health
   Check Path" blank (or point it at `/docs`); a path returning 401 would
   be treated as unhealthy.

**Free tier note**: Render's free web services spin down after 15 minutes
of inactivity. The first request after idle takes ~30-50 seconds to wake
up - normal, not a bug. Upgrade to a paid instance if that matters for your
users.

**OCR and memory note**: the OCR model loads the first time an image or
scanned PDF is uploaded after each start, then stays in memory (about 65 MB).
The app itself needs about 145 MB. Recognition memory grows with the number of
pixels, so pictures are shrunk to a 1600 px longest side and read in
overlapping bands (`MAX_OCR_SIDE`, `OCR_BAND_PIXELS` in
`app/ingestion/extractors.py`), one at a time, and at most two uploads are
indexed at once (`MAX_CONCURRENT_INGESTIONS` in
`app/services/document_upload.py`). On a developer's Windows machine a 12 MP
photo peaked near 440 MB (700+ MB before this limit existed) - local numbers,
not Render's. Run a single uvicorn process (no `--workers`, and no
`WEB_CONCURRENCY` above 1): each worker would load its own copy of the app and
the OCR model. After a deploy, check Render's Metrics tab while uploading a
phone photo and a scanned PDF; if memory still approaches 512 MB, lower
`MAX_UPLOAD_MB` or move to a larger instance.

## Step 4 - Frontend (Vercel)

1. Go to <https://vercel.com>, sign up free (GitHub sign-in is easiest).
2. **Add New → Project**, import your GitHub repo.
3. Settings:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (should auto-detect)
4. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://your-service.onrender.com` (from Step 3) |

5. Click **Deploy**. Wait ~1-2 minutes.
6. You'll get a URL like `https://campusmind-ai.vercel.app`.

## Step 5 - Connect the two (CORS)

Go back to Render → your backend service → **Environment**, and update:

```
FRONTEND_ORIGIN=https://campusmind-ai.vercel.app
```

(use your actual Vercel URL). Save - Render will redeploy automatically.
Without this step, the browser will block every API request with a CORS
error.

## Step 6 - Verify the live deployment

Visit your Vercel URL and repeat the demo flow from `SETUP.md` step 4 -
register a college, upload documents in a few formats, sign up a student,
ask a question, then check **Login activity** as the admin.
If everything in that walkthrough works against your live URLs, you're
fully deployed.

## Step 7 - SEO finishing touches

`frontend/index.html`, `frontend/public/robots.txt`, and
`frontend/public/sitemap.xml` currently point at
`https://campus-mind-ai-delta.vercel.app`. If you deploy under a different
Vercel (or custom) domain, find-and-replace every occurrence with yours,
commit, and redeploy.

The production origin is also hard-coded as `SITE_ORIGIN` in
`frontend/src/lib/usePageMeta.ts` (used for per-route canonicals), and the
`og:image`, `og:url`, `twitter:image` and JSON-LD URLs in `index.html` use it
too. Update all of them together.

Other SEO and PWA files, all in `frontend/public/`: `site.webmanifest`,
`og-image.png` (1200x630), `favicon.ico`, `favicon.svg`, the PNG favicons,
`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, and
`icon-maskable-512.png`. Vercel serves these as static files before the SPA
rewrite, so `vercel.json` needs no change. `robots.txt` blocks private routes
as a courtesy to crawlers only; it is not access control.

### Google Search Console

1. With your frontend live at its real domain, go to
   <https://search.google.com/search-console> and add your domain as a
   property (the "URL prefix" method is simplest for a Vercel subdomain).
2. Choose the **HTML tag** verification method, copy the `content` value
   it gives you.
3. Add it to `frontend/index.html`:
   ```html
   <meta name="google-site-verification" content="YOUR_CODE_HERE" />
   ```
4. Commit, push (Vercel redeploys automatically), then click **Verify** in
   Search Console.
5. Under **Sitemaps**, submit `https://yourdomain.com/sitemap.xml`.

## Step 8 - Custom domain (optional)

Both Vercel and Render support custom domains free. In Vercel: **Project →
Settings → Domains**. In Render: **Service → Settings → Custom Domains**.
Point your domain's DNS as each dashboard instructs, then repeat Step 5
with the new frontend domain and Step 7 with both new domains.

---

## Notifications, reminders and attachments

**Cloudinary is required for document and notification attachments in
production.** Render's disk is ephemeral, so with `ENVIRONMENT=production`
and no `CLOUDINARY_*` values, uploads return a clear 503 instead of silently
losing files. Attachments are stored as authenticated assets and served only
through `GET /api/documents/{id}/file` after a permission check; storage URLs
and paths are never sent to the browser. Local-disk storage is a dev/test
fallback only.

**Scheduled reminders** (7, 3, 1 days before, and the day of) are sent by
calling one endpoint from an external scheduler every 15-60 minutes - there
is no always-on worker, which keeps the free tier working:

```
curl -X POST https://<your-backend>/api/notifications/process-reminders      -H "X-Cron-Secret: $CRON_SECRET"
```

1. Set `CRON_SECRET` on Render (a long random string).
2. Create the schedule with Render Cron Jobs, GitHub Actions `schedule:`,
   or any external cron service (e.g. cron-job.org).
3. The endpoint is idempotent: each reminder is claimed atomically and fires
   once, so overlapping or repeated calls are safe.

**Known limitations**

- Reminders are only as punctual as the scheduler interval, and a cold-starting
  free-tier backend may delay a run.
- Browser alerts use the foreground Notification API: they appear while
  CampusMind is open in a tab. Background delivery with the tab closed is the
  separate Web Push channel below. The in-app bell and Notifications page
  always work, including when browser permission is denied or unsupported.
- "Day of" reminders fire 6 hours before the deadline/event time. Day
  boundaries follow UTC on the server; the app shows times in the viewer's
  local zone.
- Date detection in uploaded documents is day-first (`12/10/2026` = 12 Oct)
  and requires an explicit year. Detected dates are suggestions: nothing is
  published until an admin clicks "Publish Reminder".
- **PostgreSQL behaviour has only been tested locally on SQLite.** After
  deploying, verify on Supabase: startup migration (new `documents` storage
  columns, `notifications.push_sent_at` and the notification and
  `push_subscriptions` tables), publishing with an attachment, per-user read
  state, and one `process-reminders` run.

### Background notifications (Web Push)

An additional channel on top of the in-app bell and 60s polling, which are
unchanged. Students and faculty click **Enable Background Notifications** on
the Notifications page (never prompted automatically); a service worker
(`frontend/public/sw.js`) then shows notifications with the tab closed.

1. **Generate keys** (once, locally): `python backend/scripts/generate_vapid_keys.py`.
   It prints to the terminal only. Never commit the output.
2. **Render environment** (backend only): `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:you@college.edu` or an
   `https://` URL). The private key is never a `VITE_*` variable and never
   reaches the browser; the frontend fetches the public key from
   `GET /api/push/status`, so Vercel needs no new variables.
3. **Rotating keys** invalidates every existing subscription. Users must turn
   background notifications off and on again (dead subscriptions are
   deactivated automatically on their next failed delivery).
4. **HTTPS is required** (Vercel and Render provide it); service workers and
   push do not work on plain HTTP except `localhost`.
5. **Service worker scope**: served from `/sw.js` with scope `/`;
   `frontend/vercel.json` sets `no-cache` on it so updates ship immediately.
6. **When pushes are sent**: once when a notification goes live (immediately
   on publish, or at the next `process-reminders` run for scheduled ones and
   published drafts), and once per fired reminder (7/3/1/0 days). Editing and
   archiving never push. Existing notifications are marked as already pushed
   by the migration, so enabling push does not resend old notices.
7. **Latency**: scheduled items and reminders are pushed by the scheduler, so
   delay equals the scheduler interval (15-60 minutes).
8. **Who receives**: active students and faculty of the notification's own
   college, matching its audience. Administrators publish and are not push
   targets. Several devices per user are supported; subscribe endpoints are
   restricted to the browsers' push services (FCM, Mozilla, Windows, Apple).
9. **Failures**: a failing device never blocks the others or the publish.
   404/410 responses deactivate the subscription; other failures are counted.
10. **Shared devices**: signing in as another user on the same browser
    re-binds that browser's subscription to the new user. Signing out does not
    unsubscribe; use **Turn off** before handing a device over.
11. **Troubleshooting**: `GET /api/push/status` shows `configured` and device
    count; check the Render logs for "push delivery failed"; ensure the
    browser's site notification permission is Allow and the OS isn't in
    Do Not Disturb.

**Not verified locally** (needs a real deployment and browser): delivery
through the real FCM/Mozilla/Apple services, service worker behavior on
Android/iOS (iOS needs the site added to the Home Screen), OS-level
notification display, Render Cron timing, real Supabase Postgres and real
Cloudinary uploads. Automated tests mock the push network call.

## Ongoing costs at scale

Everything above is free at low-to-moderate usage. Two things to watch as
a deployment grows past a single-department pilot:

- **Gemini's free tier** has per-minute and per-day request caps - check
  current limits at <https://ai.google.dev/pricing>. Swapping providers or
  tiers is a one-line `.env` change (`AI_PROVIDER=openai` etc.), no code
  changes, thanks to the provider abstraction in `app/services/ai_provider.py`.
- **Render's free tier** has a monthly usage cap and spins down on idle.
  For a real always-on department deployment, the ~$7/mo starter tier
  removes both limitations.

## Rolling back or debugging a bad deploy

- Render keeps deploy history under **Service → Events** - roll back to
  any previous successful deploy with one click.
- Vercel keeps every deployment under **Project → Deployments** - promote
  any previous one back to production instantly.
- Every backend response includes an `X-Request-ID` header, and matching
  entries appear in Render's log stream - if a user reports "it broke",
  ask for that ID and search the logs for it rather than guessing.
