import { useCallback, useMemo, useRef, useState } from "react";
export function useProofOfLife(opts) {
    const { backendUrl, sessionId, token, videoConstraints, maxFps = 15, enableClientHeuristics = true, minMotionScore = 0.02, phashIntervalFrames = 5, enablePositionGuide = true, minFaceAreaRatio = 0.12, maxFaceAreaRatio = 0.6, centerTolerance = 0.12, detectionIntervalFrames = 2 } = opts;
    const [status, setStatus] = useState("idle");
    const [lastPrompt, setLastPrompt] = useState();
    const [error, setError] = useState();
    const [rttMs, setRttMs] = useState();
    const [throttled, setThrottled] = useState(false);
    const [targetFps, setTargetFps] = useState(maxFps);
    const [lastAckAt, setLastAckAt] = useState();
    const wsRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const canvasRef = useRef(null);
    const lastFrameAtRef = useRef(0);
    const sendTimesRef = useRef(new Map());
    const streamingRef = useRef(false);
    const preparingRef = useRef(false);
    const readyCountRef = useRef(0);
    const lastSmallGrayRef = useRef(null);
    const frameCounterRef = useRef(0);
    const mpDetectorRef = useRef(null);
    const mpVisionRef = useRef(null);
    const [facePresent, setFacePresent] = useState(undefined);
    const [faceBox, setFaceBox] = useState(undefined);
    const [guide, setGuide] = useState(undefined);
    const challengeCountRef = useRef(0);
    const wsUrl = useMemo(() => backendUrl.replace(/^http/, "ws") + "/ws", [backendUrl]);
    const send = useCallback((msg) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }, []);
    const computeAHash = (data, w, h) => {
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
                gray[idx++] = g;
            }
        }
        let sum = 0;
        for (let i = 0; i < gray.length; i++)
            sum += (gray[i] ?? 0);
        const mean = sum / gray.length;
        let bitsBig = 0n;
        for (let i = 0; i < gray.length; i++) {
            const gv = gray[i] ?? 0;
            if (gv >= mean)
                bitsBig |= 1n << BigInt(i);
        }
        return bitsBig.toString(16);
    };
    const captureAndSendFrame = useCallback(() => {
        const now = performance.now();
        const interval = 1000 / (targetFps || maxFps);
        if (now - lastFrameAtRef.current < interval)
            return;
        lastFrameAtRef.current = now;
        const video = document.querySelector("video[data-proof-of-life]");
        if (!video)
            return;
        if (!canvasRef.current)
            canvasRef.current = document.createElement("canvas");
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = (canvas.getContext("2d", { willReadFrequently: true }) || canvas.getContext("2d"));
        if (!ctx)
            return;
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
                    const r = id.data[i] ?? 0;
                    const gch = id.data[i + 1] ?? 0;
                    const b = id.data[i + 2] ?? 0;
                    const g = (r * 0.299 + gch * 0.587 + b * 0.114) | 0;
                    small[p++] = g;
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
            let ahashHex;
            const n = (frameCounterRef.current = (frameCounterRef.current + 1) % 1000000);
            if (n % (phashIntervalFrames || 5) === 0) {
                ahashHex = computeAHash(id.data, w, h);
            }
            if ((frameCounterRef.current % (detectionIntervalFrames || 2)) === 0) {
                if (mpDetectorRef.current && mpVisionRef.current) {
                    try {
                        const res = mpDetectorRef.current.detectForVideo(video, now);
                        let present = false;
                        let box;
                        if (res && res.detections && res.detections.length > 0) {
                            present = true;
                            const d = res.detections[0];
                            const bb = d.boundingBox;
                            box = { x: Math.round(bb.originX), y: Math.round(bb.originY), width: Math.round(bb.width), height: Math.round(bb.height) };
                            console.log("🔍 MediaPipe detectou face:", { present, box });
                        }
                        else {
                            console.log("🔍 MediaPipe: nenhuma face detectada");
                        }
                        setFacePresent(present);
                        setFaceBox(box);
                        if (enablePositionGuide) {
                            const vw = video.videoWidth || 320;
                            const vh = video.videoHeight || 240;
                            if (!present) {
                                setGuide({ level: "error", message: "Posicione seu rosto na frente da câmera", reason: "no_face" });
                            }
                            else if (box) {
                                const area = box.width * box.height;
                                const areaRatio = area / (vw * vh);
                                const cx = box.x + box.width / 2;
                                const cy = box.y + box.height / 2;
                                const dx = Math.abs(cx - vw / 2) / vw;
                                const dy = Math.abs(cy - vh / 2) / vh;
                                if (areaRatio < minFaceAreaRatio) {
                                    setGuide({ level: "warn", message: "Aproxime-se da câmera", reason: "too_far" });
                                }
                                else if (areaRatio > maxFaceAreaRatio) {
                                    setGuide({ level: "warn", message: "Afaste-se da câmera", reason: "too_close" });
                                }
                                else if (dx > centerTolerance) {
                                    if (cx > vw / 2) {
                                        setGuide({ level: "warn", message: "Mova-se para a esquerda", reason: "face_right" });
                                    }
                                    else {
                                        setGuide({ level: "warn", message: "Mova-se para a direita", reason: "face_left" });
                                    }
                                }
                                else if (dy > centerTolerance) {
                                    if (cy > vh / 2) {
                                        setGuide({ level: "warn", message: "Mova-se para cima", reason: "face_down" });
                                    }
                                    else {
                                        setGuide({ level: "warn", message: "Mova-se para baixo", reason: "face_up" });
                                    }
                                }
                                else {
                                    setGuide({ level: "ok", message: "Posição perfeita!", reason: "centered" });
                                }
                            }
                        }
                    }
                    catch (e) {
                        console.warn("Erro na detecção facial:", e);
                    }
                }
                else {
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
                const tel = { type: "telemetry", motionScore };
                if (ahashHex)
                    tel.ahash = ahashHex;
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
                if (!blob)
                    return;
                const ts = Date.now();
                sendTimesRef.current.set(ts, performance.now());
                const reader = new FileReader();
                reader.onload = () => {
                    const arr = new Uint8Array(reader.result);
                    const header = new Uint8Array(16);
                    header.set([0x46, 0x50, 0x46, 0x31]);
                    header[4] = 1;
                    const view = new DataView(header.buffer);
                    view.setBigUint64(8, BigInt(ts), true);
                    const packet = new Uint8Array(header.length + arr.length);
                    packet.set(header, 0);
                    packet.set(arr, header.length);
                    const ws2 = wsRef.current;
                    if (ws2 && ws2.readyState === WebSocket.OPEN)
                        ws2.send(packet);
                };
                reader.readAsArrayBuffer(blob);
            }, "image/jpeg", 0.7);
        }
    }, [enableClientHeuristics, maxFps, minMotionScore, phashIntervalFrames, send, targetFps, detectionIntervalFrames]);
    const start = useCallback(async () => {
        setError(undefined);
        setStatus("connecting");
        try {
            const defaultConstraints = {
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
            const video = document.querySelector("video[data-proof-of-life]");
            if (video)
                video.srcObject = ms;
            try {
                await (async () => {
                    const mod = await import("@mediapipe/tasks-vision");
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
                        }
                        catch (e) {
                            console.warn(`Falha ao carregar modelo de ${modelPath}:`, e);
                        }
                    }
                    if (!detector) {
                        console.warn("❌ Nenhum modelo de detecção facial pôde ser carregado. Detecção facial será desabilitada.");
                    }
                    else {
                        console.log("✅ MediaPipe detector carregado com sucesso!");
                    }
                    mpDetectorRef.current = detector;
                })();
            }
            catch (e) {
                console.warn("Erro ao inicializar MediaPipe:", e);
            }
            preparingRef.current = true;
            readyCountRef.current = 0;
            const prepareLoop = () => {
                if (!preparingRef.current)
                    return;
                captureAndSendFrame();
                const v = document.querySelector("video[data-proof-of-life]");
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
                    }
                    else {
                        readyCountRef.current = 0;
                    }
                }
                else {
                    readyCountRef.current += 1;
                }
                const requiredReadyFrames = mpDetectorRef.current ? 12 : 5; // Mais frames para estabilidade
                if (readyCountRef.current % 10 === 0) {
                    console.log(`Ready count: ${readyCountRef.current}/${requiredReadyFrames}, detector: ${!!mpDetectorRef.current}, face: ${!!facePresent}`);
                }
                if (readyCountRef.current >= requiredReadyFrames && !wsRef.current) {
                    console.log(`Conectando ao WebSocket: ${wsUrl}`);
                    const ws = new WebSocket(wsUrl);
                    wsRef.current = ws;
                    ws.onopen = () => {
                        console.log("WebSocket conectado, enviando hello");
                        ws.send(JSON.stringify({ type: "hello", sessionId, token, client: { sdkVersion: "0.0.2", platform: "web" } }));
                    };
                    ws.onmessage = (ev) => {
                        try {
                            const msg = JSON.parse(ev.data);
                            console.log("Mensagem recebida do WebSocket:", JSON.stringify(msg, null, 2));
                            if (msg.type === "helloAck") {
                                console.log("HelloAck recebido, iniciando streaming");
                                setStatus("streaming");
                                preparingRef.current = false;
                                streamingRef.current = true;
                                const loop = () => {
                                    const wso = wsRef.current;
                                    if (!streamingRef.current || !wso || wso.readyState !== WebSocket.OPEN)
                                        return;
                                    captureAndSendFrame();
                                    requestAnimationFrame(loop);
                                };
                                requestAnimationFrame(loop);
                            }
                            else if (msg.type === "prompt") {
                                challengeCountRef.current += 1;
                                console.log(`🎯 Desafio ${challengeCountRef.current} recebido:`, {
                                    id: msg.challenge?.id,
                                    kind: msg.challenge?.kind,
                                    timeout: msg.challenge?.timeoutMs
                                });
                                setLastPrompt(msg.challenge);
                                setStatus("prompt");
                            }
                            else if (msg.type === "throttle") {
                                if (typeof msg.maxFps === "number") {
                                    setTargetFps((prev) => Math.min(prev, msg.maxFps));
                                    setThrottled(true);
                                    setTimeout(() => setThrottled(false), 1500);
                                }
                            }
                            else if (msg.type === "frameAck") {
                                const sentAt = sendTimesRef.current.get(msg.ts);
                                if (sentAt) {
                                    const rtt = Math.round(performance.now() - sentAt);
                                    setRttMs(rtt);
                                    send({ type: "telemetry", rttMs: rtt });
                                    sendTimesRef.current.delete(msg.ts);
                                }
                                setLastAckAt(Date.now());
                                if (msg.face || msg.pad) {
                                    console.log("FrameAck com dados adicionais:", { face: msg.face, pad: msg.pad });
                                }
                            }
                            else if (msg.type === "result") {
                                console.log("Resultado recebido:", msg.decision);
                                setStatus(msg.decision?.passed ? "passed" : "failed");
                                setLastPrompt(undefined); // Limpar prompt quando finalizar
                                streamingRef.current = false;
                            }
                        }
                        catch { }
                    };
                    ws.onerror = (error) => {
                        console.error("Erro no WebSocket:", error);
                        setError("ws-error");
                    };
                    ws.onclose = (event) => {
                        console.log("WebSocket fechado:", event.code, event.reason);
                    };
                }
                requestAnimationFrame(prepareLoop);
            };
            requestAnimationFrame(prepareLoop);
        }
        catch (e) {
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
    return { status, start, stop, lastPrompt, error, rttMs, targetFps, throttled, lastAckAt, facePresent, faceBox, guide };
}
