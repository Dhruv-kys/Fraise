# Fraise — Roadmap

> Voice for anything that speaks _MCP_ — over your data, which never leaves your machine.

You talk. Fraise routes your intent to the right MCP server, has a back-and-forth if it needs more, and speaks the result back. Adding a capability means adding a server to a config file.

**Status:** ✅ done · 🚧 in progress · ⏳ planned

---

## Architecture

Two layers, and capability lives in only one:

1. **The voice host** — the transport. Mic → STT → LLM → TTS, the orb, and how MCP concepts are rendered as speech. Generic: it never knows what a calendar *is*.
2. **MCP servers** — every capability. Private servers we write; public servers plug in via config.

The voice host only learns to speak MCP better — it never implements a specific task. That belongs in a server.

---

## Phase 0 — Scaffold ✅

- [x] Deepgram Voice Agent loop (STT → LLM → TTS, one WebSocket)
- [x] ElevenLabs WebGL orb mapped to agent state (idle / listening / thinking / speaking)
- [x] `calculate` tool via FastMCP (`@mcp.tool`, pydantic I/O)
- [x] MCP server mounted at `/mcp` for external clients
- [x] LLM-driven tool calling via Deepgram function calling
- [x] AudioWorklet mic pipeline → gapless TTS playback

## Phase 1 — MCP host core ✅ (one item left)

Connect any number of MCP servers from a config file. Route every call to the right one.

- [x] `mcp_servers.json` — servers by name, type (`builtin` / `stdio` / `http`), URL/command, env-var credentials
- [x] `MCPManager` — connects on startup, aggregates tools, routes calls, degrades if one is down
- [x] Tool namespacing — collisions get a server prefix (`slack_search` vs `jira_search`)
- [x] Voice agent reads from `MCPManager`, not the hardcoded calculator
- [ ] 🚧 **Multi-tool chaining** — keep calling tools until the task is done, with a step cap. Needed for any multi-step task ("move my 2pm" = list → find slot → move).

---

## Phase 2 — Calendar ⏳

A private MCP server over your own calendar. Data and tokens stay on the backend.

- [ ] **Calendar MCP** (`builtin`) — wraps Google Calendar / CalDAV. Tools: `list_events`, `find_free_slot`, `move_event`, `create_event`.
- [ ] **Speakable output** (host) — strip IDs and ISO timestamps; summarize lists; speak dates and numbers naturally.
- [ ] **Elicitation → voice** (host) — implement MCP's elicitation spec as a spoken exchange. A tool asks for missing input, Fraise speaks the question, you answer, the tool resumes.
- [ ] **Destructive-action confirmation** (host) — read the MCP `destructiveHint` annotation aloud before running.

---

## Phase 3 — Memory & files ⏳

- [ ] **Memory MCP** (server) — local SQLite for preferences and things you ask it to remember. Feeds the calendar: "remember I prefer afternoon meetings" biases `find_free_slot`.
- [ ] **File + RAG MCP** (server) — files local, embedded with sqlite-vec. Tools: `upload`, `summarize`, `ask`. Voice Q&A over your own documents.
- [ ] **Progress narration** (host) — long-running calls speak MCP progress events.

---

## Phase 4 — Polish ⏳

- [ ] **"What can you do?"** (host) — Fraise speaks available tools grouped by server.
- [ ] **Barge-in / interruptibility** (host) — talk over Fraise to redirect mid-sentence.
- [ ] **Greet once per session** (host) — skip greeting on reconnect/reload.
- [ ] **Dark / light toggle** — the orb already adapts to a `dark` class; wire the switch.
- [ ] **Deploy** — backend + built frontend at a live URL.

---

## Public MCP servers

Public servers (Slack, GitHub, Jira, Notion, …) are supported with no new code — the host already speaks `http` and `stdio`, so connecting one is a single entry in `mcp_servers.json`. We add them as the need arises rather than up front.

---

## Adding a capability

**Private server:**
1. Write `backend/app/mcp_<name>.py` — `@mcp.tool` functions with pydantic types.
2. Add it to `mcp_servers.json` as `"type": "builtin"`.
3. Voice-callable on next start. The speakable-output layer picks it up automatically.

**External server:** add one `http` / `stdio` entry to `mcp_servers.json`. Restart.

The voice transport never changes. That is the point.
