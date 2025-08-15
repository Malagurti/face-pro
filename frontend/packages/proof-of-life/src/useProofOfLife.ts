import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "idle" | "connecting" | "prompt" | "streaming" | "passed" | "failed";

interface ChallengeFrameData {
  timestamp: number;
  frameId: number;
  imageData?: string;
  motionScore?: number;
  ahash?: string;
  landmarks?: any;
  facePresent?: boolean;
  faceBox?: { x: number; y: number; width: number; height: number };
  telemetry?: {
    fps?: number;
    rttMs?: number;
    camWidth?: number;
    camHeight?: number;
  };
}

interface ChallengeDataBuffer {
  challengeId: string;
  challengeType: 'look_right' | 'look_left' | 'look_up' | 'open_mouth';
  startTime: number;
  frames: ChallengeFrameData[];
  metadata: {
    gestureDetected: boolean;
    completionTime?: number;
    totalFrames: number;
    bufferSizeBytes: number;
  };
  status: 'active' | 'completed' | 'failed' | 'sent';
}

export interface UseProofOfLifeOptions {
  backendUrl: string;
  sessionId: string;
  token: string;
  videoConstraints?: MediaTrackConstraints;
  maxFps?: number;
  enableClientHeuristics?: boolean;
  minMotionScore?: number;
  phashIntervalFrames?: number;
  enableLivenessChallenge?: boolean;
  detectionIntervalFrames?: number;
  bypassValidation?: boolean;
  maxBufferSize?: number;
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
  currentChallenge?: { type: 'look_right' | 'look_left' | 'look_up' | 'open_mouth'; id: string };
  challengeCompleted?: boolean;
  standaloneMode?: boolean;
  challengeStartTime?: number;
  challengeState?: 'idle' | 'active' | 'completed' | 'transitioning';
  totalChallenges?: number;
  maxChallenges?: number;
  bufferingMode?: boolean;
  bufferStats?: {
    currentFrames: number;
    currentSizeKB: number;
    totalBuffers: number;
  };
}

