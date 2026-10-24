//! Local transcription engine — in-process whisper.cpp via `whisper-rs`.
//!
//! It is engine #0 of the `voice_transcribe` chain: zero network, zero keys,
//! ~100-400ms latency for a 3-5s voice command on Apple Silicon (Metal).
//! The ggml model lives in `<app_data>/models/` and is downloaded lazily in the
//! background on first voice use; until it is ready the chain continues with
//! the cloud engines, so the user never waits for the download.
//!
//! The `WhisperContext` (mmap of the model) stays loaded between calls:
//! only the first transcription pays the load (~150-400ms).
//!
//! Default model: `ggml-small-q5_1.bin` (~190MB, multilingual). Override
//! with env `PROMPTOPS_WHISPER_MODEL` (e.g. `ggml-base-q5_1.bin`, ~59MB):
//! only models listed in `MODEL_SHA256` can be downloaded, because every
//! download is checked against a pinned SHA-256 before it is used.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_URL_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
/// SHA-256 of every model this build may download, from the Hugging Face
/// API (`/api/models/ggerganov/whisper.cpp/tree/main`, field `lfs.oid`).
/// A download whose bytes do not match is deleted and never loaded.
const MODEL_SHA256: &[(&str, &str)] = &[
    (
        "ggml-tiny-q5_1.bin",
        "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7",
    ),
    (
        "ggml-tiny-q8_0.bin",
        "c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca",
    ),
    (
        "ggml-base-q5_1.bin",
        "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    ),
    (
        "ggml-base-q8_0.bin",
        "c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9",
    ),
    (
        "ggml-small-q5_1.bin",
        "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    ),
    (
        "ggml-small-q8_0.bin",
        "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f",
    ),
    (
        "ggml-medium-q5_0.bin",
        "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
    ),
    (
        "ggml-large-v3-turbo-q5_0.bin",
        "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    ),
    (
        "ggml-large-v3-turbo-q8_0.bin",
        "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
    ),
];

/// Pinned SHA-256 (lowercase hex) for a model file name, if any.
fn pinned_sha256(model: &str) -> Option<&'static str> {
    MODEL_SHA256
        .iter()
        .find(|(name, _)| *name == model)
        .map(|(_, hash)| *hash)
}

/// Model that gets downloaded and preferred: small (~190MB) — base (~59MB)
/// mangles Italian commands ("apri le sessioni" → "Appelizzazioni").
const PREFERRED_MODEL: &str = "ggml-small-q5_1.bin";
/// Fallback: serves transcriptions until small is on disk.
const FALLBACK_MODEL: &str = "ggml-base-q5_1.bin";

/// Vocabulary bias for whisper: the app's command phrases. It clearly
/// improves recognition of short commands without penalizing
/// free dictation.
const INITIAL_PROMPT: &str = "PromptOps voice commands: apri le sessioni, apri sessione, sessione successiva, sessione precedente, nuova sessione, chiudi sessione, focus sub agent, agente due, vai al terminale, prossimo agente, elenco agenti, nuovo sub agent, workspace, invia, scrivi, esegui, ranking, impostazioni, open sessions, next session, focus sub agent, go to terminal, list agents, new sub agent, send, run, settings.";

/// Loaded whisper context, reused across calls. The Mutex serializes
/// transcriptions (one at a time — voice is a single stream anyway).
static ENGINE: OnceLock<Mutex<Option<LoadedModel>>> = OnceLock::new();
/// A single download per process, even with concurrent transcribes.
static DOWNLOAD_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct LoadedModel {
    ctx: WhisperContext,
    path: PathBuf,
}

fn engine_slot() -> &'static Mutex<Option<LoadedModel>> {
    ENGINE.get_or_init(|| Mutex::new(None))
}

/// Model to download (env override or the preferred one).
fn model_name() -> String {
    std::env::var("PROMPTOPS_WHISPER_MODEL")
        .ok()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| PREFERRED_MODEL.to_string())
}

fn models_dir(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("models"))
}

fn model_path(app: &AppHandle) -> Option<PathBuf> {
    Some(models_dir(app)?.join(model_name()))
}

/// Best model ALREADY on disk, in order of preference: env override,
/// small, base. So base serves transcriptions while small downloads,
/// and the swap happens on its own as soon as the file is there (the ctx reloads on
/// path change).
fn best_ready_model_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = models_dir(app)?;
    let mut names = vec![model_name()];
    for m in [PREFERRED_MODEL, FALLBACK_MODEL] {
        if !names.iter().any(|n| n == m) {
            names.push(m.to_string());
        }
    }
    names.into_iter().map(|n| dir.join(n)).find(|p| p.exists())
}

