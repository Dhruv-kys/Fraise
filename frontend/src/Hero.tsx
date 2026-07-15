// The front door — Obsidian & Signal Blue.
//
// A classical figure holds the orb aloft where a vinyl once was; by default it's
// rendered in ASCII and resolves into the real photograph on hover (the Razorpay
// reveal). Below it, a dictation composer: speak your whole day in one breath and
// it's split into tasks, each fanned out to its own lane agent (see useDay).

import { useCallback, useEffect, useRef, useState } from "react";
import Orb from "./Orb";
import { FraiseMark, GitHubMark } from "./icons";
import { HERO_ASCII, HERO_RAMP, HERO_ASPECT, HERO_ORB_X, HERO_ORB_Y, HERO_ORB_W } from "./heroAscii";
import type { Day, DayTask, Lane } from "./useDay";
import type { OrbState } from "./useVoiceAgent";
import "./Hero.css";

const SpeechRecognition: any =
  (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
  null;

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

// Live dictation via the Web Speech API — the right tool for a long monologue you
// then edit, and it stays clear of the conversational Deepgram loop the orb uses.
function useDictation(onFinal: (text: string) => void) {
  const [dictating, setDictating] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<any>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setDictating(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinalRef.current(r[0].transcript.trim() + " ");
        else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onend = () => {
      // Chrome ends the session after a pause; if the user is still dictating,
      // restart it so a long, thoughtful day doesn't get cut off mid-sentence.
      if (recRef.current === rec) {
        try {
          rec.start();
        } catch {
          setDictating(false);
        }
      }
    };
    rec.onerror = () => {};
    recRef.current = rec;
    rec.start();
    setDictating(true);
  }, []);

  const toggle = useCallback(() => (dictating ? stop() : start()), [dictating, start, stop]);
  useEffect(() => () => recRef.current?.stop(), []);

  return { dictating, interim, toggle, stop, supported: !!SpeechRecognition };
}

