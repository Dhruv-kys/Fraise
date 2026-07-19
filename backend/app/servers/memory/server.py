"""Memory MCP server for Fraise.

Stores things the user asks Fraise to remember, scoped per user session. Tools
return plain-English strings designed to be read aloud.

`session_id` is injected by the host (MCPManager) from the live connection and
hidden from the LLM — the model never sees or supplies it.
"""
import anyio
from mcp.server.fastmcp import FastMCP

from . import store

mcp = FastMCP("memory", streamable_http_path="/")

@mcp.tool()
async def remember(content: str, session_id: str = "") -> str:
    """Save something the user wants remembered for later.

    content: the fact or preference to store, in plain language.
    Call this whenever the user says to remember, note, or keep track of something.
    """
    if not session_id:
        return "I couldn't tell which session this is, so I can't save that right now."
    await anyio.to_thread.run_sync(store.remember, session_id, content)
    return "Got it — I'll remember that."

@mcp.tool()
async def recall(query: str = "", session_id: str = "") -> str:
    """Look up what the user has asked Fraise to remember.

    query: words to search for. Leave blank to get their most recent memories.
    Call this before answering anything that might depend on what they've told you.
    """
    if not session_id:
        return ""
    memories = await anyio.to_thread.run_sync(store.recall, session_id, query)
    if not memories:
        return "I don't have anything saved about that yet."
    return "Here's what I remember: " + "; ".join(memories) + "."

@mcp.tool()
async def forget(query: str, session_id: str = "") -> str:
    """Delete saved memories that match the given words.

    query: words identifying what to forget.
    """
    if not session_id:
        return "I couldn't tell which session this is, so I can't change anything."
    count = await anyio.to_thread.run_sync(store.forget, session_id, query)
    if not count:
        return "I didn't find anything matching that to forget."
    return f"Done — I forgot {count} thing{'s' if count != 1 else ''}."
