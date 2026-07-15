# Fraise — Project Context / AI Handoff

_A self-contained brief so another AI (or engineer) can pick up exactly where this left off._

---

## 1. What Fraise is

A **voice-first MCP host**. Two layers; capability lives in exactly one:

1. **Voice host (transport)** — generic. mic → STT → LLM → TTS. Never knows what a tool *does*.
2. **MCP servers (capability)** — every skill (calculator, memory, RAG, research…) is an MCP server.

Adding a capability = write `backend/app/servers/<name>/` + one entry in `backend/mcp_servers.json`. The host code never changes for a new capability — that is the core design invariant.

## 2. Stack & how to run

- **Backend**: FastAPI + FastMCP + pydantic, Python 3.11+, venv at `backend/.venv`.
  `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000`
- **Frontend**: React 19 + TypeScript + Vite 6.
  `cd frontend && npm install && npm run dev` → http://localhost:5173
  `npm run build` = `tsc -b && vite build` → `frontend/dist` (served by backend in prod)
- Vite dev **proxies API routes to :8000**. EVERY backend route must be listed in `frontend/vite.config.ts` `server.proxy` or it silently serves index.html (a fetch then gets HTML and the feature does nothing).
- Requires `.env` at repo root: `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `TAVILY_API_KEY` (all present).
- No test suite / linter. Verify by running the app. Visual verification was done with a throwaway Playwright install in the scratchpad.

## 3. Pre-existing architecture (before this session)

- `/ws` → `backend/app/host/voice_agent.py::bridge` proxies browser 16 kHz PCM to **Deepgram Voice Agent** (STT+LLM+TTS in one socket); intercepts `FunctionCallRequest` and routes via MCPManager.
- `backend/app/host/mcp_manager.py`: reads `mcp_servers.json`, connects builtin/http/stdio servers, aggregates tools into one namespace, collision-only prefixing, injects `session_id` into tools, `${VAR}` env interpolation.
- **Research fan-out**: `backend/app/servers/research/__init__.py` — a planner LLM designs 2–4 agents, they run in parallel (Tavily search + Groq summarize), a synthesizer merges into an artifact (doc/slides). Progress streams over `backend/app/host/bus.py` (in-process pub/sub) → **SSE `/agents/stream?sid=`**.
- Groq LLM helper: `backend/app/servers/research/llm.py` — `complete()`, `complete_json()`, `strip_markdown()`. Models: `RESEARCH_MODEL=llama-3.1-8b-instant`, `SYNTH_MODEL=llama-3.3-70b-versatile`.
- Storage: one SQLite file via `backend/app/storage/db.py`. Memory store `backend/app/servers/memory/store.py` (`remember`, `recall`, `recent_turns`).
- **Per-user scope = browser session id** (`sid` = the active assistant id), passed to `/ws`, `/upload`, `/agents/stream`, `/dictate`.

## 4. What was built THIS session

### 4a. Rebrand: "editorial wine" → **Obsidian + Signal Blue**
Premium fintech look, explicitly modeled on the Razorpay "AI builders" landing page. **Dark is now the default / front door.**
- Palette in `frontend/src/App.css`: `:root` = rebranded LIGHT variant; `.dark` = primary OBSIDIAN. Canvas `#07080B`, accent signal-blue `#5B6CFF` (`#3D4EE6` on light), ivory text `#ECEEF4`, action-green `#3FE0A0`, cool blue-tinted borders. App.css is almost entirely token-driven, so flipping tokens propagated everywhere.
- `frontend/src/index.css`, `index.html` `theme-color`, `App.tsx` `statusPill` colors → new palette. Default theme set to `"dark"`.
- Orb recolored blue/cyan: `Orb.tsx` `colors={["#3D5AFF","#63E6FF"]}`; `Orb.css` bloom/shadow/fallback → blue.
- Added **JetBrains Mono** (index.html) for mono annotation labels/eyebrows. Kept Instrument Serif (display) + Hanken Grotesk (body). Added `--mono` token.

### 4b. New feature: dictate your whole day → split into tasks → fan out to lane agents
- Backend `backend/app/servers/daily.py`: `start(text, sid, tz_offset_min)` fires a detached task that (1) segments the brain-dump into atomic tasks via Groq JSON (`_SEGMENT_SYSTEM`), each `{id,title,lane,detail}`, lane ∈ `research|remember|reminder|calendar|email|note|answer`; (2) fans them out concurrently (semaphore = 3); each lane handler streams `day_task` events over `bus`; ends with a `day` `done` event.
  - Handlers: research (Tavily search + 2–3 sentence summarize + sources), remember (memory store), email (draft → status "proposed"), answer (LLM), reminder/calendar (status "proposed"), note (stored).
