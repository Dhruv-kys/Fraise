import { useState } from "react";
import type { Day, DayTask, Lane } from "./useDay";

const LANE_META: Record<Lane, { label: string; glyph: string }> = {
  research: { label: "Research", glyph: "◍" },
  remember: { label: "Memory", glyph: "❖" },
  reminder: { label: "Reminder", glyph: "◔" },
  calendar: { label: "Calendar", glyph: "▤" },
  email: { label: "Email", glyph: "✉" },
  note: { label: "Note", glyph: "▦" },
  answer: { label: "Answer", glyph: "✦" },
};

const STATUS_LABEL: Record<DayTask["status"], string> = {
  queued: "Queued",
  running: "Working",
  done: "Done",
  proposed: "Ready to review",
  failed: "Failed",
};

function TaskRow({ t }: { t: DayTask }) {
  const meta = LANE_META[t.lane] ?? LANE_META.note;
  const working = t.status === "running" || t.status === "queued";
  return (
    <div className={`dv-task ${t.status}`}>
      <div className="dv-task-head">
        <span className="dv-lane">
          <span className="dv-lane-glyph">{meta.glyph}</span>
          {meta.label}
        </span>
        <span className={`dv-status ${t.status}`}>
          {STATUS_LABEL[t.status]}
          {t.elapsed != null && ` · ${t.elapsed}s`}
        </span>
      </div>
      <p className="dv-task-title">{t.title}</p>
      {t.detail && t.detail !== t.title && <p className="dv-task-detail">{t.detail}</p>}
      {working && t.note && <p className="dv-task-note">{t.note}</p>}
      {t.result && !working && <p className="dv-task-result">{t.result}</p>}
      {t.error && <p className="dv-task-error">{t.error}</p>}
      {t.sources && t.sources.length > 0 && (
        <div className="dv-task-sources">
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

export default function DayView({ day, onClose }: { day: Day; onClose: () => void }) {
  const [showText, setShowText] = useState(false);
  const done = day.tasks.filter((t) => ["done", "proposed", "failed"].includes(t.status)).length;
  const total = day.tasks.length;
  const label =
    day.status === "segmenting"
      ? day.note || "Splitting your day into tasks…"
      : day.status === "failed"
        ? day.error || "That didn't go through."
        : day.status === "done"
          ? `${done} of ${total} handled`
          : `Working — ${done} of ${total} handled`;

  return (
    <section className="dv">
      <div className="dv-head">
        <span className="dv-eyebrow">Your day</span>
        <span className="dv-progress">{label}</span>
        {day.text && (
          <button className="dv-toggle" onClick={() => setShowText((s) => !s)}>
            {showText ? "Hide dictation" : "Show dictation"}
          </button>
        )}
        <button className="dv-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {showText && day.text && <p className="dv-text">{day.text}</p>}

      {day.status === "segmenting" && day.tasks.length === 0 ? (
        <div className="dv-thinking">{day.note || "Reading your day…"}</div>
      ) : (
        <div className="dv-list">
          {day.tasks.map((t) => (
            <TaskRow key={t.id} t={t} />
          ))}
        </div>
      )}

      {day.spoken && day.status === "done" && <p className="dv-spoken">{day.spoken}</p>}
    </section>
  );
}
