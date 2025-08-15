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
}
export interface UseProofOfLifeResult {
    status: Status;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    lastPrompt?: {
        id: string;
        kind: string;
        timeoutMs: number;
    };
    error?: string;
    rttMs?: number;
    targetFps: number;
    throttled: boolean;
    lastAckAt?: number;
    facePresent?: boolean;
    faceBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    guide?: {
        level: "ok" | "warn" | "error";
        message?: string;
        reason?: string;
    };
}
export declare function useProofOfLife(opts: UseProofOfLifeOptions): UseProofOfLifeResult;
export {};
