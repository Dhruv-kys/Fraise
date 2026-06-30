# Fraise 🍓

<p align="center">
  <img src="assets/fraise.png" alt="Fraise" width="240" />
  <br />
  <strong><em>talk to me</em></strong>
  <br /><br />
  <a href="https://fraise-mcp.netlify.app"><strong>🔊 Try it live → fraise-mcp.netlify.app</strong></a>
</p>

**Voice for anything that speaks _MCP_.**

Fraise is a voice assistant you actually talk to. Ask it something out loud, it picks the right tool, runs it, and talks back.

The trick:

- Every skill is just an [MCP](https://modelcontextprotocol.io) server. A calculator, your memory, your documents, your calendar, a Slack workspace, all the same kind of plug.
- Adding a skill means adding one line to a config file.
- The voice part never changes.

## What you can say

> *"Remember I hate morning meetings."*
> *"What does the handbook say about reimbursements?"*
> *"What's forty-two times nineteen?"*

Three things are wired up today:

- **Memory** keeps what you tell it. It's stored locally and tied to your browser, so it's yours and nobody else's.
- **Documents** lets you upload a PDF, Markdown, or text file and ask about it. Fraise reads it on your machine and answers from the actual text instead of guessing.
- **Calendar** can read and move events on your Google Calendar. It's off until you connect your own account, and it always asks before changing anything.

## How it works

- You speak into the browser. The audio streams over a WebSocket to [Deepgram's Voice Agent](https://developers.deepgram.com/docs/voice-agent), which does speech-to-text, the language model, and text-to-speech in one place.
- When the model picks a tool, Fraise routes the call to whichever MCP server owns it and feeds the result back.
- That routing layer is the whole project. It reads the server list on startup, collects every tool, and hardcodes none of them.

## How document search (RAG) works

When you ask about a file, Fraise has to find the few lines that actually answer you. It does that in four steps, all on your machine:

- **Late chunking.** Most tools cut a file into pieces and embed each piece alone, so a line like *"it renews every January"* forgets what *"it"* was. Fraise reads the whole document first, then splits it, so every piece keeps its context.
- **Local embeddings.** That whole-document read uses `jina-embeddings-v2-small-en` running through ONNX Runtime on your machine. No PyTorch, no cloud, loaded once when the server starts.
- **Two searches, blended.** A meaning-based search (catches paraphrases) runs next to a keyword search (catches exact names, codes, IDs). Their results are merged so passages both searches liked rise to the top. Vectors live in SQLite via `sqlite-vec`; keyword search is SQLite's FTS5.
- **A final ranking pass.** A reranker reads your question and each top passage *together* and scores how well they match, keeping only the best few.

Those winning passages go straight to the voice model already in the conversation, which speaks the answer. No second model is spun up to write it.

## API

The backend is one FastAPI process. Endpoints (dev base `http://localhost:8000`):

| Method | Path | What it does |
|--------|------|--------------|
| `GET` | `/health` | Liveness check. Returns `{"ok": true}`. Use it for uptime probes and load balancers. |
| `WS` | `/ws?sid=<id>` | The voice session. Browser streams microphone PCM in; Fraise streams audio and JSON events back. `sid` ties the session to your memory and documents (generated if you omit it). |
| `POST` | `/upload?sid=<id>` | Add a document to the RAG store. Send a multipart `file` (`.txt` / `.md` / `.pdf`). Returns `400` if the file has no readable text. |
| `GET` | `/auth/calendar` | Starts Google Calendar OAuth. |
| `GET` | `/auth/calendar/callback` | Where Google redirects back; stores the token locally. |
| `*` | `/mcp/` | Fraise's own tools exposed as an MCP server over streamable HTTP, so other MCP clients can use them too. |
| `GET` | `/` | Serves the built frontend in production. |

Pass the same `sid` to `/ws` and `/upload` so a document you upload is searchable in the same voice session.

## Components

**Frontend**
- React 19 + TypeScript + Vite 6 for the app.
- Three.js for the orb that reacts to state (idle, listening, thinking, speaking).
- Web Audio API with an AudioWorklet that captures the mic and converts it to 16 kHz PCM, sent over the WebSocket.

**Backend**
- FastAPI hosts the WebSocket, the upload and health endpoints, and the calendar OAuth flow.
- FastMCP defines the built-in tools; an `MCPManager` connects to every server in `mcp_servers.json` and routes each call to its owner.
- Deepgram Voice Agent runs the voice loop: Flux (`flux-general-en`) for speech-to-text, `gpt-4o-mini` for the language model, and Aura (`aura-2-thalia-en`) for the spoken reply.

**Storage and search**
- SQLite is the single local database (`fraise.db`) for both memory and documents.
- Full-text search uses SQLite's FTS5; vector search uses `sqlite-vec`.
- Document embeddings run locally through ONNX Runtime (`jina-embeddings-v2-small-en`), with a fastembed cross-encoder for the final ranking.

## Run it

Put `DEEPGRAM_API_KEY` in a `.env` at the repo root, then:

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend, in another terminal
cd frontend
npm install && npm run dev
```

Open <http://localhost:5173>. Start the backend first, then click the orb and talk.

See [ROADMAP.md](ROADMAP.md) for where it's going.
