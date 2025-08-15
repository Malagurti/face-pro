use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    Hello {
        #[serde(rename = "sessionId")]
        session_id: String,
        token: String,
        client: ClientInfo,
    },
    Frame(FrameMessage),
    Telemetry(TelemetryMessage),
    Feedback(FeedbackMessage),
    ChallengeStart(ChallengeStartMessage),
    ChallengeFrameBatch(ChallengeFrameBatchMessage),
    ChallengeEnd(ChallengeEndMessage),
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub sdk_version: String,
    pub platform: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hints {
    #[serde(default)]
    pub roll: Option<f32>,
    #[serde(default)]
    pub pitch: Option<f32>,
    #[serde(default)]
    pub yaw: Option<f32>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameMessage {
    pub ts: u64,
    pub format: String,
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub hints: Option<Hints>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryMessage {
    #[serde(default)]
    pub fps: Option<f32>,
    #[serde(default)]
    pub rtt_ms: Option<u32>,
    #[serde(default)]
    pub cam_width: Option<u32>,
    #[serde(default)]
    pub cam_height: Option<u32>,
    #[serde(default)]
    pub motion_score: Option<f32>,
    #[serde(default)]
    pub ahash: Option<String>,
    #[serde(default)]
    pub face_present: Option<bool>,
    #[serde(default)]
    pub face_box: Option<TelemetryFaceBox>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryFaceBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackMessage {
    #[serde(default)]
    pub status: Option<String>, // "continue" | "fail" | "pass"
    #[serde(default)]
    pub liveness: Option<f32>,
    #[serde(default)]
    pub spoof: Option<f32>,
    #[serde(default)]
    pub kind: Option<ChallengeKind>,
    #[serde(default)]
    pub ok: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage<'a> {
    HelloAck {
        challenges: &'a [&'a str],
    },
    Error {
        code: &'a str,
        message: &'a str,
    },
    Throttle {
        reason: &'a str,
        max_fps: u32,
    },
    Prompt {
        challenge: PromptChallenge<'a>,
    },
    Result {
        #[serde(rename = "attemptId")]
        attempt_id: &'a str,
        decision: Decision,
    },
    FrameAck {
        ts: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        rtt_ms: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        face: Option<FaceDebug>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pad: Option<PadDebug>,
    },
    ChallengeResult {
        #[serde(rename = "attemptId")]
        attempt_id: String,
        #[serde(rename = "challengeId")]
        challenge_id: String,
        decision: Decision,
        analysis: ChallengeAnalysis,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceDebug {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub score: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadDebug {
    pub suspected_replay: bool,
    pub duplicate_hash: bool,
    pub flicker: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptChallenge<'a> {
    pub id: &'a str,
    pub kind: ChallengeKind,
    pub timeout_ms: u32,
    pub attempt_id: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ChallengeKind {
    Blink,
    OpenMouth,
    TurnLeft,
    TurnRight,
    HeadUp,
    HeadDown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub passed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

// Estruturas para o sistema de buffer
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeStartMessage {
    pub attempt_id: String,
    pub challenge_id: String,
    pub challenge_type: String,
    pub start_time: u64,
    pub total_frames: usize,
    pub completion_time: Option<u64>,
    pub gesture_detected: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeFrameBatchMessage {
    pub attempt_id: String,
    pub challenge_id: String,
    pub batch_index: usize,
    pub frames: Vec<ChallengeFrameData>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeFrameData {
    pub timestamp: f64,
    pub frame_id: u64,
    #[serde(default)]
    pub image_data: Option<String>,
    #[serde(default)]
    pub motion_score: Option<f32>,
    #[serde(default)]
    pub ahash: Option<String>,
    #[serde(default)]
    pub face_present: Option<bool>,
    #[serde(default)]
    pub face_box: Option<ChallengeFaceBox>,
    #[serde(default)]
    pub landmarks: Option<serde_json::Value>,
    #[serde(default)]
    pub telemetry: Option<ChallengeTelemetry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeFaceBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeTelemetry {
    #[serde(default)]
    pub fps: Option<f32>,
    #[serde(default)]
    pub rtt_ms: Option<u32>,
    #[serde(default)]
    pub cam_width: Option<u32>,
    #[serde(default)]
    pub cam_height: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeEndMessage {
    pub attempt_id: String,
    pub challenge_id: String,
    pub timestamp: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeAnalysis {
    pub total_frames: usize,
    pub frames_with_face: usize,
    pub frames_with_landmarks: usize,
    pub average_motion_score: f32,
    pub face_detection_rate: f32,
    pub gesture_confidence: f32,
    pub processing_time_ms: u64,
    pub quality_score: f32,
}


