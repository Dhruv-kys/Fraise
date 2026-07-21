import asyncio
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

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
    if not session_id:
        return
    for q in list(_subscribers.get(session_id, ())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("progress queue full for %s; dropping %s", session_id, event.get("type"))
