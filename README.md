# Face Pro – Prova de Vida com Detecção Facial, PAD e Antifraude

Projeto monorepo (Rust backend + TypeScript frontend) para prova de vida em tempo real via WebSocket, com detecção facial (SCRFD), anti‑replay e heurísticas PAD, SDK Web e execução acelerada por GPU (CUDA) via Docker.

## Objetivos
- Prova de vida confiável e rápida, com desafios (blink/turn) e validação automática lato‑sensu
- Proteções PAD: anti‑replay, detecção de duplicidade, flicker anômalo, e (futuro) liveness ONNX e rPPG/FFT
- Observabilidade e segurança de transporte, com design pronto para LGPD

## Arquitetura
- backend/ (Rust, axum + tokio)
  - WebSocket `/ws` (hello → frames → prompt/result)
  - HTTP `/health`, `/config`, `/session`, `/session/{id}`
  - Inferência (feature `onnx`), SCRFD e PAD
- frontend/ (TypeScript)
  - SDK `proof-of-life` (hook + componente React de exemplo)
  - App de exemplo com Vite
- docs/ (API, Postman, planning)

## Features
- WebSocket com throttling, limites de tamanho e handshake com token
- PAD heurístico:
  - Anti‑replay por timestamp/janela
  - pHash perceptual de frames (reuso/loops)
  - Métrica simples de flicker
- Detecção facial (SCRFD):
  - Pré‑processamento (letterbox, normalização, CHW) e NMS prontos
  - Mapeamento de saídas do modelo (strides 8/16/32, 2 anchors/célula) preparado
  - Execução ONNX (CUDA/CPU) já configurada no runtime (falta plugar a leitura das saídas)
- SDK Web: captura de câmera, envio de frames, prompts e UI base
- Docker (runtime GPU): imagem CUDA + ONNX Runtime GPU

## Requisitos
- Windows 10/11, macOS ou Linux
- Rust (1.78+ recomendado) e Cargo
- Node 18+ e pnpm 8+ (frontend)
- Docker (para execução em container)
- Para GPU (opcional):
  - Host com NVIDIA + Docker Desktop (WSL2) + suporte `--gpus all`

## Como executar (local)
### Backend (sem ONNX)
```bash
cd backend
cargo run
```

### Backend (com ONNX – CPU)
```bash
cd backend
cargo run --features onnx
```

### Backend (com ONNX – Docker + CUDA)
1) Build da imagem
```bash
docker build -f backend/Dockerfile -t face-pro-backend:cuda .
```
2) Run com GPU
```bash
docker run --rm --gpus all -p 8080:8080 face-pro-backend:cuda
```

### Frontend (app exemplo)
```bash
pnpm install
pnpm --filter @example/app dev
# ou
cd frontend/apps/example
pnpm install
pnpm dev
```

## Endpoints (MVP)
- GET `/health`
- GET `/config`
- POST `/session`
- GET `/session/{id}`
- WS `/ws`

### Exemplos HTTP (curl)
- Criar sessão
```bash
curl -s -X POST http://localhost:8080/session | jq
```
- Health
```bash
curl -s http://localhost:8080/health | jq
```
- Config
```bash
curl -s http://localhost:8080/config | jq
```

### Fluxo WebSocket (resumo)
1) Client envia `hello { sessionId, token, client }`
2) Server responde `helloAck { challenges }` e envia `prompt`
3) Client envia `frame` (jpeg/png base64 ou binário com header)
4) Server responde `frameAck { ts, face?, pad? }`
5) Server envia novos `prompt` até `result { passed }`

## Execução de modelos
- SCRFD 2.5G (onnx) – `backend/models/face_detection/0001/model.onnx`
- Liveness (placeholder) – `backend/models/liveness/0001/`
- Em Docker GPU:
  - A imagem baixa o ONNX Runtime GPU oficial e expõe as libs em `LD_LIBRARY_PATH`

