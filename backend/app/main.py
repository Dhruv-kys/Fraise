"""Voice-MCP backend — one FastAPI process.

  * `/ws` bridges the browser to Deepgram's Voice Agent (STT → LLM → TTS).
    When the LLM calls a tool, MCPManager routes it to the right MCP server.
  * MCPManager reads mcp_servers.json on startup and connects to every server
    listed there. Adding a server to that file makes its tools voice-callable.
  * The built-in FastMCP server is also mounted at `/mcp` for external clients.
"""
import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import anyio
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.servers.calendar_auth import router as calendar_auth_router
from app.host.mcp_manager import manager
from app.servers.calculator import mcp
from app.servers.rag import embeddings, extract, reranker, store as rag_store
from app.host.voice_agent import bridge

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logger = logging.getLogger(__name__)

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
# Comma-separated list in prod, e.g. "https://fraise.vercel.app".
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with mcp.session_manager.run():
        await manager.connect_all()
        # Load the RAG models off the event loop so the first query is fast and
        # startup isn't blocked on the download/warm pass.
        warm_task = asyncio.create_task(anyio.to_thread.run_sync(_warm_rag))
        yield
        # Can't interrupt the worker thread itself; this just avoids an orphaned task.
        warm_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await warm_task
    await manager.aclose()


def _warm_rag() -> None:
    try:
        embeddings.warm()
        reranker.warm()
    except Exception:
        logger.exception("RAG warm-up failed — first query will be slow")


app = FastAPI(title="fraise", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.post("/upload")
async def upload(sid: str = Query(...), file: UploadFile = ...) -> dict:
    raw = await file.read()
    try:
        text = extract.extract_text(file.filename or "", raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not text:
        raise HTTPException(status_code=400, detail="no readable text in that file")
    return await anyio.to_thread.run_sync(
        rag_store.add_document, sid, file.filename, text
    )


@app.websocket("/ws")
async def voice_socket(ws: WebSocket) -> None:
    await ws.accept()
    session_id = ws.query_params.get("sid") or uuid4().hex
    user_name = ws.query_params.get("name") or ""
    greet = ws.query_params.get("greet") != "0"
    # Per-assistant persona config (Phase 11): the active assistant's display
    # name, its custom instructions, and the names of the user's other assistants
    # (for voice-native switching). All live in the browser; the sid is the scope.
    assistant_name = ws.query_params.get("persona") or ""
    instructions = ws.query_params.get("instructions") or ""
    personas = ws.query_params.get("personas") or ""
    try:
        await bridge(ws, session_id, user_name, greet, assistant_name, instructions, personas)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("voice bridge failed")
        with contextlib.suppress(Exception):
            await ws.send_json({"type": "error", "message": "Voice connection failed. Please try again."})


app.include_router(calendar_auth_router)
app.mount("/mcp", mcp.streamable_http_app())

if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
