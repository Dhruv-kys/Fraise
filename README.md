# Fraise 🍓

<p align="center">
  <img src="assets/fraise.png" alt="Fraise" width="240" />
  <br />
  <strong><em>talk to me</em></strong>
  <br /><br />
  <a href="https://fraise-mcp.netlify.app"><strong>🔊 Try it live → fraise-mcp.netlify.app</strong></a>
</p>

**Voice for anything that speaks _MCP_.**

Fraise is a voice-first MCP host. You talk — it figures out which MCP server
handles your intent and calls it. Public servers (Slack, Jira, GitHub) or
private ones you build yourself. Adding a capability means adding a server to a
config file, not changing Fraise.

See [ROADMAP.md](ROADMAP.md) for the full plan.

---

## How it works

```
You speak
  └─ Deepgram STT → text
       └─ LLM sees all tools from all connected MCP servers
            └─ picks a tool → Fraise routes the call
                 ├─ Slack MCP    (public)
                 ├─ Jira MCP     (public)
                 ├─ Calendar MCP (private — built by us)
                 ├─ Memory MCP   (private — local SQLite)
                 └─ Calculator   (built-in, today)
  └─ result → LLM → Deepgram TTS → you hear it
```

- **Frontend** — React + Vite. Animated ElevenLabs WebGL orb that reacts to
  agent state (idle → listening → thinking → speaking). Mic audio captured via
  AudioWorklet and streamed as linear16 PCM over WebSocket.
- **Backend** — FastAPI. A single `/ws` WebSocket bridges your mic to
  [Deepgram's Voice Agent](https://developers.deepgram.com/docs/voice-agent)
  (STT + LLM + TTS in one socket). When the LLM picks a tool, Fraise runs it
  on the right MCP server and returns the result. Tools are discovered
  automatically — no hardcoding.
- **MCP layer** — built-in tools are FastMCP `@mcp.tool` functions. An
  `MCPManager` connects to every server listed in `mcp_servers.json`
  (`builtin` / `stdio` / `http`), aggregates their tools, and routes each call
  to the server that owns it.

---

## Layout

```
frontend/
  src/
    App.tsx              voice UI
    Orb.tsx              ElevenLabs WebGL orb (lazy-loaded)
    useVoiceAgent.ts     mic + playback + WebSocket hook
  public/
    pcm-worklet.js       AudioWorklet: Float32 → Int16 PCM at 16 kHz

backend/
  app/
    main.py              FastAPI app — /ws, /health, /mcp, serves frontend
    host/
      voice_agent.py     Deepgram bridge + MCP function call handler
      mcp_manager.py     connects to MCP servers, aggregates + routes tools
    servers/
      calculator.py      built-in FastMCP calculator (@mcp.tool)
      calendar.py        Google Calendar MCP (list / free slots / create / move)
      calendar_auth.py   Google OAuth flow (/auth/calendar)
  mcp_servers.json       MCP server config (builtin / stdio / http)
  requirements.txt
```

---

## Running locally

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` at the repo root:

```
DEEPGRAM_API_KEY=your_key_here
```

Speech-to-text uses Deepgram's **Flux** model (`flux-general-en`) for real
end-of-turn detection — a mid-sentence pause no longer splits your turn into
multiple transcripts. Tunable via `DEEPGRAM_EOT_THRESHOLD` (0.5–0.9, default
0.7) and `DEEPGRAM_EOT_TIMEOUT_MS` (default 5000).

Start the server:

```bash
uvicorn app.main:app --reload --port 8000
```

Endpoints:

| Path | What it is |
|------|-----------|
| `/health` | liveness → `{"ok": true}` |
| `/ws` | voice WebSocket |
| `/mcp/` | MCP server (streamable HTTP) |
| `/auth/calendar` | starts Google Calendar OAuth |

### Google Calendar (optional)

The Calendar MCP works against your **personal** Google Calendar. To enable it:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   enable the **Google Calendar API** and create an **OAuth 2.0 Client ID**
   (type: Web application).
2. Add the redirect URI `http://localhost:8000/auth/calendar/callback`.
3. Download the JSON and save it as `backend/google_credentials.json`
   (or set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env`).

First time you ask about your calendar, Fraise surfaces a **Connect Calendar**
banner — click it, pick your account, and it auto-retries the request. The
token is cached in `backend/calendar_token.json` and refreshed automatically.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at <http://localhost:5173>. Start the backend first — the orb shows
**Offline** until the WebSocket connects. Click the orb to start talking.

**Production build** (backend serves the UI):

```bash
cd frontend && npm run build
# then visit http://localhost:8000
```

---

## Tech

React 19 · TypeScript · Vite 6 · Three.js (orb) · Web Audio API  
FastAPI · FastMCP · pydantic · Deepgram Voice Agent · Python 3.11+