## Checklist
Implementado
- WebSocket e FSM básico de desafios (blink → turn-left/right aleatório)
- PAD heurístico: pHash, flicker e anti‑replay por ts
- SCRFD: pré‑processamento, parâmetros e NMS; mapeamento de saídas pronto
- Docker runtime CUDA + ORT GPU
- SDK Web (hook + componente), app exemplo
- API HTTP (`/health`, `/config`, `/session`)

Pendente
- SCRFD ONNX plugado no `detect()` (ler 9 saídas, `decode_scale` por stride, NMS e melhor bbox)
- Landmarks/pose para EAR/yaw e validação automática dos desafios
- Liveness ONNX com agregação/thresholds
- Heurísticas antifraude avançadas: rPPG/FFT/specular highlights/pHash sequência
- Ensemble final (desafios + PAD + heurísticas) e métricas ISO/IEC 30107‑3
- Observabilidade (métricas p50/p95/p99; trilhas sem PII)

## Troubleshooting
- Docker + GPU: usar `--gpus all`; verificar `nvidia-smi` no container
- Modelos: coloque os `.onnx` nas pastas indicadas; o catálogo seleciona a melhor versão
- Tempo real: manter ~320×240 @ 10–15 FPS no cliente para latência e uso de banda

## Roadmap curto
1) Finalizar SCRFD ONNX no backend e retornar `frameAck.face`
2) Landmarks leves (EAR/yaw) e validação automática de blink/turn
3) Liveness ONNX com thresholds por ambiente
4) Heurísticas de deepfake + ensemble

## Licença
MIT

## Integração com buffer e attemptId (SDK Web + Backend)

### Visão geral
- Cada rodada de prova de vida é identificada por um `attemptId` (UUID).
- O servidor envia `prompt` com `attemptId` e `id` do desafio (ex.: `c1`, `c2`, `c3`).
- O cliente executa o desafio, agrega os dados em buffer e envia em três etapas: `challengeStart`, vários `challengeFrameBatch`, e `challengeEnd` — sempre com o mesmo `attemptId` e `challengeId`.
- O servidor valida e responde com `challengeResult` (por desafio). Ao finalizar a rodada (3 desafios), envia `result` com `attemptId` e decisão final.
- Se um novo `attemptId` surgir, o servidor e o cliente devem reiniciar contadores e ignorar buffers antigos.

### Sequência resumida
1) Client → Server: `hello { sessionId, token, client }`
2) Server → Client: `helloAck { challenges }`
3) Server → Client: `prompt { challenge: { id, kind, timeoutMs?, attemptId } }`
4) Client coleta dados do desafio em buffer local
5) Client → Server: `challengeStart { attemptId, challengeId, challengeType, startTime, totalFrames, completionTime?, gestureDetected }`
6) Client → Server: múltiplos `challengeFrameBatch { attemptId, challengeId, batchIndex, frames[] }`
7) Client → Server: `challengeEnd { attemptId, challengeId, timestamp }`
8) Server → Client: `challengeResult { attemptId, challengeId, decision, analysis }`
9) Repetir até 3 desafios; Server → Client: `result { attemptId, decision }`

Observações:
- O servidor deve ignorar qualquer mensagem cujo `attemptId` não seja o atual.
- Ao detectar `attemptId` diferente no `challengeStart`, reinicie FSM/telemetria/contadores e troque o `currentAttemptId`.
- O cliente deve ignorar `challengeResult`/`result` com `attemptId` diferente do atual.

### Exemplos de mensagens (JSON)

Server → Client: prompt
```json
{
  "type": "prompt",
  "challenge": {
    "id": "c1",
    "kind": "open-mouth",
    "timeoutMs": 5000,
    "attemptId": "2f4a2e4f-64f7-4b1a-a4de-6d0cdd2cddf3"
  }
}
```

Client → Server: challengeStart
```json
{
  "type": "challengeStart",
  "attemptId": "2f4a2e4f-64f7-4b1a-a4de-6d0cdd2cddf3",
  "challengeId": "c1",
  "challengeType": "open_mouth",
  "startTime": 1723740000000,
  "totalFrames": 14,
  "completionTime": 1390,
  "gestureDetected": true
}
```

