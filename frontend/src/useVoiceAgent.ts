import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveAssistant, getActiveId, listAssistants } from "./assistants";

export type Role = "user" | "agent" | "system";
export interface Message {
  id: string;
  role: Role;
  text: string;
}

type Status = "connecting" | "online" | "error";
export type OrbState = "idle" | "listening" | "thinking" | "speaking";

// Prod backend (Caddy + TLS on the VM). Used when no env override is set and
// we're not on localhost, so the deployed site works without a build-time var.
const PROD_WS_URL = "wss://100-56-229-165.sslip.io/ws";
const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname);
const WS_URL =
  import.meta.env.VITE_BACKEND_WS_URL ??
  (isLocalHost
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
    : PROD_WS_URL);
// The active assistant's id is the scope key (Phase 11) — memory, documents,
// and conversation history are all keyed on it, so switching assistants gives a
// clean, isolated mind. No login: the browser holds the assistants.
function sessionId(): string {
  return getActiveId();
}

// Greet the first connection *per assistant* per tab, so switching personas
// mid-app gets a fresh hello as the new persona but a reload/reconnect doesn't.
function greetedKey(id: string): string {
  return `fraise-greeted-${id}`;
}

function wsUrlWithSession(): string {
  const active = getActiveAssistant();
  const url = new URL(WS_URL, location.href);
  url.searchParams.set("sid", active.id);
  const name = localStorage.getItem("fraise-name");
  if (name) url.searchParams.set("name", name);
  if (active.name && active.name.toLowerCase() !== "fraise") {
    url.searchParams.set("persona", active.name);
  }
  if (active.instructions.trim()) {
    url.searchParams.set("instructions", active.instructions.trim());
  }
  // Other assistants' names, for voice-native switching ("switch to Work").
  const others = listAssistants()
    .filter((a) => a.id !== active.id)
    .map((a) => a.name);
  if (others.length) url.searchParams.set("personas", others.join(","));
  if (sessionStorage.getItem(greetedKey(active.id))) {
    url.searchParams.set("greet", "0");
  }
  return url.toString();
}

// Same origin as the voice socket, over http(s) — for /upload and /agents/stream.
export function httpBase(): string {
  const url = new URL(WS_URL, location.href);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

export async function uploadDocument(file: File): Promise<{ filename: string; chunks: number }> {
  const url = new URL("/upload", httpBase());
  url.searchParams.set("sid", sessionId());
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `upload failed (${res.status})`);
  }
  return res.json();
}

const INPUT_RATE = 16_000; // mic → Deepgram (must match backend audio.input)
const OUTPUT_RATE = 24_000; // Deepgram → speaker (must match backend audio.output)
const PLAYBACK_LEAD = 0.18; // seconds of jitter cushion before playback starts

/**
 * Streams microphone audio to the backend (which bridges to Deepgram's Voice
 * Agent) and plays the agent's audio back. Orb state and the transcript are
 * driven by the agent's JSON events.
 */
