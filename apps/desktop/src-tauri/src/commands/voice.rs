//! Voice + voice-shortcut:
//!   - voice:* transcription, mic, API key
//!   - voice:*shortcut* + hotkey toggle/cancel
//!   - global hotkey lifecycle
//!   - hotkey config persistence
//!
//! Conventions as in
//! `terminal.rs`: `#[tauri::command] pub fn <name>(...) -> Result<T, String>`,
//! snake_case names mapped from the IPC channels.
//!
//! ── Channel → command map ───────────────────────────────────────────
//!   voice:transcribe            → voice_transcribe
//!   voice:check-mic             → voice_check_mic
//!   voice:open-mic-settings     → voice_open_mic_settings
//!   voice:get-api-key           → voice_get_api_key
//!   voice:set-api-key           → voice_set_api_key
//!   voice:test-api-key          → voice_test_api_key
//!   voice:hotkey-toggle         → voice_hotkey_toggle   (emits the push event)
//!   voice:hotkey-cancel         → voice_hotkey_cancel   (emits the push event)
//!   voice:get-shortcut-config   → voice_get_shortcut_config
//!   voice:set-shortcut-config   → voice_set_shortcut_config
//!   voice:open-system-settings  → voice_open_system_settings
//!
//! ── Transcription chain (priority order) ────────────────────────────
//!   0. Local Whisper in-process: whisper.cpp (voice_local.rs), offline, Metal
//!      on macOS. The model is downloaded once from Hugging Face on first use;
//!      after that audio never leaves the device.
//!   1. Groq Whisper API: only with the Groq key YOU saved in the app (kept in
//!      the encrypted local store). Audio goes to Groq under your account.
//!      Environment variables are ignored on purpose: audio leaves the
//!      device only after an explicit choice made in the app.
//!   2. macOS native speech recognition: on the device when the language
//!      supports it, otherwise Apple's service.
//!   3. Local Whisper CLI: requires `pip install openai-whisper`.
//!
//! No PromptOps server is involved: PromptOps Desktop also offers a hosted
//! transcription proxy, which is not part of this edition.
//!
//! Global hotkey: Alt+M (⌥+M) via tauri-plugin-global-shortcut — the plugin
//! exposes Pressed/Released, so "hold for holdMs" is measured with a
//! timer armed on Pressed (see `handle_voice_shortcut_event`).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::{AppHandle, Emitter, Manager};

// ── Parity constants ─────────────────────────────────────────────────
const GROQ_MODELS_URL: &str = "https://api.groq.com/openai/v1/models";
const GROQ_TRANSCRIBE_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";

// =====================================================================
//  Shared state — global hotkey config (mirror of VoiceShortcutManager)
// =====================================================================

/// Persisted voice-shortcut config. 1:1 with the TS `VoiceShortcutConfig`.
#[derive(Clone, Serialize, Deserialize)]
pub struct VoiceShortcutConfig {
    pub enabled: bool,
    #[serde(rename = "holdMs")]
    pub hold_ms: u64,
    /// macOS-only: true once we have shown the Accessibility prompt,
    /// so it is not shown again on every launch.
    #[serde(rename = "accessibilityPromptShown", default)]
    pub accessibility_prompt_shown: bool,
}

impl Default for VoiceShortcutConfig {
    fn default() -> Self {
        // Off by default: clicking the bubble activates voice; the global shortcut
        // is opt-in (in-app onboarding or Settings).
        Self {
            enabled: false,
            hold_ms: 2000,
            accessibility_prompt_shown: false,
        }
    }
}

/// State manager of the voice-shortcut. Keeps the config in memory and
/// persists it to disk. Registered as `tauri::State<Arc<VoiceShortcutManager>>`
/// (same style as `TerminalManager`/`SessionManager`).
pub struct VoiceShortcutManager {
    config: Mutex<VoiceShortcutConfig>,
    /// State of the ongoing Alt+M hold (Pressed → holdMs timer → toggle).
    hold: Mutex<HoldState>,
}

/// Hold tracking: `generation` invalidates previous press timers,
/// `fired` disarms repeats until the combo is released.
#[derive(Default)]
struct HoldState {
    pressed: bool,
    fired: bool,
    generation: u64,
}

impl VoiceShortcutManager {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(VoiceShortcutConfig::default()),
            hold: Mutex::new(HoldState::default()),
        }
    }

    /// `getConfig()` — copy of the current config.
    pub fn get_config(&self) -> VoiceShortcutConfig {
        self.config.lock().clone()
    }

    /// `setConfig(patch)` — applies the patch with the same validations as the TS
    /// (holdMs clamped to [500, 10000]) and persists. Returns the new config.
    pub fn set_config(
        &self,
        app: &AppHandle,
        enabled: Option<bool>,
        hold_ms: Option<u64>,
    ) -> VoiceShortcutConfig {
        let mut guard = self.config.lock();
        let next = VoiceShortcutConfig {
            enabled: enabled.unwrap_or(guard.enabled),
            hold_ms: match hold_ms {
                Some(ms) if (500..=10000).contains(&ms) => ms,
                _ => guard.hold_ms,
            },
            // accessibilityPromptShown preserved (the TS does not touch it in setConfig).
            accessibility_prompt_shown: guard.accessibility_prompt_shown,
        };
        *guard = next.clone();
        drop(guard);
        write_shortcut_config(app, &next);
        apply_voice_shortcut_registration(app, next.enabled);
        next
    }

    /// Loads the config from disk at startup. Call from the Tauri setup.
    pub fn load_from_disk(&self, app: &AppHandle) {
        let cfg = read_shortcut_config(app);
        *self.config.lock() = cfg;
    }
}

