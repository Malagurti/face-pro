use std::net::SocketAddr;

use axum::{
    extract::{Path, State},
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use image::GenericImageView;
use tower_http::cors::{Any, CorsLayer};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
mod protocol;
mod infer;
use protocol::{ClientMessage, ServerMessage, ChallengeKind};
mod models;
mod inference;
mod pad;

#[derive(Clone)]
struct AppState {
    _tx: broadcast::Sender<()>,
    sessions: Arc<RwLock<HashMap<String, Session>>>,
    inference: Arc<inference::InferenceContext>,
    pad_config: pad::PadConfig,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    selected: models::SelectedCatalog,
}

#[derive(Clone, Serialize)]
struct ConfigResponse {
    execution_providers: Vec<&'static str>,
    capabilities: Capabilities,
    models: Vec<ModelSummary>,
    selected: models::SelectedCatalog,
    pad: pad::PadConfig,
}

#[derive(Clone, Serialize)]
struct Capabilities {
    transport: Vec<&'static str>,
}

#[derive(Clone, Serialize)]
struct ModelSummary {
    kind: String,
    versions: Vec<String>,
}

#[derive(Clone, Serialize)]
struct Session {
    id: String,
    token: String,
    metrics: SessionMetrics,
    fsm: SessionFsm,
    #[serde(skip_serializing)]
    pad_state: pad::PadState,
    #[serde(skip_serializing)]
    tele: TelemetryState,
}
#[derive(Clone, Default, Serialize)]
struct SessionMetrics {
    frames_received: u64,
    throttled: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    p95_rtt_ms: Option<u32>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
enum FsmState {
    Idle,
    Prompting { challenge_id: String, kind: ChallengeKind },
    Passed,
    Failed,
}

#[derive(Clone, Serialize)]
struct SessionFsm {
    state: FsmState,
    completed: u32,
}

impl SessionFsm {
    fn new() -> Self { Self { state: FsmState::Idle, completed: 0 } }
}

#[derive(Clone, Default, Serialize)]
struct TelemetryState {
    #[serde(skip_serializing)]
    last_cx: Option<f32>,
    #[serde(skip_serializing)]
    last_w: Option<f32>,
    turn_left_hits: u32,
    turn_right_hits: u32,
    motion_hits: u32,
    #[serde(skip_serializing)]
    motion_scores: Vec<f32>,  // Para análise de padrões
    #[serde(skip_serializing)]
    face_positions: Vec<(f32, f32)>, // Para análise de movimento facial
}

impl TelemetryState {
    fn reset(&mut self) {
        self.turn_left_hits = 0;
        self.turn_right_hits = 0;
        self.motion_hits = 0;
        self.last_cx = None;
        self.last_w = None;
        self.motion_scores.clear();
        self.face_positions.clear();
    }
    
    fn add_motion_score(&mut self, score: f32) {
        self.motion_scores.push(score);
        // Manter apenas últimos 30 scores (2 segundos @ 15fps)
        if self.motion_scores.len() > 30 {
            self.motion_scores.remove(0);
        }
    }
    
    fn add_face_position(&mut self, x: f32, y: f32) {
        self.face_positions.push((x, y));
        // Manter apenas últimas 30 posições
        if self.face_positions.len() > 30 {
            self.face_positions.remove(0);
        }
    }
    
    // Validação específica para blink: requer spike de motion seguido de queda
    fn has_significant_motion(&self) -> bool {
        if self.motion_scores.len() < 10 { return false; }
        
        // Procurar por pico de movimento (spike pattern típico de blink)
        let recent = &self.motion_scores[self.motion_scores.len()-10..];
        let max_score = recent.iter().fold(0.0f32, |acc, &x| acc.max(x));
        let avg_score = recent.iter().sum::<f32>() / recent.len() as f32;
        
        // Deve ter um pico pelo menos 3x maior que a média
        max_score > 0.05 && max_score > avg_score * 3.0
    }
    
    // Validação para facial motion (boca, expressões)
    fn has_facial_motion(&self) -> bool {
        if self.motion_scores.len() < 15 { return false; }
        
        let recent = &self.motion_scores[self.motion_scores.len()-15..];
        let avg_motion = recent.iter().sum::<f32>() / recent.len() as f32;
        
        // Movimento facial sustentado (como abrir boca)
        avg_motion > 0.04 && recent.iter().filter(|&&x| x > 0.03).count() >= 8
    }
    
    // Validação para turn movements
    fn validate_turn_movement(&self) -> bool {
        if self.face_positions.len() < 20 { return false; }
        
        let start_pos = self.face_positions[0];
        let end_pos = self.face_positions[self.face_positions.len()-1];
        
        // Movimento horizontal significativo
        let horizontal_displacement = (end_pos.0 - start_pos.0).abs();
        horizontal_displacement > 15.0 // pixels de movimento mínimo
    }
    
    // Validação para head movements (up/down)
    fn validate_head_movement(&self) -> bool {
        if self.face_positions.len() < 20 { return false; }
        
        let start_pos = self.face_positions[0];
        let end_pos = self.face_positions[self.face_positions.len()-1];
        
        // Movimento vertical significativo
        let vertical_displacement = (end_pos.1 - start_pos.1).abs();
        vertical_displacement > 10.0 // pixels de movimento mínimo
    }
}



#[derive(Serialize)]
struct CreateSessionResponse {
    session_id: String,
    token: String,
    challenges: Vec<&'static str>,
}

#[tokio::main]
async fn main() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,axum=info,hyper=info"));
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(env_filter)
        .init();

    let (tx, _rx) = broadcast::channel(16);
    let state = AppState {
        _tx: tx,
        sessions: Arc::new(RwLock::new(HashMap::new())),
        inference: Arc::new(inference::InferenceContext::new()),
        pad_config: pad::PadConfig::default(),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/config", get(config))
        .route("/session", post(create_session))
        .route("/session/:id", get(get_session))
        .route("/ws", get(ws_upgrade))
        .layer(
            CorsLayer::new()
                .allow_methods(Any)
                .allow_origin(Any)
                .allow_headers(Any),
        )
        .with_state(state);

    let addr: SocketAddr = "0.0.0.0:8080".parse().unwrap();
    info!("listening" = %addr, "event" = "server.start");

    let listener = TcpListener::bind(addr).await.unwrap();
    if let Err(err) = axum::serve(listener, app).await {
        error!(%err, "server error");
    }
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let body = HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        selected: state.inference.selected_models.clone(),
    };
    (StatusCode::OK, Json(body))
}

async fn config(State(state): State<AppState>) -> impl IntoResponse {
    let catalog = models::inspect_models_dir("models");
    let selected = models::select_best_models("models");
    let models = catalog
        .into_iter()
        .map(|e| ModelSummary { kind: e.kind, versions: e.versions })
        .collect::<Vec<_>>();
    let body = ConfigResponse {
        execution_providers: vec![
            "CPUExecutionProvider",
            "CUDAExecutionProvider",
            "TensorRTExecutionProvider",
            "DirectMLExecutionProvider",
        ],
        capabilities: Capabilities {
            transport: vec!["wss", "webrtc"],
        },
        models,
        selected,
        pad: state.pad_config.clone(),
    };
    (StatusCode::OK, Json(body))
}

async fn create_session(State(state): State<AppState>) -> impl IntoResponse {
    let session_id = uuid::Uuid::new_v4().to_string();
    let token = uuid::Uuid::new_v4().to_string();
    let session = Session {
        id: session_id.clone(),
        token: token.clone(),
        metrics: SessionMetrics::default(),
        fsm: SessionFsm::new(),
        pad_state: pad::PadState::default(),
        tele: TelemetryState::default(),
    };
    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id.clone(), session);
    }
    let body = CreateSessionResponse {
        session_id,
        token,
        challenges: vec!["blink", "turn-left", "turn-right"],
    };
    (StatusCode::CREATED, Json(body))
}