Client → Server: challengeFrameBatch
```json
{
  "type": "challengeFrameBatch",
  "attemptId": "2f4a2e4f-64f7-4b1a-a4de-6d0cdd2cddf3",
  "challengeId": "c1",
  "batchIndex": 0,
  "frames": [
    {
      "timestamp": 1723740000123,
      "frameId": 123,
      "imageData": "...base64...",
      "motionScore": 0.12,
      "ahash": "abcd...",
      "facePresent": true,
      "faceBox": { "x": 100, "y": 120, "width": 160, "height": 160 },
      "landmarks": { "points": 478 },
      "telemetry": { "fps": 15, "rttMs": 40, "camWidth": 700, "camHeight": 500 }
    }
  ]
}
```

Client → Server: challengeEnd
```json
{
  "type": "challengeEnd",
  "attemptId": "2f4a2e4f-64f7-4b1a-a4de-6d0cdd2cddf3",
  "challengeId": "c1",
  "timestamp": 1723740001456
}
```

Server → Client: challengeResult
```json
{
  "type": "challengeResult",
  "attemptId": "2f4a2e4f-64f7-4b1a-a4de-6d0cdd2cddf3",
  "challengeId": "c1",
  "decision": { "passed": true },
  "analysis": {
    "totalFrames": 14,
    "framesWithFace": 12,
    "framesWithLandmarks": 12,
    "averageMotionScore": 0.07,
    "faceDetectionRate": 0.86,
    "gestureConfidence": 0.8,
    "processingTimeMs": 1400,
    "qualityScore": 0.7
  }
}
```

Server → Client: result (final da rodada)
```json
{
  "type": "result",
  "attemptId": "2f4a2e4f-64f7-4b1a-a4de-6d0cdd2cddf3",
  "decision": { "passed": true }
}
```

### Regras do servidor (resumo)
- Guardar `currentAttemptId` na sessão.
- `challengeStart`: ao mudar o `attemptId`, reiniciar FSM/telemetria, limpar buffers e atualizar `currentAttemptId`.
- `challengeFrameBatch`: se `attemptId` ≠ `currentAttemptId` ou `challengeId` ≠ buffer atual, ignorar lote.
- `challengeEnd`: validar `attemptId`/`challengeId` antes de analisar; emitir `challengeResult` com `attemptId`.
- Prompts subsequentes devem incluir `attemptId`.
- `result` final sempre inclui `attemptId`.

### Exemplo de backend em Python (WebSocket)
Abaixo um exemplo mínimo em Python 3.11+ usando `websockets` e `asyncio` que fala o mesmo protocolo de buffering com `attemptId`.

