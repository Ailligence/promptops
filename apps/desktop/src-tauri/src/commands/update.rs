//! Updates.
//!
//! This edition has no auto-updater and no signing key: new versions are
//! published on GitHub Releases and the app never checks for them on its own.
//! The five update commands keep their shape for the UI: checking answers
//! "no update", and the manual download opens the releases page.

use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;

const RELEASES_URL: &str = "https://github.com/shellonback/promptops/releases";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// 'idle' | 'checking' | 'available' | 'not-available' | 'downloading'
    /// | 'downloaded' | 'error'
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

fn no_update() -> UpdateStatus {
    UpdateStatus {
        state: "not-available".into(),
        download_url: Some(RELEASES_URL.to_string()),
        ..Default::default()
    }
}

/// Managed state shared by the update commands.
#[derive(Default)]
pub struct UpdateManager {
    _inner: Mutex<()>,
}

impl UpdateManager {
    pub fn new() -> Self {
        Self::default()
    }
}

#[tauri::command]
pub async fn update_check(
    _app: AppHandle,
    _manager: tauri::State<'_, Arc<UpdateManager>>,
) -> Result<UpdateStatus, String> {
    Ok(no_update())
}

#[tauri::command]
pub async fn update_download(
    _app: AppHandle,
    _manager: tauri::State<'_, Arc<UpdateManager>>,
) -> Result<serde_json::Value, String> {
    Err("This edition does not download updates. New versions are on GitHub Releases.".into())
}

#[tauri::command]
pub async fn update_install(
    _app: AppHandle,
    _manager: tauri::State<'_, Arc<UpdateManager>>,
) -> Result<serde_json::Value, String> {
    Err("This edition does not install updates. New versions are on GitHub Releases.".into())
}

#[tauri::command]
pub fn update_get_status(
    _manager: tauri::State<'_, Arc<UpdateManager>>,
) -> Result<UpdateStatus, String> {
    Ok(no_update())
}

/// Opens the GitHub releases page in the system browser.
#[tauri::command]
pub fn update_open_manual_download(
    _app: AppHandle,
    _manager: tauri::State<'_, Arc<UpdateManager>>,
) -> Result<serde_json::Value, String> {
    open_external(RELEASES_URL)?;
    Ok(json!({ "ok": true }))
}

/// Opens a URL with the system handler, through the validated opener in
/// `shell.rs` (never `cmd /C start`, which re-parses the URL on Windows).
fn open_external(url: &str) -> Result<(), String> {
    crate::commands::shell::open_external_url(url)
}
