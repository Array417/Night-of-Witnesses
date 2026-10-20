import os
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from uuid import uuid4

from db.migrate import apply_migrations


def test_migration_is_repeatable():
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        apply_migrations(connection)
        assert apply_migrations(connection) == []
        assert connection.execute("SELECT to_regclass('match_players')").fetchone()[0]


def test_checksum_change_is_rejected(tmp_path):
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        apply_migrations(connection)
        source = Path("db/migration/001_initial.sql").read_text(encoding="utf-8")
        (tmp_path / "001_initial.sql").write_text(source + "\nSELECT 1;", encoding="utf-8")
        with pytest.raises(RuntimeError, match="checksum"):
            apply_migrations(connection, tmp_path)


def test_migration_failure_rolls_back_entire_schema(tmp_path):
    source = Path("db/migration/001_initial.sql").read_text(encoding="utf-8")
    (tmp_path / "001_initial.sql").write_text(source + "\nSELECT 1/0;", encoding="utf-8")
    schema = "migration_test_" + uuid4().hex
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        connection.execute(sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(schema)))
        with pytest.raises(psycopg.errors.DivisionByZero):
            apply_migrations(connection, tmp_path)
        assert connection.execute("SELECT to_regclass('users')").fetchone()[0] is None
        connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
