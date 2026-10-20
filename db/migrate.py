import hashlib
import os
from pathlib import Path

import psycopg


def apply_migrations(connection, directory=None):
    directory = Path(directory or Path(__file__).parent / "migration")
    applied = []
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(823194621)")
        connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())")
        for source in sorted(directory.glob("*.sql")):
            version = source.name.split("_", 1)[0]
            content = source.read_text(encoding="utf-8")
            checksum = hashlib.sha256(content.encode()).hexdigest()
            previous = connection.execute("SELECT checksum FROM schema_migrations WHERE version = %s", (version,)).fetchone()
            if previous:
                if previous[0] != checksum:
                    raise RuntimeError(f"Migration {version} checksum mismatch")
                continue
            connection.execute(content)
            connection.execute("INSERT INTO schema_migrations(version, checksum) VALUES (%s, %s)", (version, checksum))
            applied.append(version)
    return applied


if __name__ == "__main__":
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        print("Applied migrations:", apply_migrations(connection))
