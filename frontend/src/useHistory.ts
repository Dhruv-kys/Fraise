// Past conversation + remembered facts, read back from the server.
//
// The turns were always being written (the voice bridge logs every one), but the
// browser only ever knew about the current tab's messages — so a reload looked
// like amnesia even though nothing had been lost. This reads them back, keyed on
// the same session id that scopes memory, documents, and research. That shared
// key is the whole point: one id, one connected mind.

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
      /* history is a nicety — never break the app over it */
    }
  }, [sid]);

  // Reload when the persona changes, and after each turn lands so the sidebar
  // keeps up with the conversation instead of only being right on page load.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return { turns, memories, reload: load };
}