- Endpoint `POST /dictate?sid=` in `backend/app/main.py` (added `from app.servers import daily`, `Body` import). Returns `{day_id}` immediately; progress via the existing SSE `/agents/stream`.
- Added `/dictate` to `frontend/vite.config.ts` proxy.
- Frontend `frontend/src/useDay.ts`: `useDay(sid)` → `{day, process, dismiss}`. POSTs transcript (with `tz_offset_min`), consumes `day`/`day_task` SSE events (its own EventSource).
- **Verified end-to-end**: one sentence → 5 tasks (email draft, reminder, research with real sources, memory saved, direct answer) streaming live.

### 4c. The Hero (front door) — `frontend/src/Hero.tsx` + `frontend/src/Hero.css`
Self-contained, always dark. Structure: grotesque nav (`Fraise /voice` · Workspace · Source · "Talk to Fraise" blue CTA) → mono eyebrow "DICTATE ONCE — AGENTS DO THE REST" → animated serif headline → the reveal figure → dictation composer. When a day is processing it swaps the figure for a `DayBoard` of per-lane task cards.
- Wired into `App.tsx`: Hero shown when `!enteredApp` (early return placed AFTER all hooks). Orb / "Talk to Fraise" → `setEnteredApp(true)` + start voice. Sidebar `.brand` is now a button → back to Hero.
- **The centerpiece reveal** — a classical "Atlas" image (`frontend/public/hero-atlas.jpg`; a Pinterest pic: a kneeling Greek figure holding a VINYL RECORD aloft). We:
  - removed its background with **rembg (u2netp model)** → cutout of just the body on transparent bg;
  - cropped it, saved `frontend/public/hero-atlas-cut.png`;
  - placed the WebGL **orb over where the vinyl/disc was**, so the figure holds the ORB;
  - render it as **ASCII by default**, resolving into the real cutout photo on hover (rack-focus: photo starts blurred/dark/zoomed → sharp; ASCII dissolves with blur+zoom). **No rectangle/border** — a figure-shaped cutout on pure black.
- ASCII data: `frontend/src/heroAscii.ts` (GENERATED — do not hand-edit). Exports: `HERO_ASCII` (background = spaces, body = glyphs), `HERO_RAMP` (brightness ramp string), `HERO_ASPECT`, `HERO_ORB_X`, `HERO_ORB_Y`, `HERO_ORB_W`, `HERO_COLS`, `HERO_ROWS`.
- **Animated ASCII** (`AsciiField` in Hero.tsx): continuously shuffles ~11% of body glyphs every 70 ms, re-rolling each within ±2 of its original `HERO_RAMP` index so tone/figure holds while the characters churn.
- **Animated headline** (`useScramble` / `Scramble` / `Headline` in Hero.tsx): "Say your whole day." scrambles in on mount; the italic "handled." re-decodes on a ~5.2 s loop. `SCRAMBLE_GLYPHS` currently mixes symbols + letters + digits. Respects `prefers-reduced-motion`.
- **Dictation composer** (`Composer` in Hero.tsx): mic uses Web Speech API (`webkitSpeechRecognition`) continuous dictation, appending finals to an editable textarea; "Process my day" → `useDay.process`.
- **Annotations**: an `ANNOTATIONS` array renders `x01/x02/x03` callouts with connector lines + mono labels ("SPLITS YOUR DAY / INTO TASKS", "ROUTES EACH TO / ITS OWN AGENT", "REMEMBERS / WHAT MATTERS"). CSS: `.hx-annos`, `.hx-anno`, `.hx-anno-tick`, `.hx-anno-line`, `.hx-anno-text`.

