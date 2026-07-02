import { useEffect, useRef, useState } from "react";
import { useVoiceAgent, uploadDocument, type OrbState } from "./useVoiceAgent";
import Orb from "./Orb";
import "./App.css";
import { SpeedInsights } from "@vercel/speed-insights/react";

// Status pill — connection state wins, otherwise the orb's phase.
function statusPill(
  status: "connecting" | "online" | "error",
  orbState: OrbState,
): { label: string; color: string } {
  if (status === "connecting") return { label: "Connecting…", color: "#C08A3E" };
  if (status === "error") return { label: "Offline", color: "#B4485C" };
  return {
    idle: { label: "Ready", color: "#A9959B" },
    listening: { label: "Listening", color: "#C75C74" },
    thinking: { label: "Working", color: "#4E8A6A" },
    speaking: { label: "Speaking", color: "#8E2A45" },
  }[orbState];
}

const DOCK_HINT: Record<OrbState, string> = {
  idle: "Tap the orb to speak",
  listening: "Listening…",
  thinking: "Working…",
  speaking: "Speaking…",
};

// Empty-state discovery prompts — shown before the first turn so the stage
// isn't just an orb in a void, and so first-time users learn what to say.
const SUGGESTIONS = [
  { icon: "✦", text: "What's 18% of 240?" },
  { icon: "◇", text: "Remember I prefer window seats" },
  { icon: "❋", text: "Summarize the document I added" },
  { icon: "❍", text: "What have I asked you to remember?" },
];

type Theme = "light" | "dark";

// Theme lives on <html class="dark"> — the WebGL orb watches that class to
// invert its palette, so the toggle just flips the class and persists it.
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("fraise-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
    meta.content = theme === "dark" ? "#271A1C" : "#FAF7F2";
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
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
const DocIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function App() {
  const { messages, status, orbState, levelRef, outLevelRef, speechSupported, toggle, notifyUpload, authNeeded, clearAuth } = useVoiceAgent();

  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  // First-run: ask the visitor's name once, persist it, and address them by it.
  const [name, setName] = useState<string>(() => localStorage.getItem("fraise-name") ?? "");
  const [askName, setAskName] = useState<boolean>(() => localStorage.getItem("fraise-name") === null);
  const [nameInput, setNameInput] = useState("");
  const saveName = (raw: string) => {
    const clean = raw.trim().slice(0, 40);
    localStorage.setItem("fraise-name", clean);
    setName(clean);
    setAskName(false);
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

  const pill = statusPill(status, orbState);
  const showSuggestions = speechSupported && orbState === "idle" && messages.length === 0;

  // Recent list — derived from the user's turns this session.
  const recents = [...messages].filter((m) => m.role === "user").reverse().slice(0, 8);

  return (
    <div className={`stage ${orbState}`}>
      <div className="window" data-screen-label="Fraise — voice assistant">
        {/* ---------- sidebar ---------- */}
        {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
        <aside className={`sidebar${menuOpen ? " open" : ""}`}>
          <div className="brand">
            <div className="brand-mark">🍓</div>
            <div>
              <div className="brand-name">Fraise</div>
              <div className="brand-sub">Voice assistant</div>
            </div>
          </div>

          <button className="new-conv" onClick={() => { toggle(); setMenuOpen(false); }}>
            <span className="plus">+</span>
            New conversation
          </button>

          <div className="section-label">Recent</div>

          <div className="recents">
            {recents.length === 0 ? (
              <div className="recents-empty">Your conversations will show up here.</div>
            ) : (
              recents.map((m, i) => (
                <button key={m.id} className={`recent${i === 0 ? " active" : ""}`}>
                  <span className="recent-title">
                    <span className="dot" />
                    <span>{m.text}</span>
                  </span>
                  <span className="recent-meta">{i === 0 ? "Active now" : "Earlier"}</span>
                </button>
              ))
            )}
          </div>

          <div className="account">
            <div className="account-mark">{(name || "You").charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="account-name">{name || "You"}</div>
              <div className="account-sub">Personal workspace</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
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
            <Orb state={orbState} onClick={toggle} inputLevelRef={levelRef} outputLevelRef={outLevelRef} />

            <div className="caption-wrap">
              <p key={caption} className={`caption ${captionClass}`}>
                {caption}
                {waveOn && <span className="caret" />}
              </p>
            </div>

            {showSuggestions && (
              <div className="suggestions">
                <span className="suggestions-label">Try saying</span>
                <div className="suggestions-grid">
                  {SUGGESTIONS.map((s) => (
                    <div key={s.text} className="suggestion">
                      <span className="suggestion-icon">{s.icon}</span>
                      <span>{s.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(docs.length > 0 || uploading) && (
              <div className="doc-chips">
                {uploading && (
                  <span className="doc-chip pending">
                    <span className="doc-icon">📄</span>
                    {uploading}…
                  </span>
                )}
                {docs.map((d) => (
                  <span key={d.name} className="doc-chip">
                    <span className="doc-icon">📄</span>
                    {d.name}
                    <span className="doc-meta">{d.chunks} chunks</span>
                  </span>
                ))}
              </div>
            )}

            <button
              className={`doc-add${docError ? " error" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
            >
              <DocIcon />
              {uploading ? `Adding ${uploading}…` : docError || "Add a document"}
            </button>
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
            <span className="dock-hint">
              {speechSupported ? DOCK_HINT[orbState] : "Voice needs Chrome or Edge"}
              {speechSupported && orbState === "idle" && <kbd className="kbd">Space</kbd>}
            </span>
          </footer>
        </main>
      </div>

      {/* ---------- first-run name prompt ---------- */}
      {askName && (
        <div className="name-overlay">
          <form
            className="name-card"
            onSubmit={(e) => {
              e.preventDefault();
              saveName(nameInput);
            }}
          >
            <div className="brand-mark name-mark">🍓</div>
            <h2 className="name-title">Welcome to Fraise</h2>
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
              Continue
            </button>
            <button className="name-skip" type="button" onClick={() => saveName("")}>
              Skip for now
            </button>
          </form>
        </div>
      )}
      <SpeedInsights />
    </div>
  );
}
