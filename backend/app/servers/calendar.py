"""Google Calendar MCP server for Fraise.

Tools return plain-English strings designed to be read aloud. No raw IDs,
no ISO timestamps — just natural language the LLM can speak directly.

Authentication: run the OAuth flow once via GET /auth/calendar. The token
is stored in backend/calendar_token.json and refreshed automatically.
"""
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("calendar", streamable_http_path="/")

SCOPES = ["https://www.googleapis.com/auth/calendar"]
TOKEN_PATH = Path(__file__).resolve().parents[1] / "calendar_token.json"
AUTH_URL = "/auth/calendar"


class CalendarAuthRequired(RuntimeError):
    """Raised when the user needs to (re)connect Google Calendar."""


def _auth_needed_response() -> str:
    # The host forwards `_action` to the browser (an OAuth redirect) and re-runs
    # the tool once auth completes. `message` is spoken if the action times out.
    return json.dumps({
        "_action": {"type": "auth_redirect", "url": AUTH_URL},
        "message": "Google Calendar isn't connected yet.",
    })

TZ_NAME = os.getenv("CALENDAR_TIMEZONE", "America/New_York")
WORK_START = int(os.getenv("CALENDAR_WORK_START", "9"))   # hour, 24h
WORK_END   = int(os.getenv("CALENDAR_WORK_END",   "18"))  # hour, 24h


# ---------------------------------------------------------------------------
# Auth / service
# ---------------------------------------------------------------------------

def _tz() -> ZoneInfo:
    return ZoneInfo(TZ_NAME)


def _service():
    if not TOKEN_PATH.exists():
        raise CalendarAuthRequired("Google Calendar isn't connected yet.")
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            TOKEN_PATH.write_text(creds.to_json())
        else:
            raise CalendarAuthRequired("Calendar credentials expired.")
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _today() -> date:
    return datetime.now(tz=_tz()).date()


def _parse_date(s: str) -> date:
    return date.today() if not s.strip() else date.fromisoformat(s.strip())


def _parse_event_dt(event_time: dict) -> datetime | None:
    """Parse a Google Calendar event start/end dict; returns None for all-day."""
    if "dateTime" in event_time:
        return datetime.fromisoformat(event_time["dateTime"])
    return None  # all-day event: only has "date"


def _speak_date(d: date) -> str:
    today = _today()
    if d == today:
        return "today"
    if d == today + timedelta(days=1):
        return "tomorrow"
    if d == today - timedelta(days=1):
        return "yesterday"
    return d.strftime("%A, %B %-d")


def _speak_time(dt: datetime) -> str:
    local = dt.astimezone(_tz())
    h, m = local.hour, local.minute
    suffix = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {suffix}" if m else f"{h12} {suffix}"


def _speak_range(start: datetime, end: datetime) -> str:
    s, e = _speak_time(start), _speak_time(end)
    # If same AM/PM suffix, drop it from the start
    if s.endswith("AM") and e.endswith("AM"):
        s = s[:-3]
    elif s.endswith("PM") and e.endswith("PM"):
        s = s[:-3]
    return f"{s.strip()} to {e}"


