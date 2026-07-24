import { useCallback, useEffect, useRef, useState } from "react";
import { useDictation, type DictationStatus } from "./useDictation";

const STATUS_LABEL: Record<DictationStatus, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  loading: "Warming up…",
  listening: "Listening",
  paused: "Paused",
  finishing: "Transcribing…",
  done: "Done",
  error: "Error",
};

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function Dictation({
  sid,
  onClose,
  onPlanDay,
}: {
  sid: string;
  onClose: () => void;
  onPlanDay: (text: string) => void;
}) {
  const { status, segments, note, error, elapsed, levelRef, start, pause, resume, stop, cancel } =
    useDictation(sid);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => void start(), 60);
    return () => window.clearTimeout(t);
  }, [start]);

  useEffect(() => {
    if (status === "done") setDraft(segments.join(" "));
  }, [status, segments]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [segments]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = dotRef.current;
      if (el) el.style.setProperty("--mic-level", levelRef.current.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);

  const close = useCallback(() => {
    cancel();
    onClose();
  }, [cancel, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const recording = status === "listening" || status === "paused";
  const busy = status === "connecting" || status === "loading" || status === "finishing";
  const liveText = segments.join(" ");
  const finalText = draft.trim();
  const words = finalText ? finalText.split(/\s+/).length : liveText ? liveText.split(/\s+/).length : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(finalText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="name-overlay" onClick={close}>
      <div className="name-card dict-card" onClick={(e) => e.stopPropagation()}>
        <div className="dict-head">
          <h2 className="name-title dict-title">Dictation</h2>
          <span className={`dict-status ${status}`}>
            {(status === "listening" || status === "paused") && (
              <span ref={dotRef} className={`dict-dot${status === "paused" ? " paused" : ""}`} />
            )}
            {STATUS_LABEL[status]}
            {recording && <span className="dict-timer">{fmtTime(elapsed)}</span>}
          </span>
        </div>

        <p className="name-sub dict-sub">
          {status === "done"
            ? "Read it over — you can edit before copying."
            : error && status !== "error"
              ? error
              : note || "Speak naturally; pauses become punctuation breaks. Everything is transcribed on this machine."}
        </p>

        {status === "error" ? (
          <div className="dict-error">{error || "Something went wrong."}</div>
        ) : status === "done" ? (
          <textarea
            className="editor-textarea dict-text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Nothing was heard."
          />
        ) : (
          <div ref={feedRef} className="dict-feed" aria-live="polite">
            {liveText ? (
              <p>
                {liveText}
                {recording && <span className="caret" />}
              </p>
            ) : (
              <p className="dict-placeholder">
                {busy ? "One moment…" : "Start talking — your words will appear here."}
              </p>
            )}
          </div>
        )}

        <div className="dict-actions">
          {recording && (
            <>
              <button
                className="dict-btn"
                onClick={status === "paused" ? resume : pause}
              >
                {status === "paused" ? "Resume" : "Pause"}
              </button>
              <button className="dict-btn primary" onClick={stop} disabled={!liveText && status !== "paused"}>
                Finish
              </button>
            </>
          )}
          {status === "finishing" && <button className="dict-btn primary" disabled>Transcribing…</button>}
          {status === "done" && (
            <>
              <button className="dict-btn primary" onClick={copy} disabled={!finalText}>
                {copied ? "Copied ✓" : "Copy text"}
              </button>
              <button
                className="dict-btn"
                onClick={() => finalText && onPlanDay(finalText)}
                disabled={!finalText}
                title="Split this into tasks and let the agents handle it"
              >
                Turn into tasks
              </button>
              <button className="dict-btn" onClick={() => void start()}>
                Dictate again
              </button>
            </>
          )}
          {status === "error" && (
            <button className="dict-btn primary" onClick={() => void start()}>
              Try again
            </button>
          )}
          <span className="dict-count">{words ? `${words} word${words === 1 ? "" : "s"}` : ""}</span>
          <button className="dict-btn ghost" onClick={close}>
            {status === "done" ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