impl Default for VoiceShortcutManager {
    fn default() -> Self {
        Self::new()
    }
}

// ── Hotkey config persistence ──

/// `<app_data_dir>/voice-shortcut-config.json`.
fn shortcut_config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir not available: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("voice-shortcut-config.json"))
}

/// `readShortcutConfig()` — reads the config with defaults+validations like the TS.
fn read_shortcut_config(app: &AppHandle) -> VoiceShortcutConfig {
    let path = match shortcut_config_file(app) {
        Ok(p) => p,
        Err(_) => return VoiceShortcutConfig::default(),
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return VoiceShortcutConfig::default(),
    };
    let parsed: JsonValue = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return VoiceShortcutConfig::default(),
    };
    let def = VoiceShortcutConfig::default();
    let enabled = parsed
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(def.enabled);
    let hold_ms = parsed
        .get("holdMs")
        .and_then(|v| v.as_u64())
        .filter(|&ms| (500..=10000).contains(&ms))
        .unwrap_or(def.hold_ms);
    let accessibility_prompt_shown = parsed
        .get("accessibilityPromptShown")
        .and_then(|v| v.as_bool())
        .unwrap_or(def.accessibility_prompt_shown);
    VoiceShortcutConfig {
        enabled,
        hold_ms,
        accessibility_prompt_shown,
    }
}

/// `writeShortcutConfig()` — writes indented JSON (mode 0o600 on unix). Swallow.
fn write_shortcut_config(app: &AppHandle, cfg: &VoiceShortcutConfig) {
    let path = match shortcut_config_file(app) {
        Ok(p) => p,
        Err(_) => return,
    };
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(&path, &json);
        set_owner_rw(&path);
    }
}

// =====================================================================
//  Groq API key persistence (mirror of the "API key persistence" block)
// =====================================================================

/// Your Groq key, kept in the encrypted local store (never in a plain file).
const GROQ_KEY_ID: &str = "groq_api_key";
const SECRETS: &str = "secrets";

fn read_user_groq_key(_app: &AppHandle) -> Option<String> {
    crate::local_store::get()?
        .get(SECRETS, GROQ_KEY_ID)?
        .get("value")?
        .as_str()
        .map(str::to_string)
}

fn write_user_groq_key(_app: &AppHandle, key: Option<&str>) -> Result<(), String> {
    let store = crate::local_store::get().ok_or("local store not ready")?;
    match key {
        Some(k) => store.put(SECRETS, GROQ_KEY_ID, serde_json::json!({ "value": k })),
        None => store.delete(SECRETS, GROQ_KEY_ID),
    }
}

/// The Groq key saved in the app. GROQ_API_KEY from the environment is
/// deliberately ignored: a key inherited from the shell must not send audio
/// to a cloud service without a choice made in the app.
/// Returns (key, source) where source ∈ {"user",null}.
fn resolve_groq_key(app: &AppHandle) -> (Option<String>, Option<&'static str>) {
    match read_user_groq_key(app) {
        Some(user_key) if !user_key.is_empty() => (Some(user_key), Some("user")),
        _ => (None, None),
    }
}

/// `getGroqKey()` — the saved key only.
fn get_groq_key(app: &AppHandle) -> Option<String> {
    resolve_groq_key(app).0
}

// =====================================================================
//  Auth token
// =====================================================================

// =====================================================================
//  Return types (mirror of the handlers' JSON objects)
// =====================================================================

/// Result of voice:check-mic.
#[derive(Serialize)]
pub struct MicCheckResult {
    pub granted: bool,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guide: Option<MicGuide>,
}

#[derive(Serialize)]
pub struct MicGuide {
    pub title: String,
    pub steps: Vec<String>,
    pub action: String,
    #[serde(rename = "settingsUrl")]
    pub settings_url: String,
}

/// Result of voice:get-api-key.
#[derive(Serialize)]
pub struct ApiKeyInfo {
    #[serde(rename = "hasKey")]
    pub has_key: bool,
    pub masked: Option<String>,
    pub source: Option<String>,
    #[serde(rename = "fromEnv")]
    pub from_env: bool,
    #[serde(rename = "proxyAvailable")]
    pub proxy_available: bool,
}

/// Generic result `{ ok, error? }`.
#[derive(Serialize)]
pub struct OkResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Result of voice:get-shortcut-config / set-shortcut-config.
#[derive(Serialize)]
pub struct ShortcutConfigResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<VoiceShortcutConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Result of voice:transcribe.
#[derive(Serialize)]
pub struct TranscribeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(rename = "detectedLang", skip_serializing_if = "Option::is_none")]
    pub detected_lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

