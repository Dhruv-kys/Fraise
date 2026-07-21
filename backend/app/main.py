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
        warm_task = asyncio.create_task(anyio.to_thread.run_sync(_warm_rag))
        yield
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
    queue = bus.subscribe(sid)

    async def events():
        try:
            yield ": connected\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
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
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="nothing was dictated")
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
    assistant_name = ws.query_params.get("persona") or ""
    instructions = ws.query_params.get("instructions") or ""
    personas = ws.query_params.get("personas") or ""
    voice = ws.query_params.get("voice") or ""
    try:
        await bridge(ws, session_id, user_name, greet, assistant_name, instructions, personas, voice)
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
