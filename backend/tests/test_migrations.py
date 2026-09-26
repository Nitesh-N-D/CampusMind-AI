"""Startup migrations upgrade a database created by an older version of the
app without touching data that is still in use."""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.db.migrations import apply_migrations


def _old_schema_engine():
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE colleges (id INTEGER PRIMARY KEY, name VARCHAR(255), official_domain VARCHAR(255))"))
        conn.execute(text("INSERT INTO colleges (id, name, official_domain) VALUES (1, 'Old College', 'old.edu')"))
        for table in ("notifications", "extracted_events", "document_change_logs"):
            conn.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE search_logs (id INTEGER PRIMARY KEY, query VARCHAR(500))"))
        conn.execute(text("INSERT INTO search_logs (id, query) VALUES (1, 'attendance')"))
    return engine


def test_old_database_is_upgraded_and_removed_feature_tables_dropped():
    engine = _old_schema_engine()
    apply_migrations(engine)

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert tables == {"colleges", "search_logs"}
    assert "faculty_domain" in {c["name"] for c in inspector.get_columns("colleges")}

    with engine.connect() as conn:
        assert conn.execute(text("SELECT name, faculty_domain FROM colleges")).all() == [("Old College", None)]
        assert conn.execute(text("SELECT query FROM search_logs")).all() == [("attendance",)]


def test_migrations_are_idempotent():
    engine = _old_schema_engine()
    apply_migrations(engine)
    apply_migrations(engine)
    assert "notifications" not in inspect(engine).get_table_names()
