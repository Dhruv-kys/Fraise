import { useEffect, useRef } from "react";
import { useVoiceAgent, type OrbState } from "./useVoiceAgent";
import Orb from "./Orb";
import "./App.css";

// Status pill — connection state wins, otherwise the orb's phase.
function statusPill(
  status: "connecting" | "online" | "error",
  orbState: OrbState,
): { label: string; color: string } {
  if (status === "connecting") return { label: "Connecting…", color: "#E0A23C" };
  if (status === "error") return { label: "Offline", color: "#E0566B" };
  return {
    idle: { label: "Ready", color: "#BBA0A6" },
    listening: { label: "Listening", color: "#FF7596" },
    thinking: { label: "Working", color: "#5BB47B" },
    speaking: { label: "Speaking", color: "#F23E63" },
  }[orbState];
}

const DOCK_HINT: Record<OrbState, string> = {
  idle: "Tap the orb to speak",
  listening: "Listening…",
  thinking: "Working…",
  speaking: "Speaking…",
};

export default function App() {
  const { messages, status, orbState, levelRef, speechSupported, toggle } = useVoiceAgent();

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
    caption = messages.length ? (lastAgent ?? messages[messages.length - 1]).text : "Hi — what can I help with?";
    captionClass = "idle";
  }

  const pill = statusPill(status, orbState);

  // Recent list — derived from the user's turns this session.
  const recents = [...messages].filter((m) => m.role === "user").reverse().slice(0, 8);

  return (
    <div className="stage">
      <div className="window" data-screen-label="Fraise — voice assistant">
        {/* ---------- sidebar ---------- */}
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark" />
            <div>
              <div className="brand-name">Fraise</div>
              <div className="brand-sub">Voice assistant</div>
            </div>
          </div>

          <button className="new-conv" onClick={toggle}>
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
            <div className="account-mark" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="account-name">You</div>
              <div className="account-sub">Personal workspace</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#CDA9B0">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </div>
        </aside>

        {/* ---------- main ---------- */}
        <main className="main">
          <header className="main-header">
            <div className="status-pill">
              <span
                className="dot"
                style={{ background: pill.color, boxShadow: `0 0 9px ${pill.color}` }}
              />
              <span className="label">{pill.label}</span>
            </div>
          </header>

          <section className="assistant-stage">
            <Orb state={orbState} onClick={toggle} />

            <div className="caption-wrap">
              <p className={`caption ${captionClass}`}>
                {caption}
                {waveOn && <span className="caret" />}
              </p>
            </div>
          </section>

          <footer className="dock">
            <div ref={waveRef} className={`wave${waveOn ? " on" : ""}`}>
              {Array.from({ length: 13 }).map((_, i) => (
                <span key={i} />
              ))}
            </div>
            <span className="dock-hint">
              {speechSupported ? DOCK_HINT[orbState] : "Voice needs Chrome or Edge"}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
