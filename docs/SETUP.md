# Setup - Step by Step

This covers running CampusMind AI on your own machine for development.
For putting it on the internet, see `DEPLOYMENT.md`.

## 1. Prerequisites

- Python 3.11 or newer (`python3 --version`)
- Node.js 20 or newer (`node --version`)
- A free Google Gemini API key (optional but recommended) -
  <https://aistudio.google.com/apikey>
- A free Cloudinary account (optional, only needed for profile picture
  uploads) - <https://cloudinary.com/users/register/free>

Nothing else is required. No database server to install, no Docker, no
paid services.

## 2. Get the code running - backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows (PowerShell): venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
```

Open `backend/.env` in an editor and fill in:

```env
# Generate a real one with: python3 -c "import secrets; print(secrets.token_urlsafe(48))"
SECRET_KEY=change-this-to-a-long-random-string

# Get a free key at https://aistudio.google.com/apikey
AI_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key-here

EMBEDDING_PROVIDER=gemini
```

You can leave `GEMINI_API_KEY` blank to run in offline demo mode - every
feature works except the actual generated answer text, which is replaced
with a clearly-labeled offline placeholder. Good for developing the UI or
running the test suite; add a real key before demoing the chat itself.

Start the server:

```bash
python3 -m uvicorn app.main:app --reload --port 8000
```

Check it's alive: open <http://localhost:8000/api/health> - you should see
`{"status":"ok",...}`. The full interactive API reference is at
<http://localhost:8000/docs>.

### 2a. Optional: enable profile picture uploads (Cloudinary)

1. Sign up free at <https://cloudinary.com/users/register/free> (no credit
   card required).
2. On your Cloudinary dashboard, copy your **Cloud name**, **API Key**, and
   **API Secret**.
3. Add them to `backend/.env`:
   ```env
   CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=your-api-key
   CLOUDINARY_API_SECRET=your-api-secret
   ```
4. Restart the backend. Profile picture upload on the Profile page will now
   work. Without this, the upload button still works but returns a clear
   "not set up yet" message instead of a broken 500 - it never pretends to
   save a photo it can't.

### 2b. Run the backend test suite

```bash
python3 -m pytest tests/ -v
```

This runs against an isolated in-memory database created fresh for the
test run - it never touches your real `campusmind.db`, and Cloudinary
credentials aren't required (avatar tests confirm the "not configured"
error path works correctly instead of needing real cloud storage).

## 3. Get the code running - frontend

Open a **second terminal** (leave the backend running in the first):

```bash
cd frontend
npm install
cp .env.example .env
```

`frontend/.env` should already point at your local backend:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Start it:

```bash
npm run dev
```

Visit <http://localhost:5173>.

### Production build (to check it compiles cleanly before deploying)

```bash
npm run build
```

Outputs a static site to `frontend/dist/`. Preview it locally with
`npm run preview`.

## 4. Try the full demo flow

1. Go to <http://localhost:5173/register-college>. Enter your college name
   and its real email domain (e.g. `mitindia.edu`) - this becomes the gate
   for who can sign up. You become that workspace's first admin.
2. You're redirected to the admin dashboard. Go to **Documents** → **Upload
   document**. Try the sample PDFs in `backend/seed_data/` (clearly marked
   as demo data) - upload `attendance_reg_2025.pdf` first.
3. Upload `attendance_reg_2026.pdf`, and in the "Supersedes" dropdown pick
   the 2025 document you just uploaded.
4. Check **What changed?** in the sidebar - you should see the diff between
   75% and 80% attendance with an impact summary.
5. Sign out. Go to `/register` and create a student account using an email
   on the same domain (e.g. `test@mitindia.edu`).
6. In **Ask CampusMind**, ask "What is the minimum attendance requirement?"
   - the assistant should flag the conflict between the two documents and
   cite both, with a visible trust score on each.
7. Try the command palette (`Ctrl+K` or `Cmd+K`), the microphone icon in
   chat (if your browser supports it - Chrome and Edge do), and exporting
   the conversation from the download icon in the chat header.
8. Sign back in as admin, go to **Conflicts**, and resolve the one you just
   triggered.
9. Check **Knowledge health** - the score and document counts should
   reflect what you uploaded.

If every step above works, your local setup is fully functional.

## 5. Common issues

| Symptom | Fix |
|---|---|
| Frontend shows a network error on every page | Backend isn't running, or `VITE_API_BASE_URL` in `frontend/.env` doesn't match where it's running. |
| CORS error in the browser console | `FRONTEND_ORIGIN` in `backend/.env` doesn't match the URL you're actually visiting the frontend from. |
| Chat answers say "Offline demo mode" | No `GEMINI_API_KEY` set - see step 2. |
| Profile picture upload fails with a 503 | Cloudinary isn't configured yet - see step 2a. This is intentional, not a bug. |
| `pip install` fails on a package | Make sure you activated the virtual environment (`source venv/bin/activate`) first. |
