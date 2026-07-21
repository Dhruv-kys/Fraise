import anyio
from mcp.server.fastmcp import FastMCP

from . import store

mcp = FastMCP("memory", streamable_http_path="/")

@mcp.tool()
async def remember(content: str, session_id: str = "") -> str:
    if not session_id:
        return "I couldn't tell which session this is, so I can't save that right now."
    await anyio.to_thread.run_sync(store.remember, session_id, content)
    return "Got it — I'll remember that."

@mcp.tool()
async def recall(query: str = "", session_id: str = "") -> str:
    if not session_id:
        return ""
    memories = await anyio.to_thread.run_sync(store.recall, session_id, query)
    if not memories:
        return "I don't have anything saved about that yet."
    return "Here's what I remember: " + "; ".join(memories) + "."

@mcp.tool()
async def forget(query: str, session_id: str = "") -> str:
    if not session_id:
        return "I couldn't tell which session this is, so I can't change anything."
    count = await anyio.to_thread.run_sync(store.forget, session_id, query)
    if not count:
        return "I didn't find anything matching that to forget."
    return f"Done — I forgot {count} thing{'s' if count != 1 else ''}."
