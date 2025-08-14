import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "idle" | "connecting" | "prompt" | "streaming" | "passed" | "failed";

export interface UseProofOfLifeOptions {
  backendUrl: string;
  sessionId: string;
  token: string;
  videoConstraints?: MediaTrackConstraints;
  maxFps?: number;
  enableClientHeuristics?: boolean;
  useFaceDetector?: boolean;
  minMotionScore?: number;
  phashIntervalFrames?: number;
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
  const { backendUrl, sessionId, token, videoConstraints, maxFps = 15, enableClientHeuristics = true, useFaceDetector = true, minMotionScore = 0.02, phashIntervalFrames = 5 } = opts;
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
  const lastSmallGrayRef = useRef<Uint8ClampedArray | null>(null);
  const frameCounterRef = useRef<number>(0);
  const faceDetectorRef = useRef<any>(null);

  const wsUrl = useMemo(() => backendUrl.replace(/^http/, "ws") + "/ws", [backendUrl]);

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const computeAHash = (data: Uint8ClampedArray, w: number, h: number) => {
    const smallW = 8, smallH = 8;
    const stepX = Math.max(1, Math.floor(w / smallW));
    const stepY = Math.max(1, Math.floor(h / smallH));
    const gray = new Uint8Array(smallW * smallH);
    let idx = 0;
    for (let yy = 0; yy < smallH; yy++) {
      for (let xx = 0; xx < smallW; xx++) {
        const x = xx * stepX;
        const y = yy * stepY;
        const i = (y * w + x) * 4;
        const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
        gray[idx++] = g as number;
      }
    }
    let sum = 0;
    for (let i = 0; i < gray.length; i++) sum += gray[i];
    const mean = sum / gray.length;
    let bitsBig = 0n;
    for (let i = 0; i < gray.length; i++) {
      if (gray[i] >= mean) bitsBig |= 1n << BigInt(i);
    }
    return bitsBig.toString(16);
  };

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
    if (enableClientHeuristics) {
      const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const w = id.width, h = id.height;
      const stepX = Math.max(1, Math.floor(w / 32));
      const stepY = Math.max(1, Math.floor(h / 32));
      const small = new Uint8ClampedArray(32 * 32);
      let p = 0;
      for (let yy = 0; yy < 32; yy++) {
        for (let xx = 0; xx < 32; xx++) {
          const x = xx * stepX;
          const y = yy * stepY;
          const i = (y * w + x) * 4;
          const g = (id.data[i] * 0.299 + id.data[i + 1] * 0.587 + id.data[i + 2] * 0.114) | 0;
          small[p++] = g as number;
        }
      }
      let motionScore = 0;
      if (lastSmallGrayRef.current) {
        const prev = lastSmallGrayRef.current;
        const len = Math.min(prev.length, small.length);
        let acc = 0;
        for (let i = 0; i < len; i++) acc += Math.abs(prev[i] - small[i]) / 255;
        motionScore = acc / len;
      }
      lastSmallGrayRef.current = small;

      let ahashHex: string | undefined;
      const n = (frameCounterRef.current = (frameCounterRef.current + 1) % 1000000);
      if (n % (phashIntervalFrames || 5) === 0) {
        ahashHex = computeAHash(id.data, w, h);
      }

      const FaceDetectorCtor: any = (globalThis as any).FaceDetector;
      if (useFaceDetector && FaceDetectorCtor) {
        if (!faceDetectorRef.current) faceDetectorRef.current = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 1 });
        if (n % 2 === 0) {
          try {
            void faceDetectorRef.current.detect(video).then((faces: any[]) => {
              let facePresent: boolean | undefined;
              let faceBox: { x: number; y: number; width: number; height: number } | undefined;
              if (faces && faces.length > 0) {
                const b = faces[0].boundingBox;
                facePresent = true;
                faceBox = { x: b.x, y: b.y, width: b.width, height: b.height };
              } else {
                facePresent = false;
              }
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN) {
                const tel: any = { type: "telemetry", facePresent };
                if (faceBox) tel.faceBox = faceBox;
                ws.send(JSON.stringify(tel));
              }
            }).catch(() => {});
          } catch {}
        }
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const tel: any = { type: "telemetry", motionScore };
        if (ahashHex) tel.ahash = ahashHex;
        if (motionScore >= minMotionScore || ahashHex) {
          wsRef.current.send(JSON.stringify(tel));
        }
      }
    }
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
  }, [enableClientHeuristics, maxFps, minMotionScore, phashIntervalFrames, send, targetFps, useFaceDetector]);

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


