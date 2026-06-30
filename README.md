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
                 ├─ Documents MCP(private — local RAG over your files)
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

## Memory

Fraise can remember things you tell it. Say *"remember I prefer afternoon
meetings"* and it saves that. Later, ask *"what do you know about my meeting
preferences?"* and it reads it back. You can also tell it to forget something.

Three things make this work:

- **It's local.** Everything lives in one SQLite file on the backend
  (`backend/app/data/fraise.db`). Nothing is sent anywhere or used for training.
  Search uses SQLite's built-in full-text engine (FTS5).
- **It's per person.** The first time you open Fraise, your browser quietly
  creates an id and keeps it. That id rides along on the connection, so your
  memories are yours — a different browser sees a completely separate set.
  (No login yet; same browser = same you. Reloading the page keeps your memory.)
- **The AI never sees the id.** The model only knows three actions —
  `remember`, `recall`, `forget`. Fraise stamps your id onto each call behind the
  scenes, so the AI can't mix up one person with another or make an id up.

Adding memory took exactly what the roadmap promises: one new server and one
line in `mcp_servers.json`. The voice pipeline didn't change at all.

---

## Documents

Drop in a text file, Markdown doc, or PDF, then ask about it out loud. *"What
does the handbook say about reimbursements?"* Fraise finds the passages that
actually answer the question and reads back a grounded answer. Files go in
through the **Add a document** box in the sidebar (or a plain `POST /upload`);
they never travel over the voice channel.

Finding the right passage is three steps:

- **Late chunking.** Most systems split a document into chunks first, then turn
  each chunk into a vector on its own — so a chunk that says *"it renews every
  January"* has already forgotten what *"it"* was. Fraise embeds the whole
  document in one pass and splits it into chunks afterward, so each chunk's
  vector still carries the context around it. That needs a long-context model
  that exposes per-token output, so the encoder is `jina-embeddings-v2-small-en`
  run through ONNX Runtime: local, no PyTorch, loaded once when the server
  starts.
- **Two searches, merged.** A meaning-based vector search (catches paraphrases)
  runs next to a keyword BM25 search (catches the exact stuff — names, codes,
  IDs). Their two ranked lists are combined with Reciprocal Rank Fusion, which
  rewards the chunks both searches agreed on. The vectors live in SQLite via
  `sqlite-vec`; BM25 is SQLite's own FTS5. Same `fraise.db` as memory.
- **A reranker breaks the tie.** The first two steps are fast but rough. The
  best ~30 candidates go through a cross-encoder that reads the question and
  each passage *together* and scores how well they actually match. The top few
  survive.

Fraise never runs a second model to write the answer. It hands the winning
passages back to the voice model already in the conversation, and that model
speaks the reply. Everything except the voice runs on your machine. The encoder
and reranker download once on first use and are cached after that.

Privacy is the same as memory: documents are stored locally in `fraise.db`,
scoped to your browser's id, and the AI only ever sees three actions — `ask`,
`summarize`, and `list_documents`. And like everything here, it was one new
server plus one line in `mcp_servers.json`.

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
      memory/            Memory MCP — remember / recall / forget
        server.py        the @mcp.tool functions (speak plain English)
        store.py         session-scoped SQL (what the tools call)
      rag/               Documents MCP — ask / summarize / list_documents
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
| `/upload` | add a document to the RAG store (`?sid=` + a file) |
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
SQLite (FTS5) · sqlite-vec · ONNX Runtime (jina-embeddings-v2-small-en) · fastembed reranker
