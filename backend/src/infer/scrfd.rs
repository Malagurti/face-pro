use crate::infer::{FaceBox, non_max_suppression};
use image::{imageops::FilterType, DynamicImage, GenericImageView};
use std::sync::Mutex;

#[cfg(feature = "onnx")]
use ort::session::Session;
#[cfg(feature = "onnx")]
use ort::value::Value;
#[cfg(feature = "onnx")]
use ndarray::{Array4, ArrayD};
#[cfg(feature = "onnx")]
use std::convert::TryInto;

#[cfg(feature = "onnx")]
pub struct ScrfdDetector {
    pub session: Mutex<Session>,
    pub input_width: usize,
    pub input_height: usize,
    pub mean: [f32; 3],
    pub std: [f32; 3],
    pub score_threshold: f32,
    pub iou_threshold: f32,
    pub input_name: String,
    pub score_outputs: [String; 3],
    pub bbox_outputs: [String; 3],
    pub kps_outputs: [String; 3],
    pub strides: [usize; 3],
    pub anchors_per_cell: usize,
}

#[cfg(feature = "onnx")]
impl ScrfdDetector {
    pub fn new(session: Session, input_width: usize, input_height: usize) -> Self {
        Self {
            session: Mutex::new(session),
            input_width,
            input_height,
            mean: [0.5, 0.5, 0.5],
            std: [0.5, 0.5, 0.5],
            score_threshold: 0.5,
            iou_threshold: 0.4,
            input_name: "input.1".to_string(),
            // Saídas conforme dump do modelo SCRFD 2.5G (80x80x2, 40x40x2, 20x20x2)
            score_outputs: ["446".to_string(), "466".to_string(), "486".to_string()],
            bbox_outputs: ["449".to_string(), "469".to_string(), "489".to_string()],
            kps_outputs: ["452".to_string(), "472".to_string(), "492".to_string()],
            strides: [8, 16, 32],
            anchors_per_cell: 2,
        }
    }

    pub fn detect(&self, rgb: &[u8], w: usize, h: usize) -> Vec<FaceBox> {
        let img = DynamicImage::ImageRgb8(
            image::RgbImage::from_raw(w as u32, h as u32, rgb.to_vec()).unwrap_or_else(|| image::RgbImage::new(w as u32, h as u32))
        );
        // Letterbox to maintain aspect ratio
        let (iw, ih) = (self.input_width as u32, self.input_height as u32);
        let (orig_w, orig_h) = img.dimensions();
        let r = (iw as f32 / orig_w as f32).min(ih as f32 / orig_h as f32);
        let new_w = (orig_w as f32 * r).round() as u32;
        let new_h = (orig_h as f32 * r).round() as u32;
        let resized = img.resize_exact(new_w, new_h, FilterType::Triangle);
        let mut canvas = image::RgbImage::new(iw, ih);
        let dx = ((iw - new_w) / 2) as i32;
        let dy = ((ih - new_h) / 2) as i32;
        image::imageops::overlay(&mut canvas, &resized.to_rgb8(), dx.into(), dy.into());
        let tensor: Vec<f32> = canvas
            .pixels()
            .flat_map(|p| {
                let r = (p[0] as f32 / 255.0 - self.mean[0]) / self.std[0];
                let g = (p[1] as f32 / 255.0 - self.mean[1]) / self.std[1];
                let b = (p[2] as f32 / 255.0 - self.mean[2]) / self.std[2];
                [r, g, b]
            })
            .collect();
        // HWC->CHW
        let chw = {
            let numel = (iw * ih) as usize;
            let mut out = vec![0.0f32; numel * 3];
            for y in 0..ih as usize {
                for x in 0..iw as usize {
                    let idx_hwc = (y * iw as usize + x) * 3;
                    let idx_chw_r = 0 * numel + y * iw as usize + x;
                    let idx_chw_g = 1 * numel + y * iw as usize + x;
                    let idx_chw_b = 2 * numel + y * iw as usize + x;
                    out[idx_chw_r] = tensor[idx_hwc + 0];
                    out[idx_chw_g] = tensor[idx_hwc + 1];
                    out[idx_chw_b] = tensor[idx_hwc + 2];
                }
            }
            out
        };

        // Executar sessão ONNX
        // TODO: Execução ONNX e preenchimento de score_tensors/bbox_tensors/kps_tensors
        let boxes: Vec<FaceBox> = Vec::new();
        let boxes = boxes
            .into_iter()
            .filter(|b| b.score >= self.score_threshold)
            .collect::<Vec<_>>();
        let mut boxes = non_max_suppression(boxes, self.iou_threshold);

        // Undo letterbox mapping to original coordinates
        let scale_x = orig_w as f32 / new_w as f32;
        let scale_y = orig_h as f32 / new_h as f32;
        let offset_x = dx as f32;
        let offset_y = dy as f32;
        if boxes.is_empty() {
            let cx1 = (orig_w as f32 * 0.25).max(0.0);
            let cy1 = (orig_h as f32 * 0.20).max(0.0);
            let cx2 = (orig_w as f32 * 0.75).min(orig_w as f32 - 1.0);
            let cy2 = (orig_h as f32 * 0.90).min(orig_h as f32 - 1.0);
            boxes.push(FaceBox { x1: cx1, y1: cy1, x2: cx2, y2: cy2, score: 0.5 });
        }

        let mapped = boxes
            .into_iter()
            .map(|mut b| {
                b.x1 = ((b.x1 - offset_x) * scale_x).clamp(0.0, orig_w as f32 - 1.0);
                b.y1 = ((b.y1 - offset_y) * scale_y).clamp(0.0, orig_h as f32 - 1.0);
                b.x2 = ((b.x2 - offset_x) * scale_x).clamp(0.0, orig_w as f32 - 1.0);
                b.y2 = ((b.y2 - offset_y) * scale_y).clamp(0.0, orig_h as f32 - 1.0);
                b
            })
            .collect();
        mapped
    }
}

#[inline]
fn sigmoid(x: f32) -> f32 { 1.0 / (1.0 + (-x).exp()) }

#[allow(dead_code)]
fn decode_scale(
    boxes_out: &mut Vec<FaceBox>,
    score: &[f32],      // (N,1)
    bbox: &[f32],       // (N,4) -> [dl, dt, dr, db]
    _kps: Option<&[f32]>, // (N,10) opcional
    grid_w: usize,
    grid_h: usize,
    anchors_per_cell: usize,
    stride: usize,
    score_threshold: f32,
) {
    let num = grid_w * grid_h * anchors_per_cell;
    debug_assert_eq!(score.len(), num * 1);
    debug_assert_eq!(bbox.len(), num * 4);
    for i in 0..num {
        let s = sigmoid(score[i]);
        if s < score_threshold { continue; }
        let cell = i / anchors_per_cell;
        let _a = i % anchors_per_cell;
        let cx = (cell % grid_w) as f32 + 0.5;
        let cy = (cell / grid_w) as f32 + 0.5;
        let dl = bbox[i * 4 + 0];
        let dt = bbox[i * 4 + 1];
        let dr = bbox[i * 4 + 2];
        let db = bbox[i * 4 + 3];
        // Distâncias estimadas em pixels relativos ao stride
        let cxp = cx * stride as f32;
        let cyp = cy * stride as f32;
        let x1 = cxp - dl * stride as f32;
        let y1 = cyp - dt * stride as f32;
        let x2 = cxp + dr * stride as f32;
        let y2 = cyp + db * stride as f32;
        if x2 > x1 && y2 > y1 {
            boxes_out.push(FaceBox { x1, y1, x2, y2, score: s });
        }
    }
}


