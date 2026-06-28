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
    voice_agent.py       Deepgram bridge + MCP function call handler
    mcp_manager.py       connects to MCP servers, aggregates + routes tools
    mcp_server.py        built-in FastMCP tools (@mcp.tool)
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
