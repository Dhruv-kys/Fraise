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
from datetime import datetime, timezone
from pathlib import Path

import anyio
import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.host.mcp_manager import manager
from app.servers.memory import store as memory_store

# A tool may return an {"_action": {...}} envelope to ask the host to perform an
# out-of-band step (e.g. an OAuth redirect) and re-run the tool once it's done.
# The host stays capability-agnostic: it forwards the action to the browser and
# polls the same tool until it stops asking. _ACTION_TIMEOUT bounds that wait.
_ACTION_TIMEOUT = 90  # seconds

# Bounds a single tool call so one wedged server (a hung http/stdio session, a
# stuck thread) can't stall the dg_to_browser loop and silence the whole session.
# Kept under the frontend's 20s watchdog so the LLM can still speak the error.
_TOOL_TIMEOUT = 15  # seconds

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
    "Web search: when a question needs current information, or anything you don't "
    "already know for certain, use the search tools and answer only from what they "
    "return. Never invent a search result or a fact you're not sure of.\n\n"
    "Weather: when asked about current weather or conditions somewhere, call "
    "get_weather with the place name. If they haven't said where, ask before "
    "calling it — never guess a location or invent conditions.\n\n"
    "Files: the user has a local folder Fraise can read and write. When they ask "
    "about files — listing, reading, creating, or editing one — use the filesystem "
    "tools rather than guessing at what's there.\n\n"
    "Sound great out loud. Keep replies short — usually one or two sentences — "
    "warm, clear, and conversational. Say the single most useful thing and stop; "
    "don't pad, don't recap, don't add a follow-up question unless you truly need "
    "one to continue. If the user starts talking while you're speaking, they're "
    "interrupting on purpose — stop immediately and listen. No lists, no markdown, "
    "no emoji; say numbers, dates, and symbols the way a person would speak them. "
    "Never invent results."
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


def _describe_capabilities() -> str:
    """Build a per-server capability summary from whatever's actually connected,
    so a new MCP server is describable in 'what can you do' without editing this
    file — only mcp_servers.json changes, matching the host's own design rule."""
    lines = []
    for sname, tools in manager.functions_by_server().items():
        bullets = "; ".join(t["description"] for t in tools if t["description"])
        if bullets:
            lines.append(f"- {sname}: {bullets}")
    return "\n".join(lines)


async def _recent_context(session_id: str) -> str:
    """Recent turns from this session_id, across reconnects and even prior
    visits (session_id persists in the browser's localStorage) — the only
    memory of the conversation itself, distinct from things explicitly told
    to `remember`. Returns "" for a brand-new session with no history yet."""
    if not session_id:
        return ""
    turns = await anyio.to_thread.run_sync(memory_store.recent_turns, session_id)
    if not turns:
        return ""
    return "\n".join(f"{'User' if role == 'user' else 'Fraise'}: {content}" for role, content in turns)


async def _build_settings(session_id: str = "", user_name: str = "", greet: bool = True) -> dict:
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

    now = datetime.now(timezone.utc)
    prompt = prompt + (
        f"\n\nToday's date is {now:%A, %B %-d, %Y}, current time {now:%H:%M} UTC. "
        "Use this for anything involving dates, deadlines, or 'today'/'tomorrow' — "
        "never rely on your training data for the current date. Convert to the "
        "user's local time only if you know their timezone; otherwise say UTC."
    )

    capabilities = _describe_capabilities()
    if capabilities:
        prompt = prompt + (
            "\n\nWhat you can do: if asked what you can do, your skills, or your "
            "features, describe these warmly in your own words as natural sentences "
            "grouped by theme — never recite raw tool names or read this list "
            "verbatim.\n" + capabilities
        )

    context = await _recent_context(session_id)
    if context:
        prompt = prompt + (
            "\n\nRecent conversation history with this user, carried over from "
            "before this connection — use it for continuity (don't ask something "
            "they already told you), but only bring it up out loud if it's "
            "relevant or they ask what you talked about:\n" + context
        )

    agent: dict = {
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
    }
    # Only the first connection in a browser tab speaks the greeting; reconnects
    # (reload, a dropped socket auto-recovering) omit it so Fraise doesn't
    # re-introduce herself mid-conversation. See useVoiceAgent's `greet` param.
    if greet:
        agent["greeting"] = greeting

    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": INPUT_RATE},
            "output": {"encoding": "linear16", "sample_rate": OUTPUT_RATE, "container": "none"},
        },
        "agent": agent,
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
    raw_filename = event.get("filename") or ""
    # Drop the extension — this text becomes a conversation turn the LLM can see
    # and echo back, and TTS reads ".txt" as "dot t x t" if it does.
    name = Path(raw_filename).stem if raw_filename else "the document"
    return json.dumps({
        "type": "InjectUserMessage",
        "content": f'I just uploaded a document called "{name}". '
                   "Give me a short summary of what it's about.",
    })


