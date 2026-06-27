# Fraise — Roadmap

> Voice for anything that speaks _MCP_.

You talk. Fraise routes your intent to the right MCP server and speaks the result back.
Adding a capability = adding a server to a config file. Nothing else changes.

**Status key:** ✅ done · 🚧 in progress · ⏳ planned

---

## What makes it hard to copy

| Moat | Why it matters |
|------|---------------|
| **Private data flywheel** | Memory + RAG MCPs learn you over time. A new competitor starts from zero. |
| **Voice-native output** | Genuinely speakable responses — not JSON read aloud. |
| **Elicitation as dialogue** | Servers ask you questions mid-call, by voice. No text client does this. |
| **Ambient use cases** | Hands-free, no context switch. Text clients require you to stop and type. |
| **Developer platform** | Build an MCP server → get a voice interface for free. |

---

## Phase 0 — Working scaffold ✅

- [x] Deepgram Voice Agent loop (STT → LLM → TTS, one WebSocket)
- [x] ElevenLabs WebGL orb mapped to agent state (idle / listening / thinking / speaking)
- [x] `calculate` tool via FastMCP (`@mcp.tool`, pydantic I/O)
- [x] MCP server mounted at `/mcp` for external clients
- [x] LLM-driven tool calling via Deepgram function calling
- [x] AudioWorklet mic pipeline → gapless TTS playback

---

## Phase 1 — MCP Host core 🚧

Turn Fraise from a single-server app into a real MCP host.
Connect any number of servers from a config file. Route every call to the right one.

- [ ] `mcp_servers.json` — list servers by name, type (`builtin` / `stdio` / `http`), URL or command, credentials via env vars
- [ ] `MCPManager` — connects all servers on startup, aggregates tools, routes calls, degrades gracefully if one is down
- [ ] Tool namespacing — collisions get server prefix (`slack_search` vs `jira_search`)
- [ ] Voice agent reads from `MCPManager` instead of the hardcoded calculator
- [ ] Multi-tool chaining — keep calling tools until the task is done, with a step cap

> **This is the unlock.** Every phase after it is just adding an entry to the config.

---

## Phase 2 — Public MCP servers ⏳

Their data lives on their servers. Use their MCPs. Each is one line in `mcp_servers.json`.

| Server | What you can say |
|--------|-----------------|
| **Slack** | "Message #general" · "What did the team say in #design today?" |
| **Jira** | "Open a bug ticket" · "What's in my sprint?" |
| **GitHub** | "Create an issue" · "What PRs need my review?" |
| **Linear** | "Add a task" · "What's in my queue?" |
| **Notion** | "Add a note to my ideas page" |
| **Browserbase** | "Search the web for X" |

---

## Phase 3 — Private MCP servers ⏳

For private data, we build our own servers. Data stays local. Nothing phones home.

- [ ] **Calendar MCP** — wraps Google Calendar API (or CalDAV). Tools: `list_events`, `create_event`, `find_free_slot`. We call their API; we own the layer.
- [ ] **Google Meet MCP** — `create_meeting()` returns a Meet link. Builds on Calendar auth.
- [ ] **Memory MCP** — local SQLite. Stores conversations, preferences, things you've asked Fraise to remember. Powers "remember I prefer morning meetings."
- [ ] **File + RAG MCP** — files stored locally, embedded with sqlite-vec. Tools: `upload`, `summarize`, `ask`. Zero cloud storage.
- [ ] **Meetings MCP** — Fraise session transcripts, indexed and searchable by voice.

> The longer you use Fraise, the smarter these get about you. A competitor starts from zero.

---

## Phase 4 — Voice-native output ⏳

MCP tools return JSON. Text clients render tables. Voice has to *speak* it well.

- [ ] **Speakable output layer** — summarize lists, drop IDs and raw fields, speak dates and numbers naturally. "You have 3 meetings tomorrow. First is with design at 10am." Not `meeting_id: abc123, start_time: 2024-01-15T10:00:00Z`.
- [ ] **Elicitation as dialogue** — MCP's elicitation spec lets servers ask for more info mid-call. In Fraise this becomes a voice exchange: "What time works?" You answer. Tool continues. First voice client to implement this.
- [ ] **Destructive action confirmation** — tools with `destructiveHint: true` trigger a voice check before running. "That will delete 47 Jira tickets. Say yes to confirm."
- [ ] **Progress narration** — long tool calls speak MCP progress events. "Searching your calendar… found 3 matches."

---

## Phase 5 — Tool scale ⏳

10 servers × 10 tools = 100 definitions. LLM context bloats; routing gets noisy.

- [ ] **Meta-tool router** — send one `route(intent)` tool to the LLM instead of 100 definitions. It picks the server. LLM then only sees that server's tools for the actual call.
- [ ] **Intent pre-filter** — lightweight classifier to narrow which servers are relevant before hitting the LLM.
- [ ] **Tool health checks** — ping each server on a schedule; drop its tools if unreachable; restore when it comes back.

---

## Phase 6 — Developer platform ⏳

If Fraise is the standard way to voice-enable any MCP server, developers build for it.
Every MCP server in existence becomes a potential Fraise plugin.

- [ ] **`fraise.json` manifest** — a spec an MCP server ships to declare how its output should be spoken (templates, summaries, confirmation prompts).
- [ ] **`fraise add <url>`** — one command to connect a new MCP server and make its tools voice-callable.
- [ ] **Plugin registry** — community directory of MCP servers tested with Fraise.
- [ ] **Embedded SDK** — JS/Python package so any app can embed the Fraise voice loop against their own MCP server.

---

## Phase 7 — UX & trust ⏳

Polish that turns a demo into something people use every day.

- [ ] **Greet once per session** — skip the greeting on reconnect/reload (session cookie or localStorage)
- [ ] **"What can you do?"** — Fraise speaks available tools grouped by server. Discovery without docs.
- [ ] **Transcript correction** — tap a misheard word, fix it, re-run. Needs Memory MCP.
- [ ] **Dark / light mode** — the orb already adapts to a `dark` class on `<html>`; just wire a toggle.
- [ ] **Multi-language** — Deepgram nova-3 supports it; expose a language setting.
- [ ] **Mobile / PWA** — mic on iOS, responsive layout, offline indicator.

---

## Adding a capability

**Public server (Phase 2)** — add one entry to `mcp_servers.json`. Restart. Done.

**Private server (Phase 3+):**
1. Write `backend/app/mcp_<name>.py` with `@mcp.tool` functions and pydantic types.
2. Add it to `mcp_servers.json` as `"type": "builtin"`.
3. Voice-callable on next start. Output layer (Phase 4) picks it up automatically.

The voice transport never changes. That is the point.
