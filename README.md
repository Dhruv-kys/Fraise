# Fraise 🍓

<p align="center">
  <img src="assets/fraise.png" alt="Fraise" width="240" />
  <br />
  <strong><em>talk to me</em></strong>
  <br /><br />
  <a href="https://fraise-mcp.netlify.app"><strong>🔊 Try it live → fraise-mcp.netlify.app</strong></a>
</p>

**Voice for anything that speaks _MCP_.**

You talk. Fraise turns your speech into text, lets an LLM pick the right tool, runs that tool on whichever MCP server owns it, and speaks the result back. Every capability (Slack, Jira, GitHub, Calendar, Memory, Documents) is just an MCP server. Adding one means adding an entry to a config file. The voice layer never changes.

---

## Contents

- [The one idea](#the-one-idea)
- [Request flow](#request-flow)
- [Capabilities (MCP servers)](#capabilities-mcp-servers)
- [Memory](#memory)
- [Documents (RAG)](#documents-rag)
- [Calendar](#calendar)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Running locally](#running-locally)
- [Adding a capability](#adding-a-capability)
- [Tech stack](#tech-stack)

---

## The one idea

Fraise is split into two layers, and capability lives in exactly one of them.

1. **The voice host (transport).** Microphone in, speaker out. It runs the speech pipeline, draws the orb, and renders MCP concepts as conversation. It never knows what a "calendar" or a "document" is.
2. **MCP servers (capability).** Every actual skill is a server. Private servers are written in this repo. Public servers plug in over HTTP or stdio with zero new code.

The host only ever learns to speak MCP better. A new feature is a new server, not a change to the host. That separation is the whole point.

---

## Request flow

```
You speak
  -> browser captures mic audio (AudioWorklet, Float32 -> Int16 PCM @ 16 kHz)
  -> streamed over WebSocket (/ws) to the backend
  -> backend bridges to Deepgram Voice Agent (STT + LLM + TTS, one socket)
       -> Deepgram Flux STT turns speech into text with real end-of-turn detection
       -> the LLM sees every tool from every connected MCP server
       -> the LLM picks a tool; MCPManager routes the call to the owning server
            - calculator (built-in)
            - memory     (built-in, local SQLite)
            - rag        (built-in, local RAG over your files)
            - calendar   (built-in, off by default)
            - any public Slack / Jira / GitHub server (config only)
       -> the LLM may chain up to 10 tool calls in one turn before answering
  -> result text -> Deepgram TTS (Aura) @ 24 kHz -> you hear the answer
```

Key facts:

- **One WebSocket** carries the whole turn. The backend does not run its own STT, LLM, or TTS; it bridges to Deepgram Voice Agent, which hosts all three.
- **The LLM** is OpenAI `gpt-4o-mini` by default, called through Deepgram's `think` provider.
- **Tool discovery is automatic.** `MCPManager` reads `mcp_servers.json` on startup, connects to every server, and flattens all their tools into one function list handed to the LLM. Nothing is hardcoded.
- **Name collisions** get a server prefix (`slack_search` vs `jira_search`); unique names stay clean.
- **One bad server degrades gracefully.** If a server fails to connect, it is skipped and logged. The rest still work.

---

## Capabilities (MCP servers)

All four shipped servers are `builtin` (FastMCP instances running inside the backend process). Public servers would be added as `http` or `stdio` entries.

| Server | Status | Tools the LLM can call | Storage |
|--------|--------|------------------------|---------|
| `calculator` | On | `calculate` | none |
| `memory` | On | `remember`, `recall`, `forget` | local SQLite (`fraise.db`) |
| `rag` | On | `ask`, `summarize`, `list_documents` | local SQLite + `sqlite-vec` |
| `calendar` | Off by default | `list_events`, `find_free_slot`, `create_event`, `move_event` | local token + Google Calendar |

Toggle a server with the `"disabled": true` flag in [backend/mcp_servers.json](backend/mcp_servers.json). Calendar ships disabled.

---

## Memory

Tell Fraise something ("remember I prefer afternoon meetings"), ask about it later ("what do you know about my meeting preferences?"), or tell it to forget. Three things make this safe and useful:

- **It is fully local.** Everything lives in one SQLite file on the backend, [backend/app/data/fraise.db](backend/app/data/fraise.db). Nothing leaves your machine and nothing is used for training. Search uses SQLite's built-in full-text engine, FTS5.
- **It is per person.** On first visit your browser generates a stable session id and keeps it. That id rides on the WebSocket connection (`?sid=`), so your memories are yours and a different browser sees a separate set. (No login yet: same browser means same person, and reloading keeps your memory.)
- **The model never sees the id.** The LLM only knows three actions: `remember`, `recall`, `forget`. The host injects your session id onto each call after the model has chosen it (see `_INJECTED_PARAMS` in [backend/app/host/mcp_manager.py](backend/app/host/mcp_manager.py#L29)). The model cannot read, spoof, or invent it.

Adding memory cost exactly what the roadmap promises: one new server plus one line in `mcp_servers.json`. The voice pipeline did not change.

---

## Documents (RAG)

Upload a `.txt`, `.md`, or `.pdf`, then ask about it out loud ("what does the handbook say about reimbursements?"). Fraise finds the passages that actually answer the question and speaks a grounded reply. Files enter through the **Add a document** box in the sidebar or a plain `POST /upload`; they never travel over the voice channel.

Retrieval runs in three stages:

1. **Late chunking.** Most pipelines split a document into chunks first, then embed each chunk alone, so a chunk that says "it renews every January" has already lost what "it" was. Fraise embeds the whole document in one pass, then splits it into chunks, so each chunk's vector still carries its surrounding context. This needs a long-context encoder that exposes per-token output: `jina-embeddings-v2-small-en`, run through ONNX Runtime, loaded once at startup, no PyTorch.
2. **Two searches, fused.** A dense vector search (catches paraphrases) runs alongside a BM25 keyword search (catches exact names, codes, and IDs). The two ranked lists are merged with Reciprocal Rank Fusion, which rewards chunks both searches agreed on. Vectors live in SQLite via `sqlite-vec`; BM25 is SQLite's own FTS5; both share the same `fraise.db`.
3. **A cross-encoder reranks.** The top candidates go through a cross-encoder (fastembed) that reads the question and each passage together and scores how well they match. The best few survive.

Two more points:

- **No second model writes the answer.** Fraise hands the winning passages back to the voice LLM already in the conversation, and that model speaks the reply. Everything except the voice transit runs on your machine.
- **Same privacy model as memory.** Documents are stored locally in `fraise.db`, scoped to your browser's session id, and the LLM only ever sees `ask`, `summarize`, and `list_documents`. The encoder and reranker download once on first use, then stay cached.

---

## Calendar

A private MCP server over your own Google Calendar. It ships **disabled** (`"disabled": true` in `mcp_servers.json`), because it needs your own Google OAuth credentials. Once enabled:

- **Tools:** `list_events`, `find_free_slot`, `create_event`, `move_event`.
- **Speakable output.** Tools return plain English. No ISO timestamps or raw event IDs ever reach the LLM.
- **Confirmation on destructive actions.** `move_event` returns a spoken confirmation prompt on the first call and only executes when called again with `confirmed=True`.
- **Local tokens.** OAuth runs at `/auth/calendar`; the token is cached in `backend/calendar_token.json` and refreshed automatically. Event data and tokens stay on the backend.

Setup steps are in [Running locally → Google Calendar](#google-calendar-optional).

---

## API reference

Base URL in development is `http://localhost:8000`.

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| `GET` | `/health` | Liveness probe | none | `{"ok": true}` |
| `WS` | `/ws` | Voice session (mic in, audio out) | query `?sid=<session id>` (optional; generated if absent), then linear16 PCM audio frames | streamed linear16 PCM audio + JSON event frames |
| `POST` | `/upload` | Add a document to the RAG store | query `?sid=<session id>` (required) + multipart `file` (`.txt` / `.md` / `.pdf`) | JSON document record, or `400` if the file has no readable text |
| `GET` | `/auth/calendar` | Start Google Calendar OAuth | none | redirect to Google consent |
| `GET` | `/auth/calendar/callback` | OAuth redirect target | Google `code` query param | stores `calendar_token.json`, then redirects back |
| `*` | `/mcp/` | The built-in FastMCP server over streamable HTTP, for external MCP clients | MCP streamable-HTTP | MCP streamable-HTTP |
| `GET` | `/` | Serves the built frontend (production build only) | none | the React app |

Notes:

- `/ws` and `/upload` both take `?sid=`. Pass the same id to both so an uploaded document is searchable in the same voice session.
- `/mcp/` exposes Fraise's own tools to any MCP client, so Fraise is both an MCP host and an MCP server.

---

## Configuration

Create a `.env` at the repo root. Only `DEEPGRAM_API_KEY` is required.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `DEEPGRAM_API_KEY` | Yes | none | Auth for Deepgram Voice Agent (STT + LLM routing + TTS) |
| `DEEPGRAM_AGENT_URL` | No | `wss://agent.deepgram.com/v1/agent/converse` | Voice Agent WebSocket endpoint |
| `DEEPGRAM_LISTEN_MODEL` | No | `flux-general-en` | STT model. Flux does real end-of-turn detection, so a mid-sentence pause does not split your turn |
| `DEEPGRAM_EOT_THRESHOLD` | No | `0.7` | End-of-turn confidence (range 0.5 to 0.9). Higher waits longer before deciding you finished |
| `DEEPGRAM_EOT_TIMEOUT_MS` | No | `5000` | Hard cap on silence before the turn ends |
| `DEEPGRAM_THINK_TYPE` | No | `open_ai` | LLM provider Deepgram routes tool calls through |
| `DEEPGRAM_THINK_MODEL` | No | `gpt-4o-mini` | LLM that selects tools and writes replies |
| `DEEPGRAM_VOICE` | No | `aura-2-thalia-en` | TTS voice |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Comma-separated allowed origins (set your deploy URL in production) |
| `GOOGLE_CLIENT_ID` | Calendar only | none | Google OAuth client id (or use `google_credentials.json`) |
| `GOOGLE_CLIENT_SECRET` | Calendar only | none | Google OAuth client secret |

---

## Project layout

```
frontend/
  src/
    App.tsx              voice UI
    Orb.tsx              ElevenLabs WebGL orb (lazy-loaded)
    useVoiceAgent.ts     mic + playback + WebSocket hook
  public/
    pcm-worklet.js       AudioWorklet: Float32 -> Int16 PCM @ 16 kHz

backend/
  app/
    main.py              FastAPI app: /ws, /health, /upload, /mcp, serves frontend
    host/
      voice_agent.py     Deepgram bridge + MCP tool-call handler
      mcp_manager.py     connects to MCP servers, aggregates + routes tools
    servers/
      calculator.py      built-in FastMCP calculator (@mcp.tool)
      calendar.py        Google Calendar MCP (list / free slots / create / move)
      calendar_auth.py   Google OAuth flow (/auth/calendar)
      memory/            Memory MCP: remember / recall / forget
        server.py        the @mcp.tool functions (speak plain English)
        store.py         session-scoped SQL the tools call
      rag/               Documents MCP: ask / summarize / list_documents
        server.py        the @mcp.tool functions (speak plain English)
        store.py         late chunking + hybrid search + rerank
        embeddings.py    ONNX long-context encoder (per-token, for late chunking)
        reranker.py      cross-encoder reranker (fastembed)
        extract.py       pull text out of txt / md / pdf
        chunk.py         chunk-boundary helper
    storage/
      db.py              SQLite connection + schema migrations (shared)
    data/                local databases live here (gitignored)
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

Create a `.env` at the repo root with at least:

```
DEEPGRAM_API_KEY=your_key_here
```

Start the server:

```bash
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at <http://localhost:5173>. Start the backend first: the orb shows **Offline** until the WebSocket connects. Click the orb to start talking.

**Production build** (the backend serves the UI):

```bash
cd frontend && npm run build
# then visit http://localhost:8000
```

### Google Calendar (optional)

The Calendar MCP works against your personal Google Calendar. To enable it:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), enable the **Google Calendar API** and create an **OAuth 2.0 Client ID** (type: Web application).
2. Add the redirect URI `http://localhost:8000/auth/calendar/callback`.
3. Download the JSON and save it as `backend/google_credentials.json`, or set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
4. Set `"disabled": false` on the `calendar` entry in [backend/mcp_servers.json](backend/mcp_servers.json).

The first time you ask about your calendar, Fraise surfaces a **Connect Calendar** banner. Click it, pick your account, and Fraise auto-retries the request. The token is cached in `backend/calendar_token.json` and refreshed automatically.

---

## Adding a capability

**Private server (in this repo):**

1. Write `backend/app/servers/<name>.py` with `@mcp.tool` functions and pydantic types.
2. Add it to [backend/mcp_servers.json](backend/mcp_servers.json) as `"type": "builtin"`.
3. Restart. The tools are voice-callable on next start. The speakable-output layer picks them up automatically.

**External server (public MCP):**

1. Add one `http` or `stdio` entry to `mcp_servers.json` (URL or command, plus any credentials as env vars).
2. Restart.

The voice transport never changes. That is the point.

---

## Tech stack

**Frontend:** React 19, TypeScript, Vite 6, Three.js (the orb), Web Audio API.

**Backend:** FastAPI, FastMCP, pydantic, Python 3.11+.

**Voice:** Deepgram Voice Agent (Flux STT, OpenAI `gpt-4o-mini` think, Aura TTS).

**Retrieval and storage:** SQLite (FTS5), `sqlite-vec`, ONNX Runtime (`jina-embeddings-v2-small-en`), fastembed cross-encoder reranker.

See [ROADMAP.md](ROADMAP.md) for the full phase plan.
```