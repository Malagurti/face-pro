use std::collections::VecDeque;
use serde::Serialize;
use image::{DynamicImage, ImageBuffer, Luma};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadConfig {
    pub replay_window_ms: u64,
    pub allow_clock_skew_ms: u64,
    pub max_recent_hashes: usize,
    pub duplicate_hamming_threshold: u32,
    pub flicker_size: u32,
    pub flicker_suspect_threshold: f32,
}

impl Default for PadConfig {
    fn default() -> Self {
        Self {
            replay_window_ms: 5000,
            allow_clock_skew_ms: 1000,
            max_recent_hashes: 32,
            duplicate_hamming_threshold: 0,
            flicker_size: 32,
            flicker_suspect_threshold: 0.2,
        }
    }
}

#[derive(Default, Clone)]
pub struct PadState {
    pub last_ts: Option<u64>,
    pub recent_hashes: VecDeque<(u64, u64)>, // (hash, ts)
    pub last_small_gray: Option<Vec<u8>>,    // flicker reference
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadSignals {
    pub suspected_replay: bool,
    pub duplicate_hash: bool,
    pub flicker: f32,
}

pub fn process_frame(config: &PadConfig, state: &mut PadState, ts: u64, bytes: &[u8]) -> PadSignals {
    let mut suspected_replay = false;
    let mut duplicate_hash = false;
    let mut flicker = 0.0f32;

    if let Some(prev) = state.last_ts {
        if ts + config.allow_clock_skew_ms < prev { suspected_replay = true; }
        if ts > prev && ts - prev > config.replay_window_ms * 2 { /* large gap tolerated */ }
    }
    state.last_ts = Some(ts);

    if let Ok(img) = image::load_from_memory(bytes) {
        let hash = phash_u64(&img);
        // Remove old hashes beyond window
        while let Some(&(_, t)) = state.recent_hashes.front() {
            if ts.saturating_sub(t) > config.replay_window_ms { state.recent_hashes.pop_front(); } else { break; }
        }
        // Check duplicates
        duplicate_hash = state.recent_hashes.iter().any(|(h, _)| hamming_distance_u64(*h, hash) <= config.duplicate_hamming_threshold);
        state.recent_hashes.push_back((hash, ts));
        if state.recent_hashes.len() > config.max_recent_hashes { let _ = state.recent_hashes.pop_front(); }

        // Flicker: mean abs diff of small grayscale
        let small = downscale_gray(&img, config.flicker_size, config.flicker_size);
        if let Some(prev) = state.last_small_gray.replace(small.clone()) {
            let len = prev.len().min(small.len());
            if len > 0 {
                let mut acc = 0.0f32;
                for i in 0..len { acc += ((prev[i] as i16 - small[i] as i16).abs() as f32) / 255.0; }
                flicker = acc / len as f32;
            }
        }
    }

    PadSignals { suspected_replay, duplicate_hash, flicker }
}

 fn phash_u64(img: &DynamicImage) -> u64 {
    use std::f32::consts::PI;
    let g = img.to_luma8();
    let resized: ImageBuffer<Luma<u8>, Vec<u8>> = image::imageops::resize(&g, 32, 32, image::imageops::FilterType::Triangle);
    let mut f: [[f32; 32]; 32] = [[0.0; 32]; 32];
    for y in 0..32usize {
        for x in 0..32usize {
            f[y][x] = resized[(x as u32, y as u32)][0] as f32;
        }
    }
    // 2D DCT-II naive (suficiente para 32x32)
    let mut c: [[f32; 32]; 32] = [[0.0; 32]; 32];
    for u in 0..32usize {
        for v in 0..32usize {
            let mut sum = 0.0f32;
            for y in 0..32usize {
                for x in 0..32usize {
                    let cx = ((PI / 32.0) * ((x as f32) + 0.5) * (u as f32)).cos();
                    let cy = ((PI / 32.0) * ((y as f32) + 0.5) * (v as f32)).cos();
                    sum += f[y][x] * cx * cy;
                }
            }
            let alpha_u = if u == 0 { (1.0f32 / 2.0).sqrt() } else { 1.0 };
            let alpha_v = if v == 0 { (1.0f32 / 2.0).sqrt() } else { 1.0 };
            c[u][v] = 0.25 * alpha_u * alpha_v * sum;
        }
    }
    // Pegue 8x8 do topo-esquerdo (exclui DC c[0][0])
    let mut vals: [f32; 64] = [0.0; 64];
    let mut idx = 0usize;
    for u in 0..8usize {
        for v in 0..8usize {
            vals[idx] = c[u][v];
            idx += 1;
        }
    }
    // Ignore DC
    let mut ac: Vec<f32> = vals[1..].to_vec();
    ac.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = ac[ac.len() / 2];
    let mut bits: u64 = 0;
    for (i, &val) in vals.iter().enumerate().skip(1) {
        if val > median { bits |= 1u64 << (i - 1); }
    }
    bits
 }

fn hamming_distance_u64(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

fn downscale_gray(img: &DynamicImage, w: u32, h: u32) -> Vec<u8> {
    let g = img.to_luma8();
    let small: ImageBuffer<Luma<u8>, Vec<u8>> = image::imageops::resize(&g, w, h, image::imageops::FilterType::Triangle);
    small.into_raw()
}


