// Live view of the research agents.
//
// The voice socket carries the conversation; this carries the *work*. A tool call
// answers once, but a fan-out of agents has a story while it runs — so the backend
// publishes progress and we read it here over SSE. EventSource is deliberate: this
// is one-way, and it reconnects on its own, which a raw WebSocket wouldn't.

import { useCallback, useEffect, useRef, useState } from "react";
import { httpBase } from "./useVoiceAgent";


export type AgentPhase = "queued" | "searching" | "reading" | "thinking" | "done" | "failed";

export interface AgentStatus {
  agent: string;
  label: string;
  status: AgentPhase;
  found?: number;
  summary?: string;
  error?: string;
  elapsed?: number;
  note?: string;
  titles?: string[];
  // Every note the agent has emitted, in order — its train of thought, kept so
  // you can read back what it did rather than only catching the latest line.
  thoughts?: string[];
}

export interface Section {
  heading: string;
  bullets: string[];
}

export interface Citation {
  label: string;
  title: string;
  url: string;
}

export interface Artifact {
  title: string;
  query: string;
  format: "doc" | "slides";
  sections: Section[];
  citations: Citation[];
  agents: { agent: string; label: string; ok: boolean }[];
}

export type RunStatus = "planning" | "running" | "synthesizing" | "done" | "failed";

export interface Run {
  runId: string;
  query: string;
  status: RunStatus;
  format: "doc" | "slides";
  agents: AgentStatus[];
  error?: string;
  note?: string;
}

// One row in the history list — the artifact itself is only fetched when opened.
export interface ArtifactRef {
  id: string;
  title: string;
  format: "doc" | "slides";
  created_at: string;
}

export function useAgents(sid: string) {
  const [run, setRun] = useState<Run | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [history, setHistory] = useState<ArtifactRef[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;

  // Everything the agents ever produced for this assistant, newest first. Scoped
  // by sid like memory and documents, so each persona keeps its own research.
  const loadHistory = useCallback(async () => {
    if (!sid) return;
    const url = new URL("/artifacts", httpBase());
    url.searchParams.set("sid", sid);
    try {
      const r = await fetch(url);
      if (r.ok) setHistory(await r.json());
    } catch {
      /* history is a nicety — never break the app over it */
    }
  }, [sid]);

  useEffect(() => {
    setRun(null);
    setArtifact(null);
    setOpenId(null);
    void loadHistory();
  }, [sid, loadHistory]);

  const openArtifact = useCallback(
    async (id: string) => {
      const url = new URL(`/artifacts/${id}`, httpBase());
      url.searchParams.set("sid", sid);
      const r = await fetch(url);
      if (!r.ok) return;
      setRun(null);
      setArtifact(await r.json());
      setOpenId(id);
    },
    [sid],
  );

  useEffect(() => {
    if (!sid) return;
    const url = new URL("/agents/stream", httpBase());
    url.searchParams.set("sid", sid);
    const es = new EventSource(url);

    es.onmessage = (ev) => {
      let e: any;
      try {
        e = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (e.type === "run") {
        // "planning" opens the run with no agents yet — the planner is still
        // deciding who to send. "running" then delivers the team it chose.
        if (e.status === "planning" || e.status === "running") {
          setArtifact(null);
          setRun((r) => ({
            runId: e.run_id,
            query: e.query ?? r?.query ?? "",
            status: e.status,
            format: e.format ?? r?.format ?? "doc",
            // Dedupe defensively: colliding ids render duplicate React keys and the
            // cards break. The backend guarantees uniqueness — this makes a future
            // regression there a missing card, not a shattered panel.
            agents: e.agents?.length
              ? (e.agents as AgentStatus[]).filter(
                  (a, i, all) => all.findIndex((b) => b.agent === a.agent) === i,
                )
              : e.status === "planning"
                ? []
                : (r?.agents ?? []),
            note: e.note,
          }));
          return;
        }
        setRun((r) => (r ? { ...r, status: e.status, error: e.error, note: e.note } : r));
        if (e.status === "done" && e.artifact) {
          setArtifact(e.artifact as Artifact);
          setOpenId(e.run_id);
          void loadHistory(); // the new answer joins the list immediately
        }
        return;
      }

      if (e.type === "agent") {
        // Merge by agent name — events arrive per phase transition, and an agent
        // we never saw queued (a source added mid-flight) should still appear.
        setRun((r) => {
          if (!r) return r;
          const next = [...r.agents];
          const i = next.findIndex((a) => a.agent === e.agent);
          const prev = i >= 0 ? next[i] : undefined;
          const merged: AgentStatus = { ...(prev ?? {}), ...e };
          delete (merged as any).type;
          // Append rather than overwrite: the notes accumulate into a trail.
          const trail = prev?.thoughts ?? [];
          merged.thoughts = e.note && e.note !== trail.at(-1) ? [...trail, e.note] : trail;
          if (i >= 0) next[i] = merged;
          else next.push(merged);
          return { ...r, agents: next };
        });
      }
    };

    // EventSource retries on its own; don't tear the run down on a blip.
    es.onerror = () => {};

    return () => es.close();
  }, [sid, loadHistory]);

  const dismiss = useCallback(() => {
    setRun(null);
    setArtifact(null);
    setOpenId(null);
  }, []);

  return { run, artifact, history, openId, openArtifact, dismiss };
}
