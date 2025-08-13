use tracing::{info, warn};
use crate::models::{select_best_models, SelectedCatalog};
#[cfg(feature = "onnx")]
use ort::session::Session;
#[cfg(feature = "onnx")]
use crate::infer::scrfd::ScrfdDetector;

pub struct InferenceContext {
    pub selected_models: SelectedCatalog,
    #[cfg(feature = "onnx")]
    pub _session: Option<Session>,
    #[cfg(feature = "onnx")]
    pub scrfd: Option<ScrfdDetector>,
}

impl InferenceContext {
    pub fn new() -> Self {
        let selected = select_best_models("models");
        if selected.face_detection.is_none() || selected.liveness.is_none() {
            warn!("event" = "models.missing", "message" = "no models found in models directory");
        }
        info!("event" = "models.selected", has_face_detection = selected.face_detection.is_some(), has_liveness = selected.liveness.is_some());
        #[cfg(feature = "onnx")]
        let _ = ort::init().with_name("face-pro").commit();

        #[cfg(feature = "onnx")]
        let _session = selected.face_detection.as_ref().and_then(|sel| {
            use ort::execution_providers::{CUDAExecutionProvider, ExecutionProviderDispatch};
            let builder = Session::builder().ok()?;
            let builder = builder.with_intra_threads(1).ok()?;
            let cuda = CUDAExecutionProvider::default();
            let providers: [ExecutionProviderDispatch; 1] = [cuda.into()];
            let builder = builder.with_execution_providers(providers).ok()?;
            builder.commit_from_file(&sel.path).ok()
        });

        #[cfg(feature = "onnx")]
        if let Some(_) = _session {
            info!("event" = "onnx.session.ok", "model" = "face_detection");
        } else {
            warn!("event" = "onnx.session.fail", "model" = "face_detection");
        }

        #[cfg(feature = "onnx")]
        let ctx = InferenceContext { selected_models: selected, _session, scrfd: None };

        #[cfg(not(feature = "onnx"))]
        let ctx = InferenceContext { selected_models: selected };

        #[cfg(feature = "onnx")]
        let ctx = {
            let mut ctx = ctx;
            if let Some(session) = ctx._session.take() {
                // Detect input size from selected face_detection model metadata if available
                let (mut in_w, mut in_h) = (640usize, 640usize);
                let mut mean: Option<[f32; 3]> = None;
                let mut stdv: Option<[f32; 3]> = None;
                if let Some(sel) = ctx.selected_models.face_detection.as_ref() {
                    if let Some(spec) = sel.metadata.inputs.get(0) {
                        if spec.shape.len() >= 4 {
                            // Expecting [N, C, H, W]
                            let sh = &spec.shape;
                            let h = sh[2].max(1) as usize;
                            let w = sh[3].max(1) as usize;
                            in_w = w;
                            in_h = h;
                        }
                        if let Some(m) = &spec.mean {
                            if m.len() == 3 { mean = Some([m[0], m[1], m[2]]); }
                        }
                        if let Some(s) = &spec.std {
                            if s.len() == 3 { stdv = Some([s[0], s[1], s[2]]); }
                        }
                    }
                }
                let mut det = ScrfdDetector::new(session, in_w, in_h);
                if let Some(m) = mean { det.mean = m; }
                if let Some(s) = stdv { det.std = s; }
                ctx.scrfd = Some(det);
                info!("event" = "scrfd.ready", width = in_w, height = in_h);
            }
            ctx
        };

        ctx
    }
}


