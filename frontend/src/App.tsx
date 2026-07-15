import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceAgent, uploadDocument, type OrbState } from "./useVoiceAgent";
import {
  AVATAR_CHOICES,
  createAssistant,
  deleteAssistant,
  getActiveId,
  listAssistants,
  setActiveId,
  updateAssistant,
  type Assistant,
} from "./assistants";
import Orb from "./Orb";
import Board from "./Board";
import Hero from "./Hero";
import { AgentPanel, ArtifactView } from "./Agents";
import { useAgents } from "./useAgents";
import { useDay } from "./useDay";
import { useHistory } from "./useHistory";
import { FraiseMark } from "./icons";
import "./App.css";
import { SpeedInsights } from "@vercel/speed-insights/react";

// Status pill — connection state wins, otherwise the orb's phase.
function statusPill(
  status: "connecting" | "online" | "error",
  orbState: OrbState,
): { label: string; color: string } {
  if (status === "connecting") return { label: "Connecting…", color: "#C79A45" };
  if (status === "error") return { label: "Offline", color: "#E06B7E" };
  return {
    idle: { label: "Ready", color: "#7E8598" },
    listening: { label: "Listening", color: "#5B6CFF" },
    thinking: { label: "Working", color: "#3FE0A0" },
    speaking: { label: "Speaking", color: "#8493FF" },
  }[orbState];
}

const DOCK_HINT: Record<OrbState, string> = {
  idle: "Tap the orb to speak",
  listening: "Listening…",
  thinking: "Working…",
  speaking: "Speaking…",
};

type Theme = "light" | "dark";

// Theme lives on <html class="dark"> — the WebGL orb watches that class to
// invert its palette, so the toggle just flips the class and persists it.
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("fraise-theme");
    if (saved === "light" || saved === "dark") return saved;
    // Obsidian is the brand's home now — the front door is dark.
    return "dark";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("fraise-theme", theme);
    // Keep mobile browser chrome (status bar) in step with the theme.
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = theme === "dark" ? "#07080B" : "#F5F6F9";
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