/// Arguments of voice:transcribe (mirror of `{ lang?, audioBase64?, mimeType? }`).
#[derive(Deserialize, Default)]
pub struct TranscribeOpts {
    #[serde(default)]
    pub lang: Option<String>,
    #[serde(rename = "audioBase64", default)]
    pub audio_base64: Option<String>,
    #[serde(rename = "mimeType", default)]
    pub mime_type: Option<String>,
}

// =====================================================================
//  voice:check-mic
// =====================================================================

/// voice:check-mic — checks/requests the microphone permission.
#[tauri::command]
pub fn voice_check_mic() -> Result<MicCheckResult, String> {
    let platform = node_platform();

    // No reliable pre-flight check without AVCaptureDevice bindings: we
    // return granted and let getUserMedia in the renderer ask for
    // the permission (the webapp's catch already shows the per-platform guide
    // if the user denies). The old macOS branch that ALWAYS answered
    // granted:false blocked voice on the whole reference platform.
    Ok(MicCheckResult {
        granted: true,
        platform,
        status: None,
        guide: None,
    })
}

// =====================================================================
//  voice:open-mic-settings
// =====================================================================

/// voice:open-mic-settings — opens the OS microphone settings panel.
#[tauri::command]
pub fn voice_open_mic_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        open_external(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        )?;
    }
    #[cfg(target_os = "windows")]
    {
        open_external("ms-settings:privacy-microphone")?;
    }
    // Linux: no universal URL for the settings (no-op, like the original).
    Ok(())
}

// =====================================================================
//  voice:get-api-key / set-api-key / test-api-key
// =====================================================================

/// voice:get-api-key — Groq key status. There is no hosted proxy in this edition.
#[tauri::command]
pub fn voice_get_api_key(app: AppHandle) -> Result<ApiKeyInfo, String> {
    let (key, source) = resolve_groq_key(&app);
    let proxy_available = false;

    match key {
        None => Ok(ApiKeyInfo {
            has_key: false,
            masked: None,
            source: None,
            from_env: false,
            proxy_available,
        }),
        Some(k) => {
            // `key.length > 8 ? `${first4}…${last4}` : '••••'`
            let masked = if k.chars().count() > 8 {
                let chars: Vec<char> = k.chars().collect();
                let first4: String = chars[..4].iter().collect();
                let last4: String = chars[chars.len() - 4..].iter().collect();
                format!("{first4}…{last4}")
            } else {
                "••••".to_string()
            };
            Ok(ApiKeyInfo {
                has_key: true,
                masked: Some(masked),
                source: source.map(|s| s.to_string()),
                from_env: false,
                proxy_available,
            })
        }
    }
}

/// voice:set-api-key — saves (or clears if null/empty) the user's Groq key.
#[tauri::command]
pub fn voice_set_api_key(app: AppHandle, api_key: Option<String>) -> Result<OkResult, String> {
    let saved = match api_key {
        Some(k) if !k.trim().is_empty() => write_user_groq_key(&app, Some(k.trim())),
        _ => write_user_groq_key(&app, None),
    };
    // A key that was not stored must not look saved.
    Ok(match saved {
        Ok(()) => OkResult {
            ok: true,
            error: None,
        },
        Err(e) => OkResult {
            ok: false,
            error: Some(e),
        },
    })
}

/// voice:test-api-key — checks a Groq key with GET /models (8s timeout).
/// spawn_blocking: the blocking HTTP call must not freeze the main thread.
#[tauri::command]
pub async fn voice_test_api_key(
    app: AppHandle,
    api_key: Option<String>,
) -> Result<OkResult, String> {
    tauri::async_runtime::spawn_blocking(move || voice_test_api_key_impl(app, api_key))
        .await
        .map_err(|e| e.to_string())?
}

fn voice_test_api_key_impl(app: AppHandle, api_key: Option<String>) -> Result<OkResult, String> {
    // `opts.apiKey?.trim() || getGroqKey()`
    let key = api_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(|| get_groq_key(&app));

    let key = match key {
        Some(k) => k,
        None => {
            return Ok(OkResult {
                ok: false,
                error: Some("No API key".to_string()),
            })
        }
    };

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(OkResult {
                ok: false,
                error: Some(e.to_string()),
            })
        }
    };

    match client
        .get(GROQ_MODELS_URL)
        .header("Authorization", format!("Bearer {key}"))
        .send()
    {
        Ok(res) if res.status().is_success() => Ok(OkResult {
            ok: true,
            error: None,
        }),
        Ok(res) => Ok(OkResult {
            ok: false,
            error: Some(format!("HTTP {}", res.status().as_u16())),
        }),
        Err(e) => Ok(OkResult {
            ok: false,
            error: Some(if e.to_string().is_empty() {
                "Network error".to_string()
            } else {
                e.to_string()
            }),
        }),
    }
}

// =====================================================================
//  voice:transcribe — full fallback chain
// =====================================================================

/// voice:transcribe — transcribes the audio through the engine chain.
/// spawn_blocking: disk write + engine/HTTP can take seconds.
#[tauri::command]
pub async fn voice_transcribe(
    app: AppHandle,
    opts: Option<TranscribeOpts>,
) -> Result<TranscribeResult, String> {
    tauri::async_runtime::spawn_blocking(move || voice_transcribe_impl(app, opts))
        .await
        .map_err(|e| e.to_string())?
}