export function useProofOfLife(opts: UseProofOfLifeOptions): UseProofOfLifeResult {
  const { backendUrl, sessionId, token, videoConstraints, maxFps = 15, enableClientHeuristics = true, minMotionScore = 0.02, phashIntervalFrames = 5, enableLivenessChallenge = true, detectionIntervalFrames = 2, bypassValidation = false, maxBufferSize = 50, onLog } = opts;
  
  // Sistema de buffer sempre habilitado como modo principal
  const enableDataBuffering = true;

  // Otimizações para modo standalone
  const isStandaloneMode = useMemo(() => {
    return !backendUrl || !sessionId || !token || sessionId === "" || token === "";
  }, [backendUrl, sessionId, token]);

  // Intervalos otimizados para standalone
  const effectiveDetectionInterval = useMemo(() => {
    if (isStandaloneMode && enableLivenessChallenge) {
      return 8; // MediaPipe a cada 8 frames (7.5 FPS) em vez de 2 (30 FPS)
    }
    return detectionIntervalFrames;
  }, [isStandaloneMode, enableLivenessChallenge, detectionIntervalFrames]);

  const effectivePhashInterval = useMemo(() => {
    if (isStandaloneMode) {
      return 15; // Hash a cada 15 frames (4 FPS) em vez de 5 (12 FPS)
    }
    return phashIntervalFrames;
  }, [isStandaloneMode, phashIntervalFrames]);

  const effectiveMaxFps = useMemo(() => {
    if (isStandaloneMode && enableLivenessChallenge) {
      return 10; // Limitar a 10 FPS em standalone para economizar CPU
    }
    return maxFps;
  }, [isStandaloneMode, enableLivenessChallenge, maxFps]);
  
  // Debug: verificar props recebidas
  React.useEffect(() => {
    console.log('🔧 Props recebidas no useProofOfLife:', {
      backendUrl,
      sessionId,
      token,
      enableLivenessChallenge,
      bypassValidation,
      hasNoBackend: !backendUrl || !sessionId || !token,
      isStandaloneMode,
      effectiveDetectionInterval,
      effectivePhashInterval,
      effectiveMaxFps
    });
  }, [backendUrl, sessionId, token, enableLivenessChallenge, bypassValidation, isStandaloneMode, effectiveDetectionInterval, effectivePhashInterval, effectiveMaxFps]);
  const [status, setStatus] = useState<Status>("idle");
  const [lastPrompt, setLastPrompt] = useState<UseProofOfLifeResult["lastPrompt"]>();
  const [error, setError] = useState<string | undefined>();
  const [rttMs, setRttMs] = useState<number | undefined>();
  const [throttled, setThrottled] = useState<boolean>(false);
  const [targetFps, setTargetFps] = useState<number>(effectiveMaxFps);
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
  const mpLandmarkerRef = useRef<any>(null);
  const mpVisionRef = useRef<any>(null);
  const [facePresent, setFacePresent] = useState<boolean | undefined>(undefined);
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; width: number; height: number } | undefined>(undefined);
  const [currentChallenge, setCurrentChallenge] = useState<{ type: 'look_right' | 'look_left' | 'look_up' | 'open_mouth'; id: string } | undefined>(undefined);
  const [challengeCompleted, setChallengeCompleted] = useState<boolean>(false);
  const [standaloneMode, setStandaloneMode] = useState<boolean>(false);
  const [challengeStartTime, setChallengeStartTime] = useState<number>(0);
  const challengeTimeoutRef = useRef<number | null>(null);
  const challengeCountRef = useRef<number>(0);
  const landmarksRef = useRef<any>(null);
  const [challengeState, setChallengeState] = useState<'idle' | 'active' | 'completed' | 'transitioning'>('idle');
  const [totalChallenges, setTotalChallenges] = useState<number>(0);
  const maxChallenges = 3;
  const challengeQueue = useRef<Array<'look_right' | 'look_left' | 'look_up' | 'open_mouth'>>([]);
  const initializationRef = useRef<boolean>(false);
  const standaloneInitialized = useRef<boolean>(false);
  const currentChallengeRef = useRef<{ type: 'look_right' | 'look_left' | 'look_up' | 'open_mouth'; id: string } | undefined>(undefined);
  const challengeStateRef = useRef<'idle' | 'active' | 'completed' | 'transitioning'>('idle');
  const challengeCompletedRef = useRef<boolean>(false);
  const enableLivenessChallengeRef = useRef<boolean>(enableLivenessChallenge);
  
  // Buffer de dados por desafio
  const currentBufferRef = useRef<ChallengeDataBuffer | null>(null);
  const buffersHistoryRef = useRef<ChallengeDataBuffer[]>([]);
  const [bufferingMode, setBufferingMode] = useState<boolean>(false);
  const bufferingModeRef = useRef<boolean>(false);
  const prepareStartedAtRef = useRef<number>(0);
  const [bufferStats, setBufferStats] = useState<{
    currentFrames: number;
    currentSizeKB: number;
    totalBuffers: number;
  }>({
    currentFrames: 0,
    currentSizeKB: 0,
    totalBuffers: 0
  });
  const promptWatchdogRef = useRef<number | null>(null);

  useEffect(() => { currentChallengeRef.current = currentChallenge; }, [currentChallenge]);
  useEffect(() => { challengeStateRef.current = challengeState; }, [challengeState]);
  useEffect(() => { challengeCompletedRef.current = challengeCompleted; }, [challengeCompleted]);
  useEffect(() => { enableLivenessChallengeRef.current = enableLivenessChallenge; }, [enableLivenessChallenge]);

  const wsUrl = useMemo(() => backendUrl.replace(/^http/, "ws") + "/ws", [backendUrl]);

  // Analisadores de gestos
  const analyzeLookRight = useCallback((landmarks: any) => {
    if (!landmarks || landmarks.length === 0) {
      console.log("🔍 analyzeLookRight: sem landmarks");
      return false;
    }
    
    const leftEye = landmarks[33]; // Canto esquerdo do olho esquerdo
    const rightEye = landmarks[362]; // Canto direito do olho direito
    const noseTip = landmarks[1]; // Ponta do nariz
    
    if (!leftEye || !rightEye || !noseTip) {
      console.log("🔍 analyzeLookRight: landmarks insuficientes", { leftEye: !!leftEye, rightEye: !!rightEye, noseTip: !!noseTip });
      return false;
    }
    
    // Calcular se a cabeça está virada para a direita
    const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
    const noseOffset = noseTip.x - eyeCenter.x;
    
    console.log("👁️ analyzeLookRight:", { noseOffset, threshold: 0.09, detected: noseOffset > 0.09, eyeCenter: eyeCenter.x, noseTip: noseTip.x });
    // Se noseOffset > 0.03, nariz está à direita dos olhos = cabeça virada para direita
    // Threshold ajustado baseado nos logs reais observados
    return noseOffset > 0.09; // Threshold reduzido de 0.05 para 0.03
  }, []);

  const analyzeLookLeft = useCallback((landmarks: any) => {
    if (!landmarks || landmarks.length === 0) return false;
    
    const leftEye = landmarks[33];
    const rightEye = landmarks[362];
    const noseTip = landmarks[1];
    
    if (!leftEye || !rightEye || !noseTip) return false;
    
    const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
    const noseOffset = noseTip.x - eyeCenter.x;
    
    console.log("👁️ analyzeLookLeft:", { noseOffset, threshold: 0.09, detected: noseOffset > 0.09, eyeCenter: eyeCenter.x, noseTip: noseTip.x });
    // Se noseOffset > 0.10, nariz está à direita dos olhos = cabeça virada para esquerda
    // Threshold ajustado baseado nos logs reais observados
    return noseOffset > 0.09; // Threshold reduzido de 0.12 para 0.10
  }, []);

  const analyzeLookUp = useCallback((landmarks: any) => {
    if (!landmarks || landmarks.length === 0) return false;
    
    const eyebrowLeft = landmarks[70]; // Sobrancelha esquerda
    const eyebrowRight = landmarks[107]; // Sobrancelha direita
    const chinBottom = landmarks[175]; // Parte inferior do queixo
    
    if (!eyebrowLeft || !eyebrowRight || !chinBottom) return false;
    
    const eyebrowCenter = { x: (eyebrowLeft.x + eyebrowRight.x) / 2, y: (eyebrowLeft.y + eyebrowRight.y) / 2 };
    const faceHeight = Math.abs(chinBottom.y - eyebrowCenter.y);
    
    console.log("👁️ analyzeLookUp:", { faceHeight, threshold: 0.32, detected: faceHeight < 0.32, eyebrowY: eyebrowCenter.y, chinY: chinBottom.y });
    // Detectar se a cabeça está levantada (face comprimida verticalmente)
    // Threshold baseado em pesquisa: equivale a ~15-20° de rotação pitch
    return faceHeight < 0.32; // Threshold otimizado baseado em melhores práticas
  }, []);

  const analyzeOpenMouth = useCallback((landmarks: any) => {
    if (!landmarks || landmarks.length === 0) return false;
    
    const upperLip = landmarks[13]; // Lábio superior
    const lowerLip = landmarks[14]; // Lábio inferior
    const mouthLeft = landmarks[308]; // Canto esquerdo da boca
    const mouthRight = landmarks[78]; // Canto direito da boca
    
    if (!upperLip || !lowerLip || !mouthLeft || !mouthRight) return false;
    
    const mouthHeight = Math.abs(lowerLip.y - upperLip.y);
    const mouthWidth = Math.abs(mouthRight.x - mouthLeft.x);
    const mouthAspectRatio = mouthHeight / mouthWidth;
    
    console.log("👁️ analyzeOpenMouth:", { mouthHeight, mouthWidth, mouthAspectRatio, threshold: 0.6, detected: mouthAspectRatio > 0.6 });
    return mouthAspectRatio > 0.6; // Threshold otimizado baseado em melhores práticas
  }, []);

  const analyzeGesture = useCallback((landmarks: any) => {
    // Usar ref para consistência com o loop de detecção
    const currentChallengeFromRef = currentChallengeRef.current;
    if (!currentChallengeFromRef || !landmarks) {
      console.log("🔍 analyzeGesture: sem desafio ou landmarks", { 
        hasChallenge: !!currentChallengeFromRef, 
        hasLandmarks: !!landmarks,
        challengeFromRef: currentChallengeFromRef,
        challengeFromState: currentChallenge
      });
      return false;
    }
    
    console.log("🎯 Analisando gesto para:", currentChallengeFromRef.type);
    
    switch (currentChallengeFromRef.type) {
      case 'look_right':
        return analyzeLookRight(landmarks);
      case 'look_left':
        return analyzeLookLeft(landmarks);
      case 'look_up':
        return analyzeLookUp(landmarks);
      case 'open_mouth':
        return analyzeOpenMouth(landmarks);
      default:
        console.log("❌ Tipo de desafio desconhecido:", currentChallengeFromRef.type);
        return false;
    }
  }, [currentChallenge, analyzeLookRight, analyzeLookLeft, analyzeLookUp, analyzeOpenMouth]);

  const logRef = useRef(onLog);
  logRef.current = onLog;

  const log = useCallback((level: 'info' | 'warn' | 'error', message: string, data?: any) => {
    if (logRef.current) {
      logRef.current(level, message, data);
    } else {
      const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      logFn(message, data || '');
    }
  }, []);

  // Funções para gerenciar buffer de dados
  const createChallengeBuffer = useCallback((challenge: { type: 'look_right' | 'look_left' | 'look_up' | 'open_mouth'; id: string }) => {
    console.log('🔧 createChallengeBuffer chamado com:', challenge);
    
    const buffer: ChallengeDataBuffer = {
      challengeId: challenge.id,
      challengeType: challenge.type,
      startTime: Date.now(),
      frames: [],
      metadata: {
        gestureDetected: false,
        totalFrames: 0,
        bufferSizeBytes: 0
      },
      status: 'active'
    };
    
    currentBufferRef.current = buffer;
    console.log('📦 Buffer criado e armazenado em currentBufferRef:', {
      challengeId: buffer.challengeId,
      type: buffer.challengeType,
      status: buffer.status,
      hasCurrentBuffer: !!currentBufferRef.current
    });
    
    log('info', '📦 Buffer criado para desafio', { challengeId: challenge.id, type: challenge.type });
    
    return buffer;
  }, [log]);

  const updateBufferStats = useCallback(() => {
    const current = currentBufferRef.current;
    const newStats = {
      currentFrames: current?.frames.length || 0,
      currentSizeKB: current ? (current.metadata.bufferSizeBytes / 1024) : 0,
      totalBuffers: buffersHistoryRef.current.length
    };
    setBufferStats(newStats);
  }, []);

  const addFrameToBuffer = useCallback((frameData: ChallengeFrameData) => {
    const buffer = currentBufferRef.current;
    if (!buffer || buffer.status !== 'active') {
      console.log('⚠️ addFrameToBuffer falhou:', {
        hasBuffer: !!buffer,
        bufferStatus: buffer?.status,
        challengeId: buffer?.challengeId
      });
      return false;
    }

    // Verificar limite de tamanho do buffer
    if (buffer.frames.length >= maxBufferSize) {
      log('warn', '⚠️ Buffer atingiu tamanho máximo, removendo frame mais antigo', { 
        challengeId: buffer.challengeId,
        currentSize: buffer.frames.length,
        maxSize: maxBufferSize
      });
      buffer.frames.shift(); // Remove o frame mais antigo
    }

    buffer.frames.push(frameData);
    buffer.metadata.totalFrames = buffer.frames.length;
    
    // Calcular tamanho aproximado do buffer
    const frameSize = (frameData.imageData?.length || 0) + JSON.stringify(frameData).length;
    buffer.metadata.bufferSizeBytes += frameSize;

    // Atualizar estatísticas
    updateBufferStats();

    return true;
  }, [maxBufferSize, log, updateBufferStats]);

  const cleanupOldBuffers = useCallback(() => {
    const maxHistorySize = 5; // Manter apenas os últimos 5 buffers no histórico
    
    if (buffersHistoryRef.current.length > maxHistorySize) {
      const removed = buffersHistoryRef.current.splice(0, buffersHistoryRef.current.length - maxHistorySize);
      log('info', `🧹 Buffers antigos removidos da memória`, { 
        removedCount: removed.length,
        currentHistorySize: buffersHistoryRef.current.length
      });
    }
    
    // Calcular uso total de memória dos buffers
    const totalMemoryBytes = buffersHistoryRef.current.reduce((acc, buffer) => {
      return acc + buffer.metadata.bufferSizeBytes;
    }, 0);
    
    const currentBufferSize = currentBufferRef.current?.metadata.bufferSizeBytes || 0;
    const totalMemoryMB = (totalMemoryBytes + currentBufferSize) / (1024 * 1024);
    
    if (totalMemoryMB > 50) { // Limite de 50MB
      log('warn', '⚠️ Uso de memória dos buffers está alto', { 
        totalMemoryMB: totalMemoryMB.toFixed(2),
        buffersCount: buffersHistoryRef.current.length
      });
      
      // Remover metade dos buffers mais antigos
      const toRemove = Math.floor(buffersHistoryRef.current.length / 2);
      buffersHistoryRef.current.splice(0, toRemove);
      log('info', `🧹 Buffers removidos por alto uso de memória`, { removedCount: toRemove });
    }
  }, [log]);

  const completeBuffer = useCallback((gestureDetected: boolean = false) => {
    const buffer = currentBufferRef.current;
    if (!buffer) {
      log('warn', '⚠️ Tentativa de completar buffer inexistente');
      return null;
    }

    buffer.status = gestureDetected ? 'completed' : 'failed';
    buffer.metadata.gestureDetected = gestureDetected;
    buffer.metadata.completionTime = Date.now() - buffer.startTime;

    log('info', `📦 Buffer ${gestureDetected ? 'completado' : 'falhado'}`, {
      challengeId: buffer.challengeId,
      type: buffer.challengeType,
      frames: buffer.metadata.totalFrames,
      completionTime: buffer.metadata.completionTime,
      sizeKB: (buffer.metadata.bufferSizeBytes / 1024).toFixed(2)
    });

    // Mover para histórico
    buffersHistoryRef.current.push(buffer);
    
    // Executar limpeza de memória
    cleanupOldBuffers();
    
    return buffer;
  }, [log, cleanupOldBuffers]);

  const clearCurrentBuffer = useCallback(() => {
    if (currentBufferRef.current) {
      log('info', '🗑️ Limpando buffer atual', { challengeId: currentBufferRef.current.challengeId });
    }
    currentBufferRef.current = null;
  }, [log]);

  const sendBufferToStandalone = useCallback(async (buffer: ChallengeDataBuffer) => {
    if (!buffer || buffer.status !== 'completed') {
      log('warn', '⚠️ Tentativa de processar buffer inválido no standalone', { 
        hasBuffer: !!buffer, 
        status: buffer?.status 
      });
      return false;
    }

    try {
      log('info', '🧪 [STANDALONE] Processando buffer completo', {
        challengeId: buffer.challengeId,
        type: buffer.challengeType,
        frames: buffer.frames.length,
        sizeKB: (buffer.metadata.bufferSizeBytes / 1024).toFixed(2),
        completionTime: buffer.metadata.completionTime
      });

      // Simular processamento detalhado dos dados
      const summary = {
        challengeId: buffer.challengeId,
        challengeType: buffer.challengeType,
        startTime: new Date(buffer.startTime).toISOString(),
        completionTime: buffer.metadata.completionTime,
        totalFrames: buffer.frames.length,
        bufferSizeKB: (buffer.metadata.bufferSizeBytes / 1024).toFixed(2),
        gestureDetected: buffer.metadata.gestureDetected,
        framesSample: buffer.frames.slice(0, 3).map(frame => ({
          timestamp: frame.timestamp,
          frameId: frame.frameId,
          motionScore: frame.motionScore?.toFixed(4),
          hasImage: !!frame.imageData,
          imageSizeKB: frame.imageData ? (frame.imageData.length / 1024).toFixed(2) : '0',
          facePresent: frame.facePresent,
          faceBox: frame.faceBox,
          hasLandmarks: !!frame.landmarks,
          landmarksCount: frame.landmarks?.length || 0,
          ahash: frame.ahash ? frame.ahash.substring(0, 8) + '...' : 'none'
        }))
      };

      // Log detalhado dos primeiros frames para análise
      log('info', '🔍 [STANDALONE] Análise detalhada do buffer', summary);

      // Simular análise de qualidade dos dados
      const qualityMetrics = {
        averageMotionScore: buffer.frames.reduce((acc, frame) => acc + (frame.motionScore || 0), 0) / buffer.frames.length,
        framesWithFace: buffer.frames.filter(frame => frame.facePresent).length,
        framesWithLandmarks: buffer.frames.filter(frame => frame.landmarks).length,
        framesWithImages: buffer.frames.filter(frame => frame.imageData).length,
        uniqueAhashes: new Set(buffer.frames.map(frame => frame.ahash).filter(Boolean)).size
      };

      log('info', '📊 [STANDALONE] Métricas de qualidade dos dados', {
        ...qualityMetrics,
        faceDetectionRate: ((qualityMetrics.framesWithFace / buffer.frames.length) * 100).toFixed(1) + '%',
        landmarkDetectionRate: ((qualityMetrics.framesWithLandmarks / buffer.frames.length) * 100).toFixed(1) + '%',
        imageAvailabilityRate: ((qualityMetrics.framesWithImages / buffer.frames.length) * 100).toFixed(1) + '%'
      });

      // Simular decisão do backend baseada nos dados
      const decision = {
        passed: buffer.metadata.gestureDetected && qualityMetrics.framesWithFace > buffer.frames.length * 0.7,
        confidence: Math.min(0.95, qualityMetrics.framesWithFace / buffer.frames.length + (buffer.metadata.gestureDetected ? 0.2 : 0)),
        reasons: [
          buffer.metadata.gestureDetected ? `Gesto ${buffer.challengeType} detectado` : 'Gesto não detectado',
          `${qualityMetrics.framesWithFace}/${buffer.frames.length} frames com face detectada`,
          `Tempo de conclusão: ${buffer.metadata.completionTime}ms`
        ]
      };

      log('info', '🎯 [STANDALONE] Decisão simulada do backend', decision);

      // Simular delay de processamento
      await new Promise(resolve => setTimeout(resolve, 200));
      
      buffer.status = 'sent';
      log('info', '✅ [STANDALONE] Processamento completo', { 
        challengeId: buffer.challengeId,
        decision: decision.passed ? 'APROVADO' : 'REJEITADO',
        confidence: (decision.confidence * 100).toFixed(1) + '%'
      });
      
      return true;
    } catch (error) {
      log('error', '❌ [STANDALONE] Erro ao processar buffer', { challengeId: buffer.challengeId, error });
      return false;
    }
  }, [log]);

  const sendBufferToBackend = useCallback(async (buffer: ChallengeDataBuffer) => {
    if (!buffer || buffer.status !== 'completed') {
      log('warn', '⚠️ Tentativa de enviar buffer inválido', { 
        hasBuffer: !!buffer, 
        status: buffer?.status 
      });
      return false;
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('warn', '⚠️ WebSocket não está conectado para enviar buffer');
      return false;
    }

    try {
      log('info', '🚀 Enviando buffer completo para backend', {
        challengeId: buffer.challengeId,
        type: buffer.challengeType,
        frames: buffer.frames.length,
        sizeKB: (buffer.metadata.bufferSizeBytes / 1024).toFixed(2)
      });

      // Enviar metadados do desafio primeiro
      const challengeStartMessage = {
        type: "challengeStart",
        challengeId: buffer.challengeId,
        challengeType: buffer.challengeType,
        startTime: buffer.startTime,
        totalFrames: buffer.frames.length,
        completionTime: buffer.metadata.completionTime,
        gestureDetected: buffer.metadata.gestureDetected
      };
      
      ws.send(JSON.stringify(challengeStartMessage));

      // Enviar frames em lote (pode ser necessário dividir se muito grande)
      const batchSize = 10; // Enviar 10 frames por vez
      for (let i = 0; i < buffer.frames.length; i += batchSize) {
        const frameBatch = buffer.frames.slice(i, i + batchSize);
        
        const batchMessage = {
          type: "challengeFrameBatch",
          challengeId: buffer.challengeId,
          batchIndex: Math.floor(i / batchSize),
          frames: frameBatch.map(frame => ({
            timestamp: frame.timestamp,
            frameId: frame.frameId,
            imageData: frame.imageData,
            motionScore: frame.motionScore,
            ahash: frame.ahash,
            facePresent: frame.facePresent,
            faceBox: frame.faceBox,
            landmarks: frame.landmarks,
            telemetry: frame.telemetry
          }))
        };

        ws.send(JSON.stringify(batchMessage));
        
        // Pequeno delay entre batches para não sobrecarregar
        if (i + batchSize < buffer.frames.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Sinalizar fim do envio
      const challengeEndMessage = {
        type: "challengeEnd", 
        challengeId: buffer.challengeId,
        timestamp: Date.now()
      };
      
      ws.send(JSON.stringify(challengeEndMessage));
      
      buffer.status = 'sent';
      log('info', '✅ Buffer enviado com sucesso', { challengeId: buffer.challengeId });
      
      return true;
    } catch (error) {
      log('error', '❌ Erro ao enviar buffer', { challengeId: buffer.challengeId, error });
      return false;
    }
  }, [log]);

  // Sistema de desafios controlados sequencialmente
  const generateChallengeQueueRef = useRef(() => {
    log('info', '🎲 Gerando nova fila de desafios...');
    const allChallenges: Array<'look_right' | 'look_left' | 'look_up' | 'open_mouth'> = ['look_right', 'look_left', 'look_up', 'open_mouth'];
    const shuffled = [...allChallenges].sort(() => Math.random() - 0.5);
    challengeQueue.current = shuffled.slice(0, maxChallenges);
    log('info', `🎯 Fila de ${maxChallenges} desafios gerada:`, challengeQueue.current);
  });

  const generateChallengeQueue = useCallback(() => {
    generateChallengeQueueRef.current();
  }, []);

  const startNextChallengeRef = useRef<() => void>();
  
  startNextChallengeRef.current = () => {
    log('info', '🎯 startNextChallenge executado!', {
      challengeState,
      totalChallenges,
      maxChallenges,
      queueLength: challengeQueue.current.length
    });
    
    console.log('🔍 Verificação de estado em startNextChallenge:', {
      challengeState,
      challengeStateRef: challengeStateRef.current,
      currentChallenge: currentChallengeRef.current,
      challengeCompleted: challengeCompletedRef.current
    });
    
    if (challengeState !== 'idle' && challengeState !== 'transitioning') {
      log('warn', '⚠️ Tentativa de iniciar desafio com estado inválido:', challengeState);
      return;
    }

    if (totalChallenges >= maxChallenges) {
      log('info', '🏁 Todos os desafios foram completados!');
      setChallengeState('completed');
      setStatus('passed');
      return;
    }

    if (challengeQueue.current.length === 0) {
      log('info', '📝 Fila de desafios vazia, gerando nova...');
      generateChallengeQueueRef.current();
    }

    const nextChallengeType = challengeQueue.current.shift();
    if (!nextChallengeType) {
      log('error', '❌ Erro: fila de desafios vazia após geração');
      return;
    }

    const challengeId = `challenge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newChallenge = {
      type: nextChallengeType,
      id: challengeId
    };
    
    log('info', '🔄 Atualizando estados para novo desafio...', newChallenge);
    
    setCurrentChallenge(newChallenge);
    currentChallengeRef.current = newChallenge;
    setChallengeCompleted(false);
    challengeCompletedRef.current = false;
    setChallengeState('active');
    challengeStateRef.current = 'active';
    setChallengeStartTime(Date.now());
    setTotalChallenges(prev => prev + 1);
    
    // Criar buffer para o novo desafio (funciona em standalone e backend)
    if (enableDataBuffering) {
      createChallengeBuffer(newChallenge);
      setBufferingMode(true);
      bufferingModeRef.current = true;
      console.log('🔧 setBufferingMode(true) chamado para desafio:', newChallenge.id);
      log('info', '📦 Modo buffering ativado para desafio', { 
        challengeId: newChallenge.id,
        mode: isStandaloneMode ? 'standalone' : 'backend'
      });
    }
    
    log('info', `🎯 Desafio ${totalChallenges + 1}/${maxChallenges}: ${nextChallengeType}`, { id: challengeId });
    console.log('📌 Estado após iniciar desafio:', {
      currentChallenge: currentChallengeRef.current,
      challengeState: challengeStateRef.current,
      challengeCompleted: challengeCompletedRef.current
    });
    
    // Verificação adicional para debug
    setTimeout(() => {
      console.log('🔍 Verificação tardia dos refs:', {
        currentChallengeRef: currentChallengeRef.current,
        challengeStateRef: challengeStateRef.current,
        challengeCompletedRef: challengeCompletedRef.current
      });
    }, 100);
    
    // Timeout de 15 segundos para o desafio
    if (challengeTimeoutRef.current) {
      clearTimeout(challengeTimeoutRef.current);
    }
    
    challengeTimeoutRef.current = window.setTimeout(() => {
      log('warn', `⏰ Desafio ${nextChallengeType} expirou - próximo desafio`);
      
      // Falhar buffer se estiver ativo (funciona em standalone e backend)
      if (enableDataBuffering && currentBufferRef.current) {
        completeBuffer(false); // false = falhou
        clearCurrentBuffer();
        setBufferingMode(false);
        bufferingModeRef.current = false;
        log('info', '🗑️ Buffer descartado devido ao timeout do desafio', {
          mode: isStandaloneMode ? 'standalone' : 'backend'
        });
      }
      
      setChallengeState('transitioning');
      challengeStateRef.current = 'transitioning';
      setTimeout(() => startNextChallengeRef.current?.(), 1000);
    }, 15000);
  };

  const startNextChallenge = useCallback(() => {
    startNextChallengeRef.current?.();
  }, []);

  const completeCurrentChallengeRef = useRef<() => void>();
  
  completeCurrentChallengeRef.current = () => {
    console.log('🔍 Verificação em completeCurrentChallenge:', {
      currentChallengeRef: currentChallengeRef.current,
      challengeCompletedRef: challengeCompletedRef.current,
      challengeStateRef: challengeStateRef.current
    });
    
    if (!currentChallengeRef.current || challengeCompletedRef.current || challengeStateRef.current !== 'active') {
      console.log('⚠️ Condições não atendidas para completar desafio');
      return;
    }

    setChallengeCompleted(true);
    challengeCompletedRef.current = true;
    setChallengeState('transitioning');
    challengeStateRef.current = 'transitioning';
    const completionTime = Date.now() - challengeStartTime;
    
    log('info', `✅ Desafio ${currentChallengeRef.current?.type} completado em ${completionTime}ms! (${totalChallenges}/${maxChallenges})`);
    
    // Limpar timeout do desafio atual
    if (challengeTimeoutRef.current) {
      clearTimeout(challengeTimeoutRef.current);
      challengeTimeoutRef.current = null;
    }
    
    // Completar buffer e enviar para o backend (funciona tanto com backend quanto standalone)
    if (enableDataBuffering && currentBufferRef.current) {
      const completedBuffer = completeBuffer(true);
      if (completedBuffer) {
        if (isStandaloneMode) {
          // Modo standalone: simular envio para logs e teste
          sendBufferToStandalone(completedBuffer).then((success) => {
            if (success) {
              log('info', '✅ Buffer processado com sucesso no modo standalone');
            } else {
              log('error', '❌ Falha ao processar buffer no modo standalone');
            }
          });
        } else {
          // Modo backend: enviar buffer completo de forma assíncrona
          sendBufferToBackend(completedBuffer).then((success) => {
            if (success) {
              log('info', '✅ Buffer enviado com sucesso após completar desafio');
            } else {
              log('error', '❌ Falha ao enviar buffer após completar desafio');
            }
          });
        }
      }
      clearCurrentBuffer();
      setBufferingMode(false);
      bufferingModeRef.current = false;
    } else {
      // Modo tradicional: enviar resultado individual para o backend (se conectado)
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "challengeResponse",
          challengeId: currentChallengeRef.current?.id,
          completed: true,
          completionTime,
          timestamp: Date.now()
        }));
      }
    }
    
    setTimeout(() => {
      setChallengeState('idle');
      challengeStateRef.current = 'idle';
      if (isStandaloneMode) {
        startNextChallengeRef.current?.();
      }
    }, 2000);
  };

  const completeCurrentChallenge = useCallback(() => {
    completeCurrentChallengeRef.current?.();
  }, []);

  // Função para iniciar modo standalone (sem backend)
  const startStandaloneMode = useCallback(() => {
    if (standaloneInitialized.current) {
      log('warn', '⚠️ Modo standalone já foi inicializado');
      return;
    }
    
    standaloneInitialized.current = true;
    setStandaloneMode(true);
    setStatus("streaming");
    setChallengeState('idle');
    setTotalChallenges(0);
    log('info', `🚀 Modo standalone iniciado - ${maxChallenges} desafios serão gerados sequencialmente`);
    
    // Gerar fila de desafios e iniciar primeiro após 2 segundos
    if (enableLivenessChallenge) {
      log('info', '🎯 Gerando fila de desafios...');
      generateChallengeQueueRef.current();
      setTimeout(() => {
        log('info', '🎯 Iniciando primeiro desafio...');
        console.log('🔍 Estado antes de iniciar desafio:', {
          challengeState,
          totalChallenges,
          currentChallenge: currentChallengeRef.current,
          challengeStateRef: challengeStateRef.current
        });
        startNextChallengeRef.current?.();
      }, 2000);
    } else {
      log('warn', '⚠️ enableLivenessChallenge está desabilitado');
    }
  }, [enableLivenessChallenge, maxChallenges, log]);

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
    canvas.width = video.videoWidth || 700;
    canvas.height = video.videoHeight || 500;
    const ctx = (canvas.getContext("2d", { willReadFrequently: true } as any) || canvas.getContext("2d")) as CanvasRenderingContext2D | null;
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Verificar se devemos usar buffer ou enviar diretamente
      const shouldBuffer = enableDataBuffering && bufferingModeRef.current && currentBufferRef.current;
      
      // Debug mais frequente para identificar o problema
      if (frameCounterRef.current % 10 === 0) {
        console.log('🔍 shouldBuffer debug (a cada 10 frames):', {
          enableDataBuffering,
          bufferingMode,
          bufferingModeRef: bufferingModeRef.current,
          hasCurrentBuffer: !!currentBufferRef.current,
          shouldBuffer,
          frameCounter: frameCounterRef.current
        });
      }
      
      // Debug detalhado da lógica de buffer
      if (frameCounterRef.current % 30 === 0) {
        console.log('🔍 Debug lógica de buffer (console):', {
          enableDataBuffering,
          bufferingMode,
          bufferingModeRef: bufferingModeRef.current,
          hasCurrentBuffer: !!currentBufferRef.current,
          shouldBuffer,
          challengeId: currentBufferRef.current?.challengeId,
          bufferStatus: currentBufferRef.current?.status
        });
        log('info', '🔍 Debug lógica de buffer:', {
          enableDataBuffering,
          bufferingMode,
          hasCurrentBuffer: !!currentBufferRef.current,
          shouldBuffer,
          challengeId: currentBufferRef.current?.challengeId,
          bufferStatus: currentBufferRef.current?.status
        });
      }

    if (bypassValidation) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Reduzir resolução para 350x250 para manter qualidade adequada
      const reducedCanvas = document.createElement('canvas');
      reducedCanvas.width = 350;
      reducedCanvas.height = 250;
      const reducedCtx = reducedCanvas.getContext('2d');
      if (reducedCtx) {
        reducedCtx.drawImage(canvas, 0, 0, 350, 250);
        var reducedImageData = reducedCtx.getImageData(0, 0, 350, 250);
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
      // Otimização: processar imagem apenas quando necessário
      const shouldProcessImage = !isStandaloneMode || (frameCounterRef.current % 3 === 0); // A cada 3 frames em standalone
      
      let id: ImageData | undefined;
      let w: number = canvas.width;
      let h: number = canvas.height;
      let motionScore = 0;
      
      if (shouldProcessImage) {
        id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        w = id.width;
        h = id.height;
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
      }

      let ahashHex: string | undefined;
      const n = (frameCounterRef.current = (frameCounterRef.current + 1) % 1000000);
      if (n % (effectivePhashInterval || 5) === 0 && id) {
        ahashHex = computeAHash(id.data, w, h);
      }

      if ((frameCounterRef.current % (effectiveDetectionInterval || 2)) === 0) {
        if (mpDetectorRef.current && mpLandmarkerRef.current && mpVisionRef.current) {
          // Validar se o vídeo está pronto e tem dimensões válidas
          if (!video || !video.videoWidth || !video.videoHeight || video.videoWidth === 0 || video.videoHeight === 0) {
            console.log("🚫 Vídeo não está pronto para MediaPipe:", { 
              width: video?.videoWidth, 
              height: video?.videoHeight,
              readyState: video?.readyState 
            });
            return;
          }

          try {
            // Detecção facial
            const detectionRes = mpDetectorRef.current.detectForVideo(video, now);
            let present = false;
            let box: { x: number; y: number; width: number; height: number } | undefined;
            
            if (detectionRes && detectionRes.detections && detectionRes.detections.length > 0) {
              present = true;
              const d = detectionRes.detections[0];
              const bb = d.boundingBox;
              box = { x: Math.round(bb.originX), y: Math.round(bb.originY), width: Math.round(bb.width), height: Math.round(bb.height) };
              
              // Face Landmarks quando face detectada
              const landmarkRes = mpLandmarkerRef.current.detectForVideo(video, now);
              if (landmarkRes && landmarkRes.faceLandmarks && landmarkRes.faceLandmarks.length > 0) {
                const landmarks = landmarkRes.faceLandmarks[0];
                landmarksRef.current = landmarks;
                
                // Debug: verificar se temos desafio ativo (via refs para evitar stale state)
                const dbgCurrent = currentChallengeRef.current;
                const dbgState = challengeStateRef.current;
                const dbgCompleted = challengeCompletedRef.current;
                const dbgEnabled = enableLivenessChallengeRef.current;
                console.log("🎯 Debug análise gestos:", {
                  hasChallenge: !!dbgCurrent,
                  challengeType: dbgCurrent?.type,
                  challengeState: dbgState,
                  enableLivenessChallenge: dbgEnabled,
                  challengeCompleted: dbgCompleted,
                  landmarksCount: landmarks.length
                });
                
                // Analisar gestos se há desafio ativo (usando refs para consistência no loop)
                if (dbgCurrent && dbgEnabled && dbgState === 'active') {
                  console.log("🎯 Iniciando análise de gesto para:", {
                    challengeType: dbgCurrent.type,
                    challengeId: dbgCurrent.id,
                    landmarksCount: landmarks.length
                  });
                  
                  const gestureDetected = analyzeGesture(landmarks);
                  console.log("👁️ Gesto analisado:", {
                    challengeType: dbgCurrent.type,
                    gestureDetected,
                    challengeCompleted: dbgCompleted
                  });
                  
                  if (gestureDetected && !dbgCompleted) {
                    console.log("✅ Gesto detectado! Completando desafio...");
                    completeCurrentChallenge();
                  }
                } else {
                  console.log("⚠️ Condições não atendidas para análise:", {
                    hasChallenge: !!dbgCurrent,
                    challengeEnabled: dbgEnabled,
                    challengeState: dbgState,
                    challengeCompleted: dbgCompleted
                  });
                }
              } else {
                landmarksRef.current = null;
              }
              
              console.log("🔍 MediaPipe detectou face:", { present, box, landmarks: !!landmarksRef.current });
            } else {
              console.log("🔍 MediaPipe: nenhuma face detectada");
              landmarksRef.current = null;
            }
            
            setFacePresent(present);
            setFaceBox(box);

          } catch (e) {
            console.warn("Erro na detecção facial:", e);
          }
        } else {
          console.log("🚫 MediaPipe não disponível:", { 
            detector: !!mpDetectorRef.current, 
            landmarker: !!mpLandmarkerRef.current,
            vision: !!mpVisionRef.current 
          });
          setFacePresent(undefined);
          setFaceBox(undefined);
          landmarksRef.current = null;
        }
      }

      // Preparar dados do frame para buffer ou envio direto
      const frameData: ChallengeFrameData = {
        timestamp: now,
        frameId: Date.now(),
        motionScore,
        ahash: ahashHex,
        landmarks: landmarksRef.current,
        facePresent,
        faceBox,
        telemetry: {
          fps: targetFps,
          rttMs,
          camWidth: canvas.width,
          camHeight: canvas.height
        }
      };
      
      if (shouldBuffer) {
        // Modo buffer: adicionar dados ao buffer atual
        const added = addFrameToBuffer(frameData);
        if (added && frameCounterRef.current % 30 === 0) {
          log('info', '📦 Frame adicionado ao buffer', {
            challengeId: currentBufferRef.current?.challengeId,
            framesInBuffer: currentBufferRef.current?.frames.length,
            bufferSizeKB: ((currentBufferRef.current?.metadata.bufferSizeBytes || 0) / 1024).toFixed(2)
          });
        }
      } else {
        // Modo tradicional: enviar telemetria diretamente quando necessário
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
    }
    
    // Enviar imagem apenas se não estiver em modo buffer ou se for modo tradicional
    const shouldSendImage = !shouldBuffer || bypassValidation;
    const ws = wsRef.current;
    
    if (shouldSendImage && ws && ws.readyState === WebSocket.OPEN) {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const ts = Date.now();
        sendTimesRef.current.set(ts, performance.now());
        const reader = new FileReader();
        reader.onload = () => {
          if (shouldBuffer && currentBufferRef.current) {
            // Se estamos em modo buffer, adicionar imagem ao frame buffer mais recente
            const base64 = btoa(String.fromCharCode(...new Uint8Array(reader.result as ArrayBuffer)));
            const lastFrame = currentBufferRef.current.frames[currentBufferRef.current.frames.length - 1];
            if (lastFrame) {
              lastFrame.imageData = base64;
            }
          } else {
            // Modo tradicional: enviar diretamente via WebSocket binário
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
          }
        };
        reader.readAsArrayBuffer(blob);
      }, "image/jpeg", 0.7);
    }
  }, [enableClientHeuristics, effectiveMaxFps, minMotionScore, effectivePhashInterval, send, targetFps, effectiveDetectionInterval, bypassValidation, enableLivenessChallenge, analyzeGesture, log, standaloneMode, enableDataBuffering, bufferingMode, addFrameToBuffer, rttMs]);

  const start = useCallback(async () => {
    console.log('🔥 FUNÇÃO START CHAMADA!!! initializationRef.current:', initializationRef.current);
    
    if (initializationRef.current) {
      console.log('⚠️ Sistema já foi inicializado - ignorando nova tentativa');
      return;
    }
    
    console.log('🚀 Iniciando sistema - primeira vez DIRETO!', { 
      sessionId: sessionId || 'vazio', 
      token: token || 'vazio',
      backendUrl: backendUrl || 'vazio',
      enableLivenessChallenge,
      bypassValidation,
      timestamp: new Date().toISOString()
    });
    
    initializationRef.current = true;
    
    // ✨ VERIFICAÇÃO STANDALONE PRIORITÁRIA (ANTES DE TUDO)
    const hasNoBackend = !sessionId || sessionId === "" || !token || token === "";
    console.log('🎯 VERIFICAÇÃO STANDALONE PRIORITÁRIA DIRETO!', {
      enableLivenessChallenge,
      hasNoBackend,
      standaloneInitialized: standaloneInitialized.current,
      shouldStart: enableLivenessChallenge && hasNoBackend && !standaloneInitialized.current
    });
    
    if (enableLivenessChallenge && hasNoBackend && !standaloneInitialized.current) {
      console.log('🚀 ✨ INICIANDO STANDALONE PRIORITÁRIO - MEDIAPIPE SERÁ CARREGADO!');
      standaloneInitialized.current = true;
      setStandaloneMode(true);
      setStatus("streaming");
      setChallengeState('idle');
      setTotalChallenges(0);
      
      setTimeout(() => {
        console.log('🎯 Gerando fila de desafios prioritário...');
        generateChallengeQueueRef.current();
        setTimeout(() => {
          console.log('🎯 Iniciando primeiro desafio prioritário...');
          startNextChallengeRef.current?.();
        }, 2000);
      }, 1000);
      
      // NÃO FAZER RETURN - CONTINUAR PARA CARREGAR CÂMERA (mas pular MediaPipe)
      console.log('📷 Continuando para carregar câmera...');
    }
    setError(undefined);
    setStatus("connecting");

    try {
      const defaultConstraints: MediaStreamConstraints = {
        video: videoConstraints ?? {
          width: { ideal: 700 },
          height: { ideal: 500 },
          frameRate: { ideal: 15 },
          facingMode: "user",
        },
        audio: false,
      };
      const ms = await navigator.mediaDevices.getUserMedia(defaultConstraints);
      mediaStreamRef.current = ms;
      const video = document.querySelector("video[data-proof-of-life]") as HTMLVideoElement | null;
      if (video) {
        video.srcObject = ms;
        
        // Aguardar o vídeo estar pronto
        await new Promise<void>((resolve) => {
          const onLoadedMetadata = () => {
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            log('info', `📹 Vídeo carregado: ${video.videoWidth}x${video.videoHeight}`);
            resolve();
          };
          
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            log('info', `📹 Vídeo já carregado: ${video.videoWidth}x${video.videoHeight}`);
            resolve();
          } else {
            video.addEventListener('loadedmetadata', onLoadedMetadata);
          }
        });
      }
      console.log('🔍 Verificando carregamento MediaPipe:', { 
        bypassValidation, 
        standaloneMode: standaloneInitialized.current,
        shouldLoadMediaPipe: !bypassValidation 
      });
      
      if (!bypassValidation) {
        log('info', '🔧 Iniciando carregamento do MediaPipe (bypassValidation=false)');
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

            // Inicializar Face Landmarker
            const landmarkModelPaths = [
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
              "https://storage.googleapis.com/mediapipe-assets/face_landmarker.task"
            ];
            
            let landmarker = null;
            for (const landmarkPath of landmarkModelPaths) {
              try {
                landmarker = await mod.FaceLandmarker.createFromOptions(fileset, {
                  baseOptions: { modelAssetPath: landmarkPath },
                  runningMode: "VIDEO",
                  numFaces: 1
                });
                break;
              } catch (e) {
                console.warn(`Falha ao carregar modelo de landmarks de ${landmarkPath}:`, e);
              }
            }
            
            if (!landmarker) {
              console.warn("❌ Nenhum modelo de Face Landmarks pôde ser carregado. Análise de gestos será desabilitada.");
            } else {
              console.log("✅ MediaPipe Face Landmarker carregado com sucesso!");
            }
            
            mpLandmarkerRef.current = landmarker;
            
            // ✨ VERIFICAÇÃO STANDALONE APÓS MEDIAPIPE CARREGAR
            const hasNoBackend = !sessionId || sessionId === "" || !token || token === "";
            console.log('🚀 MEDIAPIPE CARREGADO! Verificando standalone...', {
              detector: !!detector,
              landmarker: !!landmarker,
              enableLivenessChallenge,
              hasNoBackend,
              standaloneInitialized: standaloneInitialized.current
            });
            
            if (detector && landmarker && enableLivenessChallenge && hasNoBackend && standaloneInitialized.current) {
              console.log('🎯 ✨ MEDIAPIPE + STANDALONE - CONTINUANDO COM DESAFIOS!');
              // Não fazer return - continuar o fluxo normal mas com standalone ativo
            }
          })();
        } catch (e) {
          console.warn("Erro ao inicializar MediaPipe:", e);
          
          // Fallback: se MediaPipe falhar e não tem backend, iniciar modo standalone mesmo assim
          const hasNoBackend = !sessionId || sessionId === "" || !token || token === "";
          if (enableLivenessChallenge && hasNoBackend && !standaloneInitialized.current) {
            log('info', '🎯 MediaPipe falhou, mas iniciando modo standalone para demonstração');
            setTimeout(() => {
              startStandaloneMode();
            }, 1000);
            return;
          }
        }
      } else {
        console.log("🔄 MediaPipe pulado - modo bypass ou standalone ativo");
        
        // Se está em bypass e não tem backend, ainda pode fazer demonstração
        const hasNoBackend = !sessionId || sessionId === "" || !token || token === "";
        if (enableLivenessChallenge && hasNoBackend && !standaloneInitialized.current) {
          log('info', '🎯 Modo bypass + standalone - iniciando demonstração');
          setTimeout(() => {
            startStandaloneMode();
          }, 1000);
          return;
        }
      }

      // Verificação standalone já foi feita acima, após MediaPipe carregar

      preparingRef.current = true;
      readyCountRef.current = 0;
      prepareStartedAtRef.current = performance.now();
      const prepareLoop = () => {
        if (!preparingRef.current) return;
        captureAndSendFrame();
        const v = document.querySelector("video[data-proof-of-life]") as HTMLVideoElement | null;
        const vw = v?.videoWidth || 700;
        const vh = v?.videoHeight || 500;
        let okNow = false;
        
        // Simplificado: apenas detectar face para estar pronto
        if (mpDetectorRef.current && facePresent) {
          readyCountRef.current += 1;
        } else if (!mpDetectorRef.current) {
          // Se não há detector, ainda assim prosseguir
          readyCountRef.current += 1;
        } else {
          readyCountRef.current = 0;
        }
        
        const requiredReadyFrames = bypassValidation ? 2 : (mpDetectorRef.current ? 12 : 5);
        if (readyCountRef.current % 10 === 0 && readyCountRef.current < requiredReadyFrames * 2) {
          log('info', `Ready count: ${readyCountRef.current}/${requiredReadyFrames}`, { detector: !!mpDetectorRef.current, face: !!facePresent, bypass: bypassValidation });
        }
        const elapsedSincePrepare = performance.now() - prepareStartedAtRef.current;
        if ((readyCountRef.current >= requiredReadyFrames || elapsedSincePrepare > 2000) && !wsRef.current) {
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
                log('info', '🎯 Aguardando desafios do backend');

                if (promptWatchdogRef.current) {
                  clearInterval(promptWatchdogRef.current);
                  promptWatchdogRef.current = null;
                }
                promptWatchdogRef.current = window.setInterval(() => {
                  if (!streamingRef.current) {
                    if (promptWatchdogRef.current) {
                      clearInterval(promptWatchdogRef.current);
                      promptWatchdogRef.current = null;
                    }
                    return;
                  }
                  if (!currentChallengeRef.current && challengeStateRef.current === 'idle') {
                    log('info', '🔔 Solicitando prompt ao backend');
                    send({ type: 'feedback', status: 'continue' });
                  }
                }, 2000);
                
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
                if (promptWatchdogRef.current) {
                  clearInterval(promptWatchdogRef.current);
                  promptWatchdogRef.current = null;
                }

                const kind = (msg.challenge?.kind || '').toString();
                let mapped: 'look_right' | 'look_left' | 'look_up' | 'open_mouth' | null = null;
                if (kind === 'look_right' || kind === 'turn-right' || kind === 'right') mapped = 'look_right';
                else if (kind === 'look_left' || kind === 'turn-left' || kind === 'left') mapped = 'look_left';
                else if (kind === 'look_up' || kind === 'head-up' || kind === 'up') mapped = 'look_up';
                else if (kind === 'open_mouth' || kind === 'open-mouth' || kind === 'mouth') mapped = 'open_mouth';

                if (!mapped || !msg.challenge?.id) {
                  log('warn', '⚠️ Tipo de desafio desconhecido ou id ausente no prompt', msg.challenge);
                  return;
                }

                const newChallenge = { id: msg.challenge.id, type: mapped } as { id: string; type: 'look_right' | 'look_left' | 'look_up' | 'open_mouth' };
                setCurrentChallenge(newChallenge);
                currentChallengeRef.current = newChallenge;
                setChallengeCompleted(false);
                challengeCompletedRef.current = false;
                setChallengeState('active');
                challengeStateRef.current = 'active';
                setChallengeStartTime(Date.now());
                setTotalChallenges(prev => prev + 1);

                if (enableDataBuffering) {
                  createChallengeBuffer(newChallenge);
                  setBufferingMode(true);
                  bufferingModeRef.current = true;
                }

                if (challengeTimeoutRef.current) {
                  clearTimeout(challengeTimeoutRef.current);
                }
                const tmo = typeof msg.challenge?.timeoutMs === 'number' ? msg.challenge.timeoutMs : 15000;
                challengeTimeoutRef.current = window.setTimeout(() => {
                  log('warn', `⏰ Desafio ${newChallenge.type} expirou (backend)`);
                  if (enableDataBuffering && currentBufferRef.current) {
                    completeBuffer(false);
                    clearCurrentBuffer();
                    setBufferingMode(false);
                    bufferingModeRef.current = false;
                  }
                  send({ type: 'feedback', status: 'fail' });
                  setChallengeState('idle');
                  challengeStateRef.current = 'idle';
                }, tmo);
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
                if (promptWatchdogRef.current) {
                  clearInterval(promptWatchdogRef.current);
                  promptWatchdogRef.current = null;
                }
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
  }, [wsUrl, send, sessionId, token, videoConstraints, captureAndSendFrame, bypassValidation, enableLivenessChallenge, startStandaloneMode, effectiveMaxFps]);

  const stop = useCallback(async () => {
    log('info', '🛑 Parando sistema completamente');
    
    // Reset de flags
    initializationRef.current = false;
    standaloneInitialized.current = false;
    preparingRef.current = false;
    streamingRef.current = false;
    
    // Limpar timeouts
    if (challengeTimeoutRef.current) {
      clearTimeout(challengeTimeoutRef.current);
      challengeTimeoutRef.current = null;
    }
    
    // Fechar conexões
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Parar camera
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => {
        t.stop();
        log('info', '📹 Track da câmera parado:', t.kind);
      });
      mediaStreamRef.current = null;
    }
    
    // Reset de estados
    setStatus("idle");
    setChallengeState('idle');
    setCurrentChallenge(undefined);
    setChallengeCompleted(false);
    setTotalChallenges(0);
    setStandaloneMode(false);
    setFacePresent(undefined);
    setFaceBox(undefined);
    
    // Limpar refs e buffers
    challengeQueue.current = [];
    landmarksRef.current = null;
    currentBufferRef.current = null;
    buffersHistoryRef.current = [];
    setBufferingMode(false);
    bufferingModeRef.current = false;
    
    log('info', '✅ Sistema parado completamente');
  }, [log]);

  return { status, start, stop, lastPrompt, error, rttMs, targetFps, throttled, lastAckAt, facePresent, faceBox, currentChallenge, challengeCompleted, standaloneMode, challengeStartTime, challengeState, totalChallenges, maxChallenges, bufferingMode, bufferStats };
}