## 5. Files created / modified this session
- **Created**: `frontend/src/Hero.tsx`, `frontend/src/Hero.css`, `frontend/src/useDay.ts`, `frontend/src/heroAscii.ts` (generated), `backend/app/servers/daily.py`, `frontend/public/hero-atlas.jpg` (source asset), `frontend/public/hero-atlas-cut.png` (bg-removed cutout).
- **Modified**: `frontend/src/App.tsx` (Hero front door, useDay, statusPill colors, dark default, brand button), `frontend/src/App.css` (palette tokens + `.brand` button reset), `frontend/src/index.css`, `frontend/index.html` (fonts + title + theme-color), `frontend/src/Orb.tsx` + `Orb.css` (blue recolor), `frontend/src/icons.tsx` (added `GitHubMark`), `frontend/vite.config.ts` (`/dictate` proxy), `backend/app/main.py` (`/dictate` + daily import + Body).
- **Memory** (Claude's persistent notes) updated: brand direction now "Obsidian + Signal Blue" (wine retired).

## 6. ASCII regeneration workflow (how to re-tune the figure)
The ASCII + cutout are generated by a script in the **scratchpad** (ephemeral) using an isolated `rembg` venv. The generated outputs (`heroAscii.ts`, `hero-atlas-cut.png`) ARE committed to the repo, so the app runs without the scratchpad — you only need this to change the crop/columns.
- Background removal: `rembg` (model **u2netp**, ~4.7 MB — the big u2net 176 MB download times out, use u2netp) → `hero-atlas-cut-raw.png` (RGBA, full 736×920 with transparent bg).
- Generator `scratchpad/asciicut.py` (PIL): opens the raw cutout, computes alpha bbox + 2% pad, **`KEEP_TOP` fraction crops the legs off at the waist**, resizes to `COLS`, maps alpha<`ALPHA_MIN`→space and luminance→`RAMP` char. Writes `frontend/src/heroAscii.ts` AND saves the exact cropped cutout to `frontend/public/hero-atlas-cut.png` (so photo + ASCII + orb all share one crop). Key constants: `COLS`, `KEEP_TOP`, `ALPHA_MIN=40`, `DISC_CX,DISC_CY=368,400`, `DISC_D=250` (vinyl centre/diameter in the ORIGINAL image; drives `HERO_ORB_X/Y/W`).
- `HERO_RAMP` MUST be written with `json.dumps(RAMP)` (it contains `" ' \` ^` etc. — plain repr breaks the TS).
- Font size rule: to fill the figure width, CSS `.hx-ascii { font-size: (166.7 / COLS) cqw }`, `line-height: 1.235` (matches the generator's `char_aspect = 2.05`). The figure is a container query context (`container-type: inline-size`).

## 7. CURRENT IN-PROGRESS STATE (mid-task)
Last user asks: **"it shows the full photo length — fix that"** and **"MAKE THE ASCII ULTRA BIG"**, plus **"x01 x02 x03 are not even readable."**
- Just regenerated `heroAscii.ts` at `COLS=38`, `KEEP_TOP=0.66` (crop the legs, keep upper body to the waist — wider aspect lets glyphs be bigger). New geometry: cropped 301×384, `HERO_ASPECT=0.7839`, `HERO_ORB_X=53.5`, `HERO_ORB_Y=37.0`, `HERO_ORB_W=96.3`. `hero-atlas-cut.png` re-saved to the new waist crop.
- ⚠️ **NOT YET DONE / needs sync**: `frontend/src/Hero.css` `.hx-ascii { font-size: ... }` is still **3.087cqw** (for 54 cols). It MUST be updated to **4.387cqw** to match `COLS=38` (`166.7/38`). Until then the ASCII renders too small / under-fills.

## 8. OPEN ISSUES / pending user feedback
1. **`x01/x02/x03` annotations are unreadable** (user's latest note). Current CSS: `.hx-anno` opacity `0.55` (→0.95 on hover), `.hx-anno-text` color `var(--muted)` `#8A90A4`, 11px mono, positioned in `.hx-annos { inset: -4% -22% -2% }` so they overlap the dark figure. Fix options: brighten (higher opacity / lighter color / stronger weight), push them clear of the figure silhouette (more negative horizontal inset), enlarge, and/or add a subtle backing. They should read like the Razorpay technical callouts.
2. **Ultra-big ASCII** — in progress (COLS=38 + waist crop). May need to go even coarser (COLS ~30–34) if not big enough; keep the CSS font-size formula in sync (`166.7/COLS` cqw).
3. **Figure length** — waist crop (`KEEP_TOP=0.66`) should stop it being full head-to-toe; tune `KEEP_TOP` if the cut looks wrong. Confirm the composer stays visible (figure height is `clamp(320px, calc(100vh - 420px), 780px)` in `.hx-reveal`; composer must clear the fold).
4. Headline scramble uses code symbols (`%$*` etc.) in the elegant serif — offered to switch to letters-only if the user prefers it cleaner (`SCRAMBLE_GLYPHS` in Hero.tsx).
5. WebGL orb idle frame looks like a "pinwheel" in static screenshots — it shimmers as a sphere live; not a real bug.
6. User is sharing Pinterest references to refine the hero further — fold them in.

## 9. Verification commands
- Build: `cd frontend && npm run build` (must pass `tsc -b`).
- Run: backend on :8000 + `npm run dev` on :5173; open http://localhost:5173. Mic dictation best in Chrome (Safari ok for visuals).
- Screenshot check (Playwright installed in scratchpad): navigate, `waitForSelector('.hx-reveal')`, screenshot; hover `.hx-reveal` to trigger the ASCII→photo reveal; compare `.hx-ascii` textContent across 600 ms to confirm the shuffle animates.

## 10. Design north star
Razorpay "AI builders" page: near-black, big readable ASCII portrait of the subject (cutout, no rectangle) that resolves into the real cutout photo; serif roman+italic headline; mono technical `x0N` callouts; one blue primary button. Fraise's twist: the figure holds the **orb**, the headline + ASCII **animate/decode**, and the product is **dictate-your-day → multi-agent fan-out**.
```