fn voice_transcribe_impl(
    app: AppHandle,
    opts: Option<TranscribeOpts>,
) -> Result<TranscribeResult, String> {
    let opts = opts.unwrap_or_default();
    let mut files_to_clean: Vec<PathBuf> = Vec::new();
    // The recording lives in a folder only this user can read (0700, random
    // name), removed with everything in it when this function returns: never
    // under a guessable name in the shared temp directory.
    let scratch = match super::util_cmd::PrivateTempDir::new("promptops-voice") {
        Ok(dir) => dir,
        Err(e) => return Ok(transcribe_err("Recording failed", Some(e))),
    };

    let audio_file: PathBuf = if let Some(ref b64) = opts.audio_base64 {
        // ── Mode A: audio from the renderer (MediaRecorder) ──
        let ext = match opts.mime_type.as_deref() {
            Some(m) if m.contains("webm") => ".webm",
            Some(m) if m.contains("ogg") => ".ogg",
            _ => ".wav",
        };
        let file = scratch.path().join(format!("recording{ext}"));
        let bytes = base64_decode(b64).unwrap_or_default();
        if crate::local_store::write_private(&file, &bytes).is_err() {
            return Ok(transcribe_err("Recording failed", None));
        }
        files_to_clean.push(file.clone());

        if file_len(&file) < 100 {
            cleanup_all(&files_to_clean);
            return Ok(transcribe_err("no-speech", None));
        }
        eprintln!("[voice] transcribe start: {} KB", file_len(&file) / 1024);
        file
    } else {
        // No audio from the renderer = a call bug, not a use case: the
        // old "Mode B" (record 2s via sox AFTER speaking) transcribed
        // silence and masked the bridge args mismatch for hours.
        eprintln!("[voice] transcribe called WITHOUT audioBase64 — caller bug");
        return Ok(transcribe_err("no audio payload from caller", None));
    };

    let mut errors: Vec<String> = Vec::new();

    // 0. In-process local Whisper — zero network. If the model is not on
    //    disk yet the download starts in the background and we continue with the cloud.
    if super::voice_local::model_ready(&app) {
        if let Some((text, detected)) =
            super::voice_local::transcribe_local(&app, &audio_file, opts.lang.as_deref())
        {
            // Never log the dictated text: it is user content.
            eprintln!(
                "[voice] whisper-local: {} chars (lang {:?})",
                text.chars().count(),
                detected
            );
            cleanup_all(&files_to_clean);
            return Ok(TranscribeResult {
                ok: true,
                text: Some(text),
                engine: Some("whisper-local".to_string()),
                detected_lang: detected,
                error: None,
                details: None,
            });
        }
        errors.push("local: empty/failed".to_string());
    } else {
        super::voice_local::ensure_model_download(&app);
    }

    // 1. Groq Whisper API, only with the user's own key.
    let groq = try_groq_whisper(&app, &audio_file, opts.lang.as_deref());
    if let Some(text) = groq.text {
        cleanup_all(&files_to_clean);
        return Ok(TranscribeResult {
            ok: true,
            text: Some(text),
            engine: Some("groq".to_string()),
            detected_lang: groq.detected_lang,
            error: None,
            details: None,
        });
    }
    if let Some(e) = groq.error {
        errors.push(format!("groq: {e}"));
    }

    // 2. macOS native speech recognition (on the device when supported).
    #[cfg(target_os = "macos")]
    {
        let mut wav_for_native = audio_file.clone();
        if audio_file.extension().and_then(|e| e.to_str()) != Some("wav") {
            let converted = scratch.path().join("converted.wav");
            if convert_to_wav(&audio_file, &converted) {
                wav_for_native = converted.clone();
                files_to_clean.push(converted);
            }
        }
        if wav_for_native.extension().and_then(|e| e.to_str()) == Some("wav") {
            if let Some(text) = try_macos_speech(&wav_for_native, opts.lang.as_deref()) {
                cleanup_all(&files_to_clean);
                return Ok(TranscribeResult {
                    ok: true,
                    text: Some(text),
                    engine: Some("macos-native".to_string()),
                    detected_lang: None,
                    error: None,
                    details: None,
                });
            }
        }
    }

    // 3. Local Whisper CLI (requires `pip install openai-whisper`).
    if let Some(text) = try_whisper_cli(&audio_file) {
        cleanup_all(&files_to_clean);
        return Ok(TranscribeResult {
            ok: true,
            text: Some(text),
            engine: Some("whisper-cli".to_string()),
            detected_lang: None,
            error: None,
            details: None,
        });
    }

    cleanup_all(&files_to_clean);
    // First offline use: the local model is still downloading — say so,
    // instead of the generic "check your internet connection".
    let hint = if super::voice_local::model_downloading() {
        "Voice engine warming up (downloading the local model) — retry in a few seconds."
    } else {
        "Transcription failed. Add a Groq key, or wait for the local model, then retry."
    };
    let details = if errors.is_empty() {
        None
    } else {
        Some(errors.join(" | "))
    };
    Ok(transcribe_err(hint, details))
}

