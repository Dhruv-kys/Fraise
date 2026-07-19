import { lazy, Suspense } from "react";
import type { AgentState } from "./components/orb";
import type { OrbState } from "./useVoiceAgent";
import "./Orb.css";

const GlOrb = lazy(() => import("./components/orb").then((m) => ({ default: m.Orb })));

const AGENT: Record<OrbState, AgentState> = {
  idle: null,
  listening: "listening",
  thinking: "thinking",
  speaking: "talking",
};

interface OrbProps {
  state: OrbState;
  onClick: () => void;
  inputLevelRef?: React.RefObject<number>;
  outputLevelRef?: React.RefObject<number>;
}

export default function Orb({ state, onClick, inputLevelRef, outputLevelRef }: OrbProps) {
  return (
    <div className={`orb-stage phase-${state}`}>
      <div className="orb-shadow" />
      <div className="orb-bloom-a" />
      <button className="orb" onClick={onClick} aria-label="Toggle voice">
        <Suspense fallback={<div className="orb-fallback" />}>
          <GlOrb
            className="orb-gl"
            colors={["#3D5AFF", "#63E6FF"]}
            seed={1337}
            agentState={AGENT[state]}
            inputVolumeRef={inputLevelRef}
            outputVolumeRef={outputLevelRef}
          />
        </Suspense>
      </button>
    </div>
  );
}
