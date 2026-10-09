# Real-integration server: Gemini / Cloudinary / VAPID come from backend/.env
# (never printed). DATABASE_URL is forced to a throwaway SQLite file so the
# shared Supabase database is never written to. Run from anywhere.
cd "$(dirname "$0")/../backend"
mkdir -p ../tmp/e2e
export ENVIRONMENT=development DATABASE_URL="sqlite:///../tmp/e2e/integration.db" UPLOAD_DIR=../tmp/e2e/uploads_int \
  SECRET_KEY="integration-only-secret-key-xxxxxxxxxxxxxxxxxxxxxxxx" CRON_SECRET=int-cron FRONTEND_ORIGIN=http://127.0.0.1:5173
exec .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