fn transcribe_err(msg: &str, details: Option<String>) -> TranscribeResult {
    TranscribeResult {
        ok: false,
        text: None,
        engine: None,
        detected_lang: None,
        error: Some(msg.to_string()),
        details,
    }
}

// =====================================================================
//  voice:hotkey-toggle / hotkey-cancel — push events to the renderer
// =====================================================================

/// voice:hotkey-toggle — emits the `voice:hotkey-toggle` push event.
/// In the original the main process sends it when the hold-fire triggers
/// (`win.webContents.send`); here we also expose a command to invoke it
/// (e.g. from an alternative hotkey source) or for manual forwarding.
#[tauri::command]
pub fn voice_hotkey_toggle(app: AppHandle) -> Result<(), String> {
    app.emit("voice:hotkey-toggle", ())
        .map_err(|e| e.to_string())
}

/// voice:hotkey-cancel — emits the `voice:hotkey-cancel` push event.
#[tauri::command]
pub fn voice_hotkey_cancel(app: AppHandle) -> Result<(), String> {
    app.emit("voice:hotkey-cancel", ())
        .map_err(|e| e.to_string())
}

// =====================================================================
//  voice:get-shortcut-config / set-shortcut-config
// =====================================================================

/// voice:get-shortcut-config — returns `{ ok, config }`.
#[tauri::command]
pub fn voice_get_shortcut_config(
    manager: tauri::State<'_, Arc<VoiceShortcutManager>>,
) -> Result<ShortcutConfigResult, String> {
    Ok(ShortcutConfigResult {
        ok: true,
        config: Some(manager.get_config()),
        error: None,
    })
}

/// voice:set-shortcut-config — patch `{ enabled?, holdMs? }`, returns `{ ok, config }`.
#[tauri::command]
pub fn voice_set_shortcut_config(
    app: AppHandle,
    manager: tauri::State<'_, Arc<VoiceShortcutManager>>,
    enabled: Option<bool>,
    #[allow(non_snake_case)] holdMs: Option<u64>,
) -> Result<ShortcutConfigResult, String> {
    let config = manager.set_config(&app, enabled, holdMs);
    Ok(ShortcutConfigResult {
        ok: true,
        config: Some(config),
        error: None,
    })
}

// =====================================================================
//  voice:open-system-settings (macOS panes)
// =====================================================================

/// voice:open-system-settings — opens one of the macOS panels
/// (spotlight | accessibility | microphone). macOS only.
#[tauri::command]
pub fn voice_open_system_settings(pane: Option<String>) -> Result<OkResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pane;
        return Ok(OkResult {
            ok: false,
            error: Some("macOS only".to_string()),
        });
    }

    #[cfg(target_os = "macos")]
    {
        let url = match pane.as_deref() {
            Some("spotlight") => Some("x-apple.systempreferences:com.apple.preference.spotlight"),
            Some("accessibility") => Some(
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            ),
            Some("microphone") => {
                Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            }
            _ => None,
        };
        match url {
            None => Ok(OkResult {
                ok: false,
                error: Some("unknown pane".to_string()),
            }),
            Some(u) => match open_external(u) {
                Ok(()) => Ok(OkResult {
                    ok: true,
                    error: None,
                }),
                Err(e) => Ok(OkResult {
                    ok: false,
                    error: Some(e),
                }),
            },
        }
    }
}

// =====================================================================
//  Groq Whisper API — whisper-large-v3-turbo, verbose_json, temperature 0
// =====================================================================

struct GroqResult {
    text: Option<String>,
    error: Option<String>,
    detected_lang: Option<String>,
}