/// true if a usable model is already downloaded.
pub fn model_ready(app: &AppHandle) -> bool {
    best_ready_model_path(app).is_some()
}

/// true while the model download is in progress.
pub fn model_downloading() -> bool {
    DOWNLOAD_IN_FLIGHT.load(Ordering::SeqCst)
}

// =====================================================================
//  Lazy background download
// =====================================================================

/// Starts (only once) the model download on a dedicated thread.
/// No-op if the model already exists or a download is in progress. Emits
/// `voice:local-model` events with `{ status: downloading|ready|error, progress? }`.
pub fn ensure_model_download(app: &AppHandle) {
    let Some(path) = model_path(app) else { return };
    if path.exists() {
        return;
    }
    if DOWNLOAD_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let result = download_model(&app, &path);
        DOWNLOAD_IN_FLIGHT.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                let _ = app.emit(
                    "voice:local-model",
                    serde_json::json!({ "status": "ready" }),
                );
            }
            Err(e) => {
                eprintln!("[voice-local] model download failed: {e}");
                let _ = app.emit(
                    "voice:local-model",
                    serde_json::json!({ "status": "error", "error": e }),
                );
            }
        }
    });
}

fn download_model(app: &AppHandle, dest: &PathBuf) -> Result<(), String> {
    let name = model_name();
    let expected = pinned_sha256(&name)
        .ok_or_else(|| format!("no pinned SHA-256 for model {name}: download refused"))?;
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let url = format!("{MODEL_URL_BASE}{name}");
    let _ = app.emit(
        "voice:local-model",
        serde_json::json!({ "status": "downloading", "progress": 0 }),
    );

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client.get(&url).send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(0);

    // Download to .part and rename only once the download completes and the
    // hash matches, so a process killed halfway or a tampered file never
    // becomes the model whisper loads.
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut last_pct: u64 = 0;
    let result = copy_verified(&mut res, &mut file, expected, |written| {
        if let Some(pct) = (written * 100).checked_div(total) {
            if pct >= last_pct + 5 {
                last_pct = pct;
                let _ = app.emit(
                    "voice:local-model",
                    serde_json::json!({ "status": "downloading", "progress": pct }),
                );
            }
        }
    });
    drop(file);
    let written = match result {
        Ok(n) => n,
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
    };
    if total > 0 && written < total {
        let _ = std::fs::remove_file(&part);
        return Err("truncated download".to_string());
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Copies `reader` into `writer` while hashing the bytes, then checks the
/// SHA-256 against `expected_hex`. Returns the byte count, or an error on
/// I/O failure or digest mismatch (the caller deletes the partial file).
fn copy_verified<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    expected_hex: &str,
    mut on_progress: impl FnMut(u64),
) -> Result<u64, String> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut written: u64 = 0;
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        written += n as u64;
        on_progress(written);
    }
    writer.flush().map_err(|e| e.to_string())?;
    let actual: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if !actual.eq_ignore_ascii_case(expected_hex.trim()) {
        return Err(format!(
            "model integrity check failed (SHA-256 {actual}, expected {expected_hex})"
        ));
    }
    Ok(written)
}

// =====================================================================
//  Transcription
// =====================================================================

