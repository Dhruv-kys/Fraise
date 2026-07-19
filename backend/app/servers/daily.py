"""Dictation → a day, split into tasks, each handled by its own agent.

You speak your whole day in one breath — "email Sarah the deck, book a dentist
Tuesday, find me the best noise-cancelling headphones, remind me to call mom" —
and this splits that monologue into atomic tasks, classifies each into a lane,
and fans them out to run at once. Each task is a tiny agent: research searches
the web and summarizes, remember writes to memory, email drafts a reply, and so
on. Progress streams to `bus` (the same channel the research fan-out uses), so
the browser watches the day get handled task by task instead of a spinner.

This is orchestration over the existing capabilities, not a new one — it reuses
the research search, the Groq LLM helper, and the memory store. Triggered by the
`POST /dictate` HTTP endpoint (like `/upload`), not a voice tool.
"""
import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone

from app.host import bus
from app.servers.memory import store as memory_store
from app.servers.research import llm, search
from app.storage import db

logger = logging.getLogger(__name__)

_LANE_LIMIT = 3
_TASK_BUDGET = 55

_CHUNK_CHARS = 4000
_MAX_TASKS_PER_CHUNK = 16
_MAX_TASKS_TOTAL = 48
_DETAIL_MAX_CHARS = 800
_SEGMENT_MAX_TOKENS = 4096

LANES = ("research", "remember", "reminder", "calendar", "email", "note", "answer")

_running: set[asyncio.Task] = set()

_SEGMENT_SYSTEM = (
    "You turn a spoken brain-dump of someone's day into a list of separate, atomic "
    "tasks, and sort each into the one agent that should handle it. You may be shown "
    "only one part of a longer dictation — segment just what's given here; don't "
    "invent or assume content from parts you can't see.\n\n"
    "Return JSON: {\"tasks\": [...]}. Each task is:\n"
    '  "title": an imperative phrase, max 8 words, naming the one thing to do.\n'
    '  "lane": exactly one of: research, remember, reminder, calendar, email, note, answer.\n'
    '  "detail": the specifics the handling agent needs — the search query, the fact '
    "to store, the message to draft, the event and time, etc. Keep the user's own "
    "words where they matter (names, times, amounts).\n\n"
    "Lane meanings:\n"
    "- research: needs looking up on the web — find options, compare things, gather "
    "information, prices, reviews, news.\n"
    "- remember: a durable fact about the user or their preferences to store.\n"
    "- reminder: a time-based nudge to resurface later (\"remind me to…\").\n"
    "- calendar: a specific appointment or event to schedule at a time/date.\n"
    "- email: a message to write or send to someone.\n"
    "- note: a to-do or note that fits no other lane.\n"
    "- answer: a direct question the assistant can just answer.\n\n"
    "Rules:\n"
    "- SPLIT compound speech into separate tasks. \"Email Sam and book a table\" is two.\n"
    "- Do not invent tasks the person did not say. Do not merge unrelated ones.\n"
    "- Every task needs a lane; when unsure between two, pick the more actionable one.\n"
    "- Keep the tasks in the order they were spoken."
)

def _today_line(tz_offset_min: int) -> str:
    now = datetime.now(timezone.utc)
    local = now.timestamp() - tz_offset_min * 60
    d = datetime.fromtimestamp(local, tz=timezone.utc)
    return d.strftime("Today is %A, %B %-d, %Y, local time %-I:%M %p.")

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
_TASK_OBJ = re.compile(r'\{[^{}]*"title"[^{}]*\}', re.S)

def _split_into_chunks(text: str, max_chars: int = _CHUNK_CHARS) -> list[str]:
    """Sentence-bounded chunks so no sentence — and no task inside it — is ever
    cut in half at a chunk boundary."""
    text = text.strip()
    if len(text) <= max_chars:
        return [text]
    chunks: list[str] = []
    current = ""
    for sent in _SENT_SPLIT.split(text):
        if current and len(current) + len(sent) + 1 > max_chars:
            chunks.append(current.strip())
            current = sent
        else:
            current = f"{current} {sent}".strip()
    if current.strip():
        chunks.append(current.strip())
    return chunks or [text]