fn try_groq_whisper(app: &AppHandle, file: &Path, lang: Option<&str>) -> GroqResult {
    let api_key = match get_groq_key(app) {
        Some(k) => k,
        None => {
            return GroqResult {
                text: None,
                error: None,
                detected_lang: None,
            }
        }
    };

    let file_bytes = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) => {
            return GroqResult {
                text: None,
                error: Some(e.to_string()),
                detected_lang: None,
            }
        }
    };
    let file_name = file
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio")
        .to_string();

    let boundary = format!("----PromptOpsGroq{}", now_ms());
    let mut body: Vec<u8> = Vec::new();

    // file field (Content-Type: application/octet-stream)
    append_octet_file_part(&mut body, &boundary, "file", &file_name, &file_bytes);
    // model = whisper-large-v3-turbo
    append_text_part(&mut body, &boundary, "model", "whisper-large-v3-turbo");
    // response_format = verbose_json (for the `language` field)
    append_text_part(&mut body, &boundary, "response_format", "verbose_json");
    // temperature = 0
    append_text_part(&mut body, &boundary, "temperature", "0");
    // language hint only if ISO 2-letter and != 'auto'
    if let Some(l) = lang {
        if l != "auto" {
            let iso = l.split('-').next().unwrap_or(l).to_lowercase();
            if iso.len() == 2 && iso.chars().all(|c| c.is_ascii_lowercase()) {
                append_text_part(&mut body, &boundary, "language", &iso);
            }
        }
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return GroqResult {
                text: None,
                error: Some(e.to_string()),
                detected_lang: None,
            }
        }
    };

    let res = client
        .post(GROQ_TRANSCRIBE_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send();

    let res = match res {
        Ok(r) => r,
        Err(e) => {
            return GroqResult {
                text: None,
                error: Some(if e.to_string().is_empty() {
                    "network".to_string()
                } else {
                    e.to_string()
                }),
                detected_lang: None,
            }
        }
    };

    let status = res.status();
    if !status.is_success() {
        let err_body = res.text().unwrap_or_default();
        let code = status.as_u16();
        let msg = if code == 401 {
            "Invalid Groq API key".to_string()
        } else if code == 429 {
            "Groq rate limit hit — retry shortly".to_string()
        } else if !err_body.is_empty() {
            let head: String = err_body.chars().take(120).collect();
            format!("HTTP {code} {head}")
        } else {
            format!("HTTP {code}")
        };
        return GroqResult {
            text: None,
            error: Some(msg),
            detected_lang: None,
        };
    }

    match res.json::<JsonValue>() {
        Ok(data) => {
            let text = data
                .get("text")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let detected_lang = data
                .get("language")
                .and_then(|v| v.as_str())
                .and_then(map_whisper_language)
                .map(|s| s.to_string());
            GroqResult {
                text,
                error: None,
                detected_lang,
            }
        }
        Err(e) => GroqResult {
            text: None,
            error: Some(e.to_string()),
            detected_lang: None,
        },
    }
}

/// `mapWhisperLanguage` — Whisper supports 99 languages; we map only the 5 UI ones.
pub(crate) fn map_whisper_language(raw: &str) -> Option<&'static str> {
    match raw.to_lowercase().trim() {
        "italian" | "it" | "ita" => Some("it"),
        "english" | "en" | "eng" => Some("en"),
        "spanish" | "es" | "spa" => Some("es"),
        "french" | "fr" | "fra" | "fre" => Some("fr"),
        "portuguese" | "pt" | "por" => Some("pt"),
        _ => None,
    }
}

// =====================================================================
//  Google free Speech API (chromium endpoint)
// =====================================================================

/// `LANG_MAP` + `resolveLang` — maps short code → BCP-47 locale. The value
/// comes from the renderer and ends up inside a Swift program, so anything
/// that is not a plain locale tag falls back to en-US.
fn resolve_lang(lang: Option<&str>) -> String {
    let lang = match lang {
        Some(l) if is_locale_tag(l) => l,
        _ => return "en-US".to_string(),
    };
    if lang.contains('-') {
        return lang.to_string(); // already a full locale (e.g. 'it-IT')
    }
    match lang.to_lowercase().as_str() {
        "it" => "it-IT".to_string(),
        "en" => "en-US".to_string(),
        "es" => "es-ES".to_string(),
        "fr" => "fr-FR".to_string(),
        "de" => "de-DE".to_string(),
        "pt" => "pt-BR".to_string(),
        "ja" => "ja-JP".to_string(),
        "ko" => "ko-KR".to_string(),
        "zh" => "zh-CN".to_string(),
        "ru" => "ru-RU".to_string(),
        "ar" => "ar-SA".to_string(),
        "hi" => "hi-IN".to_string(),
        "nl" => "nl-NL".to_string(),
        "pl" => "pl-PL".to_string(),
        "sv" => "sv-SE".to_string(),
        "tr" => "tr-TR".to_string(),
        other => format!("{}-{}", other, other.to_uppercase()),
    }
}

