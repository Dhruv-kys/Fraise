"""Voice-MCP backend — one FastAPI process.

  * `/ws` bridges the browser to Deepgram's Voice Agent (STT → LLM → TTS).
    When the LLM calls a tool, MCPManager routes it to the right MCP server.
  * MCPManager reads mcp_servers.json on startup and connects to every server
    listed there. Adding a server to that file makes its tools voice-callable.
  * The built-in FastMCP server is also mounted at `/mcp` for external clients.
"""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.servers.calendar_auth import router as calendar_auth_router
from app.host.mcp_manager import manager
from app.servers.calculator import mcp
from app.host.voice_agent import bridge

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logger = logging.getLogger(__name__)

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
# Comma-separated list in prod, e.g. "https://fraise-mcp.netlify.app".
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if o.strip()
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with mcp.session_manager.run():
        await manager.connect_all()
        yield
    await manager.aclose()


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


@app.websocket("/ws")
async def voice_socket(ws: WebSocket) -> None:
    await ws.accept()
    session_id = ws.query_params.get("sid") or uuid4().hex
    try:
        await bridge(ws, session_id)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("voice bridge failed")


app.include_router(calendar_auth_router)
app.mount("/mcp", mcp.streamable_http_app())

if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
