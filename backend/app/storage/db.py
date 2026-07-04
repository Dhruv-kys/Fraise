"""SQLite for Fraise's local stores (memory and RAG vectors).

One file on disk, no server. Schema changes are forward-only migrations keyed
by SQLite's built-in `PRAGMA user_version`. The sqlite-vec extension is loaded on
every connection so the RAG `vec0` table is queryable.
"""
import sqlite3
from pathlib import Path

import sqlite_vec

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
    # 2 — RAG store. `chunks` (FTS5) doubles as the chunk text store and the
    # BM25 lexical index; its rowid is the chunk id that `vec_chunks` keys on for
    # dense search. session_id is a vec0 metadata column so KNN stays per-user.
    """
    CREATE TABLE documents (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        filename TEXT,
        uploaded_at TEXT,
        char_count INTEGER,
        text TEXT
    );
    CREATE VIRTUAL TABLE chunks USING fts5(
        text,
        session_id UNINDEXED,
        document_id UNINDEXED,
        ordinal UNINDEXED
    );
    CREATE VIRTUAL TABLE vec_chunks USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        session_id TEXT,
        embedding float[512]
    );
    """,
    # 3 — conversation transcript, so a new connection (reload, reconnect, a
    # returning session days later) can be handed recent context instead of
    # starting cold. Plain table, not FTS: this needs recency order, not search.
    """
    CREATE TABLE conversation_turns (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content TEXT,
        created_at TEXT
    );
    """,
]


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    _migrate(conn)
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for i in range(version, len(_MIGRATIONS)):
        conn.executescript(_MIGRATIONS[i])
        conn.execute(f"PRAGMA user_version = {i + 1}")
        conn.commit()
