"""Offline PostgreSQL check: no connection is made. It proves the models
compile to valid Postgres DDL; it does not prove migrations or queries run on
a live Postgres server."""
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.db.database import Base
from app.db import models  # noqa: F401  (registers the tables)


def test_every_table_and_index_compiles_for_postgres():
    dialect = postgresql.dialect()
    assert len(Base.metadata.sorted_tables) >= 13
    for table in Base.metadata.sorted_tables:
        ddl = str(CreateTable(table).compile(dialect=dialect))
        assert ddl.startswith("\nCREATE TABLE")
        for index in table.indexes:
            str(CreateIndex(index).compile(dialect=dialect))
