// Phase 11 — Profiles & personas.
//
// Multiple named assistants in one browser. Each carries a stable `id` that is
// used exactly where the old single `fraise_sid` was: as the `?sid=` scope key
// for memory, RAG documents, and conversation history. So each assistant
// accumulates its own remembered facts, files, and continuity in isolation —
// no server-side change, the scoping already keys on the session id.
//
// The list lives entirely in localStorage (like the first-run name). The host
// never stores it; it only receives the active assistant's id + config per
// connection.

import { DEFAULT_VOICE } from "./voices";

export interface Assistant {
  id: string;
  name: string;
  avatar: string; // a single emoji
  instructions: string;
  voice: string; // Deepgram Aura-2 model id, see voices.ts
}

const LIST_KEY = "fraise-assistants";
const ACTIVE_KEY = "fraise-active-assistant";
const LEGACY_SID_KEY = "fraise_sid"; // the pre-Phase-11 single session id

export const AVATAR_CHOICES = [
  "🍓", "💼", "🏡", "🎨", "📚", "🎧", "🧪", "🌙", "⚡", "🌿", "🔮", "🦊",
];

function uuid(): string {
  return crypto.randomUUID();
}

function read(): Assistant[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        // Backfill `voice` for assistants saved before it existed.
        return parsed.map((a) => (a.voice ? a : { ...a, voice: DEFAULT_VOICE }));
      }
    }
  } catch {
    /* fall through to migration */
  }
  return migrate();
}

// First run under Phase 11: seed a single default assistant. Its id reuses any
// existing `fraise_sid` so a returning user's memory and documents carry over
// into the default persona instead of being orphaned under a fresh id.
function migrate(): Assistant[] {
  const legacyId = localStorage.getItem(LEGACY_SID_KEY);
  const def: Assistant = {
    id: legacyId || uuid(),
    name: "Fraise",
    avatar: "🍓",
    instructions: "",
    voice: DEFAULT_VOICE,
  };
  const list = [def];
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
  localStorage.setItem(ACTIVE_KEY, def.id);
  return list;
}

function write(list: Assistant[]): void {
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
}

export function listAssistants(): Assistant[] {
  return read();
}

export function getActiveId(): string {
  const list = read();
  const active = localStorage.getItem(ACTIVE_KEY);
  if (active && list.some((a) => a.id === active)) return active;
  const fallback = list[0].id;
  localStorage.setItem(ACTIVE_KEY, fallback);
  return fallback;
}

export function getActiveAssistant(): Assistant {
  const list = read();
  const id = getActiveId();
  return list.find((a) => a.id === id) ?? list[0];
}

export function setActiveId(id: string): void {
  if (read().some((a) => a.id === id)) localStorage.setItem(ACTIVE_KEY, id);
}

export function createAssistant(partial: Partial<Assistant> = {}): Assistant {
  const list = read();
  const used = new Set(list.map((a) => a.avatar));
  const avatar = partial.avatar || AVATAR_CHOICES.find((e) => !used.has(e)) || "✦";
  const assistant: Assistant = {
    id: uuid(),
    name: partial.name?.trim() || "New assistant",
    avatar,
    instructions: partial.instructions ?? "",
    voice: partial.voice || DEFAULT_VOICE,
  };
  write([...list, assistant]);
  return assistant;
}

export function updateAssistant(id: string, patch: Partial<Assistant>): Assistant[] {
  const list = read().map((a) =>
    a.id === id
      ? {
          ...a,
          ...patch,
          name: (patch.name ?? a.name).trim().slice(0, 40) || a.name,
        }
      : a,
  );
  write(list);
  return list;
}

// Deleting an assistant leaves its memory/documents on the backend untouched
// (they're keyed by id); we just drop the local pointer to it. Never delete the
// last one — there must always be somewhere to talk.
export function deleteAssistant(id: string): Assistant[] {
  const list = read();
  if (list.length <= 1) return list;
  const next = list.filter((a) => a.id !== id);
  write(next);
  if (getActiveId() === id) setActiveId(next[0].id);
  return next;
}
