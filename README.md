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

### Memory — *"remember I prefer afternoons."*

- **What it does.** Saves things you tell it and reads them back later. Three tools: `remember`, `recall`, `forget`.
- **Per person, no login.** Your browser gets a session id (`?sid=`) on first visit. The host stamps it onto every call so your notes stay separate from everyone else's. Same browser means same you.
- **The LLM never sees the id.** The model only chooses the action; the host injects the id afterward, so it cannot read, leak, or invent one.
- **Fully local.** Stored in `fraise.db` and searched with SQLite's built-in full-text engine (FTS5). Nothing leaves the machine.

### Documents (RAG) — *"what does the contract say about renewal?"*

Drop a `.txt` / `.md` / `.pdf` in the sidebar (or `POST /upload`) and ask about it out loud. Finding the right passage runs in four steps:

- **Late chunking.** Normal RAG splits a document into chunks *first*, then embeds each chunk alone, so a chunk reading *"it renews every January"* has already forgotten what *"it"* was. Fraise embeds the **whole document in one pass**, then splits it, so every chunk's vector still carries the surrounding context.
- **A local long-context encoder.** Late chunking needs per-token output from a model that can read the whole doc at once. That model is `jina-embeddings-v2-small-en`, run through ONNX Runtime on your machine (no PyTorch, loaded once at startup).
- **Hybrid search (dense + BM25).** Two searches run side by side: a **dense** vector search that matches meaning (catches paraphrases) and a **BM25** keyword search that matches exact text (catches names, codes, IDs). Their two ranked lists are merged with **Reciprocal Rank Fusion**, which rewards chunks that both searches agreed on. Vectors live in SQLite via `sqlite-vec`; BM25 is FTS5; same `fraise.db`.
- **A cross-encoder reranker.** The first three steps are fast but rough. The top candidates go through a **cross-encoder** (fastembed) that reads the question and each passage *together* and scores how well they actually match. Only the best few survive.
- **No second model writes the reply.** The winning passages go straight back to the voice LLM already in the conversation, and it speaks the answer. Everything except the voice transit runs locally, and the encoder + reranker download once then stay cached. Scoped per session id.

### Calendar — *"move my 3pm to tomorrow."*

- **Off by default.** It needs your own Google OAuth credentials, so it ships disabled. Four tools: `list_events`, `find_free_slot`, `create_event`, `move_event`.
- **Speaks human.** Tools return plain English; no raw event IDs or ISO timestamps ever reach the LLM.
- **Confirms before it touches anything.** Destructive actions like `move_event` ask out loud first and only run when called again with confirmation.
- **Local tokens.** OAuth runs at `/auth/calendar`; the token is cached in `calendar_token.json` and refreshed automatically.

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
