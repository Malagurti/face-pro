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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ChallengeKind {
    Blink,
    TurnLeft,
    TurnRight,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub passed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}


