
import { useEffect, useState } from "react";
import type { AgentStatus, Artifact, Run } from "./useAgents";

const PHASE_LABEL: Record<AgentStatus["status"], string> = {
  queued: "Queued",
  searching: "Searching",
  reading: "Reading",
  thinking: "Thinking",
  done: "Done",
  failed: "Failed",
};

function bullets(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean);
}

function AgentCard({ a }: { a: AgentStatus }) {
  const working = a.status === "searching" || a.status === "reading" || a.status === "thinking";
  const [open, setOpen] = useState(false);
  const findings = a.summary ? bullets(a.summary) : [];

  return (
    <div className={`agent-card ${a.status}`}>
      <div className="agent-head">
        <span className="agent-name">
          <span className={`agent-dot ${a.status}`} />
          {a.label}
        </span>
        <span className="agent-phase">
          {a.status === "done" && a.found != null ? `${a.found} results` : PHASE_LABEL[a.status]}
        </span>
      </div>

      <div className={`agent-bar${working ? " on" : ""}`}>
        <span />
      </div>

      {a.note && <p className={`agent-note${working ? " live" : ""}`}>{a.note}</p>}

      {a.titles && a.titles.length > 0 && a.status !== "done" && (
        <ul className="agent-titles">
          {a.titles.slice(0, 3).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}

      {a.status === "failed" && <div className="agent-error">{a.error || "No results"}</div>}

      {a.status === "done" && findings.length > 0 && (
        <>
          <button className="agent-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "What it found"}
            <span className={`chev${open ? " up" : ""}`}>›</span>
          </button>
          {open && (
            <ul className="agent-findings">
              {findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {open && a.thoughts && a.thoughts.length > 1 && (
        <ol className="agent-trail">
          {a.thoughts.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AgentPanel({ run }: { run: Run }) {
  const done = run.agents.filter((a) => a.status === "done" || a.status === "failed").length;
  const label =
    run.status === "planning"
      ? "Choosing the team…"
      : run.status === "synthesizing"
        ? "Merging what the agents found…"
        : run.status === "failed"
          ? run.error || "The run failed"
          : `${done} of ${run.agents.length} agents finished`;

  return (
    <section className="agent-panel">
      <div className="agent-panel-head">
        <span className="board-label">Agents at work</span>
        <span className="agent-progress">{label}</span>
      </div>
      <p className="agent-query">{run.query}</p>

      {run.status === "planning" && run.agents.length === 0 ? (
        <div className="agent-planning">
          <span className="agent-dot searching" />
          {run.note || "Working out who should go looking"}
        </div>
      ) : (
        <div className="agent-grid">
          {run.agents.map((a) => (
            <AgentCard key={a.agent} a={a} />
          ))}
        </div>
      )}
    </section>
  );
}

export function ArtifactView({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const slides = artifact.format === "slides";
  const [i, setI] = useState(0);
  const total = artifact.sections.length;

  useEffect(() => setI(0), [artifact]);

  useEffect(() => {
    if (!slides) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, total - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides, total]);

  const section = artifact.sections[i];

  return (
    <section className="artifact">
      <header className="artifact-head">
        <div>
          <span className="board-label">{slides ? "Deck" : "Document"}</span>
          <h2 className="artifact-title">{artifact.title}</h2>
        </div>
        <button className="artifact-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {slides && section ? (
        <>
          <div className="slide">
            <span className="slide-num">
              {i + 1} / {total}
            </span>
            <h3 className="slide-heading">{section.heading}</h3>
            <ul className="slide-bullets">
              {section.bullets.map((b, k) => (
                <li key={k}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="slide-nav">
            <button onClick={() => setI((n) => Math.max(n - 1, 0))} disabled={i === 0}>
              ‹ Back
            </button>
            <div className="slide-dots">
              {artifact.sections.map((_, k) => (
                <button
                  key={k}
                  className={`dot${k === i ? " on" : ""}`}
                  onClick={() => setI(k)}
                  aria-label={`Slide ${k + 1}`}
                />
              ))}
            </div>
            <button onClick={() => setI((n) => Math.min(n + 1, total - 1))} disabled={i >= total - 1}>
              Next ›
            </button>
          </div>
        </>
      ) : (
        <div className="doc">
          {artifact.sections.map((s, k) => (
            <div key={k} className="doc-section">
              <h3 className="doc-heading">{s.heading}</h3>
              <ul className="doc-bullets">
                {s.bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {artifact.citations.length > 0 && (
        <footer className="artifact-sources">
          <span className="board-label">Sources</span>
          <div className="source-list">
            {artifact.citations.map((c, k) => (
              <a key={k} href={c.url} target="_blank" rel="noreferrer noopener" className="source">
                <span className="source-tag">{c.label}</span>
                <span className="source-title">{c.title || c.url}</span>
              </a>
            ))}
          </div>
        </footer>
      )}
    </section>
  );
}
