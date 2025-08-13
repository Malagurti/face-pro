use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct ModelCatalogEntry {
    pub kind: String,
    pub versions: Vec<String>,
}

pub fn inspect_models_dir(base_dir: impl AsRef<Path>) -> Vec<ModelCatalogEntry> {
    let base = base_dir.as_ref();
    let mut entries: Vec<ModelCatalogEntry> = Vec::new();
    for kind in ["face_detection", "liveness"] {
        let mut versions: Vec<String> = Vec::new();
        let kind_dir: PathBuf = base.join(kind);
        if let Ok(read) = fs::read_dir(&kind_dir) {
            for item in read.flatten() {
                if let Ok(ft) = item.file_type() {
                    if ft.is_dir() {
                        let name = item.file_name().to_string_lossy().to_string();
                        // only count as model version if it contains metadata.json
                        let has_meta = kind_dir.join(&name).join("metadata.json").exists();
                        if has_meta { versions.push(name); }
                    }
                }
            }
        }
        versions.sort();
        entries.push(ModelCatalogEntry { kind: kind.to_string(), versions });
    }
    entries
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InputSpec {
    pub name: String,
    pub shape: Vec<i64>,
    pub layout: String,
    pub mean: Option<Vec<f32>>,
    pub std: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelMetadata {
    pub name: String,
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub inputs: Vec<InputSpec>,
    pub license: String,
    #[serde(default)]
    pub accuracy: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelSelection {
    pub kind: String,
    pub version: String,
    pub path: String,
    pub metadata: ModelMetadata,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SelectedCatalog {
    pub face_detection: Option<ModelSelection>,
    pub liveness: Option<ModelSelection>,
}

fn read_metadata(path: &Path) -> Option<ModelMetadata> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ModelMetadata>(&data).ok()
}

fn discover_kind(base_dir: &Path, kind: &str) -> Vec<(String, ModelMetadata, String)> {
    let mut out: Vec<(String, ModelMetadata, String)> = Vec::new();
    let kind_dir = base_dir.join(kind);
    if let Ok(read) = fs::read_dir(&kind_dir) {
        for item in read.flatten() {
            if let Ok(ft) = item.file_type() {
                if ft.is_dir() {
                    let version = item.file_name().to_string_lossy().to_string();
                    let meta_path = kind_dir.join(&version).join("metadata.json");
                    if meta_path.exists() {
                        if let Some(meta) = read_metadata(&meta_path) {
                            // Prefer a model.onnx in the same dir; allow any extension "model.*"
                            if let Some(existing) = ["model.onnx", "model.ort", "model"]
                                .into_iter()
                                .map(|fname| kind_dir.join(&version).join(fname))
                                .find(|p| p.exists())
                            {
                                out.push((
                                    version,
                                    meta,
                                    existing.to_string_lossy().to_string(),
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

fn pick_best(mut items: Vec<(String, ModelMetadata, String)>) -> Option<ModelSelection> {
    if items.is_empty() {
        return None;
    }
    items.sort_by(|a, b| {
        let acc_a = a.1.accuracy.unwrap_or(f64::NEG_INFINITY);
        let acc_b = b.1.accuracy.unwrap_or(f64::NEG_INFINITY);
        acc_b
            .partial_cmp(&acc_a)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.0.cmp(&a.0))
    });
    let (version, metadata, path) = items.remove(0);
    Some(ModelSelection { kind: String::new(), version, path, metadata })
}

pub fn select_best_models(base_dir: impl AsRef<Path>) -> SelectedCatalog {
    let base = base_dir.as_ref();
    let mut selected = SelectedCatalog::default();

    let det = pick_best(discover_kind(base, "face_detection")).map(|mut s| {
        s.kind = "face_detection".to_string();
        s
    });
    let liv = pick_best(discover_kind(base, "liveness")).map(|mut s| {
        s.kind = "liveness".to_string();
        s
    });

    selected.face_detection = det;
    selected.liveness = liv;
    selected
}