/// `it`, `en-US`, `zh-Hant-TW`: letters and digits in short dash-separated parts.
fn is_locale_tag(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 35
        && s.split('-').all(|part| {
            (1..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

/// Escapes text for a Swift string literal.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn swift_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c if c.is_control() => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

// =====================================================================
//  Whisper CLI locale — `whisper <file> --model tiny ...`
// =====================================================================

fn try_whisper_cli(file: &Path) -> Option<String> {
    if !file.is_absolute() || !file.exists() {
        return None;
    }
    // The transcript goes next to the recording, in its private folder.
    let tmp = file.parent()?.to_path_buf();
    let output = whisper_cli_command(file, &tmp)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    // whisper writes a .txt with the same basename, whatever the input extension.
    let txt_file = replace_audio_ext_with_txt(file);
    if let Ok(t) = std::fs::read_to_string(&txt_file) {
        let _ = std::fs::remove_file(&txt_file);
        let trimmed = t.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    None
}

/// `whisper <file> --model tiny --output_format txt --output_dir <dir>`. No
/// `--language`: the CLI detects it, and `auto` is not one of the values it
/// accepts (argparse rejected it, so this engine never transcribed anything).
fn whisper_cli_command(file: &Path, out_dir: &Path) -> std::process::Command {
    let mut command = crate::commands::util_cmd::cmd("whisper");
    command
        .arg(file)
        .arg("--model")
        .arg("tiny")
        .arg("--output_format")
        .arg("txt")
        .arg("--output_dir")
        .arg(out_dir);
    command
}

/// `file.replace(/\.(wav|webm|ogg|mp3|m4a)$/i, '.txt')`.
fn replace_audio_ext_with_txt(file: &Path) -> PathBuf {
    let s = file.to_string_lossy().to_string();
    let lower = s.to_lowercase();
    for ext in [".wav", ".webm", ".ogg", ".mp3", ".m4a"] {
        if lower.ends_with(ext) {
            return PathBuf::from(format!("{}.txt", &s[..s.len() - ext.len()]));
        }
    }
    file.to_path_buf()
}

// =====================================================================
//  macOS native SFSpeechRecognizer (via `swift -`)
// =====================================================================

#[cfg(target_os = "macos")]
fn try_macos_speech(wav_file: &Path, lang: Option<&str>) -> Option<String> {
    let swift = macos_speech_script(wav_file, lang);
    try_macos_speech_script(&swift)
}

/// The Swift program for the native recognizer. The path and the locale are
/// escaped as string literals, so they can never become code.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn macos_speech_script(wav_file: &Path, lang: Option<&str>) -> String {
    let locale = swift_string(&resolve_lang(lang));
    let wav_path = swift_string(&wav_file.to_string_lossy());
    format!(
        r#"
import Foundation
import Speech

let status = SFSpeechRecognizer.authorizationStatus()

if status == .denied || status == .restricted {{
    print("ERR:denied")
    exit(1)
}}

if status == .notDetermined {{
    let authSema = DispatchSemaphore(value: 0)
    SFSpeechRecognizer.requestAuthorization {{ _ in authSema.signal() }}
    _ = authSema.wait(timeout: .now() + 5)

    if SFSpeechRecognizer.authorizationStatus() != .authorized {{
        print("ERR:not-authorized")
        exit(1)
    }}
}}

let sema = DispatchSemaphore(value: 0)
var output = ""

let url = URL(fileURLWithPath: "{wav_path}")
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "{locale}")) else {{
    print("ERR:no-recognizer")
    exit(1)
}}
let request = SFSpeechURLRecognitionRequest(url: url)
// Keep the audio on this Mac whenever the language model is available locally.
if recognizer.supportsOnDeviceRecognition {{ request.requiresOnDeviceRecognition = true }}
recognizer.recognitionTask(with: request) {{ result, error in
    if let result = result, result.isFinal {{
        output = result.bestTranscription.formattedString
        sema.signal()
    }} else if error != nil {{
        sema.signal()
    }}
}}
_ = sema.wait(timeout: .now() + 10)
if !output.isEmpty {{
    print("OK:" + output)
}} else {{
    print("ERR:no-result")
}}
"#
    )
}

#[cfg(target_os = "macos")]
fn try_macos_speech_script(swift: &str) -> Option<String> {
    let mut child = crate::commands::util_cmd::cmd("swift")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(swift.as_bytes());
        // drop(stdin) closes the stream (equivalent to stdin.end()).
    }

    let output = child.wait_with_output().ok()?;
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if let Some(rest) = out.strip_prefix("OK:") {
        let t = rest.trim();
        return if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        };
    }

    if let Some(reason) = out.strip_prefix("ERR:") {
        eprintln!("[Voice] macOS native: {reason}");
        if reason == "denied" || reason == "not-authorized" {
            let _ = crate::commands::util_cmd::cmd("open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition")
                .spawn();
        }
    }
    None
}

/// `convertToWav` — ffmpeg 16kHz mono. true on success.
#[cfg(target_os = "macos")]
fn convert_to_wav(input: &Path, output: &Path) -> bool {
    let inp = input.to_string_lossy().to_string();
    let outp = output.to_string_lossy().to_string();
    let cmd = format!(
        "ffmpeg -i {} -ar 16000 -ac 1 -y {} 2>/dev/null",
        crate::commands::remote::sh_quote(&inp),
        crate::commands::remote::sh_quote(&outp)
    );
    let (shell, args) = run_args(&cmd);
    let status = crate::commands::util_cmd::cmd(&shell)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status();
    matches!(status, Ok(s) if s.success()) && output.exists()
}

// =====================================================================
//  Multipart helpers (body built by hand, faithful to the TS Buffer.concat)
// =====================================================================

/// File field with `Content-Type: application/octet-stream` (like Groq/OpenAI in the TS).
fn append_octet_file_part(
    body: &mut Vec<u8>,
    boundary: &str,
    name: &str,
    filename: &str,
    bytes: &[u8],
) {
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\r\n");
}

/// Plain text field.
fn append_text_part(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        )
        .as_bytes(),
    );
}

// =====================================================================
//  Generic utilities
// =====================================================================

/// `process.platform` → Node-style string ("darwin" | "win32" | "linux").
fn node_platform() -> String {
    if cfg!(target_os = "macos") {
        "darwin".to_string()
    } else if cfg!(target_os = "windows") {
        "win32".to_string()
    } else {
        "linux".to_string()
    }
}

/// Opens one of the fixed OS settings URIs above with the system handler,
/// through the shell-free opener in `shell.rs` (never `cmd /C start`).
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
fn open_external(uri: &str) -> Result<(), String> {
    crate::commands::shell::spawn_uri_handler(uri)
}

