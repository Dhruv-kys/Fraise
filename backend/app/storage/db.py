"""SQLite for Fraise's local stores (memory now, RAG vectors later).

One file on disk, no server. Schema changes are forward-only migrations keyed
by SQLite's built-in `PRAGMA user_version`.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "fraise.db"

# Ordered, forward-only. Index i runs to reach user_version i+1.
_MIGRATIONS = [
    # 1 — memory store. FTS5 gives full-text recall; session_id scopes each row
    # to one user, created_at is carried for recency ordering.
    """
    CREATE VIRTUAL TABLE memories USING fts5(
        content,
        session_id UNINDEXED,
        created_at UNINDEXED
    );
    """,
]


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    _migrate(conn)
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for i in range(version, len(_MIGRATIONS)):
        conn.executescript(_MIGRATIONS[i])
        conn.execute(f"PRAGMA user_version = {i + 1}")
        conn.commit()
