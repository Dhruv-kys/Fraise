from pathlib import Path

import anyio
from mcp.server.fastmcp import FastMCP

from . import store

mcp = FastMCP("rag", streamable_http_path="/")

@mcp.tool(description=(
    "Answer a question using the user's uploaded documents.\n\n"
    "question: what the user wants to know. Call this whenever the user asks about "
    "their files, notes, or documents."
))
async def ask(question: str, session_id: str = "") -> str:
    if not session_id:
        return ""
    passages = await anyio.to_thread.run_sync(store.search, session_id, question)
    if not passages:
        return "I couldn't find anything about that in your documents."
    return "Here's what your documents say: " + " … ".join(passages)

@mcp.tool(description="Summarize an uploaded document.\n\nfilename: which document to summarize. Leave blank for the most recent upload.")
async def summarize(filename: str = "", session_id: str = "") -> str:
    if not session_id:
        return ""
    text = await anyio.to_thread.run_sync(store.get_document_text, session_id, filename)
    if not text:
        return "I don't have that document to summarize."
    return "Here's the document — summarize it for the user: " + text

@mcp.tool(description="List the documents the user has uploaded.")
async def list_documents(session_id: str = "") -> str:
    if not session_id:
        return ""
    names = await anyio.to_thread.run_sync(store.list_documents, session_id)
    if not names:
        return "You haven't uploaded any documents yet."
    spoken = [Path(n).stem for n in names]
    return "You've uploaded: " + ", ".join(spoken) + "."