async fn get_session(Path(id): Path<String>, State(state): State<AppState>) -> impl IntoResponse {
    let sessions = state.sessions.read().await;
    if let Some(sess) = sessions.get(&id) {
        let value = serde_json::to_value(sess).unwrap();
        (StatusCode::OK, Json(value))
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "not found" })))
    }
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.max_message_size(1 << 20)
        .max_frame_size(1 << 20)
        .on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    // Handshake: expect hello first
    let first_text: String = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(t))) => break t,
            Some(Ok(Message::Ping(p))) => { let _ = socket.send(Message::Pong(p)).await; continue; }
            Some(Ok(Message::Pong(_))) => continue,
            Some(Ok(Message::Binary(_))) => {
                let err = ServerMessage::Error { code: "bad-handshake", message: "expected hello first" };
                let _ = socket.send(Message::Text(serde_json::to_string(&err).unwrap())).await;
                let _ = socket.close().await;
                return;
            }
            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => { return; }
        }
    };

    if let Ok(ClientMessage::Hello { session_id, token, .. }) = serde_json::from_str::<ClientMessage>(&first_text) {
        let ok = {
            let sessions = state.sessions.read().await;
            sessions.get(&session_id).map(|s| s.token == token).unwrap_or(false)
        };
        if !ok {
            let err = ServerMessage::Error { code: "unauthorized", message: "invalid session or token" };
            let payload = serde_json::to_string(&err).unwrap();
            let _ = socket.send(Message::Text(payload)).await;
            let _ = socket.close().await;
            return;
        }
        let ack = ServerMessage::HelloAck { challenges: &["blink", "open-mouth", "turn-left", "turn-right", "head-up", "head-down"] };
        let payload = serde_json::to_string(&ack).unwrap();
        if socket.send(Message::Text(payload)).await.is_err() { return; }
    } else {
        warn!("event" = "ws.bad_handshake", "message" = "expected hello");
        let err = ServerMessage::Error { code: "bad-handshake", message: "expected hello first" };
        let _ = socket.send(Message::Text(serde_json::to_string(&err).unwrap())).await;
        let _ = socket.close().await;
        return;
    }

    use std::time::{Duration, Instant};
    let max_fps: u32 = 15;
    let min_frame_interval = Duration::from_millis(1000 / max_fps as u64);
    let mut last_frame_at: Option<Instant> = None;

    // Initial prompt
    {
        let prompt = ServerMessage::Prompt { challenge: protocol::PromptChallenge { id: "c1", kind: ChallengeKind::Blink, timeout_ms: 5000 } };
        let _ = socket.send(Message::Text(serde_json::to_string(&prompt).unwrap())).await;
        let mut sessions = state.sessions.write().await;
        if let Some(s) = sessions.values_mut().next() {
            s.fsm.state = FsmState::Prompting { challenge_id: "c1".to_string(), kind: ChallengeKind::Blink };
        }
    }

    while let Some(Ok(message)) = socket.recv().await {
        match message {
            Message::Text(text) => {
                if let Ok(msg) = serde_json::from_str::<ClientMessage>(&text) {
                    match msg {
                        ClientMessage::Hello { .. } => {}
                        ClientMessage::Telemetry(tel) => {
                            let mut done = false;
                            let mut sessions = state.sessions.write().await;
                            if let Some(s) = sessions.values_mut().next() {
                                // Heurística de movimento
                                if let Some(ms) = tel.motion_score { 
                                    s.tele.add_motion_score(ms);
                                    if ms >= 0.02 { 
                                        s.tele.motion_hits = s.tele.motion_hits.saturating_add(1); 
                                    }
                                }
                                // Usar dados de face do backend ONNX para turn detection
                                // Será implementado quando frameAck.face estiver disponível na telemetria
                                // Por enquanto, turn-left/right usarão motion_hits como fallback

                                // Debug: mostrar estado atual periodicamente
                                if s.tele.motion_hits % 10 == 0 {
                                    println!("🔍 Debug: motion_hits={}, motion_scores={}, face_positions={}", 
                                        s.tele.motion_hits, s.tele.motion_scores.len(), s.tele.face_positions.len());
                                }

                                // FSM: validar automaticamente desafios simples quando recebemos sinais suficientes
                                match &mut s.fsm.state {
                                    FsmState::Prompting { challenge_id, kind } => {
                                        let ok = match kind {
                                            // Blink: Requer motion significativo + análise específica
                                            ChallengeKind::Blink => {
                                                s.tele.motion_hits >= 10 && 
                                                s.tele.has_significant_motion()
                                            },
                                            // OpenMouth: Requer motion muito alto
                                            ChallengeKind::OpenMouth => {
                                                s.tele.motion_hits >= 15 &&
                                                s.tele.has_facial_motion()
                                            },
                                            // Turn movements: Requer análise de face + motion alto
                                            ChallengeKind::TurnLeft => {
                                                s.tele.motion_hits >= 20 &&
                                                s.tele.validate_turn_movement()
                                            },
                                            ChallengeKind::TurnRight => {
                                                s.tele.motion_hits >= 20 &&
                                                s.tele.validate_turn_movement()
                                            },
                                            // Head movements: Requer motion muito alto
                                            ChallengeKind::HeadUp => {
                                                s.tele.motion_hits >= 25 &&
                                                s.tele.validate_head_movement()
                                            },
                                            ChallengeKind::HeadDown => {
                                                s.tele.motion_hits >= 25 &&
                                                s.tele.validate_head_movement()
                                            },
                                        };
                                        if ok {
                                            s.fsm.completed += 1;
                                            println!("✅ Desafio {} ({:?}) concluído! ({}/3) - motion_hits: {}", 
                                                challenge_id, kind, s.fsm.completed, s.tele.motion_hits);
                                            s.tele.reset();
                                            if s.fsm.completed >= 3 {
                                                s.fsm.state = FsmState::Passed;
                                                done = true;
                                                println!("🎉 Todos os 3 desafios concluídos! Proof of life PASSED");
                                            } else {
                                                let next_kind = {
                                                    use rand::seq::SliceRandom;
                                                    use rand::thread_rng;
                                                    let mut all = vec![ChallengeKind::Blink, ChallengeKind::OpenMouth, ChallengeKind::TurnLeft, ChallengeKind::TurnRight, ChallengeKind::HeadUp, ChallengeKind::HeadDown];
                                                    all.retain(|k| k != kind);
                                                    let mut rng = thread_rng();
                                                    all.choose(&mut rng).cloned()
                                                };
                                                if let Some(nk) = next_kind {
                                                    let next_id = format!("c{}", s.fsm.completed + 1);
                                                    let next = ServerMessage::Prompt { challenge: protocol::PromptChallenge { id: &next_id, kind: nk.clone(), timeout_ms: 5000 } };
                                                    println!("🎯 Enviando próximo desafio: {:?} ({})", nk, next_id);
                                                    let _ = socket.send(Message::Text(serde_json::to_string(&next).unwrap())).await;
                                                    *kind = nk;
                                                    *challenge_id = next_id;
                                                }
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            if done {
                                let result = ServerMessage::Result { decision: protocol::Decision { passed: true, reason: None } };
                                let _ = socket.send(Message::Text(serde_json::to_string(&result).unwrap())).await;
                            }
                        }
                        ClientMessage::Frame(frame) => {
                            let now = Instant::now();
                            if let Some(prev) = last_frame_at {
                                if now.duration_since(prev) < min_frame_interval {
                                    let throttle = ServerMessage::Throttle { reason: "fps-limit", max_fps };
                                    let _ = socket.send(Message::Text(serde_json::to_string(&throttle).unwrap())).await;
                                    let mut sessions = state.sessions.write().await;
                                    if let Some(s) = sessions.values_mut().next() { s.metrics.throttled += 1; }
                                    continue;
                                }
                            }
                            last_frame_at = Some(now);

                            let mut valid = true;
                            if frame.format != "jpeg" && frame.format != "png" { valid = false; }

                            // PAD heuristics (JSON path)
                            let mut pad_dbg = None;
                            if let Some(ref b64) = frame.data {
                                if let Ok(bytes) = base64::decode(&b64) {
                                    if bytes.len() < 100 { valid = false; }
                                    let mut sessions = state.sessions.write().await;
                                    if let Some(s) = sessions.values_mut().next() {
                                        let sig = pad::process_frame(&state.pad_config, &mut s.pad_state, frame.ts, &bytes);
                                        pad_dbg = Some(protocol::PadDebug { suspected_replay: sig.suspected_replay, duplicate_hash: sig.duplicate_hash, flicker: sig.flicker });
                                    }
                                } else { valid = false; }
                            } else { valid = false; }

                            // Optional detection (onnx)
                            #[cfg(feature = "onnx")]
                            let face_opt = {
                                let mut res = None;
                                if let Some(ref b64) = frame.data {
                                    if let Ok(bytes) = base64::decode(b64) {
                                        if let Ok(img) = image::load_from_memory(&bytes) {
                                            let (w, h) = img.dimensions();
                                            let rgb = img.to_rgb8();
                                            let buf = rgb.into_raw();
                                            if let Some(det) = state.inference.scrfd.as_ref() {
                                                let faces = det.detect(&buf, w as usize, h as usize);
                                                if let Some(f) = faces.into_iter().max_by(|a,b| a.score.total_cmp(&b.score)) {
                                                    res = Some(protocol::FaceDebug { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, score: f.score });
                                                }
                                            }
                                        }
                                    }
                                }
                                res
                            };

                            #[cfg(feature = "onnx")]
                            let ack = ServerMessage::FrameAck { ts: frame.ts, rtt_ms: None, face: face_opt, pad: pad_dbg };
                            #[cfg(not(feature = "onnx"))]
                            let ack = ServerMessage::FrameAck { ts: frame.ts, rtt_ms: None, face: None, pad: pad_dbg };
                            let _ = socket.send(Message::Text(serde_json::to_string(&ack).unwrap())).await;

                            if !valid { continue; }
                            let mut sessions = state.sessions.write().await;
                            if let Some(s) = sessions.values_mut().next() { s.metrics.frames_received += 1; }
                        }
                        ClientMessage::Feedback(fb) => {
                            let mut done = false;
                            let mut sessions = state.sessions.write().await;
                            if let Some(s) = sessions.values_mut().next() {
                                match &mut s.fsm.state {
                                    FsmState::Prompting { challenge_id, kind } => {
                                        let ok = fb.ok.unwrap_or(false);
                                        let valid_kind = fb.kind.as_ref().map(|k| k == kind).unwrap_or(true);
                                        if ok && valid_kind {
                                            s.fsm.completed += 1;
                                            if s.fsm.completed >= 2 {
                                                s.fsm.state = FsmState::Passed;
                                                done = true;
                                            } else {
                                                let next_kind = if time::OffsetDateTime::now_utc().nanosecond() % 2 == 0 { ChallengeKind::TurnLeft } else { ChallengeKind::TurnRight };
                                                let next = ServerMessage::Prompt { challenge: protocol::PromptChallenge { id: "c2", kind: next_kind.clone(), timeout_ms: 5000 } };
                                                let _ = socket.send(Message::Text(serde_json::to_string(&next).unwrap())).await;
                                                *kind = next_kind;
                                                *challenge_id = "c2".to_string();
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            if done {
                                let result = ServerMessage::Result { decision: protocol::Decision { passed: true, reason: None } };
                                let _ = socket.send(Message::Text(serde_json::to_string(&result).unwrap())).await;
                                break;
                            }
                        }
                    }
                }
            }
            Message::Binary(bytes) => {
                // Binary path: header + payload
                if bytes.len() < 16 {
                    let err = ServerMessage::Error { code: "invalid-frame", message: "binary frame too small" };
                    let _ = socket.send(Message::Text(serde_json::to_string(&err).unwrap())).await; continue;
                }
                if &bytes[0..4] != b"FPF1" {
                    let err = ServerMessage::Error { code: "invalid-frame", message: "bad magic" };
                    let _ = socket.send(Message::Text(serde_json::to_string(&err).unwrap())).await; continue;
                }
                let fmt_code = bytes[4];
                let ts = { let mut arr = [0u8;8]; arr.copy_from_slice(&bytes[8..16]); u64::from_le_bytes(arr) };
                let payload = &bytes[16..];
                if payload.len() < 100 {
                    let err = ServerMessage::Error { code: "invalid-frame", message: "frame payload too small" };
                    let _ = socket.send(Message::Text(serde_json::to_string(&err).unwrap())).await; continue;
                }
                if !(fmt_code == 1 || fmt_code == 2) {
                    let err = ServerMessage::Error { code: "invalid-frame", message: "unsupported format" };
                    let _ = socket.send(Message::Text(serde_json::to_string(&err).unwrap())).await; continue;
                }

                let pad_dbg = {
                    let mut dbg = None;
                    let mut sessions = state.sessions.write().await;
                    if let Some(s) = sessions.values_mut().next() {
                        let sig = pad::process_frame(&state.pad_config, &mut s.pad_state, ts, payload);
                        dbg = Some(protocol::PadDebug { suspected_replay: sig.suspected_replay, duplicate_hash: sig.duplicate_hash, flicker: sig.flicker });
                    }
                    dbg
                };

                #[cfg(feature = "onnx")]
                let face_opt = {
                    let mut res = None;
                    if let Ok(img) = image::load_from_memory(payload) {
                        let (w, h) = img.dimensions();
                        let rgb = img.to_rgb8();
                        let buf = rgb.into_raw();
                        if let Some(det) = state.inference.scrfd.as_ref() {
                            let faces = det.detect(&buf, w as usize, h as usize);
                            if let Some(f) = faces.into_iter().max_by(|a,b| a.score.total_cmp(&b.score)) {
                                // Armazenar posição facial para análise de movimento
                                let center_x = (f.x1 + f.x2) / 2.0;
                                let center_y = (f.y1 + f.y2) / 2.0;
                                
                                // Adicionar à telemetria da sessão
                                let mut sessions = state.sessions.write().await;
                                if let Some(s) = sessions.values_mut().next() {
                                    s.tele.add_face_position(center_x, center_y);
                                }
                                
                                res = Some(protocol::FaceDebug { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, score: f.score });
                            }
                        }
                    }
                    res
                };

                #[cfg(feature = "onnx")]
                let ack = ServerMessage::FrameAck { ts, rtt_ms: None, face: face_opt, pad: pad_dbg };
                #[cfg(not(feature = "onnx"))]
                let ack = ServerMessage::FrameAck { ts, rtt_ms: None, face: None, pad: pad_dbg };
                let _ = socket.send(Message::Text(serde_json::to_string(&ack).unwrap())).await;
            }
            Message::Ping(p) => { let _ = socket.send(Message::Pong(p)).await; }
            Message::Pong(_) => {}
            Message::Close(_) => break,
            Message::Binary(_) => {}
        }
    }
}

