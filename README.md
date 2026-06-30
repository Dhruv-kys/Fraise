<p align="center">
  <img src="assets/fraise.png" alt="Fraise" width="240" />
</p>

<h1 align="center">Fraise 🍓</h1>

<p align="center"><strong>🎙️ Voice for anything that speaks <em>MCP</em>.</strong></p>

<p align="center">
  <a href="https://fraise-mcp.netlify.app"><strong>🔊 Try it live → fraise-mcp.netlify.app</strong></a>
</p>

> **You speak → Fraise picks a tool → runs it → speaks back.**

---

## ⚡ The idea

- **Every skill is a plug.** Calculator, memory, documents, calendar, Slack. All [MCP](https://modelcontextprotocol.io) servers, all the same shape.
- **New skill = one line in a config file.** No rewrite.
- **The voice layer never changes.** Ever.

---

## 🗣️ Try saying

> *"Remember I hate morning meetings."*
> *"What does the handbook say about reimbursements?"*
> *"What's forty-two times nineteen?"*

Three skills are live today:

- 🧠 **Memory** — remembers what you tell it. Local, tied to your browser, yours alone.
- 📄 **Documents** — upload a PDF, Markdown, or text file and ask. Read on your machine, answered from the real text.
- 📅 **Calendar** — reads and moves Google Calendar events. Off until you connect it, and it asks before it changes anything.

---

## 🔧 How it works

- 🎤 You talk. Audio streams over a WebSocket to [Deepgram Voice Agent](https://developers.deepgram.com/docs/voice-agent) (speech-to-text, the LLM, and text-to-speech in one place).
- 🧭 The model picks a tool. **Fraise routes the call to whichever MCP server owns it** and feeds the result back.
- 🪄 That router *is* the project. It reads the server list on startup, grabs every tool, hardcodes none.

---

## 🔍 Document search (RAG)

Find the few lines that actually answer you. Four steps, all on your machine:

- **Late chunking** → reads the whole doc *first*, then splits it, so a line like *"it renews every January"* never forgets what *"it"* was.
- **Local embeddings** → `jina-embeddings-v2-small-en` via ONNX Runtime. No PyTorch, no cloud.
- **Two searches, blended** → meaning-based (`sqlite-vec`) + keyword (FTS5), merged so passages both liked rise up.
- **Final rerank** → scores your question against each top passage, keeps only the best few.

🎯 The winners go straight to the voice model, which speaks the answer. **No second model.**

---

## 🌐 API

One FastAPI process. Dev base: `http://localhost:8000`.

| Method | Path | What it does |
|--------|------|--------------|
| `GET` | `/health` | Liveness check → `{"ok": true}` |
| `WS` | `/ws?sid=<id>` | Voice session. Mic PCM in, audio + JSON events out. |
| `POST` | `/upload?sid=<id>` | Add a doc (`.txt` / `.md` / `.pdf`). `400` if no readable text. |
| `GET` | `/auth/calendar` | Start Google Calendar OAuth. |
| `GET` | `/auth/calendar/callback` | OAuth redirect target. Stores the token locally. |
| `*` | `/mcp/` | Fraise's tools as an MCP server (streamable HTTP). |
| `GET` | `/` | Serves the built frontend. |

💡 Same `sid` on `/ws` and `/upload` = your upload is searchable in that session.

---

## 🧱 Components

**Frontend**
- ⚛️ React 19 + TypeScript + Vite 6
- 🔮 Three.js orb that reacts to state (idle / listening / thinking / speaking)
- 🎚️ Web Audio AudioWorklet → 16 kHz PCM over WebSocket

**Backend**
- 🚀 FastAPI — WebSocket, upload, health, calendar OAuth
- 🔌 FastMCP + an `MCPManager` that connects every server in `mcp_servers.json` and routes each call
- 🗣️ Deepgram Voice Agent — Flux (`flux-general-en`) STT, `gpt-4o-mini`, Aura (`aura-2-thalia-en`) TTS

**Storage & search**
- 🗄️ SQLite (`fraise.db`) for memory *and* documents
- 🔎 FTS5 keyword search + `sqlite-vec` vector search
- 🧮 ONNX `jina-embeddings-v2-small-en` embeddings + fastembed reranker

---

## ▶️ Run it

Drop `DEEPGRAM_API_KEY` in a `.env` at the repo root, then:

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend (another terminal)
cd frontend
npm install && npm run dev
```

👉 Open <http://localhost:5173>, start the backend first, click the orb, and talk.

---

<p align="center"><sub>Where it's headed → <a href="ROADMAP.md">ROADMAP.md</a></sub></p>
