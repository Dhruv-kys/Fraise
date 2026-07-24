
import { useCallback, useEffect, useRef, useState } from "react";
import { httpBase } from "./useVoiceAgent";

export type Lane =
  | "research"
  | "remember"
  | "reminder"
  | "calendar"
  | "email"
  | "note"
  | "answer";

export type TaskStatus = "queued" | "running" | "done" | "proposed" | "failed";

export interface DaySource {
  title: string;
  url: string;
}

export interface DayTask {
  id: string;
  title: string;
  lane: Lane;
  detail: string;
  status: TaskStatus;
  note?: string;
  result?: string;
  sources?: DaySource[];
  error?: string;
  elapsed?: number;
}

export type DayStatus = "segmenting" | "running" | "done" | "failed";

export interface Day {
  dayId: string;
  status: DayStatus;
  text?: string;
  tasks: DayTask[];
  note?: string;
  spoken?: string;
  error?: string;
}

export function useDay(sid: string) {
  const [day, setDay] = useState<Day | null>(null);
  const dayRef = useRef<Day | null>(null);
  dayRef.current = day;

  const process = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      setDay({ dayId: "pending", status: "segmenting", text: trimmed, tasks: [], note: "Splitting your day into tasks…" });
      try {
        const url = new URL("/dictate", httpBase());
        url.searchParams.set("sid", sid);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed, tz_offset_min: new Date().getTimezoneOffset() }),
        });
        if (!res.ok) throw new Error(`dictate failed (${res.status})`);
        const { day_id } = await res.json();
        setDay((d) => (d ? { ...d, dayId: day_id } : d));
        return true;
      } catch (e) {
        setDay({
          dayId: "error",
          status: "failed",
          tasks: [],
          error: e instanceof Error ? e.message : "Couldn't reach the backend.",
        });
        return false;
      }
    },
    [sid],
  );

  const dismiss = useCallback(() => setDay(null), []);

  const open = useCallback(
    async (id: string): Promise<void> => {
      try {
        const url = new URL(`/days/${id}`, httpBase());
        url.searchParams.set("sid", sid);
        const res = await fetch(url);
        if (!res.ok) return;
        const d = await res.json();
        setDay({
          dayId: d.id,
          status: d.status as DayStatus,
          text: d.text ?? undefined,
          tasks: d.tasks ?? [],
          spoken: d.spoken ?? undefined,
          error: d.error ?? undefined,
        });
      } catch {}
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

      if (e.type === "day") {
        setDay((d) => {
          const same = d && (d.dayId === e.day_id || d.dayId === "pending");
          const base: Day = same && d
            ? { ...d, dayId: e.day_id }
            : { dayId: e.day_id, status: "segmenting", tasks: [] };
          if (e.status === "running") {
            return { ...base, status: "running", text: e.text ?? base.text, tasks: e.tasks ?? base.tasks };
          }
          if (e.status === "segmenting") {
            return { ...base, status: "segmenting", note: e.note };
          }
          if (e.status === "done") {
            return { ...base, status: "done", spoken: e.spoken };
          }
          if (e.status === "failed") {
            return { ...base, status: "failed", error: e.error };
          }
          return base;
        });
        return;
      }

      if (e.type === "day_task") {
        setDay((d) => {
          if (!d || (d.dayId !== e.day_id && d.dayId !== "pending")) return d;
          const tasks = d.tasks.map((t) =>
            t.id === e.id
              ? {
                  ...t,
                  status: e.status,
                  note: e.note ?? t.note,
                  result: e.result ?? t.result,
                  sources: e.sources ?? t.sources,
                  error: e.error ?? t.error,
                  elapsed: e.elapsed ?? t.elapsed,
                }
              : t,
          );
          return { ...d, tasks };
        });
      }
    };

    es.onerror = () => {};
    return () => es.close();
  }, [sid]);

  return { day, process, open, dismiss };
}

export interface DaySummary {
  id: string;
  snippet: string;
  status: string;
  task_count: number;
  created_at: string;
}

export function useDayHistory(sid: string, refreshKey: string | undefined) {
  const [days, setDays] = useState<DaySummary[]>([]);

  useEffect(() => {
    if (!sid) return;
    let stale = false;
    const url = new URL("/days", httpBase());
    url.searchParams.set("sid", sid);
    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        if (!stale) setDays(list);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [sid, refreshKey]);

  return days;
}
