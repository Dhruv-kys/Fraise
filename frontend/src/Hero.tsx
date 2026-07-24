import { useEffect, useRef, useState } from "react";
import Orb from "./Orb";
import { FraiseMark, GitHubMark, SunIcon, MoonIcon } from "./icons";
import { QUOTE } from "./Board";
import type { Day, DayTask, Lane } from "./useDay";
import type { OrbState } from "./useVoiceAgent";
import type { Theme } from "./App";
import "./Hero.css";

function Headline() {
  return (
    <h1 className="hx-head">
      Say your whole day.
      <br />
      <em>It&rsquo;s handled.</em>
    </h1>
  );
}

const ANNOTATIONS: { side: "l" | "r"; top: string; lines: string[] }[] = [
  { side: "r", top: "10%", lines: ["SPLITS YOUR DAY", "INTO TASKS"] },
  { side: "l", top: "46%", lines: ["ROUTES EACH TO", "ITS OWN AGENT"] },
  { side: "r", top: "82%", lines: ["REMEMBERS", "WHAT MATTERS"] },
];

function HeroOrb({
  orbState,
  onOrbClick,
  inputLevelRef,
  outputLevelRef,
}: {
  orbState: OrbState;
  onOrbClick: () => void;
  inputLevelRef?: React.RefObject<number>;
  outputLevelRef?: React.RefObject<number>;
}) {
  return (
    <div className="hx-reveal">
      <div className="hx-orb-slot">
        <Orb state={orbState} onClick={onOrbClick} inputLevelRef={inputLevelRef} outputLevelRef={outputLevelRef} />

        <div className="hx-annos" aria-hidden="true">
          {ANNOTATIONS.map((a, i) => (
            <div key={i} className={`hx-anno hx-anno-${a.side}`} style={{ top: a.top }}>
              <span className="hx-anno-line" />
              <span className="hx-anno-text">
                {a.lines.map((l, k) => (
                  <span key={k}>{l}</span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const LANE_META: Record<Lane, { label: string; glyph: string }> = {
  research: { label: "Research", glyph: "◍" },
  remember: { label: "Memory", glyph: "❖" },
  reminder: { label: "Reminder", glyph: "◔" },
  calendar: { label: "Calendar", glyph: "▤" },
  email: { label: "Email", glyph: "✉" },
  note: { label: "Note", glyph: "▦" },
  answer: { label: "Answer", glyph: "✦" },
};

function TaskCard({ t }: { t: DayTask }) {
  const meta = LANE_META[t.lane] ?? LANE_META.note;
  const working = t.status === "running" || t.status === "queued";
  return (
    <div className={`hx-task ${t.status}`}>
      <div className="hx-task-head">
        <span className="hx-lane">
          <span className="hx-lane-glyph">{meta.glyph}</span>
          {meta.label}
        </span>
        <span className={`hx-task-status ${t.status}`}>
          {t.status === "queued"
            ? "Queued"
            : t.status === "running"
              ? "Working"
              : t.status === "proposed"
                ? "Ready to review"
                : t.status === "failed"
                  ? "Failed"
                  : "Done"}
        </span>
      </div>
      <p className="hx-task-title">{t.title}</p>
      <div className={`hx-task-bar${working ? " on" : ""}`}>
        <span />
      </div>
      {t.status !== "done" && t.status !== "proposed" && t.note && <p className="hx-task-note">{t.note}</p>}
      {t.result && (t.status === "done" || t.status === "proposed") && (
        <p className="hx-task-result">{t.result}</p>
      )}
      {t.error && <p className="hx-task-error">{t.error}</p>}
      {t.sources && t.sources.length > 0 && (
        <div className="hx-task-sources">
          {t.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer noopener">
              {s.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function DayBoard({ day, onDismiss }: { day: Day; onDismiss: () => void }) {
  const done = day.tasks.filter((t) => t.status === "done" || t.status === "proposed" || t.status === "failed").length;
  const total = day.tasks.length;
  const label =
    day.status === "segmenting"
      ? "Splitting your day into tasks…"
      : day.status === "failed"
        ? day.error || "That didn't go through."
        : day.status === "done"
          ? `Your day — ${done} of ${total} handled`
          : `Handling your day — ${done} of ${total}`;

  return (
    <section className="hx-board">
      <div className="hx-board-head">
        <span className="hx-eyebrow">Your day</span>
        <span className="hx-board-progress">{label}</span>
        <button className="hx-board-close" onClick={onDismiss} aria-label="Back to the start">
          ✕
        </button>
      </div>

      {day.status === "segmenting" && day.tasks.length === 0 ? (
        <div className="hx-board-thinking">
          <span className="hx-pulse" />
          {day.note || "Reading your day…"}
        </div>
      ) : (
        <div className="hx-board-grid">
          {day.tasks.map((t) => (
            <TaskCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

function Quote() {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section className={`hx-quote${inView ? " in" : ""}`} ref={ref}>
      <span className="hx-quote-mark" aria-hidden="true">&ldquo;</span>
      <p className="hx-quote-text">{QUOTE}</p>
    </section>
  );
}

export interface HeroProps {
  orbState: OrbState;
  onOrbClick: () => void;
  inputLevelRef?: React.RefObject<number>;
  outputLevelRef?: React.RefObject<number>;
  day: Day | null;
  onDismissDay: () => void;
  onEnterApp: () => void;
  onDictate: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function Hero({
  orbState,
  onOrbClick,
  inputLevelRef,
  outputLevelRef,
  day,
  onDismissDay,
  onEnterApp,
  onDictate,
  theme,
  onToggleTheme,
}: HeroProps) {
  const active = !!day && day.status !== "failed";

  return (
    <div className="hx-page">
      <div className="hx" data-active={active}>

        <nav className="hx-nav">
          <div className="hx-brand">
            <span className="hx-brand-mark">
              <FraiseMark />
            </span>
            <span className="hx-brand-name">Fraise</span>
            <span className="hx-brand-slash">/voice</span>
          </div>
          <div className="hx-nav-right">
            <button className="hx-nav-link" onClick={onDictate} title="Speak long messages or essays — transcribed on-device">
              Dictate
            </button>
            <button className="hx-nav-link" onClick={onEnterApp}>
              Workspace
            </button>
            <a className="hx-nav-link" href="https://github.com/Dhruv-kys/Fraise" target="_blank" rel="noreferrer noopener">
              <GitHubMark />
              Source
            </a>
            <button
              className="hx-theme-toggle"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-pressed={theme === "dark"}
              onClick={onToggleTheme}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            <button className="hx-cta" onClick={onOrbClick}>
              Talk to Fraise
            </button>
          </div>
        </nav>

        <main className={`hx-stage${active ? " compact" : ""}`}>
          <div className="hx-headline">
            <span className="hx-eyebrow">Dictate once — agents do the rest</span>
            <Headline />
            <p className="hx-annos-inline" aria-hidden="true">
              {ANNOTATIONS.map((a) => a.lines.join(" ")).join("   ·   ")}
            </p>
          </div>

          {active ? (
            <DayBoard day={day!} onDismiss={onDismissDay} />
          ) : (
            <HeroOrb
              orbState={orbState}
              onOrbClick={onOrbClick}
              inputLevelRef={inputLevelRef}
              outputLevelRef={outputLevelRef}
            />
          )}
        </main>
      </div>
      <Quote />
    </div>
  );
}
