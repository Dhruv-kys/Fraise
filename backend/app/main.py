"""Voice-MCP backend — one FastAPI process.

  * `/ws` bridges the browser to Deepgram's Voice Agent (STT → LLM → TTS).
    When the LLM calls a tool, MCPManager routes it to the right MCP server.
  * MCPManager reads mcp_servers.json on startup and connects to every server
    listed there. Adding a server to that file makes its tools voice-callable.
  * The built-in FastMCP server is also mounted at `/mcp` for external clients.
"""
import asyncio
import contextlib
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import anyio
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

# Load configuration before importing application modules. Several modules read
# their settings at import time (for example the voice-agent endpoint), so doing
# this below those imports made a local .env ineffective unless systemd also set
# the same variables in its environment.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from app.servers.calendar_auth import router as calendar_auth_router
from app.host import bus
from app.host.mcp_manager import manager
from app.servers.calculator import mcp
from app.servers import daily
from app.servers.memory import store as memory_store
from app.servers.rag import embeddings, extract, reranker, store as rag_store
from app.storage import db
from app.host.voice_agent import bridge

logger = logging.getLogger(__name__)

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
# Comma-separated list in prod. Keep the public deployment here as a safe
# default: WebSockets can connect cross-origin, but browser fetch/EventSource
# calls for history, artifacts, and live agent progress need an explicit CORS
# response or the browser silently hides otherwise-successful API responses.
_DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "https://fraise.vercel.app")
_configured_cors_origins = os.getenv("CORS_ORIGINS", "").split(",")
CORS_ORIGINS = list(dict.fromkeys([
    *_DEFAULT_CORS_ORIGINS,
    *(o.strip() for o in _configured_cors_origins if o.strip()),
]))


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


@app.get("/agents/stream")
async def agents_stream(sid: str = Query(...)) -> StreamingResponse:
    """Live progress from the research agents, as Server-Sent Events.

    A tool call can only answer once, but a fan-out of agents has a story to tell
    while it runs. The research server publishes to `bus`; this relays it to the
    browser so the user watches the agents work instead of a spinner. SSE rather
    than another WebSocket: this is strictly one-way and survives reconnects for
    free via EventSource.
    """
    queue = bus.subscribe(sid)

    async def events():
        try:
            # Flush a comment immediately so proxies don't sit on the response.
            yield ": connected\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"  # keeps idle proxies from closing us
                    continue
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            bus.unsubscribe(sid, queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.get("/history")
async def history(sid: str = Query(...), limit: int = Query(40)) -> dict:
    """The conversation itself, plus what Fraise was told to remember.

    Both were already being written on every turn — `conversation_turns` by the
    voice bridge, `memories` by the remember tool — but nothing could read them
    back, so a reload looked like amnesia even though nothing was lost. Same
    session id scopes both, which is what makes them one connected memory.
    """
    turns = await anyio.to_thread.run_sync(memory_store.recent_turns, sid, limit)
    facts = await anyio.to_thread.run_sync(memory_store.recall, sid, "", 20)
    return {
        "turns": [{"role": r, "text": c} for r, c in turns],
        "memories": facts,
    }


@app.get("/artifacts")
async def artifacts(sid: str = Query(...)) -> list[dict]:
    return await anyio.to_thread.run_sync(db.list_artifacts, sid)


@app.get("/artifacts/{artifact_id}")
async def artifact(artifact_id: str, sid: str = Query(...)) -> dict:
    found = await anyio.to_thread.run_sync(db.get_artifact, artifact_id, sid)
    if not found:
        raise HTTPException(status_code=404, detail="no such artifact")
    return found


@app.post("/dictate")
async def dictate(sid: str = Query(...), body: dict = Body(...)) -> dict:
    """Take a dictated brain-dump of the day, split it into tasks, and fan them
    out to their lane agents. Returns the day id at once; progress streams over
    `/agents/stream` (the same SSE the research fan-out uses)."""
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="nothing was dictated")
    # ~2 hours of continuous speech at normal pace. Segmentation chunks and
    # scales with length, so this is an abuse/cost guard, not a quality limit.
    if len(text) > 120_000:
        raise HTTPException(status_code=400, detail="that dictation is too long — try splitting it up")
    try:
        tz_offset_min = int(body.get("tz_offset_min") or 0)
    except (TypeError, ValueError):
        tz_offset_min = 0
    day_id = daily.start(text, sid, tz_offset_min)
    return {"day_id": day_id}


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
