
import { useCallback, useEffect, useState } from "react";
import { httpBase } from "./useVoiceAgent";

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export function useHistory(sid: string, refreshKey: number) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [memories, setMemories] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!sid) return;
    const url = new URL("/history", httpBase());
    url.searchParams.set("sid", sid);
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const data = await r.json();
      setTurns(data.turns ?? []);
      setMemories(data.memories ?? []);
    } catch {
    }
  }, [sid]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return { turns, memories };
}
