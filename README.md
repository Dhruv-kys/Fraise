# Voice MCP Assistant

Talk to an agent in your browser; it does the work through **MCP tools**.

Say _"what is 2 plus 2"_ and it speaks back _"4"_ — the answer comes from a real
MCP `calculate` tool, not a hardcoded reply.

```
Browser (Vite + React)                 Backend (FastAPI, one process)
  mic  → SpeechRecognition      →      WebSocket /ws
                                         └─ run_agent()
                                              └─ mcp.call_tool("calculate", …)
  speaker ← speechSynthesis     ←      reply text
```

## How it works

- **Frontend** — a voice UI ("Fraise") with an animated [ElevenLabs orb](https://ui.elevenlabs.io/docs/components/orb).
  The browser transcribes your speech (Web Speech API), sends it over a
  WebSocket, and speaks the reply back.
- **Backend** — FastAPI. The `/ws` socket hands each utterance to `run_agent`,
  which calls tools on a **FastMCP** server. Tools are plain `@mcp.tool`
  functions with pydantic-typed input/output. The MCP server is also mounted at
  `/mcp` so external MCP clients can use the same tools.

## Layout

```
frontend/                Vite + React (TS)
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

Add a capability by writing another `@mcp.tool` function in `mcp_server.py`.

## Run it

Two processes from the repo root:

```bash
# 1. Backend  →  http://localhost:8000
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. Frontend  →  http://localhost:5173
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> in Chrome (needs the Web Speech API), tap the orb,
and talk.

For a single-server build: `cd frontend && npm run build` — the backend then
serves the built UI at <http://localhost:8000>.

Endpoints: `/ws` (voice), `/health`, `/mcp/` (MCP streamable HTTP).

## Roadmap

The point of this project is to keep adding MCP tools. Rough order:

### 1. Smarter agent
- [ ] **LLM in the loop** — let Claude decide which tool to call instead of the
      regex router in `agent.py` (wire the `anthropic` SDK).
- [ ] **Multi-tool calling** — run a tool-use loop so one request can chain
      several tools (e.g. "summarize my last meeting and add a follow-up").
- [ ] **Multiple agents** — route to specialized agents (scheduling, research,
      notes) behind one voice.

### 2. More MCP tools
- [ ] **Calendar** — read/create events (Google Calendar MCP).
- [ ] **Google Meet** — schedule and share meeting links.
- [ ] **RAG / summarization MCP** — index docs and answer/summarize over them.

### 3. Memory & data
- [ ] **Database** — persist conversations, transcripts, and tool results
      (start with SQLite, move to Postgres).
- [ ] **File upload** — drop in a PDF/doc; feed it to the RAG tool.

### 4. UX
- [ ] **Transcript correction** — edit a misheard utterance and re-run it.
- [ ] **Dark / light mode** — theme toggle (the orb already adapts to a `dark`
      class on `<html>`).

## Tech

React + TypeScript + Vite · Three.js (orb) · FastAPI · FastMCP · pydantic
