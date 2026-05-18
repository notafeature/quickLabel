"""Database connection, init, and small helpers."""
from __future__ import annotations

import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(os.environ.get("QL_DATA_DIR", "/app/data"))
DB_PATH = DATA_DIR / "quicklabel.db"
PHOTOS_DIR = DATA_DIR / "photos"
SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def now_iso() -> str:
    """UTC ISO 8601 timestamp."""
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    """UUIDv4 as string."""
    return str(uuid.uuid4())


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)


def connect() -> sqlite3.Connection:
    ensure_dirs()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    """Context-managed connection that commits on success, rolls back on error."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Idempotent schema apply."""
    ensure_dirs()
    schema_sql = SCHEMA_PATH.read_text()
    with db() as conn:
        conn.executescript(schema_sql)


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]
