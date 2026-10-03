"""Startup migrations upgrade a database created by an older version of the
app without touching data that is still in use."""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.migrations import apply_migrations


def _old_schema_engine():
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE colleges (id INTEGER PRIMARY KEY, name VARCHAR(255), official_domain VARCHAR(255))"))
        conn.execute(text("INSERT INTO colleges (id, name, official_domain) VALUES (1, 'Old College', 'old.edu')"))
        for table in ("extracted_events", "document_change_logs"):
            conn.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE documents (id INTEGER PRIMARY KEY, title VARCHAR(500))"))
        conn.execute(text("INSERT INTO documents (id, title) VALUES (1, 'Old doc')"))
        conn.execute(text("CREATE TABLE search_logs (id INTEGER PRIMARY KEY, query VARCHAR(500))"))
        conn.execute(text("INSERT INTO search_logs (id, query) VALUES (1, 'attendance')"))
    return engine


def test_old_database_is_upgraded_and_removed_feature_tables_dropped():
    engine = _old_schema_engine()
    apply_migrations(engine)

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert tables == {"colleges", "search_logs", "documents"}
    assert "faculty_domain" in {c["name"] for c in inspector.get_columns("colleges")}

    with engine.connect() as conn:
        assert conn.execute(text("SELECT name, faculty_domain FROM colleges")).all() == [("Old College", None)]
        assert conn.execute(text("SELECT query FROM search_logs")).all() == [("attendance",)]


def test_migrations_are_idempotent():
    engine = _old_schema_engine()
    apply_migrations(engine)
    apply_migrations(engine)
    assert "extracted_events" not in inspect(engine).get_table_names()


def test_document_storage_columns_added_without_touching_existing_rows():
    engine = _old_schema_engine()
    apply_migrations(engine)
    columns = {c["name"] for c in inspect(engine).get_columns("documents")}
    assert {"storage_provider", "storage_key", "storage_url", "mime_type", "file_size", "detected_events"} <= columns
    with engine.connect() as conn:
        assert conn.execute(text("SELECT title, storage_key FROM documents")).all() == [("Old doc", None)]


def test_startup_never_drops_notification_tables():
    """A `notifications` table left over from the old removed feature, or
    created by the current models, must survive apply_migrations."""
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    with engine.begin() as conn:
        for table in ("notifications", "notification_reads", "scheduled_reminders"):
            conn.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, marker VARCHAR(20))"))
            conn.execute(text(f"INSERT INTO {table} (id, marker) VALUES (1, 'keep')"))
    apply_migrations(engine)
    apply_migrations(engine)
    with engine.connect() as conn:
        for table in ("notifications", "notification_reads", "scheduled_reminders"):
            assert conn.execute(text(f"SELECT marker FROM {table}")).all() == [("keep",)]


def test_removed_tables_list_excludes_live_tables():
    from app.db.database import Base
    from app.db.migrations import REMOVED_TABLES

    assert not set(REMOVED_TABLES) & set(Base.metadata.tables)


def test_notifications_push_sent_at_added_and_backfilled_idempotently():
    engine = _old_schema_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE notifications (id INTEGER PRIMARY KEY, title VARCHAR(255), published_at TIMESTAMP)"))
        conn.execute(text("INSERT INTO notifications (id, title, published_at) VALUES (1, 'Old', '2026-01-01 00:00:00')"))
    apply_migrations(engine)
    apply_migrations(engine)
    assert "push_sent_at" in {c["name"] for c in inspect(engine).get_columns("notifications")}
    with engine.connect() as conn:
        # Existing notices count as already pushed: enabling push never blasts old items.
        assert conn.execute(text("SELECT COUNT(*) FROM notifications WHERE push_sent_at IS NOT NULL")).scalar() == 1


def test_fresh_database_gets_push_tables():
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    apply_migrations(engine)
    apply_migrations(engine)
    inspector = inspect(engine)
    assert "push_subscriptions" in inspector.get_table_names()
    assert "push_sent_at" in {c["name"] for c in inspector.get_columns("notifications")}
    cols = {c["name"] for c in inspector.get_columns("push_subscriptions")}
    assert {"endpoint", "p256dh", "auth", "is_active", "last_success_at", "last_failure_at", "user_id", "college_id"} <= cols