def _find_event_by_title(svc, title: str, on_date: date) -> dict | None:
    tz = _tz()
    day_start = datetime(on_date.year, on_date.month, on_date.day, tzinfo=tz)
    day_end   = day_start + timedelta(days=1)
    result = svc.events().list(
        calendarId="primary",
        timeMin=day_start.isoformat(),
        timeMax=day_end.isoformat(),
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    query = title.lower()
    for ev in result.get("items", []):
        if query in ev.get("summary", "").lower():
            return ev
    return None


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def list_events(date: str = "") -> str:
    """List calendar events for a given date.

    date: YYYY-MM-DD. Leave blank for today.
    Returns a plain-English summary ready to be spoken aloud.
    """
    try:
        svc = _service()
    except CalendarAuthRequired:
        return _auth_needed_response()

    d = _parse_date(date)
    tz = _tz()
    day_start = datetime(d.year, d.month, d.day, tzinfo=tz)
    day_end   = day_start + timedelta(days=1)

    result = svc.events().list(
        calendarId="primary",
        timeMin=day_start.isoformat(),
        timeMax=day_end.isoformat(),
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    events = result.get("items", [])
    if not events:
        return f"Your {_speak_date(d)} is clear — no events scheduled."

    day = _speak_date(d).capitalize()
    parts = []
    for ev in events:
        title = ev.get("summary", "Untitled event")
        start_dt = _parse_event_dt(ev["start"])
        end_dt   = _parse_event_dt(ev["end"])
        if start_dt and end_dt:
            parts.append(f"{title} from {_speak_range(start_dt, end_dt)}")
        else:
            parts.append(f"{title} (all day)")

    if len(parts) == 1:
        return f"{day} you have one event: {parts[0]}."
    listing = ", ".join(parts[:-1]) + f", and {parts[-1]}"
    return f"{day} you have {len(parts)} events: {listing}."


@mcp.tool()
def find_free_slot(date: str, duration_minutes: int = 60) -> str:
    """Find open time slots on a given date within working hours.

    date: YYYY-MM-DD.
    duration_minutes: how long the slot needs to be (default 60).
    Returns a plain-English list of available slots.
    """
    try:
        svc = _service()
    except CalendarAuthRequired:
        return _auth_needed_response()

    d = _parse_date(date)
    tz = _tz()
    day_start = datetime(d.year, d.month, d.day, WORK_START, tzinfo=tz)
    day_end   = datetime(d.year, d.month, d.day, WORK_END,   tzinfo=tz)

    body = {
        "timeMin": day_start.isoformat(),
        "timeMax": day_end.isoformat(),
        "items": [{"id": "primary"}],
    }
    fb = svc.freebusy().query(body=body).execute()
    busy = [
        (datetime.fromisoformat(b["start"]), datetime.fromisoformat(b["end"]))
        for b in fb["calendars"]["primary"]["busy"]
    ]
    busy.sort(key=lambda x: x[0])

    # Walk working hours and collect gaps >= duration_minutes.
    duration = timedelta(minutes=duration_minutes)
    slots = []
    cursor = day_start
    for b_start, b_end in busy:
        if cursor + duration <= b_start:
            slots.append((cursor, b_start))
        cursor = max(cursor, b_end)
    if cursor + duration <= day_end:
        slots.append((cursor, day_end))

    day = _speak_date(d).capitalize()
    dur_str = f"{duration_minutes} minutes" if duration_minutes != 60 else "an hour"

    if not slots:
        return f"No free slots long enough for {dur_str} on {day} during working hours."

    spoken = [f"{_speak_time(s)} to {_speak_time(e)}" for s, e in slots[:4]]
    if len(spoken) == 1:
        return f"On {day} you're free from {spoken[0]}."
    listing = ", ".join(spoken[:-1]) + f", and {spoken[-1]}"
    return f"On {day} you have open slots at {listing}."


@mcp.tool()
def create_event(
    title: str,
    date: str,
    start_time: str,
    duration_minutes: int = 60,
    description: str = "",
) -> str:
    """Create a calendar event.

    date: YYYY-MM-DD.
    start_time: HH:MM in 24-hour format (e.g. '14:30').
    duration_minutes: how long the event lasts (default 60).
    """
    try:
        svc = _service()
    except CalendarAuthRequired:
        return _auth_needed_response()

    d = _parse_date(date)
    tz = _tz()
    h, m = (int(x) for x in start_time.strip().split(":"))
    start_dt = datetime(d.year, d.month, d.day, h, m, tzinfo=tz)
    end_dt   = start_dt + timedelta(minutes=duration_minutes)

    body = {
        "summary": title,
        "start": {"dateTime": start_dt.isoformat(), "timeZone": TZ_NAME},
        "end":   {"dateTime": end_dt.isoformat(),   "timeZone": TZ_NAME},
    }
    if description:
        body["description"] = description

    svc.events().insert(calendarId="primary", body=body).execute()
    return (
        f"Done. I've added \"{title}\" on {_speak_date(d)} "
        f"from {_speak_range(start_dt, end_dt)}."
    )


@mcp.tool()
def move_event(
    event_title: str,
    current_date: str,
    new_date: str,
    new_start_time: str,
    confirmed: bool = False,
) -> str:
    """Move a calendar event to a new date and time, found by title.

    Searches for an event matching event_title on current_date.
    On the first call (confirmed=False) returns a confirmation prompt — read it
    aloud and ask the user to confirm. Call again with confirmed=True to execute.

    current_date / new_date: YYYY-MM-DD.
    new_start_time: HH:MM in 24-hour format.
    """
    try:
        svc = _service()
    except CalendarAuthRequired:
        return _auth_needed_response()

    d = _parse_date(current_date)
    ev = _find_event_by_title(svc, event_title, d)
    if not ev:
        return (
            f"I couldn't find an event matching \"{event_title}\" on {_speak_date(d)}. "
            "Try listing events first to get the exact title."
        )

    actual_title = ev.get("summary", event_title)
    old_start_dt = _parse_event_dt(ev["start"])
    old_end_dt   = _parse_event_dt(ev["end"])
    duration = (
        (old_end_dt - old_start_dt) if old_start_dt and old_end_dt
        else timedelta(hours=1)
    )

    nd = _parse_date(new_date)
    tz = _tz()
    h, m = (int(x) for x in new_start_time.strip().split(":"))
    new_start = datetime(nd.year, nd.month, nd.day, h, m, tzinfo=tz)
    new_end   = new_start + duration

    if not confirmed:
        return (
            f"I found \"{actual_title}\" on {_speak_date(d)}. "
            f"Should I move it to {_speak_date(nd)} at {_speak_time(new_start)}?"
        )

    ev["start"] = {"dateTime": new_start.isoformat(), "timeZone": TZ_NAME}
    ev["end"]   = {"dateTime": new_end.isoformat(),   "timeZone": TZ_NAME}
    svc.events().update(calendarId="primary", eventId=ev["id"], body=ev).execute()
    return (
        f"Done. \"{actual_title}\" is now on {_speak_date(nd)} "
        f"from {_speak_range(new_start, new_end)}."
    )
