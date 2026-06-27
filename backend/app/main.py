"""Voice-MCP backend — one FastAPI process.

  * `/ws` bridges the browser to Deepgram's Voice Agent (STT → LLM → TTS).
    When the LLM calls a tool, MCPManager routes it to the right MCP server.
  * MCPManager reads mcp_servers.json on startup and connects to every server
    listed there. Adding a server to that file makes its tools voice-callable.
  * The built-in FastMCP server is also mounted at `/mcp` for external clients.
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.mcp_manager import manager
from app.mcp_server import mcp
from app.voice_agent import bridge

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logger = logging.getLogger(__name__)

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
CORS_ORIGINS = ["http://localhost:5173"]


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
    try:
        await bridge(ws)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("voice bridge failed")


app.mount("/mcp", mcp.streamable_http_app())

if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