/// Transcribes a 16kHz mono 16-bit WAV with the local model.
/// Returns `(text, detected_language)` — None if the model is not ready,
/// the file is not a compatible WAV or inference fails (the cloud
/// chain acts as fallback).
pub fn transcribe_local(
    app: &AppHandle,
    wav_file: &std::path::Path,
    lang: Option<&str>,
) -> Option<(String, Option<String>)> {
    let path = best_ready_model_path(app)?;
    // If the preferred one is missing (we are serving with the fallback), the download starts
    // in the background anyway: on the next swap the better model is used.
    ensure_model_download(app);
    let samples = read_wav_16k_mono(wav_file)?;
    if samples.len() < 1600 {
        // < 0.1s of audio: not worth an inference.
        return None;
    }

    let mut slot = engine_slot().lock();
    // (Re)load the context if missing or if the model on disk changed.
    if slot.as_ref().map(|m| m.path != path).unwrap_or(true) {
        let ctx =
            WhisperContext::new_with_params(path.to_str()?, WhisperContextParameters::default())
                .map_err(|e| eprintln!("[voice-local] model load failed: {e}"))
                .ok()?;
        *slot = Some(LoadedModel {
            ctx,
            path: path.clone(),
        });
    }
    let loaded = slot.as_ref()?;

    let mut state = loaded
        .ctx
        .create_state()
        .map_err(|e| eprintln!("[voice-local] state failed: {e}"))
        .ok()?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8) as std::os::raw::c_int;
    params.set_n_threads(threads);
    // "auto" enables whisper.cpp language detection; an explicit hint
    // ("it"/"en"/...) skips it and speeds things up.
    let hint = lang
        .filter(|l| *l != "auto")
        .map(|l| l.split('-').next().unwrap_or(l).to_lowercase());
    params.set_language(Some(hint.as_deref().unwrap_or("auto")));
    params.set_initial_prompt(INITIAL_PROMPT);
    params.set_translate(false);
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    if let Err(e) = state.full(params, &samples) {
        eprintln!("[voice-local] inference failed: {e}");
        return None;
    }

    let n = state.full_n_segments();
    let mut text = String::new();
    for i in 0..n {
        if let Some(seg) = state.get_segment(i) {
            if let Ok(s) = seg.to_str_lossy() {
                text.push_str(&s);
            }
        }
    }
    let text = text.trim().to_string();
    // On silence/noise whisper often emits a lone "." or similar:
    // without alphanumeric content it is not a transcription.
    if text.is_empty() || !text.chars().any(|c| c.is_alphanumeric()) {
        return None;
    }

    let detected = whisper_rs::get_lang_str(state.full_lang_id_from_state())
        .and_then(super::voice::map_whisper_language)
        .map(|s| s.to_string());

    Some((text, detected))
}

/// Minimal WAV parser: accepts only PCM 16-bit mono 16kHz (what the
/// renderer produces). Iterates over the RIFF chunks to find fmt/data — no
/// assumptions about a fixed 44-byte header.
fn read_wav_16k_mono(path: &std::path::Path) -> Option<Vec<f32>> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12usize;
    let mut fmt_ok = false;
    let mut data: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as usize;
        let body_start = pos + 8;
        let body_end = body_start.checked_add(size)?.min(bytes.len());
        if id == b"fmt " && size >= 16 && body_end - body_start >= 16 {
            let fmt = &bytes[body_start..body_end];
            let audio_format = u16::from_le_bytes(fmt[0..2].try_into().ok()?);
            let channels = u16::from_le_bytes(fmt[2..4].try_into().ok()?);
            let sample_rate = u32::from_le_bytes(fmt[4..8].try_into().ok()?);
            let bits = u16::from_le_bytes(fmt[14..16].try_into().ok()?);
            fmt_ok = audio_format == 1 && channels == 1 && sample_rate == 16000 && bits == 16;
        } else if id == b"data" {
            data = Some(&bytes[body_start..body_end]);
        }
        // RIFF chunks are 2-byte aligned.
        pos = match body_start
            .checked_add(size)
            .and_then(|p| p.checked_add(size & 1))
        {
            Some(p) => p,
            None => break,
        };
    }
    if !fmt_ok {
        return None;
    }
    let data = data?;
    let mut samples = Vec::with_capacity(data.len() / 2);
    for pair in data.as_chunks::<2>().0 {
        let v = i16::from_le_bytes(*pair);
        samples.push(v as f32 / 32768.0);
    }
    Some(samples)
}

// =====================================================================
//  Tauri commands — model status/download (for the Settings UI)
// =====================================================================

#[derive(Serialize)]
pub struct LocalModelStatus {
    pub ready: bool,
    pub downloading: bool,
    pub model: String,
    #[serde(rename = "sizeMb", skip_serializing_if = "Option::is_none")]
    pub size_mb: Option<u64>,
}

/// voice:local-model-status — `{ ready, downloading, model, sizeMb? }`.
#[tauri::command]
pub fn voice_local_model_status(app: AppHandle) -> Result<LocalModelStatus, String> {
    let ready_path = best_ready_model_path(&app);
    let size_mb = ready_path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len() / (1024 * 1024));
    Ok(LocalModelStatus {
        ready: ready_path.is_some(),
        downloading: DOWNLOAD_IN_FLIGHT.load(Ordering::SeqCst),
        model: model_name(),
        size_mb,
    })
}

