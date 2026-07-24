# Fraise 🍓

A voice-first AI assistant you talk to out loud. Say what you need — a calendar event, a question, a whole day's worth of tasks, a document to search — and it does it.

**Live:** [fraise.vercel.app](https://fraise.vercel.app)

## Features

- Real-time voice over a single WebSocket (Deepgram Voice Agent: STT + LLM + TTS in one stream).
- Skills are MCP servers — calculator, calendar, memory, weather, web research, on-device document Q&A.
- Dictate your whole day and it gets split into tasks, fanned out to parallel agents, and handled.
- Dictation mode — speak long messages or essays instead of typing. Transcribed fully on-device (faster-whisper + Silero VAD); nothing leaves your machine. Set `STT_MODEL` (default `large-v3-turbo`) to trade accuracy for speed.
- Multi-agent research: ask a question, a team of agents searches different sources in parallel and writes up a doc or deck.
- On-device document Q&A — upload a PDF/txt/md and ask about it; nothing leaves your machine.
- Persistent memory across a session, and spoken confirmation before anything destructive.

## How document search works

Upload triggers **late chunking**: the whole document is embedded first, then split, so each chunk's vector keeps the context of the passage around it. A question runs dense (vector) and keyword (BM25) search in parallel, fuses the results, and a cross-encoder reranks the top candidates before they reach the voice model. All local — no PyTorch, no embedding API.

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, React Three Fiber (the orb).
- **Backend:** Python, FastAPI, WebSockets, the MCP Python SDK.
- **Voice:** Deepgram Voice Agent.
- **Retrieval:** ONNX Runtime + local embeddings, sqlite-vec, SQLite FTS5, a cross-encoder reranker — no PyTorch, no embedding API.
- **Storage:** SQLite.

## Getting started

Prerequisites: Python 3.11+, Node 18+, a Deepgram API key.

```bash
# .env at the repo root: DEEPGRAM_API_KEY, GROQ_API_KEY, TAVILY_API_KEY

cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.main          # http://localhost:8000

cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Open the frontend, allow microphone access, and start talking.

## Project layout

```
backend/
  app/
    main.py            # FastAPI app: WebSocket, upload, dictate, research routes
    host/               # voice session + MCP tool router
    servers/            # one folder/file per MCP skill
  mcp_servers.json      # one entry per skill; edit this to add tools
frontend/
  src/
    useVoiceAgent.ts    # WebSocket + audio streaming hook
    Hero.tsx            # landing page
    App.tsx             # workspace
```

## Adding a skill

Write an MCP server (see `backend/app/servers/calculator.py`), add one entry to `mcp_servers.json`, restart. No changes to the agent itself.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness check. |
| `WS` | `/ws?sid=<id>` | Voice session. |
| `WS` | `/ws/dictation?sid=<id>` | Dictation mode — stream PCM16 in, transcript segments out (local STT). |
| `POST` | `/upload?sid=<id>` | Add a document. |
| `POST` | `/dictate?sid=<id>` | Segment a day's dictation into tasks. |
| `GET` | `/agents/stream?sid=<id>` | SSE progress for research/dictate runs. |
| `GET` | `/auth/calendar` | Google Calendar OAuth. |

See [ROADMAP.md](ROADMAP.md) for what's next.
