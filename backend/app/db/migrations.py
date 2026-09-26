"""
Minimal, idempotent schema upgrades for databases created by an earlier
version of this app. `Base.metadata.create_all()` creates missing tables but
never alters existing ones, so columns added to an existing table need an
explicit step here. Each step checks the live schema first and is safe to
run on every startup, on both SQLite and Postgres.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


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

    # Tables for features that were removed from the product (notifications,
    # the Timeline page, and What Changed?). Nothing reads or writes them any
    # more; dropping them keeps the schema honest about what the app does.
    removed = [t for t in REMOVED_TABLES if t in tables]
    if removed:
        with engine.begin() as conn:
            for table in removed:
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


REMOVED_TABLES = ("notifications", "extracted_events", "document_change_logs")
