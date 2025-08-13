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