```python
import asyncio
import json
import uuid
import websockets

class SessionState:
    def __init__(self):
        self.current_attempt_id = str(uuid.uuid4())
        self.fsm_completed = 0
        self.fsm_failed = 0
        self.buffer = None  # dict com attemptId/challengeId/frames

async def send(ws, obj):
    await ws.send(json.dumps(obj))

def make_prompt(challenge_id: str, kind: str, attempt_id: str, timeout_ms: int = 5000):
    return {
        "type": "prompt",
        "challenge": {
            "id": challenge_id,
            "kind": kind,
            "timeoutMs": timeout_ms,
            "attemptId": attempt_id,
        },
    }

def analyze_and_decide(buffer: dict) -> tuple[dict, dict]:
    total = len(buffer["frames"]) if buffer and buffer.get("frames") else 0
    face_with = sum(1 for f in buffer["frames"] if f.get("facePresent")) if total else 0
    rate = (face_with / total) if total else 0.0
    passed = rate >= 0.7 and bool(buffer.get("gestureDetected")) and total >= 10
    analysis = {
        "totalFrames": total,
        "framesWithFace": face_with,
        "framesWithLandmarks": sum(1 for f in buffer["frames"] if f.get("landmarks") is not None) if total else 0,
        "averageMotionScore": (sum(float(f.get("motionScore") or 0.0) for f in buffer["frames"]) / total) if total else 0.0,
        "faceDetectionRate": rate,
        "gestureConfidence": 0.8 if buffer.get("gestureDetected") else 0.0,
        "processingTimeMs": 0,
        "qualityScore": (rate * 0.7),
    }
    decision = {"passed": passed}
    return decision, analysis

async def handler(ws):
    sess = SessionState()

    # Handshake (hello)
    hello_raw = await ws.recv()
    hello = json.loads(hello_raw)
    if hello.get("type") != "hello":
        await send(ws, {"type": "error", "code": "bad-handshake", "message": "expected hello"})
        return
    await send(ws, {"type": "helloAck", "challenges": ["open-mouth", "turn-left", "turn-right", "head-up"]})

    # Primeiro prompt
    await send(ws, make_prompt("c1", "open-mouth", sess.current_attempt_id))

    async for raw in ws:
        try:
            msg = json.loads(raw)
        except Exception:
            continue

        t = msg.get("type")

        if t == "feedback":
            # Opcional: reenviar prompt atual quando status == continue
            if msg.get("status") == "continue":
                await send(ws, make_prompt("c1", "open-mouth", sess.current_attempt_id))

        elif t == "challengeStart":
            attempt_id = msg.get("attemptId") or msg.get("attempt_id")
            if attempt_id != sess.current_attempt_id:
                sess.current_attempt_id = attempt_id or str(uuid.uuid4())
                sess.fsm_completed = 0
                sess.fsm_failed = 0
                sess.buffer = None
            sess.buffer = {
                "attemptId": attempt_id,
                "challengeId": msg.get("challengeId"),
                "challengeType": msg.get("challengeType"),
                "gestureDetected": bool(msg.get("gestureDetected")),
                "frames": [],
            }

        elif t == "challengeFrameBatch":
            attempt_id = msg.get("attemptId") or msg.get("attempt_id")
            if attempt_id != sess.current_attempt_id or not sess.buffer:
                continue
            if sess.buffer.get("attemptId") != attempt_id or sess.buffer.get("challengeId") != msg.get("challengeId"):
                continue
            sess.buffer["frames"].extend(msg.get("frames") or [])

        elif t == "challengeEnd":
            attempt_id = msg.get("attemptId") or msg.get("attempt_id")
            if not sess.buffer:
                continue
            if attempt_id != sess.current_attempt_id:
                continue
            if sess.buffer.get("attemptId") != attempt_id or sess.buffer.get("challengeId") != msg.get("challengeId"):
                continue

            decision, analysis = analyze_and_decide(sess.buffer)
            await send(ws, {
                "type": "challengeResult",
                "attemptId": attempt_id,
                "challengeId": sess.buffer["challengeId"],
                "decision": decision,
                "analysis": analysis,
            })

            if decision["passed"]:
                sess.fsm_completed += 1
            else:
                sess.fsm_failed += 1

            # Próximo desafio ou resultado final
            if sess.fsm_completed >= 3:
                await send(ws, {"type": "result", "attemptId": attempt_id, "decision": {"passed": True}})
            else:
                next_id = f"c{sess.fsm_completed + sess.fsm_failed + 1}"
                await send(ws, make_prompt(next_id, "turn-left", sess.current_attempt_id))
                sess.buffer = None

async def main():
    async with websockets.serve(handler, "0.0.0.0", 8080, max_size=1 << 20):
        print("listening=0.0.0.0:8080 event=server.start")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
```

Boas práticas adicionais:
- Defina tempos limite para lote e tamanho máximo de buffer por desafio.
- Controle de taxa (FPS/mensagens) e limites de payload.
- Logs de auditoria sem PII, guardando `attemptId`, `challengeId`, contadores e decisões.
- Se o servidor gerar o `attemptId`, inclua-o em todos os `prompt` subsequentes da rodada.
