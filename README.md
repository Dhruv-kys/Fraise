<p align="center">
  <img src="assets/fraise.png" alt="Fraise" width="200" />
</p>

<h1 align="center">Fraise</h1>

<p align="center">Voice for anything that speaks <em>MCP</em>.</p>

<p align="center">
  <a href="https://fraise.vercel.app">Live demo</a>
  &nbsp;·&nbsp;
  <a href="ROADMAP.md">Roadmap</a>
  &nbsp;·&nbsp;
  <a href="https://modelcontextprotocol.io">MCP</a>
</p>

---

Fraise is a voice-first MCP host. You speak, an LLM picks the right tool, Fraise runs it on whichever [MCP](https://modelcontextprotocol.io) server owns it, and the answer is spoken back.

Every capability is an MCP server: a calculator, your memory, your documents, your calendar, a Slack workspace. They all share one shape, so adding a new skill is a single entry in a config file. The voice layer never changes.

## Highlights

- **Pluggable by design.** Tools are discovered from `mcp_servers.json` at startup and routed automatically. Nothing is hardcoded — a new skill is a config entry, not host code.
- **Private by default.** Memory and documents live in a local SQLite database, scoped to your browser session. Nothing leaves the machine. Voice and reasoning transit Deepgram/OpenAI under no-retention API policies until a fully-local mode lands.
- **Local document search.** Retrieval-augmented answers run entirely on-device, with no second model required to write the reply.
- **Safe actions.** Destructive operations, such as moving a calendar event, ask for spoken confirmation before they run.

## Capabilities

| Capability | Status | Description |
|------------|--------|-------------|
| Memory | Live | Remembers what you tell it. Local and scoped to your browser. |
| Documents | Live | Upload a PDF, Markdown, or text file and ask about it. |
| Calendar | Opt-in | Reads and moves Google Calendar events once you connect an account. |
| Calculator | Live | Reliable arithmetic, computed by a tool rather than the model. |
| Public MCP servers (Slack, GitHub, Zapier, …) | Planned | No new host code needed — `http`/`stdio` transport already works, connecting one is a config entry. See [roadmap](ROADMAP.md). |

## Architecture

- The browser captures microphone audio and streams it over a WebSocket to [Deepgram Voice Agent](https://developers.deepgram.com/docs/voice-agent), which handles speech-to-text, the language model, and text-to-speech in one connection.
- When the model selects a tool, the `MCPManager` routes the call to the server that owns it and returns the result to the conversation.
- That router is the core of the project. It reads the server list on startup, aggregates every tool, and resolves name collisions with a server prefix.

## Document search

Document questions are answered by retrieval, in four on-device stages:

- **Late chunking.** The full document is embedded first and split afterward, so each chunk keeps its surrounding context instead of losing it.
- **Local embeddings.** `jina-embeddings-v2-small-en` runs through ONNX Runtime. No PyTorch, no external calls.
- **Hybrid search.** A semantic vector search (`sqlite-vec`) and a keyword search (SQLite FTS5) run together and are fused, so passages both agree on rank highest.
- **Reranking.** A cross-encoder scores the question against each top candidate and keeps only the best few.

The winning passages are handed to the voice model already in the conversation, which speaks the answer directly.

## API

The backend is a single FastAPI process. Base URL in development is `http://localhost:8000`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check. Returns `{"ok": true}`. |
| `WS` | `/ws?sid=<id>` | Voice session. Microphone PCM in; audio and JSON events out. |
| `POST` | `/upload?sid=<id>` | Add a document (`.txt`, `.md`, `.pdf`). Returns `400` if no readable text. |
| `GET` | `/auth/calendar` | Begins Google Calendar OAuth. |
| `GET` | `/auth/calendar/callback` | OAuth redirect target. Stores the token locally. |
| `*` | `/mcp/` | Fraise's own tools, exposed as an MCP server over streamable HTTP. |
| `GET` | `/` | Serves the built frontend in production. |

Pass the same `sid` to `/ws` and `/upload` so an uploaded document is searchable within the same voice session.

## Tech stack

**Frontend**
- React 19, TypeScript, Vite 6
- Three.js for the state-reactive orb
- Web Audio AudioWorklet streaming 16 kHz PCM over WebSocket

**Backend**
- FastAPI for the WebSocket, upload, health, and OAuth endpoints
- FastMCP for built-in tools, with `MCPManager` connecting and routing every server in `mcp_servers.json`
- Deepgram Voice Agent: Flux (`flux-general-en`) STT, `gpt-4o-mini`, Aura (`aura-2-thalia-en`) TTS

**Storage and search**
- SQLite (`fraise.db`) for both memory and documents
- SQLite FTS5 for keyword search, `sqlite-vec` for vectors
- ONNX Runtime (`jina-embeddings-v2-small-en`) embeddings with a fastembed reranker

## Getting started

Add `DEEPGRAM_API_KEY` to a `.env` file at the repository root, then:

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
# Frontend (in a second terminal)
cd frontend
npm install && npm run dev
```

Open <http://localhost:5173>. Start the backend first, then click the orb and begin talking.

## Roadmap

Live: MCP host core, calendar, memory, and document search. Next up — see [ROADMAP.md](ROADMAP.md) for detail:

- **Router at scale** — hierarchical tool routing so the LLM isn't handed every tool from every server on every turn.
- **Protocol depth** — adopt MCP elicitation and progress notifications instead of hand-rolled equivalents.
- **Public ecosystem** — Slack, GitHub, Zapier, and a template so third parties can write Fraise-compatible servers.
- **Server composition & trust** — sandboxing, hot-reload, and an inspector view for a growing, partly third-party server list.
