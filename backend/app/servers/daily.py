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
import logging
import time
from datetime import datetime, timezone

from app.host import bus
from app.servers.memory import store as memory_store
from app.servers.research import llm, search
from app.storage import db

logger = logging.getLogger(__name__)

# LLM-bound lanes fired at once can clip Groq's per-minute token ceiling. Cap the
# concurrency so a busy day degrades to slightly-slower rather than 429s.
_LANE_LIMIT = 3
_TASK_BUDGET = 55  # seconds for one task's search + summarize

LANES = ("research", "remember", "reminder", "calendar", "email", "note", "answer")

_running: set[asyncio.Task] = set()


_SEGMENT_SYSTEM = (
    "You turn a spoken brain-dump of someone's day into a list of separate, atomic "
    "tasks, and sort each into the one agent that should handle it.\n\n"
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
    # The browser sends its UTC offset so "Tuesday"/"tomorrow" resolve to the
    # user's local calendar, not the server's.
    now = datetime.now(timezone.utc)
    local = now.timestamp() - tz_offset_min * 60
    d = datetime.fromtimestamp(local, tz=timezone.utc)
    return d.strftime("Today is %A, %B %-d, %Y, local time %-I:%M %p.")


async def _segment(text: str, tz_offset_min: int) -> list[dict]:
    ask = f"{_today_line(tz_offset_min)}\n\nThe day, as spoken:\n{text.strip()}"
    try:
        data = await llm.complete_json(_SEGMENT_SYSTEM, ask, model=llm.SYNTH_MODEL)
    except llm.LLMUnavailable as exc:
        logger.warning("day segmentation unavailable (%s); one-task fallback", exc)
        return [_fallback_task(text)]

    raw = data.get("tasks")
    if not isinstance(raw, list) or not raw:
        return [_fallback_task(text)]

    tasks: list[dict] = []
    for i, t in enumerate(raw[:12]):
        if not isinstance(t, dict):
            continue
        title = llm.strip_markdown(str(t.get("title") or "")).strip()[:80]
        detail = str(t.get("detail") or "").strip()[:400]
        lane = str(t.get("lane") or "note").strip().lower()
        if lane not in LANES:
            lane = "note"
        if not title and not detail:
            continue
        tasks.append({
            "id": f"t{i}-{db.new_id()[:6]}",
            "title": title or detail[:60],
            "lane": lane,
            "detail": detail or title,
        })
    return tasks or [_fallback_task(text)]


def _fallback_task(text: str) -> dict:
    return {"id": f"t0-{db.new_id()[:6]}", "title": text.strip()[:60] or "Your note",
            "lane": "note", "detail": text.strip()}


# ---- lane handlers: each returns (status, note, result, sources) ----

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
        else:  # note
            await asyncio.to_thread(memory_store.remember, session_id, f"To do: {detail}")
            status, note, result, sources = "done", "Noted.", detail, []

        elapsed = round(time.monotonic() - started, 1)
        emit(status, note, result=result, sources=sources, elapsed=elapsed)
        return {**task, "status": status, "result": result}

    except Exception as exc:  # a dead task must not kill the day
        logger.warning("day task %s (%s) failed: %s", tid, lane, exc)
        emit("failed", "Couldn't finish this one.", error=str(exc)[:160])
        return {**task, "status": "failed"}


async def _run(day_id: str, text: str, session_id: str, tz_offset_min: int) -> None:
    try:
        bus.publish(session_id, {
            "type": "day", "day_id": day_id, "status": "segmenting",
            "note": "Splitting your day into tasks…",
        })
        tasks = await _segment(text, tz_offset_min)

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