// The ASCII field, alive. Background cells are spaces (fixed); body cells hold a
// glyph whose brightness we keep by only ever re-rolling within a few steps of
// the original ramp index — so the figure stays legible while the characters
// keep churning, the way the reference's "numbers" never sit still.
function AsciiField() {
  const reduce = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  ).current;
  const [grid, setGrid] = useState(HERO_ASCII);

  useEffect(() => {
    if (reduce) return;
    const lines = HERO_ASCII.split("\n").map((l) => l.split(""));
    const cells: { r: number; c: number; base: number }[] = [];
    for (let r = 0; r < lines.length; r++) {
      for (let c = 0; c < lines[r].length; c++) {
        const ch = lines[r][c];
        if (ch !== " ") {
          const idx = HERO_RAMP.indexOf(ch);
          cells.push({ r, c, base: idx < 1 ? 1 : idx });
        }
      }
    }
    const max = HERO_RAMP.length - 1;
    const perTick = Math.max(1, Math.floor(cells.length * 0.11));
    let timer = 0;
    const tick = () => {
      for (let i = 0; i < perTick; i++) {
        const cell = cells[(Math.random() * cells.length) | 0];
        let idx = cell.base + (((Math.random() * 5) | 0) - 2);
        if (idx < 1) idx = 1;
        else if (idx > max) idx = max;
        lines[cell.r][cell.c] = HERO_RAMP[idx];
      }
      setGrid(lines.map((l) => l.join("")).join("\n"));
      timer = window.setTimeout(tick, 70);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [reduce]);

  return (
    <pre className="hx-ascii" aria-hidden="true">
      {grid}
    </pre>
  );
}

// ---- the ASCII figure that resolves to a photo, orb held where the vinyl was ----

const ANNOTATIONS: { side: "l" | "r"; top: string; tick: string; lines: string[] }[] = [
  { side: "r", top: "20%", tick: "x01", lines: ["SPLITS YOUR DAY", "INTO TASKS"] },
  { side: "l", top: "46%", tick: "x02", lines: ["ROUTES EACH TO", "ITS OWN AGENT"] },
  { side: "r", top: "72%", tick: "x03", lines: ["REMEMBERS", "WHAT MATTERS"] },
];

function RevealFigure({
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
    <figure className="hx-reveal" style={{ aspectRatio: String(HERO_ASPECT) }}>
      <img className="hx-photo" src="/hero-atlas-cut.png" alt="A figure holding the orb aloft" loading="eager" />
      <AsciiField />
      <div className="hx-scanline" aria-hidden="true" />

      <div
        className="hx-orb-slot"
        style={{ left: `${HERO_ORB_X}%`, top: `${HERO_ORB_Y}%`, width: `${HERO_ORB_W}%` }}
      >
        <Orb state={orbState} onClick={onOrbClick} inputLevelRef={inputLevelRef} outputLevelRef={outputLevelRef} />
      </div>

      <div className="hx-annos" aria-hidden="true">
        {ANNOTATIONS.map((a, i) => (
          <div key={i} className={`hx-anno hx-anno-${a.side}`} style={{ top: a.top }}>
            <span className="hx-anno-tick">{a.tick}</span>
            <span className="hx-anno-line" />
            <span className="hx-anno-text">
              {a.lines.map((l, k) => (
                <span key={k}>{l}</span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </figure>
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

// ---- the composer ----

const PLACEHOLDER =
  "Email Sarah the Q3 deck, book a dentist Tuesday afternoon, find me the best noise-cancelling headphones under 300, remind me to call mom, and remember I prefer window seats…";

function Composer({
  onProcess,
  busy,
}: {
  onProcess: (text: string) => void;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { dictating, interim, toggle, stop, supported } = useDictation((chunk) =>
    setText((t) => (t ? t.replace(/\s*$/, " ") : "") + chunk),
  );

  const submit = () => {
    if (!text.trim() || busy) return;
    stop();
    onProcess(text.trim());
    setText("");
  };

  useEffect(() => {
    const el = areaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [text, interim]);

  return (
    <div className={`hx-composer${dictating ? " live" : ""}`}>
      <button
        className={`hx-mic${dictating ? " on" : ""}`}
        onClick={toggle}
        disabled={!supported}
        title={supported ? (dictating ? "Stop dictating" : "Dictate your day") : "Dictation needs Chrome or Edge"}
        aria-label="Dictate"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
        </svg>
        {dictating && (
          <span className="hx-mic-wave" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} />
            ))}
          </span>
        )}
      </button>

      <div className="hx-composer-field">
        <textarea
          ref={areaRef}
          className="hx-textarea"
          value={text + (interim ? (text ? " " : "") + interim : "")}
          placeholder={PLACEHOLDER}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {dictating && <span className="hx-composer-hint">Listening — speak your whole day, then hit process</span>}
      </div>

      <button className="hx-process" onClick={submit} disabled={!text.trim() || busy}>
        {busy ? "Working…" : "Process my day"}
        <span className="hx-process-arrow">→</span>
      </button>
    </div>
  );
}

// ---- the hero shell ----

export interface HeroProps {
  orbState: OrbState;
  onOrbClick: () => void;
  inputLevelRef?: React.RefObject<number>;
  outputLevelRef?: React.RefObject<number>;
  day: Day | null;
  onProcess: (text: string) => void;
  onDismissDay: () => void;
  onEnterApp: () => void;
}

export default function Hero({
  orbState,
  onOrbClick,
  inputLevelRef,
  outputLevelRef,
  day,
  onProcess,
  onDismissDay,
  onEnterApp,
}: HeroProps) {
  const active = !!day && day.status !== "failed";

  return (
    <div className="hx" data-active={active}>
      <div className="hx-grid" aria-hidden="true" />

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
          <button className="hx-cta" onClick={onOrbClick}>
            Talk to Fraise
          </button>
        </div>
      </nav>

      <main className={`hx-stage${active ? " compact" : ""}`}>
        <div className="hx-headline">
          <span className="hx-eyebrow">Dictate once — agents do the rest</span>
          <Headline />
        </div>

        {active ? (
          <DayBoard day={day!} onDismiss={onDismissDay} />
        ) : (
          <RevealFigure
            orbState={orbState}
            onOrbClick={onOrbClick}
            inputLevelRef={inputLevelRef}
            outputLevelRef={outputLevelRef}
          />
        )}

        <Composer onProcess={onProcess} busy={active && day!.status !== "done"} />
      </main>
    </div>
  );
}
