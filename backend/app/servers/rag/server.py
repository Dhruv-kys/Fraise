"""RAG MCP server for Fraise.

Voice Q&A over the user's own documents, scoped per session. These tools do
retrieval only — they hand back the relevant passages and the voice LLM speaks the
grounded answer. Files are added out-of-band via the `/upload` HTTP endpoint, since
binary uploads can't travel over the voice channel.

`session_id` is injected by the host (MCPManager) and hidden from the LLM.
"""
import anyio
from mcp.server.fastmcp import FastMCP

from . import store

mcp = FastMCP("rag", streamable_http_path="/")


@mcp.tool()
async def ask(question: str, session_id: str = "") -> str:
    """Answer a question using the user's uploaded documents.

    question: what the user wants to know.
    Call this whenever the user asks about their files, notes, or documents.
    """
    if not session_id:
        return ""
    passages = await anyio.to_thread.run_sync(store.search, session_id, question)
    if not passages:
        return "I couldn't find anything about that in your documents."
    return "Here's what your documents say: " + " … ".join(passages)


@mcp.tool()
async def summarize(filename: str = "", session_id: str = "") -> str:
    """Summarize an uploaded document.

    filename: which document to summarize. Leave blank for the most recent upload.
    """
    if not session_id:
        return ""
    text = await anyio.to_thread.run_sync(store.get_document_text, session_id, filename)
    if not text:
        return "I don't have that document to summarize."
    return "Here's the document — summarize it for the user: " + text


@mcp.tool()
async def list_documents(session_id: str = "") -> str:
    """List the documents the user has uploaded."""
    if not session_id:
        return ""
    names = await anyio.to_thread.run_sync(store.list_documents, session_id)
    if not names:
        return "You haven't uploaded any documents yet."
    return "You've uploaded: " + ", ".join(names) + "."
