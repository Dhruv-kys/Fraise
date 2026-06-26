# 🍓 Fraise

<p align="center">
  <img src="assets/fraise.png" alt="Fraise" width="240" />
  <br />
  <strong><em>talk to me</em></strong>
</p>

**Voice for _anything_ that speaks MCP.**

Talk to it in your browser. Say _"what is 2 plus 2"_ and it speaks back _"4"_ —
and that answer comes from an actual MCP `calculate` tool, not a canned reply.
Fraise is the scaffold for a voice-first agent: an animated orb up front, a
[FastMCP](https://github.com/modelcontextprotocol/python-sdk) tool server behind
it, and a clean path to add real capabilities (calendar, meetings, RAG, …).

See [ROADMAP.md](ROADMAP.md) for where this is going.

```
Browser (Vite + React)                 Backend (FastAPI, one process)
  mic  → SpeechRecognition      →      WebSocket /ws
                                         └─ run_agent()
                                              └─ mcp.call_tool("calculate", …)
  speaker ← speechSynthesis     ←      reply text
```

## How it works

- **Frontend** — a voice UI with an animated [ElevenLabs orb](https://ui.elevenlabs.io/docs/components/orb)
  that reacts to your voice and the agent's state. The browser transcribes your
  speech (Web Speech API), sends it over a WebSocket, and speaks the reply back.
  frontend staging link : https://fraise-mcp.netlify.app (WIP)
- **Backend** — FastAPI in a single process. The `/ws` socket hands each
  utterance to `run_agent`, which calls tools on a **FastMCP** server. Tools are
  plain `@mcp.tool` functions with pydantic-typed input/output. The same MCP
  server is mounted at `/mcp` so external MCP clients can use the tools too.

Add a capability by writing another `@mcp.tool` function in `mcp_server.py`.

## Layout

```
frontend/                Vite + React (TypeScript)
  src/
    App.tsx              the Fraise voice UI
    Orb.tsx              ElevenLabs WebGL orb, mapped to voice state
    useVoiceAgent.ts     mic + speech + WebSocket hook

backend/
  app/
    main.py              FastAPI: /ws, /health, mounts MCP at /mcp, serves frontend
    mcp_server.py        FastMCP server — @mcp.tool functions live here
    agent.py             run_agent() — routes an utterance to MCP tools
  requirements.txt
```

## Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Runs on <http://localhost:8000>.

**Health check** — confirm the server is up:

```bash
curl http://localhost:8000/health
# {"ok":true}
```

Endpoints:

| Path      | What it is                                   |
| --------- | -------------------------------------------- |
| `/health` | liveness check → `{"ok": true}`              |
| `/ws`     | voice WebSocket (the browser talks here)     |
| `/mcp/`   | MCP server (streamable HTTP, for MCP clients) |

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on <http://localhost:5173>. Open it in **Chrome** (needs the Web Speech
API), tap the orb, and start talking. The status pill shows **Offline** until
the backend is running, so start the backend first.

**Single-server build** — bundle the UI and let the backend serve it:

```bash
cd frontend && npm run build
```

The backend now serves the built app at <http://localhost:8000>.

## Tech

React · TypeScript · Vite · Three.js (orb) · FastAPI · FastMCP · pydantic
