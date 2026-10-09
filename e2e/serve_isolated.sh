cd /d/campusmind-ai/backend
export ENVIRONMENT=test DATABASE_URL="sqlite:///../tmp/e2e/e2e.db" AI_PROVIDER=mock EMBEDDING_PROVIDER=local UPLOAD_DIR=../tmp/e2e/uploads SECRET_KEY="e2e-only-secret-key-xxxxxxxxxxxxxxxxxxxxxxxx" GEMINI_API_KEY= OPENAI_API_KEY= ANTHROPIC_API_KEY= CLOUDINARY_CLOUD_NAME= CLOUDINARY_API_KEY= CLOUDINARY_API_SECRET= CRON_SECRET=e2e-cron VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= VAPID_SUBJECT= FRONTEND_ORIGIN=http://127.0.0.1:5173
exec .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