export function useVoiceAgent(onRequestSwitch?: (name: string) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("online");
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [authNeeded, setAuthNeeded] = useState<string | null>(null); // auth URL or null

  // Live audio amplitude (0..1), kept in refs to avoid re-rendering every frame:
  // levelRef = mic input (drives orb while listening), outLevelRef = agent
  // output (drives orb while speaking).
  const levelRef = useRef(0);
  const outLevelRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playHeadRef = useRef(0); // next scheduled playback time
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  // Safety net: if "thinking" never resolves (a failed think/function step that
  // doesn't crash the bridge but also never produces a reply), don't leave the
  // orb spinning forever — bail back to idle and tell the user.
  const thinkingTimeoutRef = useRef<number | null>(null);
  // Set on barge-in, cleared when the agent's next turn actually starts. Guards
  // against trailing audio chunks Deepgram had already generated before it
  // registered the interruption — those still arrive after UserStartedSpeaking
  // and would otherwise keep playing over the user.
  const mutedRef = useRef(false);

  // Latest switch handler in a ref so handleEvent can call it without being
  // rebuilt (and re-subscribing the socket) every render.
  const switchRef = useRef(onRequestSwitch);
  switchRef.current = onRequestSwitch;

  const push = useCallback((role: Role, text: string) => {
    if (!text?.trim()) return;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role, text }]);
  }, []);

  // Stop any agent audio currently playing/scheduled (used for barge-in).
  const stopPlayback = useCallback(() => {
    for (const s of sourcesRef.current) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current = [];
    outLevelRef.current = 0;
    if (playCtxRef.current) playHeadRef.current = playCtxRef.current.currentTime;
  }, []);

  // Schedule one linear16 chunk for gapless playback.
  const playChunk = useCallback((buf: ArrayBuffer) => {
    const ctx = playCtxRef.current;
    if (!ctx) return;
    const int16 = new Int16Array(buf);
    const f32 = new Float32Array(int16.length);
    let sum = 0;
    for (let i = 0; i < int16.length; i++) {
      const x = int16[i] / 0x8000;
      f32[i] = x;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / (int16.length || 1));
    outLevelRef.current += (Math.min(1, rms * 3.2) - outLevelRef.current) * 0.5;

    const audio = ctx.createBuffer(1, f32.length, OUTPUT_RATE);
    audio.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);

    // Lead-in cushion: when starting fresh or after an underrun, schedule a
    // little in the future so load-time jitter doesn't cause dropouts.
    const now = ctx.currentTime;
    if (playHeadRef.current < now + 0.02) playHeadRef.current = now + PLAYBACK_LEAD;
    src.start(playHeadRef.current);
    playHeadRef.current += audio.duration;
    sourcesRef.current.push(src);
    src.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
    };
  }, []);

  const clearThinkingWatchdog = useCallback(() => {
    if (thinkingTimeoutRef.current !== null) {
      window.clearTimeout(thinkingTimeoutRef.current);
      thinkingTimeoutRef.current = null;
    }
  }, []);

  // A turn that never resolves (e.g. Deepgram's think/function step fails
  // without ever closing the socket) would otherwise leave the orb spinning
  // forever with no feedback. This guarantees it always comes back to idle.
  const armThinkingWatchdog = useCallback(() => {
    clearThinkingWatchdog();
    thinkingTimeoutRef.current = window.setTimeout(() => {
      thinkingTimeoutRef.current = null;
      setThinking(false);
      push("system", "That took too long — try again?");
    }, 20_000);
  }, [clearThinkingWatchdog, push]);

  // Map Deepgram Voice Agent events to UI state.
  const handleEvent = useCallback(
    (data: any) => {
      switch (data.type) {
        case "Welcome":
        case "SettingsApplied":
          setStatus("online");
          break;
        case "UserStartedSpeaking": // barge-in: cut the agent off
          clearThinkingWatchdog();
          mutedRef.current = true; // drop any trailing chunks already in flight
          stopPlayback();
          setSpeaking(false);
          setThinking(false);
          setListening(true);
          break;
        case "ConversationText":
          if (data.role === "user") {
            push("user", data.content);
          } else if (data.role === "assistant") {
            push("agent", data.content);
            // Some Deepgram Voice Agent configs never emit AgentStartedSpeaking
            // (observed: Flux v2 listen + this think/speak setup). This text
            // always arrives right before that turn's audio, and — because
            // socket order is preserved — can't belong to a stale, barged-in
            // turn once UserStartedSpeaking has already been seen. Without this,
            // mutedRef never clears and every reply's audio gets silently
            // dropped after the first barge-in.
            clearThinkingWatchdog();
            mutedRef.current = false;
            setSpeaking(true);
            setThinking(false);
            setListening(false);
          }
          break;
        case "AgentThinking":
        case "FunctionCallRequest":
          armThinkingWatchdog();
          setThinking(true);
          setListening(false);
          break;
        case "AgentStartedSpeaking":
          clearThinkingWatchdog();
          mutedRef.current = false; // a real new turn — safe to play again
          setSpeaking(true);
          setThinking(false);
          setListening(false);
          break;
        case "AgentAudioDone":
          setSpeaking(false);
          outLevelRef.current = 0;
          break;
        case "auth_redirect":
          setAuthNeeded(data.url as string);
          break;
        case "switch_assistant":
          // Voice-native switch: the backend tool named an assistant; the App
          // resolves the name against the local list and reconnects as it.
          if (typeof data.name === "string") switchRef.current?.(data.name);
          break;
        case "Error":
        case "error":
          // A fatal Deepgram error (or a bridge failure) can arrive while the
          // orb is still showing "thinking" — without resetting state here it
          // looks like the agent is still working when the turn has actually
          // died, which is exactly the "shows working, never replies" symptom.
          clearThinkingWatchdog();
          setThinking(false);
          setSpeaking(false);
          setListening(false);
          push("system", data.message || data.description || "Agent error");
          break;
      }
    },
    [push, stopPlayback, armThinkingWatchdog, clearThinkingWatchdog],
  );

  const stop = useCallback(() => {
    clearThinkingWatchdog();
    wsRef.current?.close();
    wsRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micCtxRef.current?.close().catch(() => {});
    micCtxRef.current = null;
    stopPlayback();
    playCtxRef.current?.close().catch(() => {});
    playCtxRef.current = null;
    levelRef.current = 0;
    mutedRef.current = false;
    setActive(false);
    setListening(false);
    setThinking(false);
    setSpeaking(false);
  }, [stopPlayback, clearThinkingWatchdog]);

  const start = useCallback(async () => {
    try {
      setStatus("connecting");

      // Playback pipeline first, so the first (greeting) audio chunks are never
      // dropped while the socket is being set up.
      const playCtx = new AudioContext({ sampleRate: OUTPUT_RATE });
      await playCtx.resume();
      playCtxRef.current = playCtx;
      playHeadRef.current = playCtx.currentTime;

      const ws = new WebSocket(wsUrlWithSession());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        setStatus("online");
        // Persist here, not in wsUrlWithSession — a failed first attempt must
        // still greet on retry, so the flag only sticks once we're really
        // connected. Keyed per assistant so each persona greets once per tab.
        sessionStorage.setItem(greetedKey(getActiveId()), "1");
      };
      ws.onerror = () => setStatus("error");
      ws.onclose = () => {
        if (wsRef.current === ws) stop();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            handleEvent(JSON.parse(ev.data));
          } catch {
            /* ignore non-JSON */
          }
        } else if (!mutedRef.current) {
          playChunk(ev.data as ArrayBuffer);
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const micCtx = new AudioContext({ sampleRate: INPUT_RATE });
      await micCtx.resume();
      micCtxRef.current = micCtx;
      await micCtx.audioWorklet.addModule("/pcm-worklet.js");

      const source = micCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(micCtx, "pcm-processor");
      workletRef.current = worklet;
      // Pull the worklet through a muted sink so it processes without echoing.
      const sink = micCtx.createGain();
      sink.gain.value = 0;
      source.connect(worklet);
      worklet.connect(sink);
      sink.connect(micCtx.destination);

      worklet.port.onmessage = (e) => {
        const pcm = e.data as Int16Array;
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) {
          const x = pcm[i] / 0x8000;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / pcm.length);
        levelRef.current += (Math.min(1, rms * 3.2) - levelRef.current) * 0.4;
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm.buffer as ArrayBuffer);
      };

      setActive(true);
    } catch {
      setStatus("error");
      stop();
    }
  }, [handleEvent, playChunk, stop]);

  const toggle = useCallback(() => {
    if (active) stop();
    else void start();
  }, [active, start, stop]);

  // Reconnect the whole pipeline — used when the active assistant changes so the
  // socket reopens with the new scope (sid) and persona. getUserMedia won't
  // re-prompt (permission persists), so a clean stop→start is simplest here.
  const reconnect = useCallback(() => {
    setMessages([]); // different assistant, different mind — clear the transcript
    stop();
    // Let stop() tear down the old contexts/socket before opening new ones.
    setTimeout(() => void start(), 120);
  }, [stop, start]);

  // Tell the live agent a document was just uploaded, so it speaks about it.
  // No-op if the voice session isn't connected — the doc is still indexed.
  const notifyUpload = useCallback((filename: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "document_uploaded", filename }));
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  const orbState: OrbState = speaking
    ? "speaking"
    : thinking
      ? "thinking"
      : listening
        ? "listening"
        : "idle";

  const speechSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    (typeof AudioContext !== "undefined" || "webkitAudioContext" in window);

  return {
    messages,
    status,
    listening: active,
    orbState,
    levelRef,
    outLevelRef,
    speechSupported,
    toggle,
    reconnect,
    notifyUpload,
    authNeeded,
    clearAuth: () => setAuthNeeded(null),
  };
}
