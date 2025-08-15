import React, { useEffect, useMemo, useRef } from "react";
import { useProofOfLife, UseProofOfLifeOptions } from "./useProofOfLife";

function getInstructionText(challenge: string): string {
  switch (challenge) {
    case "blink": return "Pisque os olhos naturalmente";
    case "open-mouth": return "Abra a boca";
    case "turn-left": return "Vire a cabeça para a esquerda";
    case "turn-right": return "Vire a cabeça para a direita";
    case "head-up": return "Levante a cabeça";
    case "head-down": return "Abaixe a cabeça";
    default: return challenge;
  }
}

export type ProofOfLifeProps = UseProofOfLifeOptions & {
  onResult?: (passed: boolean) => void;
  onError?: (err: string) => void;
  debug?: boolean;
};

export const ProofOfLife = React.memo(function ProofOfLife(props: ProofOfLifeProps) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const { status, start, stop, lastPrompt, error, rttMs, throttled, targetFps, lastAckAt, faceBox, guide } = useProofOfLife(props);
  const debug = props.debug ?? false;

  const ringColor = useMemo(() => {
    if (status === "passed") return "#10b981";
    if (status === "failed") return "#ef4444";
    if (guide?.level === "ok") return "#3b82f6";
    if (guide?.level === "warn") return "#f59e0b";
    if (guide?.level === "error") return "#ef4444";
    if (status === "prompt") return "#f59e0b";
    return "#374151";
  }, [status, guide]);

  useEffect(() => {
    start();
    return () => { stop(); };
  }, [start, stop]);

  useEffect(() => {
    if (error && props.onError) props.onError(error);
  }, [error, props.onError]);

  useEffect(() => {
    if (status === "passed" && props.onResult) props.onResult(true);
    if (status === "failed" && props.onResult) props.onResult(false);
  }, [status, props.onResult]);

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

        {guide && guide.message && (
          <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, textAlign: "center", color: guide.level === "ok" ? "#3b82f6" : guide.level === "warn" ? "#f59e0b" : "#ef4444", fontWeight: 600, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>{guide.message}</div>
        )}
      </div>
      {debug && (<div>status: {status} {throttled ? <span style={{ color: "#f59e0b" }}>(throttle)</span> : null}</div>)}
      {debug && (<div style={{ fontSize: 12, color: "#9ca3af" }}>targetFps: {targetFps}{rttMs !== undefined ? ` · rtt: ${rttMs}ms` : ""}{lastAckAt ? ` · last: ${new Date(lastAckAt).toLocaleTimeString()}` : ""}</div>)}
      {props.bypassValidation && status === "streaming" && (
        <div style={{ 
          fontSize: 16, 
          fontWeight: "bold", 
          padding: "12px",
          backgroundColor: "rgba(139, 69, 19, 0.8)",
          color: "white",
          borderRadius: "12px",
          textAlign: "center",
          margin: "10px 0",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          border: "2px solid #f59e0b"
        }}>
          🔄 Modo Bypass Ativo
          <div style={{ 
            fontSize: 12, 
            marginTop: "6px", 
            opacity: 0.8,
            color: "#fbbf24"
          }}>
            Capturando dados para o backend processar
          </div>
        </div>
      )}
      {promptText && status !== "passed" && status !== "failed" && !props.bypassValidation && (
        <div style={{ 
          fontSize: 16, 
          fontWeight: "bold", 
          padding: "12px",
          backgroundColor: "rgba(0,0,0,0.8)",
          color: "white",
          borderRadius: "12px",
          textAlign: "center",
          margin: "10px 0",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          border: "2px solid #3b82f6"
        }}>
          🎯 {getInstructionText(promptText)}
          <div style={{ 
            fontSize: 12, 
            marginTop: "6px", 
            opacity: 0.8,
            color: "#93c5fd"
          }}>
            Execute o movimento solicitado
          </div>
        </div>
      )}
      {status === "passed" && (
        <div style={{ fontSize: 14, color: "#10b981", fontWeight: "bold" }}>
          ✅ Prova de vida concluída com sucesso!
        </div>
      )}
      {status === "failed" && (
        <div style={{ fontSize: 14, color: "#ef4444", fontWeight: "bold" }}>
          ❌ Prova de vida falhou
        </div>
      )}
      {debug && error && <div style={{ color: "red" }}>{error}</div>}
    </div>
  );
});