/// (shell, args) to run a command string, mirror of getShell/getRunArgs.
fn run_args(cmd: &str) -> (String, Vec<String>) {
    if cfg!(windows) {
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        (shell, vec!["/c".to_string(), cmd.to_string()])
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        (shell, vec!["-c".to_string(), cmd.to_string()])
    }
}

/// Sets 0o600 permissions on the file (best-effort, unix only), like `{ mode: 0o600 }`.
fn set_owner_rw(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn cleanup_all(files: &[PathBuf]) {
    for f in files {
        let _ = std::fs::remove_file(f);
    }
}

/// base64 decode standard alphabet, ignores whitespace/padding (as in shell.rs).
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u32;
    for &c in input.as_bytes() {
        if c == b'=' || c == b'\n' || c == b'\r' || c == b' ' || c == b'\t' {
            continue;
        }
        let v = val(c)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}

// =====================================================================
//  Global hotkey listener — tauri-plugin-global-shortcut (Alt+M)
// =====================================================================
//
// The combo is **Alt+M / ⌥+M** — the one promised
// by the UI (Settings/onboarding) — registered via RegisterHotKey /
// RegisterEventHotKey: no Accessibility permission on macOS. The plugin
// exposes Pressed/Released, so "hold for holdMs" stays measurable:
// timer on Pressed, invalidated by an early Released.

/// The global push-to-talk combo: Alt+M (⌥+M on macOS).
fn voice_shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    Shortcut::new(Some(Modifiers::ALT), Code::KeyM)
}

/// Registers/unregisters Alt+M based on `enabled`. Called from setup (config
/// from disk) and from `set_config` on every toggle. Errors logged, never fatal.
pub fn apply_voice_shortcut_registration(app: &AppHandle, enabled: bool) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let sc = voice_shortcut();
    if enabled {
        if !gs.is_registered(sc) {
            if let Err(e) = gs.register(sc) {
                eprintln!("[voice] global shortcut register failed: {e}");
            }
        }
    } else if let Err(e) = gs.unregister(sc) {
        eprintln!("[voice] global shortcut unregister failed: {e}");
    }
}

/// Handler of the plugin events (wired in `lib.rs`). Pressed arms a
/// `holdMs` timer; if the combo is still pressed when it expires it emits
/// `voice:hotkey-toggle` (same push as `voice_hotkey_toggle`). Windows
/// keydown auto-repeat is disarmed by the `pressed` flag.
pub fn handle_voice_shortcut_event(
    app: &AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    use tauri_plugin_global_shortcut::ShortcutState;
    if *shortcut != voice_shortcut() {
        return;
    }
    let manager = app.state::<Arc<VoiceShortcutManager>>().inner().clone();
    match event.state() {
        ShortcutState::Pressed => {
            let cfg = manager.get_config();
            if !cfg.enabled {
                return;
            }
            let gen = {
                let mut hs = manager.hold.lock();
                if hs.pressed {
                    return; // auto-repeat while already held down
                }
                hs.pressed = true;
                hs.fired = false;
                hs.generation += 1;
                hs.generation
            };
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(cfg.hold_ms));
                let mut hs = manager.hold.lock();
                if hs.pressed && hs.generation == gen && !hs.fired {
                    hs.fired = true; // disarm until release, no repeat
                    drop(hs);
                    let _ = app.emit("voice:hotkey-toggle", ());
                }
            });
        }
        ShortcutState::Released => {
            // Early release = hold aborted: the timer will find pressed=false.
            manager.hold.lock().pressed = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_language_cannot_inject_into_the_speech_program() {
        assert_eq!(resolve_lang(Some("it")), "it-IT");
        assert_eq!(resolve_lang(Some("pt-BR")), "pt-BR");
        assert_eq!(resolve_lang(Some("zh-Hant-TW")), "zh-Hant-TW");
        for evil in [
            "x-\"); import Foundation; exit(0); //",
            "it\\(1)",
            "en US",
            "",
            "a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s",
        ] {
            assert_eq!(resolve_lang(Some(evil)), "en-US", "{evil}");
        }
        let script = macos_speech_script(
            Path::new("/tmp/a\"b\\(c)/rec.wav"),
            Some("x-\"); exit(0); //"),
        );
        assert!(script.contains(r#"URL(fileURLWithPath: "/tmp/a\"b\\(c)/rec.wav")"#));
        assert!(script.contains(r#"Locale(identifier: "en-US")"#));
        assert!(!script.contains("exit(0); //"));
    }

    #[test]
    fn whisper_cli_gets_only_arguments_it_accepts() {
        let cmd = whisper_cli_command(Path::new("/tmp/r/rec.wav"), Path::new("/tmp/r"));
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "/tmp/r/rec.wav",
                "--model",
                "tiny",
                "--output_format",
                "txt",
                "--output_dir",
                "/tmp/r"
            ]
        );
    }

    #[test]
    fn swift_literals_escape_quotes_backslashes_and_controls() {
        assert_eq!(swift_string(r#"a"b\c"#), r#"a\"b\\c"#);
        assert_eq!(swift_string("a\nb\u{7}"), "a\\nb\\u{7}");
    }
}
