"""Bridge between the browser and Deepgram's Voice Agent.

The browser streams microphone audio to /ws; we forward it to Deepgram's Voice
Agent (STT → LLM → TTS in one socket) and stream audio back. When the LLM picks
a tool, MCPManager routes the call to whichever MCP server owns it and returns
the result. The function list is built from all connected servers — adding a
server to mcp_servers.json makes its tools voice-callable with no changes here.
"""
import asyncio
import json
import logging
import os

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.mcp_manager import manager

logger = logging.getLogger(__name__)

DG_URL = os.environ.get("DEEPGRAM_AGENT_URL", "wss://agent.deepgram.com/v1/agent/converse")
MAX_TOOL_STEPS = 10  # per conversational turn; guards against runaway LLM loops

INPUT_RATE = 16_000   # mic → agent
OUTPUT_RATE = 24_000  # agent → speaker

PROMPT = (
    "You are Fraise, an intelligent voice assistant. You can chat naturally, do "
    "math, and call any tools you've been given — chain as many tool calls as "
    "needed to fully complete a task before you speak. Never stop mid-chain to "
    "ask if you should continue; just finish the job.\n\n"
    "Bigger abilities are on the roadmap but not built yet: calendar and Google "
    "Meet, remembering past conversations, file uploads, and summarizing "
    "documents. When asked for something that isn't built yet, be upfront and "
    "good-natured: let them know it's on the roadmap and that Dhruv is building "
    "it, then offer what you can help with today.\n\n"
    "Sound great out loud. Keep replies short — usually one or two sentences — "
    "warm, clear, and conversational. No lists, no markdown, no emoji; say "
    "numbers, dates, and symbols the way a person would speak them. Never invent "
    "results.\n\n"
    "Be encouraging and genuine — match the person's energy and leave them "
    "feeling a little better than before."
)


async def _build_settings() -> dict:
    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": INPUT_RATE},
            "output": {"encoding": "linear16", "sample_rate": OUTPUT_RATE, "container": "none"},
        },
        "agent": {
            "listen": {"provider": {"type": "deepgram", "model": os.environ.get("DEEPGRAM_LISTEN_MODEL", "nova-3")}},
            "think": {
                "provider": {
                    "type": os.environ.get("DEEPGRAM_THINK_TYPE", "open_ai"),
                    "model": os.environ.get("DEEPGRAM_THINK_MODEL", "gpt-4o-mini"),
                },
                "prompt": PROMPT,
                "functions": manager.functions(),
            },
            "speak": {"provider": {"type": "deepgram", "model": os.environ.get("DEEPGRAM_VOICE", "aura-2-thalia-en")}},
            "greeting": "Hey, you made it — I'm Fraise. It's really good to hear you. What can I do for you today?",
        },
    }


async def _handle_function_call(dg, message: dict) -> None:
    for fn in message.get("functions", []):
        if not fn.get("client_side", False):
            continue
        try:
            args = json.loads(fn.get("arguments") or "{}")
            content = await manager.call(fn["name"], args)
        except Exception as exc:
            logger.exception("tool %r failed", fn.get("name"))
            content = json.dumps({"error": str(exc)})
        await dg.send(json.dumps({
            "type": "FunctionCallResponse",
            "id": fn["id"],
            "name": fn["name"],
            "content": content,
        }))


async def bridge(browser: WebSocket) -> None:
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        await browser.send_json({"type": "error", "message": "DEEPGRAM_API_KEY is not set"})
        return

    async with websockets.connect(DG_URL, additional_headers={"Authorization": f"Token {api_key}"}) as dg:
        await dg.send(json.dumps(await _build_settings()))

        async def browser_to_dg() -> None:
            while True:
                msg = await browser.receive()
                if msg.get("type") == "websocket.disconnect":
                    return
                if (data := msg.get("bytes")) is not None:
                    await dg.send(data)
                elif (text := msg.get("text")) is not None:
                    await dg.send(text)

        async def dg_to_browser() -> None:
            step_count = 0
            async for message in dg:
                if isinstance(message, (bytes, bytearray)):
                    await browser.send_bytes(message)
                    continue
                try:
                    event = json.loads(message)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type")

                # A new user utterance starts a fresh tool chain.
                if event_type in ("UserStartedSpeaking", "ConversationText"):
                    step_count = 0

                if event_type == "FunctionCallRequest":
                    if step_count >= MAX_TOOL_STEPS:
                        logger.warning("tool step cap (%d) reached; aborting chain", MAX_TOOL_STEPS)
                        for fn in event.get("functions", []):
                            await dg.send(json.dumps({
                                "type": "FunctionCallResponse",
                                "id": fn["id"],
                                "name": fn["name"],
                                "content": json.dumps({"error": "tool step limit reached"}),
                            }))
                    else:
                        step_count += 1
                        await _handle_function_call(dg, event)

                await browser.send_text(message)

        b2d = asyncio.create_task(browser_to_dg())
        d2b = asyncio.create_task(dg_to_browser())
        try:
            done, pending = await asyncio.wait({b2d, d2b}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
        except WebSocketDisconnect:
            b2d.cancel()
            d2b.cancel()
