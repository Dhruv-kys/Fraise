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
import time

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.host.mcp_manager import manager

# A tool may return an {"_action": {...}} envelope to ask the host to perform an
# out-of-band step (e.g. an OAuth redirect) and re-run the tool once it's done.
# The host stays capability-agnostic: it forwards the action to the browser and
# polls the same tool until it stops asking. _ACTION_TIMEOUT bounds that wait.
_ACTION_TIMEOUT = 90  # seconds

logger = logging.getLogger(__name__)

DG_URL = os.environ.get("DEEPGRAM_AGENT_URL", "wss://agent.deepgram.com/v1/agent/converse")
MAX_TOOL_STEPS = 10  # per conversational turn; guards against runaway LLM loops

INPUT_RATE = 16_000   # mic → agent
OUTPUT_RATE = 24_000  # agent → speaker

PROMPT = (
    "You are Fraise, an intelligent voice assistant. You can chat naturally and do "
    "math. Chain as many tool calls as needed to fully complete a task before you "
    "speak. Never stop mid-chain to ask if you should continue; just finish the job.\n\n"
    "Math rule: always call the calculate tool for any arithmetic — never compute "
    "in your head. This ensures accuracy and lets the result be verified.\n\n"
    "Calendar: if the user asks anything about their calendar or meetings — events, "
    "free slots, scheduling — tell them calendar isn't connected here, so you can't "
    "see or change their schedule. Be light about it and offer to help another way. "
    "Do not attempt to access or invent calendar data.\n\n"
    "Memory: when the user tells you to remember, note, or keep track of something, "
    "call the remember tool. When a question might depend on something they told you "
    "before — a preference, a name, a detail — call recall first, then answer. Use "
    "forget when they ask you to drop something.\n\n"
    "Documents: the user can upload documents — text, Markdown, or PDF. Whenever a "
    "question might touch their files, notes, or documents, call the ask tool and base "
    "your answer only on what it returns; never guess at what a document says. Use "
    "summarize for an overview of a document and list_documents to tell them what "
    "they've uploaded. When you're told a document was just uploaded, call summarize "
    "for it and give a warm one- or two-sentence summary of what it's about, then "
    "invite them to ask questions.\n\n"
    "Sound great out loud. Keep replies short — usually one or two sentences — "
    "warm, clear, and conversational. No lists, no markdown, no emoji; say "
    "numbers, dates, and symbols the way a person would speak them. Never invent "
    "results."
)


DEFAULT_GREETING = (
    "Hey, you made it — I'm Fraise. It's really good to hear you. "
    "What can I do for you today?"
)


def _clean_name(raw: str) -> str:
    """Keep the name safe to drop into a prompt: printable chars, single line,
    capped length. Guards against prompt-injection via the query string."""
    name = "".join(ch for ch in raw if ch.isprintable() and ch not in "{}").strip()
    return name[:40]


async def _build_settings(user_name: str = "") -> dict:
    name = _clean_name(user_name)
    prompt = PROMPT
    greeting = DEFAULT_GREETING
    if name:
        prompt = (
            f"The user's name is {name}. Address them by their first name naturally "
            "and warmly — greet them by name and use it occasionally, but don't "
            "overuse it or start every sentence with it.\n\n"
        ) + PROMPT
        greeting = (
            f"Hey {name}, you made it — I'm Fraise. It's really good to hear you. "
            "What can I do for you today?"
        )
    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": INPUT_RATE},
            "output": {"encoding": "linear16", "sample_rate": OUTPUT_RATE, "container": "none"},
        },
        "agent": {
            # Flux (v2) does real end-of-turn detection, so a mid-sentence pause no
            # longer finalizes as its own utterance — one turn becomes one transcript.
            "listen": {"provider": {
                "type": "deepgram",
                "version": "v2",
                "model": os.environ.get("DEEPGRAM_LISTEN_MODEL", "flux-general-en"),
                "eot_threshold": float(os.environ.get("DEEPGRAM_EOT_THRESHOLD", "0.7")),
                "eot_timeout_ms": int(os.environ.get("DEEPGRAM_EOT_TIMEOUT_MS", "5000")),
            }},
            "think": {
                "provider": {
                    "type": os.environ.get("DEEPGRAM_THINK_TYPE", "open_ai"),
                    "model": os.environ.get("DEEPGRAM_THINK_MODEL", "gpt-4o-mini"),
                },
                "prompt": prompt,
                "functions": manager.functions(),
            },
            "speak": {"provider": {"type": "deepgram", "model": os.environ.get("DEEPGRAM_VOICE", "aura-2-thalia-en")}},
            "greeting": greeting,
        },
    }


def _translate(text: str) -> str:
    """Map a browser 'document_uploaded' signal to a Deepgram user turn that makes
    Fraise summarize the new document via RAG. Everything else passes through."""
    try:
        event = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return text
    if event.get("type") != "document_uploaded":
        return text
    filename = event.get("filename") or "the document"
    return json.dumps({
        "type": "InjectUserMessage",
        "content": f'I just uploaded a document called "{filename}". '
                   "Give me a short summary of what it's about.",
    })


async def _run_tool(fn: dict, session_id: str) -> str:
    try:
        args = json.loads(fn.get("arguments") or "{}")
        return await manager.call(fn["name"], args, session_id)
    except Exception as exc:
        logger.exception("tool %r failed", fn.get("name"))
        return json.dumps({"error": str(exc)})


def _extract_action(content: str) -> dict | None:
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return None
    return data.get("_action") if isinstance(data, dict) else None


async def _resolve_action(fn: dict, session_id: str, browser: WebSocket, action: dict) -> str:
    await browser.send_text(json.dumps(action))
    logger.info("tool %r requested action %r; waiting up to %ds",
                fn.get("name"), action.get("type"), _ACTION_TIMEOUT)
    deadline = time.monotonic() + _ACTION_TIMEOUT
    while time.monotonic() < deadline:
        await asyncio.sleep(1.5)
        content = await _run_tool(fn, session_id)
        if _extract_action(content) is None:
            return content
    return json.dumps({"error": "The action timed out. Please try again."})


async def _handle_function_call(dg, browser: WebSocket, message: dict, session_id: str) -> None:
    for fn in message.get("functions", []):
        content = await _run_tool(fn, session_id)
        action = _extract_action(content)
        if action:
            content = await _resolve_action(fn, session_id, browser, action)

        await dg.send(json.dumps({
            "type": "FunctionCallResponse",
            "id": fn["id"],
            "name": fn["name"],
            "content": content,
        }))


async def bridge(browser: WebSocket, session_id: str = "", user_name: str = "") -> None:
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        await browser.send_json({"type": "error", "message": "DEEPGRAM_API_KEY is not set"})
        return

    async with websockets.connect(DG_URL, additional_headers={"Authorization": f"Token {api_key}"}) as dg:
        await dg.send(json.dumps(await _build_settings(user_name)))

        async def browser_to_dg() -> None:
            while True:
                msg = await browser.receive()
                if msg.get("type") == "websocket.disconnect":
                    return
                if (data := msg.get("bytes")) is not None:
                    await dg.send(data)
                elif (text := msg.get("text")) is not None:
                    await dg.send(_translate(text))

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
                        await _handle_function_call(dg, browser, event, session_id)

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
