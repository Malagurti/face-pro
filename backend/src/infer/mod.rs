#[cfg(feature = "onnx")]
pub mod scrfd;

#[derive(Debug, Clone)]
pub struct FaceBox {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub score: f32,
}

impl FaceBox {
    pub fn area(&self) -> f32 {
        let w = (self.x2 - self.x1).max(0.0);
        let h = (self.y2 - self.y1).max(0.0);
        w * h
    }
}

pub fn intersection_over_union(a: &FaceBox, b: &FaceBox) -> f32 {
    let x1 = a.x1.max(b.x1);
    let y1 = a.y1.max(b.y1);
    let x2 = a.x2.min(b.x2);
    let y2 = a.y2.min(b.y2);
    let w = (x2 - x1).max(0.0);
    let h = (y2 - y1).max(0.0);
    let inter = w * h;
    if inter <= 0.0 { return 0.0; }
    let union = a.area() + b.area() - inter;
    if union <= 0.0 { 0.0 } else { inter / union }
}

pub fn non_max_suppression(mut boxes: Vec<FaceBox>, iou_threshold: f32) -> Vec<FaceBox> {
    if boxes.is_empty() { return boxes; }
    boxes.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut selected: Vec<FaceBox> = Vec::new();
    while let Some(candidate) = boxes.pop() {
        let keep = selected
            .iter()
            .all(|s| intersection_over_union(&candidate, s) < iou_threshold);
        if keep { selected.push(candidate); }
    }
    selected
}


