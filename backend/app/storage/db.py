"""SQLite for Fraise's local stores (memory and RAG vectors).

One file on disk, no server. Schema changes are forward-only migrations keyed
by SQLite's built-in `PRAGMA user_version`. The sqlite-vec extension is loaded on
every connection so the RAG `vec0` table is queryable.
"""
import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import sqlite_vec

logger = logging.getLogger(__name__)

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
    # 4 — research artifacts. `body` is the whole rendered artifact as JSON
    # (sections, citations, which agents contributed); it's write-once per run,
    # so there's nothing to gain from normalizing it into tables.
    """
    CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        title TEXT,
        format TEXT,
        body TEXT,
        created_at TEXT
    );
    CREATE INDEX idx_artifacts_session ON artifacts (session_id, created_at DESC);
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


# ---------- artifacts ----------

def new_id() -> str:
    return uuid4().hex


def save_artifact(artifact_id: str, session_id: str, title: str, fmt: str, body: str) -> None:
    conn = connect()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO artifacts (id, session_id, title, format, body, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (artifact_id, session_id, title, fmt, body, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def _artifact_body(raw: str) -> dict | None:
    """Read stored artifact JSON without turning one bad row into a 500."""
    try:
        body = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        logger.warning("skipping malformed artifact record")
        return None
    if not isinstance(body, dict) or not body.get("sections"):
        return None
    return body


def get_artifact(artifact_id: str, session_id: str) -> dict | None:
    """Scoped by session_id as well as id — an artifact id is a guessable handle,
    and one browser must never be able to read another's research."""
    conn = connect()
    try:
        row = conn.execute(
            "SELECT id, title, format, body, created_at FROM artifacts "
            "WHERE id = ? AND session_id = ?",
            (artifact_id, session_id),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    body = _artifact_body(row["body"])
    # Older versions saved an artifact even when every provider call failed.
    # Those records have no content, so don't surface a blank document to users.
    if not body:
        return None
    return {
        "id": row["id"],
        "title": row["title"],
        "format": row["format"],
        "created_at": row["created_at"],
        **body,
    }


def list_artifacts(session_id: str, limit: int = 20) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT id, title, format, body, created_at FROM artifacts WHERE session_id = ? "
            "ORDER BY created_at DESC",
            (session_id,),
        ).fetchall()
    finally:
        conn.close()
    # Filter the historical empty artifacts created by the old failure path.
    valid: list[dict] = []
    for row in rows:
        if _artifact_body(row["body"]):
            valid.append({key: row[key] for key in ("id", "title", "format", "created_at")})
            if len(valid) == limit:
                break
    return valid
