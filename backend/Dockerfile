# syntax=docker/dockerfile:1.6

FROM rust:1.88-bookworm AS builder
WORKDIR /app

# Evita downloads repetidos do cargo
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    echo ok

# Copia apenas o crate do backend
COPY backend /app/backend
WORKDIR /app/backend

# Build com ONNX habilitado (usa load-dynamic + download-binaries)
RUN --mount=type=cache,target=/app/backend/target \
    cargo build --release --features onnx

# Tenta coletar as libs baixadas do ONNX Runtime para empacotar na imagem final (opcional)
RUN mkdir -p /app/onnx && \
    find target/release -maxdepth 4 -type f \
      \( -name 'libonnxruntime.so*' -o -name 'libonnxruntime_providers_*.so' \) \
      -exec cp {} /app/onnx \; || true

FROM nvidia/cuda:12.3.1-runtime-ubuntu22.04 AS runtime
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl libgomp1 && \
    rm -rf /var/lib/apt/lists/*

# Binário
COPY --from=builder /app/backend/target/release/backend /usr/local/bin/backend

# Modelos (caso já estejam no repositório)
COPY backend/models /app/models

# ONNX Runtime GPU (libs) – usar binários oficiais
ARG ORT_VER=1.17.3
RUN curl -L -o /tmp/ort_gpu.tgz https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VER}/onnxruntime-linux-x64-gpu-${ORT_VER}.tgz \
    && mkdir -p /opt/onnxruntime \
    && tar -xzf /tmp/ort_gpu.tgz -C /opt/onnxruntime --strip-components=1 \
    && rm -f /tmp/ort_gpu.tgz
ENV LD_LIBRARY_PATH=/opt/onnxruntime/lib:${LD_LIBRARY_PATH}
ENV ORT_STRATEGY=system
ENV ORT_DYLIB_PATH=/opt/onnxruntime/lib

# Usuário não-root
RUN useradd -m -u 10001 appuser
USER appuser

EXPOSE 8080
ENV RUST_LOG=info
ENTRYPOINT ["/usr/local/bin/backend"]


