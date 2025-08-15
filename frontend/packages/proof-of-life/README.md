# @face-pro/proof-of-life – SDK Web (React)

SDK em React para prova de vida via WebSocket com o backend Face Pro. A UI mostra apenas a imagem da câmera e a instrução do desafio. Status/diagnóstico só aparecem quando `debug` estiver ativado.

## Instalação

```bash
pnpm add @face-pro/proof-of-life
# ou
npm i @face-pro/proof-of-life
# ou
yarn add @face-pro/proof-of-life
```

## Pré‑requisitos do backend

1) Criar sessão
```bash
curl -s -X POST http://localhost:8080/session | jq
# => { "session_id":"...", "token":"...", "challenges":[...] }
```
2) Use `session_id` e `token` ao iniciar o SDK.

## Uso básico (Componente)

```tsx
import { ProofOfLife } from "@face-pro/proof-of-life";

export function Example() {
  const backendUrl = "http://localhost:8080";
  const sessionId = "..."; // do POST /session
  const token = "...";     // do POST /session

  return (
    <div>
      <h1>Prova de Vida</h1>
      <ProofOfLife
        backendUrl={backendUrl}
        sessionId={sessionId}
        token={token}
        debug={false}
        maxFps={15}
        videoConstraints={{
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 15 },
          facingMode: "user",
        }}
        enableClientHeuristics
        useFaceDetector
        minMotionScore={0.02}
        phashIntervalFrames={5}
        onResult={(passed) => console.log("result:", passed)}
        onError={(err) => console.error(err)}
      />
    </div>
  );
}
```

- O componente renderiza internamente um `<video data-proof-of-life>` e inicia/paralisa o fluxo automaticamente.
- A instrução exibida reflete o `prompt` do backend (blink, open-mouth, turn-left/right, head-up/down).

## Uso com Hook (UI própria)

```tsx
import { useEffect, useRef } from "react";
import { useProofOfLife } from "@face-pro/proof-of-life";

export function CustomUi() {
  const ref = useRef<HTMLVideoElement>(null);
  const { status, start, stop, lastPrompt, error } = useProofOfLife({
    backendUrl: "http://localhost:8080",
    sessionId: "...",
    token: "...",
  });

  useEffect(() => {
    start();
    return () => { stop(); };
  }, [start, stop]);

  return (
    <div>
      <video ref={ref} data-proof-of-life autoPlay playsInline muted width={240} height={320} />
      <div>{lastPrompt ? `Guia: ${lastPrompt.kind}` : null}</div>
      {error && <div>{error}</div>}
    </div>
  );
}
```

Observação: o hook busca um elemento `video[data-proof-of-life]` no DOM para capturar frames.

## Opções (UseProofOfLifeOptions)

- backendUrl: string (ex.: `http://localhost:8080`)
- sessionId: string
- token: string
- videoConstraints?: MediaTrackConstraints
- maxFps?: number (default 15)
- enableClientHeuristics?: boolean (default true)
- useFaceDetector?: boolean (default true quando suportado)
- minMotionScore?: number (default 0.02)
- phashIntervalFrames?: number (default 5)

Props adicionais do componente:
- debug?: boolean (default false) – exibe status/RTT/erros para diagnóstico
- onResult?: (passed: boolean) => void
- onError?: (err: string) => void

## Estados e eventos

- status: "idle" | "connecting" | "prompt" | "streaming" | "passed" | "failed"
- lastPrompt: `{ id: string; kind: string; timeoutMs: number }`
- onResult(passed): chamado ao final do fluxo

## Telemetria enviada (opcional)

- motionScore: número (0–1) – diferença média quadro‑a‑quadro (downscale 32×32)
- ahash: string (hex) – hash perceptual simples periódico
- facePresent: boolean – quando FaceDetector API disponível
- faceBox: `{ x, y, width, height }` – quando FaceDetector API disponível

Esses dados ajudam o backend a validar (MVP) enquanto a validação “forte” por landmarks/pose é integrada.

## Boas práticas

- Use resolução baixa (ex.: 320×240) e 10–15 FPS para latência/uso de rede ideais.
- Execute sob HTTPS/WSS em produção; peça permissão de câmera de forma clara.
- Em mobile, preserve a orientação “portrait” para melhor enquadramento.

## Troubleshooting

- Vídeo não abre: verifique permissões do navegador (camera/mic) e `facingMode: "user"`.
- Conexão WS cai: confirme `backendUrl`, CORS e limites de tamanho no backend.
- Performance: reduza `frameRate`/resolução ou desabilite FaceDetector (`useFaceDetector: false`).
- **Erro MediaPipe 404**: O SDK agora usa múltiplos fallbacks para os modelos de detecção facial. Se todos falharem, a detecção facial será desabilitada mas o SDK continuará funcionando para captura de frames.

## Licença

MIT
