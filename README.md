# Fraise 🍓

<p align="center">
  <img src="assets/fraise.png" alt="Fraise" width="240" />
  <br />
  <strong><em>talk to me</em></strong>
  <br /><br />
  <a href="https://fraise-mcp.netlify.app"><strong>🔊 Try it live → fraise-mcp.netlify.app</strong></a>
</p>

**Voice for anything that speaks _MCP_.**

You talk. An LLM picks a tool, Fraise runs it on whichever MCP server owns it, and speaks the result back. Every capability is an MCP server. Adding one is a line in a config file; the voice layer never changes.

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

**Memory.** Per-browser session id (`?sid=`) injected by the host, never seen by the LLM. Stored locally in `fraise.db`, searched with FTS5. Nothing leaves the machine.

**Documents (RAG).** Upload `.txt` / `.md` / `.pdf` via the sidebar or `POST /upload`. Retrieval is: late chunking (embed the whole doc, then split, so chunk vectors keep context) with a local ONNX encoder `jina-embeddings-v2-small-en`, dense + BM25 search fused by RRF, then a cross-encoder rerank. The voice LLM speaks the answer from the winning passages; no second model runs. Scoped per session id.

**Calendar.** Ships disabled (needs your own Google OAuth). Returns plain English (no raw IDs/timestamps). `move_event` asks for spoken confirmation before executing. Token cached locally in `calendar_token.json`.

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

## Configuration

`.env` at the repo root. Only `DEEPGRAM_API_KEY` is required.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEEPGRAM_API_KEY` | required | Deepgram Voice Agent auth |
| `DEEPGRAM_THINK_MODEL` | `gpt-4o-mini` | LLM that picks tools and writes replies |
| `DEEPGRAM_LISTEN_MODEL` | `flux-general-en` | STT model (real end-of-turn detection) |
| `DEEPGRAM_VOICE` | `aura-2-thalia-en` | TTS voice |
| `DEEPGRAM_EOT_THRESHOLD` | `0.7` | end-of-turn confidence, 0.5–0.9 |
| `DEEPGRAM_EOT_TIMEOUT_MS` | `5000` | max silence before a turn ends |
| `CORS_ORIGINS` | `http://localhost:5173` | comma-separated allowed origins |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | none | calendar OAuth (or use `google_credentials.json`) |

---

## Run it

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
