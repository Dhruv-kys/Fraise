import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import sqlite_vec

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "fraise.db"

_MIGRATIONS = [
    """
    CREATE VIRTUAL TABLE memories USING fts5(
        content,
        session_id UNINDEXED,
        created_at UNINDEXED
    );
    """,
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
    """
    CREATE TABLE conversation_turns (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content TEXT,
        created_at TEXT
    );
    """,
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
    try:
        body = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        logger.warning("skipping malformed artifact record")
        return None
    if not isinstance(body, dict) or not body.get("sections"):
        return None
    return body

def get_artifact(artifact_id: str, session_id: str) -> dict | None:
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
    valid: list[dict] = []
    for row in rows:
        if _artifact_body(row["body"]):
            valid.append({key: row[key] for key in ("id", "title", "format", "created_at")})
            if len(valid) == limit:
                break
    return valid
