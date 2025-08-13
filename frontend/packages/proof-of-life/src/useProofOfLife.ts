import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "idle" | "connecting" | "prompt" | "streaming" | "passed" | "failed";

export interface UseProofOfLifeOptions {
  backendUrl: string;
  sessionId: string;
  token: string;
  videoConstraints?: MediaTrackConstraints;
  maxFps?: number;
}

export interface UseProofOfLifeResult {
  status: Status;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  lastPrompt?: { id: string; kind: string; timeoutMs: number };
  error?: string;
  rttMs?: number;
  targetFps: number;
  throttled: boolean;
  lastAckAt?: number;
}

export function useProofOfLife(opts: UseProofOfLifeOptions): UseProofOfLifeResult {
  const { backendUrl, sessionId, token, videoConstraints, maxFps = 15 } = opts;
  const [status, setStatus] = useState<Status>("idle");
  const [lastPrompt, setLastPrompt] = useState<UseProofOfLifeResult["lastPrompt"]>();
  const [error, setError] = useState<string | undefined>();
  const [rttMs, setRttMs] = useState<number | undefined>();
  const [throttled, setThrottled] = useState<boolean>(false);
  const [targetFps, setTargetFps] = useState<number>(maxFps);
  const [lastAckAt, setLastAckAt] = useState<number | undefined>();
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameAtRef = useRef<number>(0);
  const sendTimesRef = useRef<Map<number, number>>(new Map());
  const streamingRef = useRef<boolean>(false);

  const wsUrl = useMemo(() => backendUrl.replace(/^http/, "ws") + "/ws", [backendUrl]);

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const captureAndSendFrame = useCallback(() => {
    const now = performance.now();
    const interval = 1000 / (targetFps || maxFps);
    if (now - lastFrameAtRef.current < interval) return;
    lastFrameAtRef.current = now;
    const video = document.querySelector("video[data-proof-of-life]") as HTMLVideoElement | null;
    if (!video) return;
    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const ts = Date.now();
      sendTimesRef.current.set(ts, performance.now());
      const reader = new FileReader();
      reader.onload = () => {
        const arr = new Uint8Array(reader.result as ArrayBuffer);
        const header = new Uint8Array(16);
        header.set([0x46, 0x50, 0x46, 0x31]); // "FPF1"
        header[4] = 1; // 1=jpeg
        // bytes[5..7] reserved (zeros)
        const view = new DataView(header.buffer);
        view.setBigUint64(8, BigInt(ts), true); // little-endian
        const packet = new Uint8Array(header.length + arr.length);
        packet.set(header, 0);
        packet.set(arr, header.length);
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(packet);
      };
      reader.readAsArrayBuffer(blob);
    }, "image/jpeg", 0.7);
  }, [maxFps, send, targetFps]);

  const start = useCallback(async () => {
    setError(undefined);
    setStatus("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", sessionId, token, client: { sdkVersion: "0.0.1", platform: "web" } }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "helloAck") {
          setStatus("streaming");
          streamingRef.current = true;
          const loop = () => {
            if (!streamingRef.current || ws.readyState !== WebSocket.OPEN) return;
            captureAndSendFrame();
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        } else if (msg.type === "prompt") {
          setLastPrompt(msg.challenge);
          setStatus("prompt");
        } else if (msg.type === "throttle") {
          if (typeof msg.maxFps === "number") {
            setTargetFps((prev) => Math.min(prev, msg.maxFps));
            setThrottled(true);
            setTimeout(() => setThrottled(false), 1500);
          }
        } else if (msg.type === "frameAck") {
          const sentAt = sendTimesRef.current.get(msg.ts);
          if (sentAt) {
            const rtt = Math.round(performance.now() - sentAt);
            setRttMs(rtt);
            send({ type: "telemetry", rttMs: rtt });
            sendTimesRef.current.delete(msg.ts);
          }
          setLastAckAt(Date.now());
        } else if (msg.type === "result") {
          setStatus(msg.decision?.passed ? "passed" : "failed");
          streamingRef.current = false;
        }
      } catch {}
    };
    ws.onerror = () => setError("ws-error");

    try {
      const defaultConstraints: MediaStreamConstraints = {
        video: videoConstraints ?? {
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 15 },
          facingMode: "user",
        },
        audio: false,
      };
      const ms = await navigator.mediaDevices.getUserMedia(defaultConstraints);
      mediaStreamRef.current = ms;
      const video = document.querySelector("video[data-proof-of-life]") as HTMLVideoElement | null;
      if (video) video.srcObject = ms;
    } catch (e: any) {
      const name = e?.name || "getUserMediaError";
      setError(name);
      setStatus("failed");
      streamingRef.current = false;
      return;
    }
  }, [wsUrl, send, sessionId, token, videoConstraints, captureAndSendFrame]);

  const stop = useCallback(async () => {
    wsRef.current?.close();
    wsRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setStatus("idle");
  }, []);

  return { status, start, stop, lastPrompt, error, rttMs, targetFps, throttled, lastAckAt };
}


