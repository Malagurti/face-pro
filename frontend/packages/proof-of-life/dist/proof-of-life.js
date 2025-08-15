import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef } from "react";
import { useProofOfLife } from "./useProofOfLife";
function getInstructionText(challenge) {
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
export function ProofOfLife(props) {
    const vidRef = useRef(null);
    const { status, start, stop, lastPrompt, error, rttMs, throttled, targetFps, lastAckAt, faceBox, guide } = useProofOfLife(props);
    const debug = props.debug ?? false;
    const ringColor = useMemo(() => {
        if (status === "passed")
            return "#10b981";
        if (status === "failed")
            return "#ef4444";
        if (guide?.level === "ok")
            return "#3b82f6";
        if (guide?.level === "warn")
            return "#f59e0b";
        if (guide?.level === "error")
            return "#ef4444";
        if (status === "prompt")
            return "#f59e0b";
        return "#374151";
    }, [status, guide]);
    useEffect(() => {
        start();
        return () => { stop(); };
    }, [start, stop]);
    useEffect(() => {
        if (error && props.onError)
            props.onError(error);
    }, [error, props]);
    useEffect(() => {
        if (status === "passed" && props.onResult)
            props.onResult(true);
        if (status === "failed" && props.onResult)
            props.onResult(false);
    }, [status, props]);
    const maskStyle = {
        position: "relative",
        width: 240,
        height: 320,
        borderRadius: "50% / 60%",
        overflow: "hidden",
        boxShadow: `0 0 0 3px ${ringColor}`,
        background: "black",
    };
    const promptText = useMemo(() => {
        if (!lastPrompt)
            return undefined;
        const map = {
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
    return (_jsxs("div", { style: { display: "grid", gap: 8 }, children: [_jsxs("div", { style: maskStyle, children: [_jsx("video", { ref: vidRef, "data-proof-of-life": true, autoPlay: true, playsInline: true, muted: true, width: 240, height: 320, style: { objectFit: "cover", width: "100%", height: "100%" } }), guide && guide.message && (_jsx("div", { style: { position: "absolute", bottom: 8, left: 8, right: 8, textAlign: "center", color: guide.level === "ok" ? "#3b82f6" : guide.level === "warn" ? "#f59e0b" : "#ef4444", fontWeight: 600, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }, children: guide.message }))] }), debug && (_jsxs("div", { children: ["status: ", status, " ", throttled ? _jsx("span", { style: { color: "#f59e0b" }, children: "(throttle)" }) : null] })), debug && (_jsxs("div", { style: { fontSize: 12, color: "#9ca3af" }, children: ["targetFps: ", targetFps, rttMs !== undefined ? ` · rtt: ${rttMs}ms` : "", lastAckAt ? ` · last: ${new Date(lastAckAt).toLocaleTimeString()}` : ""] })), promptText && status !== "passed" && status !== "failed" && (_jsxs("div", { style: {
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
                }, children: ["\uD83C\uDFAF ", getInstructionText(promptText), _jsx("div", { style: {
                            fontSize: 12,
                            marginTop: "6px",
                            opacity: 0.8,
                            color: "#93c5fd"
                        }, children: "Execute o movimento solicitado" })] })), status === "passed" && (_jsx("div", { style: { fontSize: 14, color: "#10b981", fontWeight: "bold" }, children: "\u2705 Prova de vida conclu\u00EDda com sucesso!" })), status === "failed" && (_jsx("div", { style: { fontSize: 14, color: "#ef4444", fontWeight: "bold" }, children: "\u274C Prova de vida falhou" })), debug && error && _jsx("div", { style: { color: "red" }, children: error })] }));
}
