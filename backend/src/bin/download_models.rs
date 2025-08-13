use std::fs;
use std::path::PathBuf;
use sha2::{Digest, Sha256};
use reqwest::blocking::get;

#[derive(serde::Deserialize)]
struct Meta {
    url: String,
    sha256: String,
}

fn main() {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models");
    println!("models directory: {}", base.display());
    // Placeholder: In a future step, this binary will fetch remote URLs and validate checksums
    for sub in ["face_detection", "liveness"] {
        let p = base.join(sub);
        if p.exists() {
            println!("found: {}", p.display());
        } else {
            fs::create_dir_all(&p).expect("failed to create models subdir");
            println!("created: {}", p.display());
        }
    }

    // face_detection/0001
    let fd = base.join("face_detection").join("0001");
    let meta_path = fd.join("metadata.json");
    if meta_path.exists() {
        println!("reading metadata: {}", meta_path.display());
        let meta: Meta = serde_json::from_str(&fs::read_to_string(&meta_path).expect("read meta"))
            .expect("parse meta");
        if meta.url.is_empty() || meta.sha256.is_empty() || meta.sha256 == "<to-fill>" {
            println!("skip: provide valid url and sha256 in {}", meta_path.display());
            return;
        }
        let model_path = fd.join("model.onnx");
        if !model_path.exists() {
            println!("downloading {} -> {}", meta.url, model_path.display());
            let resp = get(&meta.url).expect("download");
            let buf = resp.bytes().expect("read bytes").to_vec();
            let mut hasher = Sha256::new();
            hasher.update(&buf);
            let digest = hasher.finalize();
            let hex = hex::encode(digest);
            if hex != meta.sha256 {
                panic!("checksum mismatch: {} != {}", hex, meta.sha256);
            }
            fs::write(&model_path, &buf).expect("write model");
            println!("saved {} ({} bytes)", model_path.display(), buf.len());
        } else {
            println!("model exists: {}", model_path.display());
        }
    } else {
        println!("metadata not found: {}", meta_path.display());
    }
}


