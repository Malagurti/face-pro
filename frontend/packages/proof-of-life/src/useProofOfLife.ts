import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "idle" | "connecting" | "prompt" | "streaming" | "passed" | "failed";

export interface UseProofOfLifeOptions {
  backendUrl: string;
  sessionId: string;
  token: string;
  videoConstraints?: MediaTrackConstraints;
  maxFps?: number;
  enableClientHeuristics?: boolean;
  minMotionScore?: number;
  phashIntervalFrames?: number;
  enablePositionGuide?: boolean;
  minFaceAreaRatio?: number;
  maxFaceAreaRatio?: number;
  centerTolerance?: number;
  detectionIntervalFrames?: number;
  bypassValidation?: boolean;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, data?: any) => void;
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
  facePresent?: boolean;
  faceBox?: { x: number; y: number; width: number; height: number };
  guide?: { level: "ok" | "warn" | "error"; message?: string; reason?: string };
}

export function useProofOfLife(opts: UseProofOfLifeOptions): UseProofOfLifeResult {
  const { backendUrl, sessionId, token, videoConstraints, maxFps = 15, enableClientHeuristics = true, minMotionScore = 0.02, phashIntervalFrames = 5, enablePositionGuide = true, minFaceAreaRatio = 0.12, maxFaceAreaRatio = 0.6, centerTolerance = 0.12, detectionIntervalFrames = 2, bypassValidation = false, onLog } = opts;
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
  const preparingRef = useRef<boolean>(false);
  const readyCountRef = useRef<number>(0);
  const lastSmallGrayRef = useRef<Uint8ClampedArray | null>(null);
  const frameCounterRef = useRef<number>(0);
  const mpDetectorRef = useRef<any>(null);
  const mpVisionRef = useRef<any>(null);
  const [facePresent, setFacePresent] = useState<boolean | undefined>(undefined);
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; width: number; height: number } | undefined>(undefined);
  const [guide, setGuide] = useState<{ level: "ok" | "warn" | "error"; message?: string; reason?: string } | undefined>(undefined);
  const challengeCountRef = useRef<number>(0);

  const wsUrl = useMemo(() => backendUrl.replace(/^http/, "ws") + "/ws", [backendUrl]);

  const logRef = useRef(onLog);
  logRef.current = onLog;

  const log = useCallback((level: 'info' | 'warn' | 'error', message: string, data?: any) => {
    if (logRef.current) {
      logRef.current(level, message, data);
    } else {
      const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      logFn(message, data || '');
    }
  }, []); // Dependências vazias para evitar recriação

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
        const r = data[i] ?? 0;
        const gch = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const g = (r * 0.299 + gch * 0.587 + b * 0.114) | 0;
        gray[idx++] = g as number;
      }
    }
    let sum = 0;
    for (let i = 0; i < gray.length; i++) sum += (gray[i] ?? 0);
    const mean = sum / gray.length;
    let bitsBig = 0n;
    for (let i = 0; i < gray.length; i++) {
      const gv = gray[i] ?? 0;
      if (gv >= mean) bitsBig |= 1n << BigInt(i);
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
    const ctx = (canvas.getContext("2d", { willReadFrequently: true } as any) || canvas.getContext("2d")) as CanvasRenderingContext2D | null;
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (bypassValidation) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Reduzir resolução para 160x120 para economizar largura de banda
      const reducedCanvas = document.createElement('canvas');
      reducedCanvas.width = 160;
      reducedCanvas.height = 120;
      const reducedCtx = reducedCanvas.getContext('2d');
      if (reducedCtx) {
        reducedCtx.drawImage(canvas, 0, 0, 160, 120);
        var reducedImageData = reducedCtx.getImageData(0, 0, 160, 120);
      } else {
        var reducedImageData = imageData; // fallback
      }
      
      const enhancedData = {
        timestamp: now,
        frameId: Date.now(),
        videoInfo: {
          width: canvas.width,
          height: canvas.height,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight
        },
        rawImageData: {
          width: reducedImageData.width,
          height: reducedImageData.height,
          data: Array.from(reducedImageData.data)
        },
        motionScore: 0,
        ahash: "",
        features: {
          brightness: 0,
          contrast: 0,
          sharpness: 0,
          histogram: [] as number[],
          edgeDetection: [] as number[],
          colorChannels: {
            red: 0,
            green: 0,
            blue: 0
          }
        },
        frameSequence: frameCounterRef.current
      };

      const w = imageData.width, h = imageData.height;
      const data = imageData.data;
      
      let totalBrightness = 0;
      let totalRed = 0, totalGreen = 0, totalBlue = 0;
      const histogram = new Array(256).fill(0);
      const edgeData = [];
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] || 0;
        const g = data[i + 1] || 0;
        const b = data[i + 2] || 0;
        const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
        
        totalBrightness += gray;
        totalRed += r;
        totalGreen += g;
        totalBlue += b;
        histogram[gray]++;
        
        // Detecção de bordas simples (Sobel aproximado)
        if (i > w * 4 * 2 && i < data.length - w * 4 * 2) {
          const pixelAbove = Math.round((data[i - w * 4] || 0) * 0.299 + (data[i - w * 4 + 1] || 0) * 0.587 + (data[i - w * 4 + 2] || 0) * 0.114);
          const pixelBelow = Math.round((data[i + w * 4] || 0) * 0.299 + (data[i + w * 4 + 1] || 0) * 0.587 + (data[i + w * 4 + 2] || 0) * 0.114);
          const edge = Math.abs(pixelAbove - pixelBelow);
          if (edge > 30) edgeData.push(edge);
        }
      }
      
      const pixelCount = (data.length / 4);
      enhancedData.features.brightness = totalBrightness / pixelCount;
      enhancedData.features.histogram = histogram;
      enhancedData.features.colorChannels = {
        red: totalRed / pixelCount,
        green: totalGreen / pixelCount,
        blue: totalBlue / pixelCount
      };
      enhancedData.features.edgeDetection = edgeData.slice(0, 100); // Limitar para não sobrecarregar
      
      const stepX = Math.max(1, Math.floor(w / 32));
      const stepY = Math.max(1, Math.floor(h / 32));
      const small = new Uint8ClampedArray(32 * 32);
      let p = 0;
      for (let yy = 0; yy < 32; yy++) {
        for (let xx = 0; xx < 32; xx++) {
          const x = xx * stepX;
          const y = yy * stepY;
          const i = (y * w + x) * 4;
          const r = data[i] || 0;
          const gch = data[i + 1] || 0;
          const b = data[i + 2] || 0;
          const gray = (r * 0.299 + gch * 0.587 + b * 0.114) | 0;
          small[p++] = gray as number;
        }
      }
      
      if (lastSmallGrayRef.current) {
        const prev = lastSmallGrayRef.current;
        const len = Math.min(prev.length, small.length);
        let acc = 0;
        for (let i = 0; i < len; i++) {
          const pv = prev[i] || 0;
          const sv = small[i] || 0;
          acc += Math.abs(pv - sv) / 255;
        }
        enhancedData.motionScore = acc / len;
      }
      lastSmallGrayRef.current = small;
      
      enhancedData.ahash = computeAHash(data, w, h);
      
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
          type: "bypassFrame",
          ...enhancedData
        };
        ws.send(JSON.stringify(message));
        // Log apenas a cada 30 frames para não sobrecarregar
        if (frameCounterRef.current % 30 === 0) {
          log('info', "🔄 [BYPASS] Dados enviados", {
            type: message.type,
            frameId: message.frameId,
            frameSeq: message.frameSequence,
            resolution: `${message.rawImageData.width}x${message.rawImageData.height}`,
            dataSize: `${(message.rawImageData.data.length / 1024).toFixed(1)}KB`,
            motionScore: message.motionScore.toFixed(4),
            brightness: message.features.brightness.toFixed(2),
            edges: message.features.edgeDetection.length,
            colorAvg: `R:${message.features.colorChannels.red.toFixed(0)} G:${message.features.colorChannels.green.toFixed(0)} B:${message.features.colorChannels.blue.toFixed(0)}`,
            ahash: message.ahash.substring(0, 8) + "..."
          });
        }
      }
      return;
    }
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
          const r = id.data[i] ?? 0;
          const gch = id.data[i + 1] ?? 0;
          const b = id.data[i + 2] ?? 0;
          const g = (r * 0.299 + gch * 0.587 + b * 0.114) | 0;
          small[p++] = g as number;
        }
      }
      let motionScore = 0;
      if (lastSmallGrayRef.current) {
        const prev = lastSmallGrayRef.current;
        const len = Math.min(prev.length, small.length);
        let acc = 0;
        for (let i = 0; i < len; i++) {
          const pv = prev[i] ?? 0;
          const sv = small[i] ?? 0;
          acc += Math.abs(pv - sv) / 255;
        }
        motionScore = acc / len;
      }
      lastSmallGrayRef.current = small;

      let ahashHex: string | undefined;
      const n = (frameCounterRef.current = (frameCounterRef.current + 1) % 1000000);
      if (n % (phashIntervalFrames || 5) === 0) {
        ahashHex = computeAHash(id.data, w, h);
      }

      if ((frameCounterRef.current % (detectionIntervalFrames || 2)) === 0) {
        if (mpDetectorRef.current && mpVisionRef.current) {
          try {
            const res = mpDetectorRef.current.detectForVideo(video, now);
            let present = false;
            let box: { x: number; y: number; width: number; height: number } | undefined;
            if (res && res.detections && res.detections.length > 0) {
              present = true;
              const d = res.detections[0];
              const bb = d.boundingBox;
              box = { x: Math.round(bb.originX), y: Math.round(bb.originY), width: Math.round(bb.width), height: Math.round(bb.height) };
              console.log("🔍 MediaPipe detectou face:", { present, box });
            } else {
              console.log("🔍 MediaPipe: nenhuma face detectada");
            }
            setFacePresent(present);
            setFaceBox(box);
            
            if (enablePositionGuide) {
              const vw = video.videoWidth || 320;
              const vh = video.videoHeight || 240;
              
              if (!present) {
                setGuide({ level: "error", message: "Posicione seu rosto na frente da câmera", reason: "no_face" });
              } else if (box) {
                const area = box.width * box.height;
                const areaRatio = area / (vw * vh);
                const cx = box.x + box.width / 2;
                const cy = box.y + box.height / 2;
                const dx = Math.abs(cx - vw / 2) / vw;
                const dy = Math.abs(cy - vh / 2) / vh;
                
                if (areaRatio < minFaceAreaRatio) {
                  setGuide({ level: "warn", message: "Aproxime-se da câmera", reason: "too_far" });
                } else if (areaRatio > maxFaceAreaRatio) {
                  setGuide({ level: "warn", message: "Afaste-se da câmera", reason: "too_close" });
                } else if (dx > centerTolerance) {
                  if (cx > vw / 2) {
                    setGuide({ level: "warn", message: "Mova-se para a esquerda", reason: "face_right" });
                  } else {
                    setGuide({ level: "warn", message: "Mova-se para a direita", reason: "face_left" });
                  }
                } else if (dy > centerTolerance) {
                  if (cy > vh / 2) {
                    setGuide({ level: "warn", message: "Mova-se para cima", reason: "face_down" });
                  } else {
                    setGuide({ level: "warn", message: "Mova-se para baixo", reason: "face_up" });
                  }
                } else {
                  setGuide({ level: "ok", message: "Posição perfeita!", reason: "centered" });
                }
              }
            }
            

          } catch (e) {
            console.warn("Erro na detecção facial:", e);
          }
        } else {
          console.log("🚫 MediaPipe detector não disponível:", { 
            detector: !!mpDetectorRef.current, 
            vision: !!mpVisionRef.current 
          });
          setFacePresent(undefined);
          setFaceBox(undefined);
          if (enablePositionGuide) {
            setGuide({ level: "warn", message: "Detector facial não disponível - continue", reason: "no_detector" });
          }
        }
      }

      // Enviar telemetria apenas quando necessário (motion score significativo)
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && motionScore >= minMotionScore) {
        const tel: any = { type: "telemetry", motionScore };
        if (ahashHex) tel.ahash = ahashHex;
        
        console.log("📊 Telemetria enviada:", {
          motionScore: tel.motionScore?.toFixed(4),
          ahash: !!tel.ahash,
          threshold: minMotionScore
        });
        wsRef.current.send(JSON.stringify(tel));
      }
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const ts = Date.now();
        sendTimesRef.current.set(ts, performance.now());
        const reader = new FileReader();
        reader.onload = () => {
          const arr = new Uint8Array(reader.result as ArrayBuffer);
          const header = new Uint8Array(16);
          header.set([0x46, 0x50, 0x46, 0x31]);
          header[4] = 1;
          const view = new DataView(header.buffer);
          view.setBigUint64(8, BigInt(ts), true);
          const packet = new Uint8Array(header.length + arr.length);
          packet.set(header, 0);
          packet.set(arr, header.length);
          const ws2 = wsRef.current;
          if (ws2 && ws2.readyState === WebSocket.OPEN) ws2.send(packet);
        };
        reader.readAsArrayBuffer(blob);
      }, "image/jpeg", 0.7);
    }
  }, [enableClientHeuristics, maxFps, minMotionScore, phashIntervalFrames, send, targetFps, detectionIntervalFrames, bypassValidation]);

  const start = useCallback(async () => {
    setError(undefined);
    setStatus("connecting");

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
      if (!bypassValidation) {
        try {
          await (async () => {
            const mod: any = await import("@mediapipe/tasks-vision");
            const fileset = await mod.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
            mpVisionRef.current = mod;
            
            const modelPaths = [
              "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
              "https://storage.googleapis.com/mediapipe-assets/face_detection_short_range.tflite",
              "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/models/face_detection_short_range.tflite"
            ];
            
            let detector = null;
            for (const modelPath of modelPaths) {
              try {
                detector = await mod.FaceDetector.createFromOptions(fileset, { 
                  baseOptions: { modelAssetPath: modelPath }, 
                  runningMode: "VIDEO" 
                });
                break;
              } catch (e) {
                console.warn(`Falha ao carregar modelo de ${modelPath}:`, e);
              }
            }
            
            if (!detector) {
              console.warn("❌ Nenhum modelo de detecção facial pôde ser carregado. Detecção facial será desabilitada.");
            } else {
              console.log("✅ MediaPipe detector carregado com sucesso!");
            }
            
            mpDetectorRef.current = detector;
          })();
        } catch (e) {
          console.warn("Erro ao inicializar MediaPipe:", e);
        }
      } else {
        log('info', "🔄 Modo bypass ativado - MediaPipe desabilitado");
      }

      preparingRef.current = true;
      readyCountRef.current = 0;
      const prepareLoop = () => {
        if (!preparingRef.current) return;
        captureAndSendFrame();
        const v = document.querySelector("video[data-proof-of-life]") as HTMLVideoElement | null;
        const vw = v?.videoWidth || 320;
        const vh = v?.videoHeight || 240;
        let okNow = false;
        
        if (mpDetectorRef.current && facePresent && faceBox) {
          const area = faceBox.width * faceBox.height;
          const areaRatio = area / (vw * vh);
          const cx = faceBox.x + faceBox.width / 2;
          const cy = faceBox.y + faceBox.height / 2;
          const dx = Math.abs(cx - vw / 2) / vw;
          const dy = Math.abs(cy - vh / 2) / vh;
          okNow = areaRatio >= minFaceAreaRatio && areaRatio <= maxFaceAreaRatio && Math.max(dx, dy) <= centerTolerance;
          
          if (okNow) {
            readyCountRef.current += 1;
          } else {
            readyCountRef.current = 0;
          }
        } else {
          readyCountRef.current += 1;
        }
        
        const requiredReadyFrames = bypassValidation ? 2 : (mpDetectorRef.current ? 12 : 5);
        if (readyCountRef.current % 10 === 0 && readyCountRef.current < requiredReadyFrames * 2) {
          log('info', `Ready count: ${readyCountRef.current}/${requiredReadyFrames}`, { detector: !!mpDetectorRef.current, face: !!facePresent, bypass: bypassValidation });
        }
        if (readyCountRef.current >= requiredReadyFrames && !wsRef.current) {
          log('info', `Conectando ao WebSocket: ${wsUrl}`);
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;
          ws.onopen = () => {
            log('info', "WebSocket conectado, enviando hello");
            ws.send(JSON.stringify({ type: "hello", sessionId, token, client: { sdkVersion: "0.0.3", platform: "web", bypassValidation } }));
          };
          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              log('info', "Mensagem recebida do WebSocket", msg);
              if (msg.type === "helloAck") {
                log('info', "HelloAck recebido, iniciando streaming");
                setStatus("streaming");
                preparingRef.current = false;
                streamingRef.current = true;
                const loop = () => {
                  const wso = wsRef.current;
                  if (!streamingRef.current || !wso || wso.readyState !== WebSocket.OPEN) return;
                  captureAndSendFrame();
                  requestAnimationFrame(loop);
                };
                requestAnimationFrame(loop);
              } else if (msg.type === "prompt") {
                if (bypassValidation) {
                  log('info', "🔄 [BYPASS] Ignorando prompt - modo bypass ativo", msg.challenge?.kind);
                  return;
                }
                challengeCountRef.current += 1;
                log('info', `🎯 Desafio ${challengeCountRef.current} recebido`, {
                  id: msg.challenge?.id,
                  kind: msg.challenge?.kind,
                  timeout: msg.challenge?.timeoutMs
                });
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
                if (msg.face || msg.pad) {
                  log('info', "FrameAck com dados adicionais", { face: msg.face, pad: msg.pad });
                }
              } else if (msg.type === "result") {
                log('info', "Resultado recebido", msg.decision);
                setStatus(msg.decision?.passed ? "passed" : "failed");
                setLastPrompt(undefined); // Limpar prompt quando finalizar
                streamingRef.current = false;
              }
            } catch {}
          };
          ws.onerror = (error) => {
            log('error', "Erro no WebSocket", error);
            setError("ws-error");
          };
          ws.onclose = (event) => {
            log('info', `WebSocket fechado: ${event.code}`, event.reason);
          };
        }
        
        // Parar o loop se WebSocket já foi criado ou se passou muito do limite
        if (!wsRef.current && readyCountRef.current < requiredReadyFrames * 10) {
          requestAnimationFrame(prepareLoop);
        } else if (wsRef.current) {
          preparingRef.current = false;
        }
      };
      requestAnimationFrame(prepareLoop);
    } catch (e: any) {
      const name = e?.name || "getUserMediaError";
      setError(name);
      setStatus("failed");
      streamingRef.current = false;
      return;
    }
  }, [wsUrl, send, sessionId, token, videoConstraints, captureAndSendFrame, bypassValidation]);

  const stop = useCallback(async () => {
    wsRef.current?.close();
    wsRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setStatus("idle");
  }, []);

  return { status, start, stop, lastPrompt, error, rttMs, targetFps, throttled, lastAckAt, facePresent, faceBox, guide };
}