/// voice:local-model-download — starts the download in the background (idempotent).
#[tauri::command]
pub fn voice_local_model_download(app: AppHandle) -> Result<LocalModelStatus, String> {
    ensure_model_download(&app);
    voice_local_model_status(app)
}

#[cfg(test)]
mod wav_tests {
    use super::read_wav_16k_mono;

    fn wav(fmt_size: u32, fmt_body: &[u8], data: &[u8]) -> Vec<u8> {
        let mut b = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        b.extend_from_slice(&fmt_size.to_le_bytes());
        b.extend_from_slice(fmt_body);
        b.extend_from_slice(b"data");
        b.extend_from_slice(&(data.len() as u32).to_le_bytes());
        b.extend_from_slice(data);
        b
    }

    fn pcm16k_mono_fmt() -> Vec<u8> {
        let mut f = Vec::new();
        f.extend_from_slice(&1u16.to_le_bytes()); // PCM
        f.extend_from_slice(&1u16.to_le_bytes()); // mono
        f.extend_from_slice(&16000u32.to_le_bytes());
        f.extend_from_slice(&32000u32.to_le_bytes());
        f.extend_from_slice(&2u16.to_le_bytes());
        f.extend_from_slice(&16u16.to_le_bytes());
        f
    }

    fn read(bytes: &[u8]) -> Option<Vec<f32>> {
        let path = std::env::temp_dir().join(format!(
            "promptops-wav-{}.wav",
            crate::local_store::new_id()
        ));
        std::fs::write(&path, bytes).unwrap();
        let out = read_wav_16k_mono(&path);
        let _ = std::fs::remove_file(&path);
        out
    }

    #[test]
    fn valid_wav_is_read() {
        let samples = read(&wav(16, &pcm16k_mono_fmt(), &[0, 0, 0xff, 0x7f])).unwrap();
        assert_eq!(samples.len(), 2);
    }

    #[test]
    fn truncated_or_lying_headers_never_panic() {
        let good = wav(16, &pcm16k_mono_fmt(), &[1, 2, 3, 4]);
        for cut in 0..good.len() {
            let _ = read(&good[..cut]);
        }
        // A fmt chunk that claims 16 bytes at the very end of the file, with
        // only 4 of them present (a filler chunk keeps the file over 44 bytes).
        let mut short = b"RIFF\0\0\0\0WAVEjunk".to_vec();
        short.extend_from_slice(&20u32.to_le_bytes());
        short.extend_from_slice(&[0u8; 20]);
        short.extend_from_slice(b"fmt ");
        short.extend_from_slice(&16u32.to_le_bytes());
        short.extend_from_slice(&[1, 0, 1, 0]);
        assert!(short.len() >= 44);
        assert!(read(&short).is_none());
        let mut huge = good.clone();
        huge[16..20].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(read(&huge).is_none());
    }
}

#[cfg(test)]
mod integrity_tests {
    use super::{copy_verified, pinned_sha256, MODEL_SHA256, PREFERRED_MODEL};

    // SHA-256("abc"), FIPS 180-2 test vector.
    const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn copy_verified_accepts_matching_digest() {
        let mut out = Vec::new();
        let mut seen = 0;
        let n = copy_verified(&mut &b"abc"[..], &mut out, ABC_SHA256, |w| seen = w).unwrap();
        assert_eq!(n, 3);
        assert_eq!(seen, 3);
        assert_eq!(out, b"abc");
        // Case-insensitive.
        copy_verified(
            &mut &b"abc"[..],
            &mut Vec::new(),
            &ABC_SHA256.to_uppercase(),
            |_| {},
        )
        .unwrap();
    }

    #[test]
    fn copy_verified_rejects_mismatch() {
        let err = copy_verified(&mut &b"abd"[..], &mut Vec::new(), ABC_SHA256, |_| {}).unwrap_err();
        assert!(err.contains("integrity check failed"));
    }

    #[test]
    fn default_model_is_pinned_and_hashes_are_well_formed() {
        assert!(pinned_sha256(PREFERRED_MODEL).is_some());
        assert!(pinned_sha256("ggml-unknown.bin").is_none());
        for (name, hash) in MODEL_SHA256 {
            assert_eq!(hash.len(), 64, "{name}");
            assert!(hash.chars().all(|c| c.is_ascii_hexdigit()), "{name}");
        }
    }
}
