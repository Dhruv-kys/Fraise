// The front door — Obsidian & Signal Blue.
//
// The orb is the centerpiece — the same live identity element used once you're
// in the workspace, not a stock photo standing in for it. Scrolling past the
// first screen reveals a showcase section (see Showcase) — dense, side-by-side
// imagery that scales inward into place as it enters view.

import { useEffect, useRef, useState } from "react";
import Orb from "./Orb";
import { FraiseMark, GitHubMark, SunIcon, MoonIcon } from "./icons";
import { QUOTE } from "./Board";
import type { Day, DayTask, Lane } from "./useDay";
import type { OrbState } from "./useVoiceAgent";
import type { Theme } from "./App";
import "./Hero.css";

// Scramble-decode: the word cycles through random glyphs and resolves left to
// right, then re-runs whenever `playKey` changes. Punctuation and spaces are
// held so only the letters churn — the "living text" the reference leans on.
const SCRAMBLE_GLYPHS = "ABCDEFGHKMNPRSTVXZ0123456789$#%&?/\\<>=+*";
const isLetter = (c: string) => c >= "a" && c <= "z" || c >= "A" && c <= "Z" || c >= "0" && c <= "9";

function useScramble(text: string, playKey: number, speed = 1.5, settle = 9): string {
  const [out, setOut] = useState(text);
  const reduce = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  ).current;

  useEffect(() => {
    if (reduce) {
      setOut(text);
      return;
    }
    let frame = 0;
    let timer = 0;
    const tick = () => {
      let done = true;
      let s = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (!isLetter(ch)) {
          s += ch;
          continue;
        }
        const startAt = i * speed;
        if (frame >= startAt + settle) {
          s += ch;
        } else {
          s += SCRAMBLE_GLYPHS[(Math.random() * SCRAMBLE_GLYPHS.length) | 0];
          done = false;
        }
      }
      setOut(s);
      frame++;
      if (!done) timer = window.setTimeout(tick, 34);
      else setOut(text);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [text, playKey, speed, settle, reduce]);

  return out;
}

function Scramble({ text, playKey, speed, settle }: { text: string; playKey: number; speed?: number; settle?: number }) {
  const out = useScramble(text, playKey, speed, settle);
  return <span aria-label={text}>{out}</span>;
}

// The headline: scrambles in on mount, and the italic word re-decodes on a slow
// loop so the line never sits perfectly still.
function Headline() {
  const [loop, setLoop] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setLoop((n) => n + 1), 5200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <h1 className="hx-head">
      <Scramble text="Say your whole day." playKey={0} speed={1.3} settle={8} />
      <br />
      <em>
        It&rsquo;s <Scramble text="handled." playKey={loop} speed={2.2} settle={12} />
      </em>
    </h1>
  );
}

// ---- the orb, at the center of the front door ----
//
// Three technical callouts read off the orb itself — each line starts flush
// against the orb's glow and runs outward, so they visibly belong to the one
// concrete thing on screen instead of floating in empty space.

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

// ---- the day board: tasks fanning out to their lane agents ----

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

// ---- the showcase: dense, side-by-side imagery below the fold ----
//
// Fires once, the first time the section is a quarter into view, then leaves
// it alone — no re-triggering on scroll-back, no per-frame observer cost.
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

// ---- the quote: the product's thesis, said once, plainly ----
function Quote() {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section className={`hx-quote${inView ? " in" : ""}`} ref={ref}>
      <span className="hx-quote-mark" aria-hidden="true">&ldquo;</span>
      <p className="hx-quote-text">{QUOTE}</p>
    </section>
  );
}

interface ShowcaseItem {
  src: string;
  alt: string;
  label: string;
}

const SHOWCASE_ITEMS: ShowcaseItem[] = [
  { src: "/mic-accent.jpg", alt: "A studio microphone", label: "Every word, captured" },
  { src: "/vinyl-disc.jpg", alt: "A chrome vinyl record", label: "Pressed like vinyl" },
];

function Showcase() {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section className={`hx-showcase${inView ? " in" : ""}`} ref={ref}>
      <span className="hx-eyebrow">Built like a record</span>
      <h2 className="hx-showcase-title">Every detail, mastered.</h2>
      <div className="hx-showcase-track">
        {SHOWCASE_ITEMS.map((item, i) => (
          <figure key={i} className="hx-showcase-card" style={{ transitionDelay: `${i * 90}ms` }}>
            <img src={item.src} alt={item.alt} />
            <figcaption>{item.label}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ---- the hero shell ----

export interface HeroProps {
  orbState: OrbState;
  onOrbClick: () => void;
  inputLevelRef?: React.RefObject<number>;
  outputLevelRef?: React.RefObject<number>;
  day: Day | null;
  onDismissDay: () => void;
  onEnterApp: () => void;
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
            {/* The floating side annotations need room they don't have on a
                phone screen (.hx-annos is hidden there) — this inline summary
                carries the same three points instead of just dropping them. */}
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
      <Showcase />
    </div>
  );
}
