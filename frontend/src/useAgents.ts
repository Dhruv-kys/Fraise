
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

  const loadHistory = useCallback(async () => {
    if (!sid) return;
    const url = new URL("/artifacts", httpBase());
    url.searchParams.set("sid", sid);
    try {
      const r = await fetch(url);
      if (r.ok) setHistory(await r.json());
    } catch {
    }
  }, [sid]);

  useEffect(() => {
    setRun(null);
    setArtifact(null);
    setOpenId(null);
    void loadHistory();

    const interval = window.setInterval(() => void loadHistory(), 5_000);
    return () => window.clearInterval(interval);
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
        if (e.status === "planning") {
          setArtifact(null);
          setRun((r) => ({
            runId: e.run_id,
            query: e.query ?? r?.query ?? "",
            status: e.status,
            format: e.format ?? r?.format ?? "doc",
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
        if (e.status === "running") {
          setArtifact(null);
          setRun((r) => {
            if (r && r.runId !== e.run_id) return r;
            return {
              runId: e.run_id,
              query: e.query ?? r?.query ?? "",
              status: e.status,
              format: e.format ?? r?.format ?? "doc",
              agents: e.agents?.length ? e.agents as AgentStatus[] : (r?.agents ?? []),
              note: e.note,
            };
          });
          return;
        }
        if (runRef.current?.runId !== e.run_id) return;
        setRun((r): Run | null => {
          if (!r || r.runId !== e.run_id) return r;
          return { ...r, status: e.status, error: e.error, note: e.note };
        });
        if (e.status === "done" && e.artifact) {
          setArtifact(e.artifact as Artifact);
          setOpenId(e.run_id);
          void loadHistory();
        }
        return;
      }

      if (e.type === "agent") {
        setRun((r) => {
          if (!r || r.runId !== e.run_id) return r;
          const next = [...r.agents];
          const i = next.findIndex((a) => a.agent === e.agent);
          const prev = i >= 0 ? next[i] : undefined;
          const merged: AgentStatus = { ...(prev ?? {}), ...e };
          delete (merged as any).type;
          const trail = prev?.thoughts ?? [];
          merged.thoughts = e.note && e.note !== trail.at(-1) ? [...trail, e.note] : trail;
          if (i >= 0) next[i] = merged;
          else next.push(merged);
          return { ...r, agents: next };
        });
      }
    };

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
