import React, { useEffect, useMemo, useRef } from "react";
import { useProofOfLife, UseProofOfLifeOptions } from "./useProofOfLife";

function getInstructionText(challengeType: string): string {
  switch (challengeType) {
    case "look_right": return "Olhe para a direita";
    case "look_left": return "Olhe para a esquerda";
    case "look_up": return "Olhe para cima";
    case "open_mouth": return "Abra a boca";
    default: return challengeType;
  }
}

function getChallengeEmoji(challengeType: string): string {
  switch (challengeType) {
    case "look_right": return "➡️";
    case "look_left": return "⬅️";
    case "look_up": return "⬆️";
    case "open_mouth": return "😮";
    default: return "🎯";
  }
}

export type ProofOfLifeProps = UseProofOfLifeOptions & {
  onResult?: (passed: boolean) => void;
  onError?: (err: string) => void;
  debug?: boolean;
};

interface ProgressRingProps {
  progress: number; // 0-100
  color: string;
  size: number;
  strokeWidth: number;
}

const ProgressRing: React.FC<ProgressRingProps> = ({ progress, color, size, strokeWidth }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-90deg)' }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={strokeWidth}
        fill="transparent"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="transparent"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
    </svg>
  );
};

export const ProofOfLife = React.memo(function ProofOfLife(props: ProofOfLifeProps) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const { status, start, stop, lastPrompt, error, rttMs, throttled, targetFps, lastAckAt, faceBox, currentChallenge, challengeCompleted, standaloneMode, challengeStartTime } = useProofOfLife(props);
  const debug = props.debug ?? false;

  const ringColor = useMemo(() => {
    if (status === "passed") return "#10b981";
    if (status === "failed") return "#ef4444";
    if (currentChallenge && !challengeCompleted) return "#f59e0b";
    if (currentChallenge && challengeCompleted) return "#10b981";
    if (status === "streaming") return "#3b82f6";
    return "#374151";
  }, [status, currentChallenge, challengeCompleted]);

  const progress = useMemo(() => {
    if (status === "passed") return 100;
    if (status === "failed") return 0;
    if (status === "connecting") return 20;
    if (status === "streaming" && !currentChallenge) return 60;
    if (currentChallenge && !challengeCompleted) {
      // Progresso baseado no tempo do desafio (10 segundos máximo)
      if (challengeStartTime) {
        const elapsed = Date.now() - challengeStartTime;
        const timeProgress = Math.min(elapsed / 10000, 1) * 25; // 25% do progresso baseado no tempo
        return 75 + timeProgress;
      }
      return 75;
    }
    if (currentChallenge && challengeCompleted) return 100;
    return 0;
  }, [status, currentChallenge, challengeCompleted, challengeStartTime]);

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
    background: "black",
  };

  const containerStyle: React.CSSProperties = {
    position: "relative",
    width: 250,
    height: 330,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  };



  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={containerStyle}>
        <ProgressRing 
          progress={progress} 
          color={ringColor} 
          size={250} 
          strokeWidth={6} 
        />
        <div style={maskStyle}>
          <video ref={vidRef} data-proof-of-life autoPlay playsInline muted width={240} height={320} style={{ objectFit: "cover", width: "100%", height: "100%" }} />

          {currentChallenge && (
            <div style={{ 
              position: "absolute", 
              bottom: 8, 
              left: 8, 
              right: 8, 
              textAlign: "center", 
              color: challengeCompleted ? "#10b981" : "#f59e0b", 
              fontWeight: 600, 
              textShadow: "0 1px 2px rgba(0,0,0,0.6)" 
            }}>
              {challengeCompleted ? "✅ Completado!" : `${getChallengeEmoji(currentChallenge.type)} ${getInstructionText(currentChallenge.type)}`}
            </div>
          )}
        </div>
      </div>
      {debug && (<div>status: {status} {throttled ? <span style={{ color: "#f59e0b" }}>(throttle)</span> : null}</div>)}
      {debug && (<div style={{ fontSize: 12, color: "#9ca3af" }}>targetFps: {targetFps}{rttMs !== undefined ? ` · rtt: ${rttMs}ms` : ""}{lastAckAt ? ` · last: ${new Date(lastAckAt).toLocaleTimeString()}` : ""}</div>)}
      {debug && (<div style={{ fontSize: 12, color: "#9ca3af" }}>challenge: {currentChallenge?.type || 'none'} · completed: {challengeCompleted ? 'yes' : 'no'} · bypass: {props.bypassValidation ? 'yes' : 'no'} · standalone: {standaloneMode ? 'yes' : 'no'}</div>)}
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
      {standaloneMode && status === "streaming" && (
        <div style={{ 
          fontSize: 16, 
          fontWeight: "bold", 
          padding: "12px",
          backgroundColor: "rgba(59, 130, 246, 0.8)",
          color: "white",
          borderRadius: "12px",
          textAlign: "center",
          margin: "10px 0",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          border: "2px solid #3b82f6"
        }}>
          🧪 Modo Teste Standalone
          <div style={{ 
            fontSize: 12, 
            marginTop: "6px", 
            opacity: 0.8,
            color: "#93c5fd"
          }}>
            Testando detecção de gestos com MediaPipe
          </div>
        </div>
      )}
      {currentChallenge && status !== "passed" && status !== "failed" && !props.bypassValidation && (
        <div style={{ 
          fontSize: 16, 
          fontWeight: "bold", 
          padding: "12px",
          backgroundColor: challengeCompleted ? "rgba(16, 185, 129, 0.8)" : "rgba(0,0,0,0.8)",
          color: "white",
          borderRadius: "12px",
          textAlign: "center",
          margin: "10px 0",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          border: challengeCompleted ? "2px solid #10b981" : "2px solid #3b82f6"
        }}>
          {challengeCompleted ? "✅ Desafio Completado!" : `🎯 ${getInstructionText(currentChallenge.type)}`}
          <div style={{ 
            fontSize: 12, 
            marginTop: "6px", 
            opacity: 0.8,
            color: challengeCompleted ? "#6ee7b7" : "#93c5fd"
          }}>
            {challengeCompleted ? "Aguarde o próximo desafio..." : "Execute o movimento solicitado"}
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


