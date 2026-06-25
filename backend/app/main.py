"""Voice-MCP backend — one FastAPI process.

  * FastAPI serves the `/ws` WebSocket the browser talks to and the built
    frontend.
  * The FastMCP server ([app.mcp_server]) is mounted at `/mcp` for external MCP
    clients and called in-process by the agent.

WebSocket protocol (JSON, `type`-discriminated) is modelled with pydantic.
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from app.agent import run_agent
from app.mcp_server import mcp

logger = logging.getLogger(__name__)

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
CORS_ORIGINS = ["http://localhost:5173"]  # Vite dev server


# --- WebSocket messages ---
class UserMessage(BaseModel):
    type: Literal["user_message"]
    text: str


class ReadyEvent(BaseModel):
    type: Literal["ready"] = "ready"
    message: str = "Connected. Talk to your agent."


class ThinkingEvent(BaseModel):
    type: Literal["thinking"] = "thinking"


class AgentMessage(BaseModel):
    type: Literal["agent_message"] = "agent_message"
    text: str


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Run the session manager for the mounted streamable-HTTP MCP app.
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="voice-mcp-assistant", lifespan=lifespan)
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
    await ws.send_json(ReadyEvent().model_dump())

    while True:
        try:
            raw = await ws.receive_json()
        except WebSocketDisconnect:
            break
        except ValueError:
            await ws.send_json(ErrorEvent(message="Invalid JSON").model_dump())
            continue

        try:
            msg = UserMessage.model_validate(raw)
        except ValidationError:
            continue  # ignore non-user_message frames
        if not msg.text.strip():
            continue

        await ws.send_json(ThinkingEvent().model_dump())
        try:
            reply = await run_agent(msg.text)
            await ws.send_json(AgentMessage(text=reply).model_dump())
        except Exception as exc:  # noqa: BLE001 - surface failures to the UI
            logger.exception("agent failed")
            await ws.send_json(ErrorEvent(message=f"Agent error: {exc}").model_dump())


# MCP server (streamable HTTP) for external MCP clients.
app.mount("/mcp", mcp.streamable_http_app())

# Serve the built frontend in production (run `npm run build` in frontend/).
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
