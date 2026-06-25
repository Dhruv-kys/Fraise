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

export function useVoiceAgent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Live mic amplitude (0..1). Kept in a ref so the orb can animate every
  // frame without re-rendering React.
  const levelRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const meterRef = useRef<{ stop: () => void } | null>(null);

  const push = useCallback((role: Role, text: string) => {
    setMessages((m) => [...m, { id: crypto.randomUUID(), role, text }]);
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  // WebSocket to the backend.
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setStatus("online");
    ws.onclose = () => setStatus("error");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case "thinking":
          setThinking(true);
          break;
        case "agent_message":
          setThinking(false);
          push("agent", msg.text);
          speak(msg.text);
          break;
        case "error":
          setThinking(false);
          push("system", msg.message);
          break;
      }
    };

    return () => ws.close();
  }, [push, speak]);

  // Browser speech recognition (Web Speech API), continuous.
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result.isFinal) continue;
        const text = result[0].transcript.trim();
        if (!text) continue;
        push("user", text);
        wsRef.current?.send(JSON.stringify({ type: "user_message", text }));
      }
    };
    rec.onerror = () => {};

    recognitionRef.current = rec;
  }, [push]);

  // Web Audio amplitude meter — drives the orb's reaction to your voice.
  const startMeter = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / data.length);
      // Smooth toward the new level so the orb feels organic.
      levelRef.current += (Math.min(1, rms * 3.2) - levelRef.current) * 0.3;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    meterRef.current = {
      stop: () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        levelRef.current = 0;
      },
    };
  }, []);

  const start = useCallback(async () => {
    if (listening) return;
    try {
      await startMeter();
      recognitionRef.current?.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, startMeter]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    meterRef.current?.stop();
    meterRef.current = null;
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else void start();
  }, [listening, start, stop]);

  useEffect(() => () => meterRef.current?.stop(), []);

  const orbState: OrbState = speaking
    ? "speaking"
    : thinking
      ? "thinking"
      : listening
        ? "listening"
        : "idle";

  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  return {
    messages,
    status,
    listening,
    orbState,
    levelRef,
    speechSupported,
    toggle,
  };
}