// Reveals `text` one character at a time.
//
// The agent's transcript arrives incrementally, so `text` grows mid-type. We
// only rewind when the new text isn't a continuation of what's already on the
// page — otherwise the reveal just keeps chasing the longer string, which is
// what makes it look like the words are being typed as they're spoken.
function useTypewriter(text: string, enabled: boolean, cps = 48): string {
  const [count, setCount] = useState(0);
  const printed = useRef("");

  useEffect(() => {
    if (!text.startsWith(printed.current)) setCount(0);
    printed.current = text;
  }, [text]);

  useEffect(() => {
    if (!enabled) {
      setCount(text.length);
      return;
    }
    if (count >= text.length) return;
    const id = setTimeout(() => setCount((c) => Math.min(c + 1, text.length)), 1000 / cps);
    return () => clearTimeout(id);
  }, [count, text, enabled, cps]);

  return text.slice(0, count);
}

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
  </svg>
);
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 14.2A8 8 0 0 1 9.8 4a.6.6 0 0 0-.82-.74A9.2 9.2 0 1 0 20.7 15a.6.6 0 0 0-.7-.8z" />
  </svg>
);
const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.13-.3-.54-1.53.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
  </svg>
);
// Timestamps come back as UTC ISO from SQLite; show them the way a person says them.
function timeAgo(iso: string): string {
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function App() {
  // Phase 11 — the row of assistants, and which one is active. The active id is
  // the scope key: it becomes ?sid= for memory, docs, and history.
  const [assistants, setAssistants] = useState<Assistant[]>(() => listAssistants());
  const [activeId, setActiveIdState] = useState<string>(() => getActiveId());
  const active = assistants.find((a) => a.id === activeId) ?? assistants[0];
  const [editing, setEditing] = useState<Assistant | "new" | null>(null);

  const switchTo = useCallback((id: string) => {
    setActiveId(id);
    setActiveIdState(id);
    setEditing(null);
  }, []);

  // Voice-native switch: the backend named an assistant; match it locally.
  const handleVoiceSwitch = useCallback(
    (name: string) => {
      const target = listAssistants().find(
        (a) => a.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      if (target) switchTo(target.id);
    },
    [switchTo],
  );

  const { messages, status, orbState, levelRef, outLevelRef, speechSupported, toggle, reconnect, notifyUpload, authNeeded, clearAuth, listening } = useVoiceAgent(handleVoiceSwitch);

  // The research agents stream their progress on their own channel, keyed by the
  // same id as everything else the user owns.
  const { run, artifact, history, openId, openArtifact, dismiss: dismissRun } = useAgents(activeId);

  // The dictated day: one brain-dump split into tasks, fanned out to lane agents.
  // Lives on the hero (the front door); the workspace is a second way in.
  const { day, process: processDay, dismiss: dismissDay } = useDay(activeId);
  const [enteredApp, setEnteredApp] = useState(false);

  // Conversation + remembered facts, from the server. Refreshed whenever a turn
  // completes (messages.length changes), so the sidebar tracks the conversation.
  const { turns, memories } = useHistory(activeId, messages.length);

  // When the active assistant changes while a voice session is live, reopen the
  // socket as the new persona (new sid + config). If idle, the next start picks
  // it up automatically — nothing to do.
  const prevIdRef = useRef(activeId);
  useEffect(() => {
    if (prevIdRef.current !== activeId) {
      prevIdRef.current = activeId;
      if (listening) reconnect();
    }
  }, [activeId, listening, reconnect]);

  const saveAssistant = useCallback(
    (data: { name: string; avatar: string; instructions: string }, id?: string) => {
      if (id) {
        setAssistants(updateAssistant(id, data));
        // Editing the active persona's vibe mid-session: reopen the socket so the
        // new name/instructions land in the prompt (a new persona is created idle,
        // so it needs no reconnect).
        if (id === activeId && listening) reconnect();
      } else {
        const created = createAssistant(data);
        setAssistants(listAssistants());
        switchTo(created.id);
      }
      setEditing(null);
    },
    [switchTo, activeId, listening, reconnect],
  );

  const removeAssistant = useCallback((id: string) => {
    setAssistants(deleteAssistant(id));
    setActiveIdState(getActiveId());
    setEditing(null);
  }, []);

  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // First-run asks the visitor's name once; the account menu lets them change it
  // (or their persona's vibe) any time after.
  const [name, setName] = useState<string>(() => localStorage.getItem("fraise-name") ?? "");
  const [askName, setAskName] = useState<boolean>(() => localStorage.getItem("fraise-name") === null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const saveName = (raw: string) => {
    const clean = raw.trim().slice(0, 40);
    localStorage.setItem("fraise-name", clean);
    setName(clean);
    const wasEdit = editingName;
    setAskName(false);
    setEditingName(false);
    // A live session carries the name in its socket URL (?name=), so a rename
    // only reaches the backend prompt on reconnect.
    if (wasEdit && listening) reconnect();
  };
  const openRename = () => {
    setNameInput(name);
    setEditingName(true);
    setAccountMenuOpen(false);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<{ name: string; chunks: number }[]>([]);
  const [uploading, setUploading] = useState<string>("");
  const [docError, setDocError] = useState<string>("");

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    setUploading(file.name);
    setDocError("");
    try {
      const { filename, chunks } = await uploadDocument(file);
      setDocs((prev) => [{ name: filename, chunks }, ...prev.filter((d) => d.name !== filename)]);
      notifyUpload(filename);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : "Upload failed");
      setTimeout(() => setDocError(""), 4000);
    } finally {
      setUploading("");
    }
  }

  // Live waveform: drive vertical scale from mic amplitude while listening.
  const waveRef = useRef<HTMLDivElement>(null);
  const orbStateRef = useRef(orbState);
  orbStateRef.current = orbState;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = waveRef.current;
      if (el) {
        const s = orbStateRef.current;
        const scale =
          s === "listening" ? Math.min(1, 0.5 + levelRef.current * 1.6)
          : s === "speaking" ? 1
          : 0.5;
        el.style.setProperty("--wave-scale", scale.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  // Space toggles the mic (push-to-talk feel); Esc closes the mobile menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.code === "Space" && !e.repeat && !typing && speechSupported) {
        e.preventDefault();
        toggle();
      } else if (e.key === "Escape") {
        setMenuOpen(false);
        setAccountMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, speechSupported]);

  const lastAgent = [...messages].reverse().find((m) => m.role === "agent");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const waveOn = orbState === "listening" || orbState === "speaking";

  // Caption — the single line of "speech" the assistant shows.
  let caption: string;
  let captionClass: string;
  if (!speechSupported) {
    caption = "Speech recognition isn't supported here — try Chrome.";
    captionClass = "idle";
  } else if (orbState === "thinking") {
    caption = "Working…";
    captionClass = "";
  } else if (orbState === "speaking") {
    caption = lastAgent?.text ?? "Speaking…";
    captionClass = "speaking";
  } else if (orbState === "listening") {
    caption = lastUser?.text ?? "Listening…";
    captionClass = "listening";
  } else {
    caption = messages.length
      ? (lastAgent ?? messages[messages.length - 1]).text
      : `${greetingFor(new Date())}${name ? `, ${name}` : ""} — what can I help with?`;
    captionClass = "idle";
  }

  // Type only what Fraise says. A listening caption is the user's own words
  // coming back off the mic — replaying those a character at a time would lag
  // behind their voice and feel broken.
  const reduceMotion = useRef(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false).current;
  const types = captionClass === "speaking" || captionClass === "idle";
  const typed = useTypewriter(caption, types && !reduceMotion);
  const caretOn = typed.length < caption.length || waveOn;

  const pill = statusPill(status, orbState);
  // Keep the board mounted while docs exist or a turn is in flight so it can
  // recede (fade) rather than pop out — a shelf, not a feed.
  const showBoard = speechSupported && (messages.length === 0 || docs.length > 0 || !!uploading);

  // The front door — the Obsidian hero with the dictation composer. Talking or
  // opening the workspace crosses into the full app below (which keeps captions,
  // the research panel, memory, and history). The dictated day lives out here.
  if (!enteredApp) {
    return (
      <>
        <Hero
          orbState={orbState}
          onOrbClick={() => {
            setEnteredApp(true);
            if (!listening) toggle();
          }}
          inputLevelRef={levelRef}
          outputLevelRef={outLevelRef}
          day={day}
          onProcess={processDay}
          onDismissDay={dismissDay}
          onEnterApp={() => setEnteredApp(true)}
        />
        <SpeedInsights />
      </>
    );
  }

  return (
    <div className={`stage ${orbState}`}>
      <div className="window" data-screen-label="Fraise — voice assistant">
        {/* ---------- sidebar ---------- */}
        {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
        <aside className={`sidebar${menuOpen ? " open" : ""}`}>
          <button className="brand" onClick={() => setEnteredApp(false)} title="Back to the front door">
            <div className="brand-mark"><FraiseMark /></div>
            <div>
              <div className="brand-name">Fraise</div>
              <div className="brand-sub">Voice assistant</div>
            </div>
          </button>

          <button className="new-conv" onClick={() => { toggle(); setMenuOpen(false); }}>
            <span className="plus">+</span>
            New conversation
          </button>

          {/* Past research, straight from the DB — so it survives a reload, unlike
              the spoken turns, which only ever lived in this tab's memory. */}
          <div className="section-label">Research</div>

          <div className="recents">
            {history.length === 0 ? (
              <div className="recents-empty">
                Ask me to research something and the write-ups will collect here.
              </div>
            ) : (
              history.map((h) => (
                <button
                  key={h.id}
                  className={`recent${h.id === openId ? " active" : ""}`}
                  onClick={() => { void openArtifact(h.id); setMenuOpen(false); }}
                  title={h.title}
                >
                  <span className="recent-title">
                    <span className="dot" />
                    <span>{h.title}</span>
                  </span>
                  <span className="recent-meta">
                    {h.format === "slides" ? "Deck" : "Doc"} · {timeAgo(h.created_at)}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* The conversation, read back from the server — so it survives a reload
              instead of living only in this tab. Same sid as memory and research. */}
          {turns.length > 0 && (
            <>
              <div className="section-label">Conversation</div>
              <div className="chat-log">
                {turns.map((t, i) => (
                  <div key={i} className={`chat-turn ${t.role}`}>
                    <span className="who">{t.role === "user" ? name || "You" : active.name}</span>
                    <span className="said">{t.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {memories.length > 0 && (
            <>
              <div className="section-label">Remembered</div>
              <div className="memories">
                {memories.slice(0, 6).map((m, i) => (
                  <div key={i} className="memory-line">{m}</div>
                ))}
              </div>
            </>
          )}

          <div className="account-wrap">
            {accountMenuOpen && (
              <button
                className="account-scrim"
                aria-label="Close account menu"
                onClick={() => setAccountMenuOpen(false)}
              />
            )}

            {accountMenuOpen && (
              <div className="account-menu" role="menu">
                <div className="acct-head">
                  <div className="account-mark lg">{(name || "You").charAt(0).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="account-name">{name || "You"}</div>
                    <div className="account-sub">Talking with {active.avatar} {active.name}</div>
                  </div>
                </div>

                <button className="acct-item" role="menuitem" onClick={openRename}>
                  <span className="acct-ico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </span>
                  Change your name
                </button>

                <button
                  className="acct-item"
                  role="menuitem"
                  onClick={() => { setEditing(active); setAccountMenuOpen(false); }}
                >
                  <span className="acct-ico avatar">{active.avatar}</span>
                  Customize {active.name}’s vibe
                </button>

                <div className="acct-sep" />

                <div className="acct-appearance">
                  <span className="acct-label">Appearance</span>
                  <div className="acct-theme" role="group" aria-label="Theme">
                    <button
                      className={theme === "light" ? "on" : ""}
                      onClick={() => theme !== "light" && toggleTheme()}
                      aria-pressed={theme === "light"}
                    >
                      Light
                    </button>
                    <button
                      className={theme === "dark" ? "on" : ""}
                      onClick={() => theme !== "dark" && toggleTheme()}
                      aria-pressed={theme === "dark"}
                    >
                      Dark
                    </button>
                  </div>
                </div>
              </div>
            )}

            <button
              className={`account${accountMenuOpen ? " open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((o) => !o)}
            >
              <div className="account-mark">{(name || "You").charAt(0).toUpperCase()}</div>
              <div className="account-id">
                <div className="account-name">{name || "You"}</div>
                <div className="account-sub">{active.avatar} {active.name}</div>
              </div>
              <span className="account-dots" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </span>
            </button>
          </div>

          <div className="credit">
            made by <a href="https://github.com/Dhruv-kys/Fraise" target="_blank" rel="noreferrer noopener">Dhruv</a>
          </div>
        </aside>

        {/* ---------- main ---------- */}
        <main className="main">
          <header className="main-header">
            <div className="header-left">
              <button
                className="icon-btn menu"
                aria-label="Open menu"
                onClick={() => setMenuOpen(true)}
              >
                <MenuIcon />
              </button>
              <div className="status-pill">
                <span className="dot" style={{ background: pill.color }} />
                <span className="label">{pill.label}</span>
              </div>
            </div>

            <div className="assistant-switcher" role="tablist" aria-label="Assistants">
              {assistants.map((a) => {
                const isActive = a.id === activeId;
                return (
                  <button
                    key={a.id}
                    className={`assistant-pill${isActive ? " active" : ""}`}
                    role="tab"
                    aria-selected={isActive}
                    title={isActive ? `${a.name} — edit` : `Switch to ${a.name}`}
                    onClick={() => (isActive ? setEditing(a) : switchTo(a.id))}
                  >
                    <span className="assistant-avatar">{a.avatar}</span>
                    {isActive && <span className="assistant-name">{a.name}</span>}
                  </button>
                );
              })}
              <button
                className="assistant-add"
                title="New assistant"
                aria-label="New assistant"
                onClick={() => setEditing("new")}
              >
                +
              </button>
            </div>

            <div className="header-right">
              <a
                className="icon-btn"
                href="https://github.com/Dhruv-kys/Fraise"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="View source on GitHub"
                title="View source on GitHub"
              >
                <GitHubIcon />
              </a>
              <button
                className="icon-btn"
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-pressed={theme === "dark"}
                onClick={toggleTheme}
              >
                {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          </header>

          {authNeeded && (
            <div className="auth-banner">
              <span>Google Calendar needs to be connected.</span>
              <button
                className="auth-banner-btn"
                onClick={() => {
                  window.open(authNeeded, "_blank");
                  clearAuth();
                }}
              >
                Connect Calendar
              </button>
            </div>
          )}

          <section className="assistant-stage">
            {/* The hero is its own plane: it sticks to the top and the board
                scrolls underneath its frosted scrim. It compacts when agents are
                running — at that point the work *is* the answer, and a 340px orb
                would push the deck below the fold. */}
            <div className={`hero${run || artifact ? " compact" : ""}`}>
              <Orb state={orbState} onClick={toggle} inputLevelRef={levelRef} outputLevelRef={outLevelRef} />

              <div className="caption-wrap">
                <p className={`caption ${captionClass}`} aria-live="polite">
                  {typed}
                  {caretOn && <span className="caret" />}
                </p>
              </div>
            </div>

            {/* The agents and their artifact own the stage while a run is alive —
                they're the answer, so they don't recede when Fraise speaks. */}
            {artifact ? (
              <ArtifactView artifact={artifact} onClose={dismissRun} />
            ) : run ? (
              <AgentPanel run={run} />
            ) : (
              showBoard && <Board docs={docs} uploading={uploading} receded={orbState !== "idle"} />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf"
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
          </section>

          <footer className="dock">
            <div ref={waveRef} className={`wave${waveOn ? " on" : ""}`}>
              {Array.from({ length: 13 }).map((_, i) => (
                <span key={i} />
              ))}
            </div>
            <div className="dock-row">
              <span className="dock-hint">
                {speechSupported ? DOCK_HINT[orbState] : "Voice needs Chrome or Edge"}
                {speechSupported && orbState === "idle" && <kbd className="kbd">Space</kbd>}
              </span>
              {/* Small, always-visible upload — lives in the dock (z-4) so it never
                  recedes with the board while Fraise is talking. */}
              <button
                className={`dock-upload${docError ? " error" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFiles(e.dataTransfer.files);
                }}
                title={docError || "Add a document — .txt, .md, .pdf"}
                aria-label={docError || "Add a document"}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4M8 8l4-4 4 4" />
                  <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
                <span className="dock-upload-label">
                  {uploading ? "Adding…" : docError ? "Try again" : "Add document"}
                </span>
              </button>
            </div>
          </footer>
        </main>
      </div>

      {/* ---------- name prompt: first-run and later renames share this card ---------- */}
      {(askName || editingName) && (
        <div className="name-overlay" onClick={() => editingName && setEditingName(false)}>
          <form
            className="name-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              saveName(nameInput);
            }}
          >
            <div className="brand-mark name-mark"><FraiseMark /></div>
            <h2 className="name-title">{editingName ? "Your name" : "Welcome to Fraise"}</h2>
            <p className="name-sub">What should I call you?</p>
            <input
              className="name-input"
              type="text"
              autoFocus
              placeholder="Your name"
              value={nameInput}
              maxLength={40}
              onChange={(e) => setNameInput(e.target.value)}
            />
            <button className="name-go" type="submit" disabled={!nameInput.trim()}>
              {editingName ? "Save" : "Continue"}
            </button>
            <button
              className="name-skip"
              type="button"
              onClick={() => (editingName ? setEditingName(false) : saveName(""))}
            >
              {editingName ? "Cancel" : "Skip for now"}
            </button>
          </form>
        </div>
      )}

      {editing && (
        <AssistantEditor
          assistant={editing === "new" ? null : editing}
          canDelete={editing !== "new" && assistants.length > 1}
          onSave={saveAssistant}
          onDelete={removeAssistant}
          onCancel={() => setEditing(null)}
        />
      )}
      <SpeedInsights />
    </div>
  );
}

function AssistantEditor({
  assistant,
  canDelete,
  onSave,
  onDelete,
  onCancel,
}: {
  assistant: Assistant | null;
  canDelete: boolean;
  onSave: (data: { name: string; avatar: string; instructions: string }, id?: string) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(assistant?.name ?? "");
  const [avatar, setAvatar] = useState(assistant?.avatar ?? AVATAR_CHOICES[0]);
  const [instructions, setInstructions] = useState(assistant?.instructions ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="name-overlay" onClick={onCancel}>
      <form
        className="name-card editor-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name: name.trim() || "New assistant", avatar, instructions }, assistant?.id);
        }}
      >
        <div className="editor-avatar-preview">{avatar}</div>
        <h2 className="name-title">{assistant ? "Edit assistant" : "New assistant"}</h2>
        <p className="name-sub">A separate name, look, and memory of its own.</p>

        <label className="editor-label">Name</label>
        <input
          className="name-input"
          type="text"
          autoFocus
          placeholder="Work, Personal, Coach…"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="editor-label">Avatar</label>
        <div className="avatar-grid">
          {AVATAR_CHOICES.map((e) => (
            <button
              key={e}
              type="button"
              className={`avatar-choice${e === avatar ? " active" : ""}`}
              onClick={() => setAvatar(e)}
            >
              {e}
            </button>
          ))}
        </div>

        <label className="editor-label">Custom instructions</label>
        <textarea
          className="editor-textarea"
          placeholder="Tone, role, and standing rules — e.g. 'You're my work assistant. Be concise and professional.'"
          value={instructions}
          maxLength={1500}
          rows={4}
          onChange={(e) => setInstructions(e.target.value)}
        />

        <button className="name-go" type="submit">
          {assistant ? "Save" : "Create"}
        </button>
        {canDelete && assistant && (
          <button
            className="name-skip editor-delete"
            type="button"
            onClick={() => onDelete(assistant.id)}
          >
            Delete this assistant
          </button>
        )}
        <button className="name-skip" type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  );
}
