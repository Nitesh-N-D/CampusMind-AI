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
   accounts):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the `postgresql+psycopg://...` string from Step 2 |
   | `SECRET_KEY` | run `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` locally and paste the result |
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

**OCR note**: the OCR model loads the first time an image or scanned PDF
is uploaded after each start (several seconds locally), then stays in
memory. Memory use on Render's smallest instance hasn't been measured for
this build; if image uploads fail there with out-of-memory errors, move to
a larger instance.

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
