# 🍓 Fraise — Roadmap

**Guiding idea:** Fraise grows one MCP tool at a time. The voice loop and the
tool server are the stable core; everything below is a capability that plugs
into them. Each new ability should be a `@mcp.tool` function (or its own MCP
server) that the agent can discover and call — nothing should require touching
the transport.

**Status:** ✅ done · 🚧 in progress (WIP) · ⏳ planned

### Now → Next → Later

| Horizon   | Focus                                                        |
| --------- | ----------------------------------------------------------- |
| **Now**   | 🚧 LLM-driven tool calling (let Claude choose the tool)      |
| **Next**  | Multi-tool loop · Database · Calendar tool                  |
| **Later** | RAG + file upload · Google Meet · multiple agents · theming |

---

## ✅ Phase 0 — The scaffold (done)

The end-to-end loop works today.

- [x] Voice loop: mic → speech-to-text → WebSocket → agent → text-to-speech
- [x] Animated orb mapped to agent state (idle / listening / thinking / speaking)
- [x] FastMCP server with a `calculate` tool (`@mcp.tool`, pydantic I/O)
- [x] MCP mounted at `/mcp` for external MCP clients
- [x] In-process tool calling from the agent

---

## 🚧 Phase 1 — Give the agent a brain

Right now `agent.py` routes with regex. Hand that decision to an LLM so the
model picks tools itself — this is what unlocks everything after it.

- [ ] 🚧 **LLM tool calling** — wire the `anthropic` SDK; expose the MCP tool
      list to Claude and let it call `calculate` (and future tools) on its own.
      Re-introduce settings for `ANTHROPIC_API_KEY` + model.
- [ ] ⏳ **Multi-tool loop** — keep calling tools until the task is done, with a
      step cap and graceful tool-error handling.
- [ ] ⏳ **Streaming replies** — stream tokens over the WebSocket so the orb
      starts "speaking" sooner instead of waiting for the full answer.

_Touches:_ `backend/app/agent.py`, new `settings` for keys/model.

---

## ⏳ Phase 2 — Tools that touch the real world

Each is a new MCP tool/server the agent can call. Calendar comes first because
Google Meet and scheduling build on its auth.

- [ ] **Calendar** (Google Calendar) — `list_events`, `create_event`.
      Needs Google OAuth2 + token storage (see Phase 3 database).
- [ ] **Google Meet** — create/share meeting links via Calendar
      `conferenceData`. Builds directly on the Calendar tool + auth.
- [ ] **Web search** _(optional)_ — a lookup tool for grounding answers.

_Pattern:_ add `backend/app/tools/<name>.py`, register its `@mcp.tool`s on the
shared `mcp` instance.

---

## ⏳ Phase 3 — Memory & knowledge

Persistence first, then files, then retrieval on top of both.

- [ ] **Database** — store conversations, transcripts, and tool calls.
      Start with SQLite (SQLModel), keep it swappable for Postgres later.
      Powers the recents sidebar, transcript correction, and OAuth tokens.
- [ ] **File upload** — endpoint + UI drop zone for PDF/doc/txt; store the file
      and split it into chunks.
- [ ] **RAG / summarization MCP** — index uploaded docs in a vector store
      (sqlite-vec / pgvector), expose `summarize(doc)` and `ask(question)`
      tools. Depends on file upload + the vector store.

_Touches:_ new `backend/app/db.py`, an `/upload` route, a `rag` MCP tool module.

---

## ⏳ Phase 4 — Many agents

Once multi-tool calling is solid, split the brain into specialists.

- [ ] **Specialized agents** — e.g. Scheduler, Researcher, Notetaker, each with
      its own toolset.
- [ ] **Orchestrator** — a router agent that delegates an utterance to the right
      specialist and merges the result.

_Builds on:_ Phase 1 multi-tool loop.

---

## ⏳ Phase 5 — Experience

Polish — some of these are quick wins that can land anytime.

- [ ] **Transcript correction** — edit a misheard utterance in the UI and re-run
      it (new `edit_message` WS frame; needs the database to hold turns).
- [ ] **Dark / light mode** — theme toggle. _Quick win:_ the orb already adapts
      to a `dark` class on `<html>`; just drive it from a toggle + persist it.
- [ ] **Mobile & a11y** — keyboard controls, responsive sidebar, reduced-motion.

---

## How to add a tool

1. Write a `@mcp.tool` function in `backend/app/mcp_server.py` (pydantic types
   for input/output).
2. That's it for the MCP side — it's now callable in-process by the agent and
   exposed at `/mcp` for external clients.
3. Once Phase 1 lands, the LLM will pick it up automatically from the tool list.