def _context_block(session_id: str) -> str:
    """Recent remembered facts + conversation, folded into the segmentation
    prompt so references in the dictation ("email her again", "same place as
    last time") resolve instead of turning into vague or misrouted tasks."""
    facts = memory_store.recall(session_id, limit=8)
    turns = memory_store.recent_turns(session_id, limit=6)
    parts = []
    if facts:
        parts.append(
            "Known facts about this person — use them only to resolve references, "
            "never to invent new tasks:\n" + "\n".join(f"- {f}" for f in facts)
        )
    if turns:
        recent = "\n".join(f"{role}: {content}" for role, content in turns)
        parts.append(f"Recent conversation, for resolving pronouns/references only:\n{recent}")
    return "\n\n".join(parts)

def _parse_segment_response(raw: str) -> list[dict]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = None
    if isinstance(data, dict) and isinstance(data.get("tasks"), list):
        return [t for t in data["tasks"] if isinstance(t, dict)]

    tasks = []
    for m in _TASK_OBJ.finditer(raw):
        try:
            d = json.loads(m.group(0))
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict):
            tasks.append(d)
    return tasks

async def _segment_chunk(text: str, tz_offset_min: int, context: str) -> list[dict]:
    parts = [_today_line(tz_offset_min)]
    if context:
        parts.append(context)
    parts.append(f"The day, as spoken:\n{text.strip()}")
    ask = "\n\n".join(parts)

    try:
        raw = await llm.complete(
            _SEGMENT_SYSTEM, ask, json_mode=True, model=llm.SYNTH_MODEL,
            max_tokens=_SEGMENT_MAX_TOKENS,
        )
    except llm.LLMUnavailable as exc:
        logger.warning("day segmentation unavailable (%s); one-task fallback", exc)
        return [_fallback_task(text)]

    raw_tasks = _parse_segment_response(raw)
    if not raw_tasks:
        return [_fallback_task(text)]

    tasks: list[dict] = []
    for t in raw_tasks[:_MAX_TASKS_PER_CHUNK]:
        title = llm.strip_markdown(str(t.get("title") or "")).strip()[:80]
        detail = str(t.get("detail") or "").strip()[:_DETAIL_MAX_CHARS]
        lane = str(t.get("lane") or "note").strip().lower()
        if lane not in LANES:
            lane = "note"
        if not title and not detail:
            continue
        tasks.append({"title": title or detail[:60], "lane": lane, "detail": detail or title})
    return tasks or [_fallback_task(text)]

async def _segment(text: str, tz_offset_min: int, session_id: str) -> list[dict]:
    context = await asyncio.to_thread(_context_block, session_id)
    chunks = _split_into_chunks(text)

    if len(chunks) == 1:
        merged = await _segment_chunk(chunks[0], tz_offset_min, context)
    else:
        sem = asyncio.Semaphore(_LANE_LIMIT)

        async def guarded(c: str) -> list[dict]:
            async with sem:
                return await _segment_chunk(c, tz_offset_min, context)

        results = await asyncio.gather(*(guarded(c) for c in chunks))
        merged = [t for chunk_tasks in results for t in chunk_tasks]

    merged = merged[:_MAX_TASKS_TOTAL] or [_fallback_task(text)]
    return [{**t, "id": f"t{i}-{db.new_id()[:6]}"} for i, t in enumerate(merged)]

def _fallback_task(text: str) -> dict:
    return {"title": text.strip()[:60] or "Your note", "lane": "note", "detail": text.strip()}

_RESEARCH_SYSTEM = (
    "You are a research agent. From these search results, answer the request in "
    "2-3 tight, specific sentences — concrete names, numbers, and picks, never "
    "invented. Plain text only: no markdown, no URLs."
)

async def _lane_research(detail: str) -> tuple[str, str, str, list]:
    results = await asyncio.wait_for(search.search(detail, [], max_results=5), _TASK_BUDGET)
    if not results:
        return "done", "Nothing solid came back.", "I couldn't find much on that one.", []
    corpus = "\n\n".join(f"[{i+1}] {r['title']}\n{r['content']}" for i, r in enumerate(results))
    raw = await asyncio.wait_for(
        llm.complete(_RESEARCH_SYSTEM, f"Request: {detail}\n\nResults:\n{corpus}"), _TASK_BUDGET
    )
    summary = llm.strip_markdown(raw) or "Found some leads — take a look at the sources."
    sources = [{"title": r["title"], "url": r["url"]} for r in results[:3] if r.get("title")]
    return "done", f"Read {len(results)} sources.", summary, sources

