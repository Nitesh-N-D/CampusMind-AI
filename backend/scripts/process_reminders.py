"""Runs one reminder + scheduled-push pass for every college, then exits.

This is the same work as POST /api/notifications/process-reminders, but it runs
in-process, so a scheduler (Render Cron Job, GitHub Actions, system cron) needs
no HTTP call, no cold-start wait on the web service and no CRON_SECRET - only
the same DATABASE_URL / VAPID_* environment variables as the web service.

    python scripts/process_reminders.py

Exit code 0 on success, 1 if the pass failed (so the scheduler shows the run as
failed). Safe to run as often as you like: reminders and pushes are claimed
atomically and each fires once. Prints counts only - never secrets.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def run() -> dict:
    from app.db.database import SessionLocal
    from app.services import push_service, reminder_service

    db = SessionLocal()
    try:
        result = reminder_service.process_due_reminders(db, college_id=None)
        result["pushed"] = result.get("pushed", 0) + push_service.release_due_pushes(db, None)
        return result
    finally:
        db.close()


def main() -> int:
    try:
        result = run()
    except Exception as exc:  # noqa: BLE001 - report any failure as a failed run
        print(f"process_reminders FAILED: {type(exc).__name__}", file=sys.stderr)
        return 1
    print(f"process_reminders ok: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
