"""Session-scoped data access for the memory store.

Every query filters on session_id so one user never sees another's memories.
All FTS5-specific SQL lives here; the server module just speaks plain English.
"""
import re
from contextlib import closing
from datetime import datetime, timezone

from app.storage.db import connect


def _match_query(text: str) -> str:
    """Turn free text into a safe FTS5 MATCH expression.

    User content can contain characters FTS5 treats as operators, so we quote
    each word as a phrase and AND them together.
    """
    terms = re.findall(r"\w+", text)
    return " ".join(f'"{t}"' for t in terms)


def remember(session_id: str, content: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with closing(connect()) as conn, conn:
        conn.execute(
            "INSERT INTO memories (content, session_id, created_at) VALUES (?, ?, ?)",
            (content, session_id, now),
        )


def recall(session_id: str, query: str = "", limit: int = 10) -> list[str]:
    with closing(connect()) as conn:
        if query.strip() and (match := _match_query(query)):
            rows = conn.execute(
                "SELECT content FROM memories "
                "WHERE session_id = ? AND memories MATCH ? "
                "ORDER BY rank LIMIT ?",
                (session_id, match, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT content FROM memories "
                "WHERE session_id = ? ORDER BY rowid DESC LIMIT ?",
                (session_id, limit),
            ).fetchall()
    return [r["content"] for r in rows]


def forget(session_id: str, query: str) -> int:
    match = _match_query(query)
    if not match:
        return 0
    with closing(connect()) as conn, conn:
        rowids = [
            r["rowid"]
            for r in conn.execute(
                "SELECT rowid FROM memories WHERE session_id = ? AND memories MATCH ?",
                (session_id, match),
            ).fetchall()
        ]
        conn.executemany("DELETE FROM memories WHERE rowid = ?", [(i,) for i in rowids])
    return len(rowids)
