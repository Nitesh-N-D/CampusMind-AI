"""
Minimal, idempotent schema upgrades for databases created by an earlier
version of this app. `Base.metadata.create_all()` creates missing tables but
never alters existing ones, so columns added to an existing table need an
explicit step here. Each step checks the live schema first and is safe to
run on every startup, on both SQLite and Postgres.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db.database import Base
from app.db import models  # noqa: F401 - registers every table on Base.metadata


def apply_migrations(engine: Engine) -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    if "colleges" in tables:
        columns = {c["name"] for c in inspector.get_columns("colleges")}
        if "faculty_domain" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE colleges ADD COLUMN faculty_domain VARCHAR(255)"))
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_colleges_faculty_domain "
                        "ON colleges (faculty_domain)"
                    )
                )

    if "documents" in tables:
        columns = {c["name"] for c in inspector.get_columns("documents")}
        for name, ddl in DOCUMENT_STORAGE_COLUMNS:
            if name not in columns:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE documents ADD COLUMN {name} {ddl}"))

    # Set once per notification when its Web Push is claimed. Rows that already
    # exist are marked as pushed, so turning push on never blasts old notices.
    # (The push_subscriptions table itself is created by create_all.)
    if "notifications" in tables:
        columns = {c["name"] for c in inspector.get_columns("notifications")}
        if "push_sent_at" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE notifications ADD COLUMN push_sent_at TIMESTAMP"))
                source = "published_at" if "published_at" in columns else "CURRENT_TIMESTAMP"
                conn.execute(text(f"UPDATE notifications SET push_sent_at = {source} WHERE push_sent_at IS NULL"))

    # Tables for features that were removed from the product (the Timeline
    # page and What Changed?). Nothing reads or writes them any more; dropping
    # them keeps the schema honest about what the app does. A table the
    # current models define is never dropped, whatever this list says.
    live = set(Base.metadata.tables)
    removed = [t for t in REMOVED_TABLES if t in tables and t not in live]
    if removed:
        with engine.begin() as conn:
            for table in removed:
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


REMOVED_TABLES = ("extracted_events", "document_change_logs")

# Nullable so existing documents (local file_path only) keep working untouched.
DOCUMENT_STORAGE_COLUMNS = (
    ("storage_provider", "VARCHAR(20)"),
    ("storage_key", "VARCHAR(500)"),
    ("storage_url", "VARCHAR(1000)"),
    ("mime_type", "VARCHAR(120)"),
    ("file_size", "INTEGER"),
    ("detected_events", "JSON"),
)