async def _run_tool(fn: dict, session_id: str) -> str:
    try:
        args = json.loads(fn.get("arguments") or "{}")
        return await asyncio.wait_for(manager.call(fn["name"], args, session_id), _TOOL_TIMEOUT)
    except asyncio.TimeoutError:
        # wait_for cancels the inner task, freeing the dg_to_browser loop for a real
        # asyncio hang (stuck socket read). A thread wedged in anyio.to_thread.run_sync
        # on a non-cooperative blocking call leaks, but the session still recovers.
        logger.warning("tool %r timed out after %ds", fn.get("name"), _TOOL_TIMEOUT)
        return json.dumps({"error": "That took too long, so I stopped. Please try again."})
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


async def _run_one_function_call(dg, browser: WebSocket, fn: dict, session_id: str) -> None:
    fn_id = fn.get("id")
    fn_name = fn.get("name", "")
    try:
        content = await _run_tool(fn, session_id)
        action = _extract_action(content)
        if action:
            content = await _resolve_action(fn, session_id, browser, action)
    except Exception as exc:
        # _run_tool already guards the tool call itself; this covers everything
        # else (e.g. _resolve_action hitting a browser socket that just closed).
        # Without this, Deepgram never gets a FunctionCallResponse for this id
        # and the whole turn — sometimes the whole session — goes silent.
        logger.exception("function call %r crashed outside the tool's own error handling", fn_name)
        content = json.dumps({"error": str(exc)})

    if fn_id is None:
        logger.warning("function call %r had no id; can't send a response", fn_name)
        return
    await dg.send(json.dumps({
        "type": "FunctionCallResponse",
        "id": fn_id,
        "name": fn_name,
        "content": content,
    }))


async def _handle_function_call(dg, browser: WebSocket, message: dict, session_id: str) -> None:
    # A single FunctionCallRequest can carry several independent tool calls (the
    # LLM asking for more than one at once) — run them concurrently so total
    # turn latency is the slowest call, not the sum of all of them.
    functions = message.get("functions", [])
    await asyncio.gather(*(_run_one_function_call(dg, browser, fn, session_id) for fn in functions))


async def bridge(browser: WebSocket, session_id: str = "", user_name: str = "", greet: bool = True) -> None:
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        await browser.send_json({"type": "error", "message": "DEEPGRAM_API_KEY is not set"})
        return

    async with websockets.connect(DG_URL, additional_headers={"Authorization": f"Token {api_key}"}) as dg:
        await dg.send(json.dumps(await _build_settings(session_id, user_name, greet)))

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

                if event_type == "ConversationText":
                    role, content = event.get("role"), event.get("content")
                    if role in ("user", "assistant") and content:
                        await anyio.to_thread.run_sync(memory_store.log_turn, session_id, role, content)

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
            # asyncio.wait swallows exceptions from finished tasks — without this,
            # a crash in either direction went completely silent: the socket stayed
            # open but nothing was ever sent to the browser again. Re-raising lets
            # main.py's handler report a real error instead of dead air.
            for task in done:
                exc = task.exception()
                if exc is not None:
                    raise exc
        except WebSocketDisconnect:
            b2d.cancel()
            d2b.cancel()
