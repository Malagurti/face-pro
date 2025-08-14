import React, { useEffect, useMemo, useRef } from "react";
import { useProofOfLife, UseProofOfLifeOptions } from "./useProofOfLife";

export type ProofOfLifeProps = UseProofOfLifeOptions & {
  onResult?: (passed: boolean) => void;
  onError?: (err: string) => void;
  debug?: boolean;
};

export function ProofOfLife(props: ProofOfLifeProps) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const { status, start, stop, lastPrompt, error, rttMs, throttled, targetFps, lastAckAt } = useProofOfLife(props);
  const debug = props.debug ?? false;

  const ringColor = useMemo(() => {
    if (status === "passed") return "#10b981"; // green
    if (status === "failed") return "#ef4444"; // red
    if (status === "prompt") return "#f59e0b"; // amber
    return "#374151"; // gray
  }, [status]);

  useEffect(() => {
    start();
    return () => { stop(); };
  }, [start, stop]);

  useEffect(() => {
    if (error && props.onError) props.onError(error);
  }, [error, props]);

  useEffect(() => {
    if (status === "passed" && props.onResult) props.onResult(true);
    if (status === "failed" && props.onResult) props.onResult(false);
  }, [status, props]);

  const maskStyle: React.CSSProperties = {
    position: "relative",
    width: 240,
    height: 320,
    borderRadius: "50% / 60%",
    overflow: "hidden",
    boxShadow: `0 0 0 3px ${ringColor}`,
    background: "black",
  };

  const promptText = useMemo(() => {
    if (!lastPrompt) return undefined;
    const map: Record<string, string> = {
      blink: "Piscar os olhos",
      "open-mouth": "Abra a boca",
      "turn-left": "Vire a cabeça para a esquerda",
      "turn-right": "Vire a cabeça para a direita",
      "head-up": "Levante a cabeça",
      "head-down": "Abaixe a cabeça",
      smile: "Sorria",
    };
    return map[lastPrompt.kind] ?? lastPrompt.kind;
  }, [lastPrompt]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={maskStyle}>
        <video ref={vidRef} data-proof-of-life autoPlay playsInline muted width={240} height={320} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      </div>
      {debug && (<div>status: {status} {throttled ? <span style={{ color: "#f59e0b" }}>(throttle)</span> : null}</div>)}
      {debug && (<div style={{ fontSize: 12, color: "#9ca3af" }}>targetFps: {targetFps}{rttMs !== undefined ? ` · rtt: ${rttMs}ms` : ""}{lastAckAt ? ` · last: ${new Date(lastAckAt).toLocaleTimeString()}` : ""}</div>)}
      {promptText && (
        <div style={{ fontSize: 14 }}>
          Guia: {promptText}
        </div>
      )}
      {debug && error && <div style={{ color: "red" }}>{error}</div>}
    </div>
  );
}


