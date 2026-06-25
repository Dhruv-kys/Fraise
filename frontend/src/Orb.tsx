import { lazy, Suspense } from "react";
import type { AgentState } from "./components/orb";
import type { OrbState } from "./useVoiceAgent";
import "./Orb.css";

// Code-split Three.js so the shell paints before the WebGL orb loads.
const GlOrb = lazy(() => import("./components/orb").then((m) => ({ default: m.Orb })));

// Our voice states -> ElevenLabs orb agent states.
const AGENT: Record<OrbState, AgentState> = {
  idle: null,
  listening: "listening",
  thinking: "thinking",
  speaking: "talking",
};

interface OrbProps {
  state: OrbState;
  onClick: () => void;
}

export default function Orb({ state, onClick }: OrbProps) {
  return (
    <div className={`orb-stage phase-${state}`}>
      <div className="orb-shadow" />
      <div className="orb-bloom-a" />
      <button className="orb" onClick={onClick} aria-label="Toggle voice">
        <Suspense fallback={<div className="orb-fallback" />}>
          <GlOrb
            className="orb-gl"
            colors={["#F0568B", "#FFC9DD"]}
            seed={1337}
            agentState={AGENT[state]}
          />
        </Suspense>
      </button>
    </div>
  );
}
