# Fraise 🍓

<p align="center">
  <img src="assets/fraise.png" alt="Fraise" width="240" />
  <br />
  <strong><em>talk to me</em></strong>
  <br /><br />
  <a href="https://fraise-mcp.netlify.app"><strong>🔊 Try it live → fraise-mcp.netlify.app</strong></a>
</p>

**Voice for anything that speaks _MCP_.**

> *"Remember I hate morning meetings."*
> *"What does the handbook say about reimbursements?"*
> *"What's forty-two times nineteen?"*

Say it out loud and Fraise answers out loud. Under the hood an LLM picks a tool, Fraise runs it on whichever MCP server owns it, and speaks the result back. Every capability (a calculator, your memory, your documents, your calendar, a Slack workspace) is just an MCP server. Want a new skill? Add a line to a config file. The voice layer never changes, ever.

---

## How a turn works

```
mic audio (16 kHz PCM) -> /ws WebSocket -> Deepgram Voice Agent
  Flux STT -> text
  LLM (gpt-4o-mini) picks a tool from all connected servers
  MCPManager routes the call to the owning server (up to 10 chained calls)
  result -> Aura TTS (24 kHz) -> you hear it
```

- The backend does not run its own STT/LLM/TTS. It bridges one WebSocket to Deepgram Voice Agent, which hosts all three.
- `MCPManager` reads `mcp_servers.json` on startup, connects to every server, and flattens their tools into one list for the LLM. Nothing is hardcoded.
- Colliding tool names get a server prefix (`slack_search` vs `jira_search`). A server that fails to connect is skipped, not fatal.

---

## Servers and tools

| Server | Status | Tools | Storage |
|--------|--------|-------|---------|
| `calculator` | on | `calculate` | none |
| `memory` | on | `remember`, `recall`, `forget` | local SQLite |
| `rag` | on | `ask`, `summarize`, `list_documents` | local SQLite + `sqlite-vec` |
| `calendar` | off by default | `list_events`, `find_free_slot`, `create_event`, `move_event` | local token + Google Calendar |

Toggle any server with `"disabled"` in [backend/mcp_servers.json](backend/mcp_servers.json).

**Memory** — *"remember I prefer afternoons."* It sticks. Your browser gets a session id (`?sid=`) that the host injects on every call and the LLM never sees, so your notes are yours and nobody else's. Stored locally in `fraise.db`, searched with FTS5. Nothing leaves the machine.

**Documents (RAG)** — *"what does the contract say about renewal?"* Drop a `.txt` / `.md` / `.pdf` in the sidebar (or `POST /upload`) and ask. The clever bit: **late chunking** embeds the whole document first, then splits it, so a chunk that says *"it renews every January"* still remembers what *"it"* was. A local ONNX encoder (`jina-embeddings-v2-small-en`) does the embedding, dense and BM25 search are fused with RRF, and a cross-encoder reranks the finalists. No second model writes the answer; the voice LLM speaks straight from the winning passages. Scoped per session id.

**Calendar** — *"move my 3pm to tomorrow."* Off by default (it needs your own Google OAuth). Speaks plain English, never raw IDs or timestamps, and anything destructive like `move_event` asks out loud before it touches your schedule. Token cached locally in `calendar_token.json`.

---

## API

Base URL in dev: `http://localhost:8000`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | liveness → `{"ok": true}` |
| `WS` | `/ws?sid=<id>` | voice session (PCM in, audio + JSON events out) |
| `POST` | `/upload?sid=<id>` | add a document (multipart `file`); `400` if no readable text |
| `GET` | `/auth/calendar` | start Google Calendar OAuth |
| `GET` | `/auth/calendar/callback` | OAuth redirect target |
| `*` | `/mcp/` | Fraise's own tools as an MCP server (streamable HTTP) |
| `GET` | `/` | serves the built frontend (production build) |

Pass the same `?sid=` to `/ws` and `/upload` so uploads are searchable in the same session.

---

## Run it

Set `DEEPGRAM_API_KEY` in a `.env` at the repo root, then:

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend (in another terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Start the backend first; the orb shows **Offline** until the WebSocket connects. Production build: `npm run build`, then the backend serves the UI at `http://localhost:8000`.

To enable calendar: create an OAuth 2.0 Web client in Google Cloud, add redirect `http://localhost:8000/auth/calendar/callback`, save the JSON as `backend/google_credentials.json` (or set the env vars), and set `"disabled": false` on the `calendar` entry.

---

## Add a capability

- **Private:** write `backend/app/servers/<name>.py` with `@mcp.tool` functions, add a `"type": "builtin"` entry to `mcp_servers.json`, restart.
- **Public:** add one `http` or `stdio` entry to `mcp_servers.json`, restart.

---

## Stack

React 19 · TypeScript · Vite 6 · Three.js · FastAPI · FastMCP · pydantic · Python 3.11+
Deepgram Voice Agent (Flux STT, `gpt-4o-mini`, Aura TTS) · SQLite (FTS5) · sqlite-vec · ONNX Runtime · fastembed

See [ROADMAP.md](ROADMAP.md) for the phase plan.
