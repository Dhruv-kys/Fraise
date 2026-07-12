"""In-process pub/sub for streaming progress out of a long-running tool.

MCP tools are request/response: a tool that fans out to several sub-agents can
only speak once, at the end. But the whole point of parallel agents is *watching*
them work — so the research server publishes progress events here as each agent
starts and finishes, and `/agents/stream` (SSE) relays them to the browser.

Keyed by the same `session_id` the host already injects into tools, so a user
only ever sees their own agents. Fan-out is best-effort: a slow or dead consumer
gets dropped rather than back-pressuring the agents doing the real work.
"""
import asyncio
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

# Bounded so a browser tab that stopped reading can't grow a queue without limit.
_QUEUE_MAX = 256

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(session_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAX)
    _subscribers[session_id].add(q)
    return q


def unsubscribe(session_id: str, q: asyncio.Queue) -> None:
    subs = _subscribers.get(session_id)
    if not subs:
        return
    subs.discard(q)
    if not subs:
        _subscribers.pop(session_id, None)


def publish(session_id: str, event: dict) -> None:
    """Non-blocking by design — the agents must never wait on a UI consumer."""
    if not session_id:
        return
    for q in list(_subscribers.get(session_id, ())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("progress queue full for %s; dropping %s", session_id, event.get("type"))
