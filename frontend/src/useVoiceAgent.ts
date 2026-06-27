import { useCallback, useEffect, useRef, useState } from "react";

export type Role = "user" | "agent" | "system";
export interface Message {
  id: string;
  role: Role;
  text: string;
}

type Status = "connecting" | "online" | "error";
export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const INPUT_RATE = 16_000; // mic → Deepgram (must match backend audio.input)
const OUTPUT_RATE = 24_000; // Deepgram → speaker (must match backend audio.output)
const PLAYBACK_LEAD = 0.18; // seconds of jitter cushion before playback starts

/**
 * Streams microphone audio to the backend (which bridges to Deepgram's Voice
 * Agent) and plays the agent's audio back. Orb state and the transcript are
 * driven by the agent's JSON events.
 */
export function useVoiceAgent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("online");
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Live mic amplitude (0..1) for the orb/waveform — kept in a ref to avoid
  // re-rendering every audio frame.
  const levelRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playHeadRef = useRef(0); // next scheduled playback time
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);

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
    if (playCtxRef.current) playHeadRef.current = playCtxRef.current.currentTime;
  }, []);

  // Schedule one linear16 chunk for gapless playback.
  const playChunk = useCallback((buf: ArrayBuffer) => {
    const ctx = playCtxRef.current;
    if (!ctx) return;
    const int16 = new Int16Array(buf);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;

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

  // Map Deepgram Voice Agent events to UI state.
  const handleEvent = useCallback(
    (data: any) => {
      switch (data.type) {
        case "Welcome":
        case "SettingsApplied":
          setStatus("online");
          break;
        case "UserStartedSpeaking": // barge-in: cut the agent off
          stopPlayback();
          setSpeaking(false);
          setThinking(false);
          setListening(true);
          break;
        case "ConversationText":
          if (data.role === "user") push("user", data.content);
          else if (data.role === "assistant") push("agent", data.content);
          break;
        case "AgentThinking":
        case "FunctionCallRequest":
          setThinking(true);
          setListening(false);
          break;
        case "AgentStartedSpeaking":
          setSpeaking(true);
          setThinking(false);
          setListening(false);
          break;
        case "AgentAudioDone":
          setSpeaking(false);
          break;
        case "Error":
        case "error":
          push("system", data.message || data.description || "Agent error");
          break;
      }
    },
    [push, stopPlayback],
  );

  const stop = useCallback(() => {
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
    setActive(false);
    setListening(false);
    setThinking(false);
    setSpeaking(false);
  }, [stopPlayback]);

  const start = useCallback(async () => {
    try {
      setStatus("connecting");

      // Playback pipeline first, so the first (greeting) audio chunks are never
      // dropped while the socket is being set up.
      const playCtx = new AudioContext({ sampleRate: OUTPUT_RATE });
      await playCtx.resume();
      playCtxRef.current = playCtx;
      playHeadRef.current = playCtx.currentTime;

      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => setStatus("online");
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
        } else {
          playChunk(ev.data as ArrayBuffer);
        }
      };

      // Capture pipeline.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
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
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm.buffer);
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
    speechSupported,
    toggle,
  };
}