async def _lane_answer(detail: str) -> tuple[str, str, str, list]:
    system = (
        "Answer the question directly in 1-3 sentences. Plain text, no markdown. "
        "If it needs live or personal data you don't have, say so briefly."
    )
    raw = await asyncio.wait_for(llm.complete(system, detail), _TASK_BUDGET)
    return "done", "Answered.", llm.strip_markdown(raw) or "Done.", []

async def _lane_email(detail: str) -> tuple[str, str, str, list]:
    system = (
        "Draft a short, warm, professional email for the request. Return plain text "
        "as:\nSubject: <line>\n\n<2-4 sentence body>\nNo markdown, no placeholders "
        "like [Name] unless the name is genuinely unknown."
    )
    raw = await asyncio.wait_for(llm.complete(system, detail), _TASK_BUDGET)
    return "proposed", "Draft ready to review.", llm.strip_markdown(raw) or detail, []

async def _run_task(task: dict, day_id: str, session_id: str) -> dict:
    """One task, one lane, never raises — a failed task is reported, not fatal."""
    tid, lane, detail = task["id"], task["lane"], task["detail"]
    started = time.monotonic()

    def emit(status: str, note: str, **extra) -> None:
        bus.publish(session_id, {
            "type": "day_task", "day_id": day_id, "id": tid,
            "status": status, "note": note, **extra,
        })

    emit("running", {
        "research": "Searching the web…",
        "remember": "Saving to memory…",
        "email": "Drafting the message…",
        "answer": "Working it out…",
    }.get(lane, "Handling it…"))

    try:
        if lane == "research":
            status, note, result, sources = await _lane_research(detail)
        elif lane == "answer":
            status, note, result, sources = await _lane_answer(detail)
        elif lane == "email":
            status, note, result, sources = await _lane_email(detail)
        elif lane == "remember":
            await asyncio.to_thread(memory_store.remember, session_id, detail)
            status, note, result, sources = "done", "Saved.", "I'll remember that.", []
        elif lane == "reminder":
            status, note, result, sources = (
                "proposed", "Reminder set aside.",
                f"I'll nudge you: {detail}", [])
        elif lane == "calendar":
            status, note, result, sources = (
                "proposed", "Ready to schedule.",
                f"I can add this once your calendar is connected: {detail}", [])
        else:
            await asyncio.to_thread(memory_store.remember, session_id, f"To do: {detail}")
            status, note, result, sources = "done", "Noted.", detail, []

        elapsed = round(time.monotonic() - started, 1)
        emit(status, note, result=result, sources=sources, elapsed=elapsed)
        return {**task, "status": status, "result": result}

    except Exception as exc:
        logger.warning("day task %s (%s) failed: %s", tid, lane, exc)
        emit("failed", "Couldn't finish this one.", error=str(exc)[:160])
        return {**task, "status": "failed"}

async def _run(day_id: str, text: str, session_id: str, tz_offset_min: int) -> None:
    try:
        bus.publish(session_id, {
            "type": "day", "day_id": day_id, "status": "segmenting",
            "note": "Splitting your day into tasks…",
        })
        tasks = await _segment(text, tz_offset_min, session_id)

        bus.publish(session_id, {
            "type": "day", "day_id": day_id, "status": "running", "text": text,
            "tasks": [{**t, "status": "queued"} for t in tasks],
        })

        sem = asyncio.Semaphore(_LANE_LIMIT)

        async def guarded(t: dict) -> dict:
            async with sem:
                return await _run_task(t, day_id, session_id)

        done = await asyncio.gather(*(guarded(t) for t in tasks))

        n = len(done)
        handled = sum(1 for d in done if d.get("status") in ("done", "proposed"))
        spoken = (
            f"That's your day sorted — {handled} of {n} handled. "
            "The research is written up and any drafts are ready for you to check."
        )
        bus.publish(session_id, {
            "type": "day", "day_id": day_id, "status": "done", "spoken": spoken,
        })
    except Exception as exc:
        logger.exception("day run %s crashed", day_id)
        bus.publish(session_id, {
            "type": "day", "day_id": day_id, "status": "failed", "error": str(exc)[:160],
        })

def start(text: str, session_id: str, tz_offset_min: int = 0) -> str:
    """Kick off a day run in the background; return its id immediately.

    Like the research fan-out, this outlives a single request, so it's detached
    and streams its story over the bus rather than blocking the POST.
    """
    day_id = db.new_id()
    task = asyncio.create_task(_run(day_id, text, session_id, tz_offset_min))
    _running.add(task)
    task.add_done_callback(_running.discard)
    return day_id
