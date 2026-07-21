from pathlib import Path

import anyio
from mcp.server.fastmcp import FastMCP

from . import store

mcp = FastMCP("rag", streamable_http_path="/")

@mcp.tool()
async def ask(question: str, session_id: str = "") -> str:
    if not session_id:
        return ""
    passages = await anyio.to_thread.run_sync(store.search, session_id, question)
    if not passages:
        return "I couldn't find anything about that in your documents."
    return "Here's what your documents say: " + " … ".join(passages)

@mcp.tool()
async def summarize(filename: str = "", session_id: str = "") -> str:
    if not session_id:
        return ""
    text = await anyio.to_thread.run_sync(store.get_document_text, session_id, filename)
    if not text:
        return "I don't have that document to summarize."
    return "Here's the document — summarize it for the user: " + text

@mcp.tool()
async def list_documents(session_id: str = "") -> str:
    if not session_id:
        return ""
    names = await anyio.to_thread.run_sync(store.list_documents, session_id)
    if not names:
        return "You haven't uploaded any documents yet."
    spoken = [Path(n).stem for n in names]
    return "You've uploaded: " + ", ".join(spoken) + "."
