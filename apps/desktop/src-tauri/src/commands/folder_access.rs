//! macOS TCC folder-access checks and IPC handlers.
//!
//! ~/Documents, ~/Desktop, ~/Downloads and external volumes are consent-gated:
//! the first REAL read shows the system dialog, and a deny silently breaks
//! every PTY spawned with a cwd under that root (the shell
//! survives, the children die with "EPERM: uv_cwd"). `stat` does NOT trigger
//! TCC (metadata is always allowed): a real `read_dir` is needed — which on
//! a root not yet decided TRIGGERS the dialog, so the caller decides
//! when it happens.
//!
//! Off-macOS every probe short-circuits to "granted" (identical behavior).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// TTL of granted entries: a mid-session revoke (toggle in System Settings,
/// tccutil) is re-detected at the next spawn/tick. Denied entries are sticky:
/// macOS never re-prompts a denied app — it only changes with a force re-probe.
const GRANTED_TTL_MS: u128 = 30_000;
const TCC_HOME_FOLDERS: [&str; 3] = ["Documents", "Desktop", "Downloads"];

/// The app's TCC identity: read from the manifest at runtime, NEVER hardcoded —
/// with several bundles side by side (e.g. dev and release builds) a fixed
/// id would reset the permissions of the wrong app.
fn tcc_bundle_id(app: &AppHandle) -> String {
    app.config().identifier.clone()
}

const FILES_AND_FOLDERS_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders";
const PRIVACY_SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security";

/// Revocation watcher period; the 30s TTL of granted entries makes every tick a
/// real readdir.
const WATCHER_INTERVAL_MS: u64 = 60_000;
/// Debounce of the re-probe on focus (the user Cmd-Tabs).
pub const FOCUS_RETRY_DEBOUNCE_MS: u128 = 2_000;
/// Pause between wakes so a big recovery doesn't spawn a PTY storm.
const WAKE_STAGGER_MS: u64 = 300;

#[derive(Clone)]
struct RootCacheEntry {
    denied: bool,
    ts: u128,
    code: Option<String>,
}

/// Roots of the active sessions (for the watcher) — DI from lib.rs.
pub type SessionRootsFn = Arc<dyn Fn() -> Vec<String> + Send + Sync>;
/// Wake of the sessions parked for TCC — DI from lib.rs.
pub type WakeParkedFn = Arc<dyn Fn() -> Vec<String> + Send + Sync>;

#[derive(Default)]
pub struct FolderAccessMonitor {
    cache: Mutex<HashMap<String, RootCacheEntry>>,
    checked_at: Mutex<Option<String>>,
    /// Serializes the probes: only one consent dialog at a time, and concurrent
    /// probes of the same root collapse onto the second one's cache hit.
    probe_lock: Mutex<()>,
    session_roots_fn: Mutex<Option<SessionRootsFn>>,
    wake_parked_fn: Mutex<Option<WakeParkedFn>>,
    last_focus_retry_ms: Mutex<u128>,
    /// granted↔denied transition waiting to be pushed to the renderer.
    transition_pending: Mutex<bool>,
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// TCC services (`tccutil reset <service> <bundle-id>`) that cover a root.
/// /Volumes has no per-volume granularity → reset both services.
fn tcc_services_for_root(root: &str, home: &Path) -> Vec<&'static str> {
    if root.starts_with("/Volumes/") {
        return vec!["SystemPolicyRemovableVolumes", "SystemPolicyNetworkVolumes"];
    }
    let root = Path::new(root);
    if root == home.join("Documents") {
        vec!["SystemPolicyDocumentsFolder"]
    } else if root == home.join("Desktop") {
        vec!["SystemPolicyDesktopFolder"]
    } else if root == home.join("Downloads") {
        vec!["SystemPolicyDownloadsFolder"]
    } else {
        vec![]
    }
}

/// Singleton for hot paths without access to State (spawn in session.rs).
static GLOBAL: std::sync::OnceLock<Arc<FolderAccessMonitor>> = std::sync::OnceLock::new();

pub fn set_global(monitor: Arc<FolderAccessMonitor>) {
    let _ = GLOBAL.set(monitor);
}

pub fn global_monitor() -> Option<&'static Arc<FolderAccessMonitor>> {
    GLOBAL.get()
}

impl FolderAccessMonitor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_session_roots_fn(&self, f: SessionRootsFn) {
        *self.session_roots_fn.lock() = Some(f);
    }

    pub fn set_wake_parked_fn(&self, f: WakeParkedFn) {
        *self.wake_parked_fn.lock() = Some(f);
    }

    /// Maps a cwd to the TCC root that contains it, or None if not gated.
    pub fn get_tcc_root(&self, cwd: Option<&str>) -> Option<String> {
        if !cfg!(target_os = "macos") {
            return None;
        }
        let cwd = cwd?;
        if cwd.is_empty() {
            return None;
        }
        let resolved = Path::new(cwd);
        let home = home_dir();
        for name in TCC_HOME_FOLDERS {
            let root = home.join(name);
            if resolved == root || resolved.starts_with(&root) {
                return Some(root.to_string_lossy().into_owned());
            }
        }
        // External/network volumes: gated per volume.
        if let Ok(rest) = resolved.strip_prefix("/Volumes") {
            if let Some(volume) = rest.components().next() {
                return Some(
                    Path::new("/Volumes")
                        .join(volume.as_os_str())
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
        None
    }

    /// Probe of the cwd's TCC root: REAL read_dir (can trigger the consent
    /// dialog). BLOCKING — call from a thread/spawn_blocking, never from main.
    pub fn probe(&self, cwd: Option<&str>, force: bool) -> (bool, Option<String>) {
        let Some(root) = self.get_tcc_root(cwd) else {
            return (true, None);
        };
        if !force {
            let cache = self.cache.lock();
            if let Some(entry) = cache.get(&root) {
                if entry.denied {
                    return (false, Some(root));
                }
                if now_ms().saturating_sub(entry.ts) < GRANTED_TTL_MS {
                    return (true, Some(root));
                }
            }
        }
        let _guard = self.probe_lock.lock();
        // Re-check after lock: a concurrent probe may have just decided.
        if !force {
            if let Some(entry) = self.cache.lock().get(&root) {
                if entry.denied {
                    return (false, Some(root));
                }
                if now_ms().saturating_sub(entry.ts) < GRANTED_TTL_MS {
                    return (true, Some(root));
                }
            }
        }
        let (ok, code) = match std::fs::read_dir(&root) {
            Ok(_) => (true, None),
            Err(err) => {
                // Only EPERM(1)/EACCES(13) = consent denial. ENOENT and others
                // are not TCC (unmounted volume, deleted folder).
                match err.raw_os_error() {
                    Some(1) => (false, Some("EPERM".to_string())),
                    Some(13) => (false, Some("EACCES".to_string())),
                    _ => (true, None),
                }
            }
        };
        self.set_status(&root, ok, code);
        (ok, Some(root))
    }

    /// Cache-only, zero syscalls — for hot paths that must never
    /// block on a consent dialog.
    pub fn is_known_denied(&self, cwd: Option<&str>) -> bool {
        match self.get_tcc_root(cwd) {
            Some(root) => self
                .cache
                .lock()
                .get(&root)
                .map(|e| e.denied)
                .unwrap_or(false),
            None => false,
        }
    }

    /// Force re-probe of every denied root, in sequence (one dialog at a time).
    pub fn reprobe_denied_roots(&self) -> Value {
        let denied: Vec<String> = {
            let cache = self.cache.lock();
            let mut roots: Vec<String> = cache
                .iter()
                .filter(|(_, e)| e.denied)
                .map(|(r, _)| r.clone())
                .collect();
            roots.sort();
            roots
        };
        for root in denied {
            let _ = self.probe(Some(&root), true);
        }
        self.state()
    }

    /// getState() — { denied, deniedRoots, deniedDetails, checkedAt }.
    pub fn state(&self) -> Value {
        let cache = self.cache.lock();
        let mut denied: Vec<(&String, &RootCacheEntry)> =
            cache.iter().filter(|(_, e)| e.denied).collect();
        denied.sort_by(|a, b| a.0.cmp(b.0));
        json!({
            "denied": !denied.is_empty(),
            "deniedRoots": denied.iter().map(|(r, _)| (*r).clone()).collect::<Vec<_>>(),
            "deniedDetails": denied
                .iter()
                .map(|(r, e)| json!({ "root": r, "code": e.code.clone().unwrap_or_else(|| "EPERM".into()) }))
                .collect::<Vec<_>>(),
            "checkedAt": *self.checked_at.lock(),
        })
    }

    fn set_status(&self, root: &str, ok: bool, code: Option<String>) {
        let prev_denied = {
            let mut cache = self.cache.lock();
            let prev = cache.get(root).map(|e| e.denied);
            cache.insert(
                root.to_string(),
                RootCacheEntry {
                    denied: !ok,
                    ts: now_ms(),
                    code,
                },
            );
            prev
        };
        *self.checked_at.lock() = Some(now_iso());
        // Transition = a deny that appears or disappears. The very first "granted"
        // is not a transition.
        let changed = if ok {
            prev_denied == Some(true)
        } else {
            prev_denied != Some(true)
        };
        if changed {
            // The emit is done by whoever has the AppHandle (payload() in commands/watcher).
            *self.transition_pending.lock() = true;
        }
    }
}

impl FolderAccessMonitor {
    fn payload(&self, parked: Vec<String>) -> Value {
        let translocated = cfg!(target_os = "macos")
            && std::env::current_exe()
                .map(|p| p.to_string_lossy().contains("/AppTranslocation/"))
                .unwrap_or(false);
        let mut payload = self.state();
        payload["platform"] = json!(if cfg!(target_os = "macos") {
            "darwin"
        } else if cfg!(windows) {
            "win32"
        } else {
            "linux"
        });
        payload["translocated"] = json!(translocated);
        payload["parkedSessionIds"] = json!(parked);
        payload
    }

    /// Emits folder-access:changed if there's a pending transition.
    fn push_if_transition(&self, app: &AppHandle) {
        let pending = {
            let mut p = self.transition_pending.lock();
            std::mem::replace(&mut *p, false)
        };
        if pending {
            let _ = app.emit("folder-access:changed", self.payload(Vec::new()));
        }
    }
}

/// ISO-ish UTC (same as the other modules' now_iso).
fn now_iso() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:020}.{:03}", dur.as_secs(), dur.subsec_millis())
}

// ─────────────────────────────────────────────────────────────────────────
// Commands + retry/recovery + watcher.
// ─────────────────────────────────────────────────────────────────────────

/// Shared retry: force re-probe of the denied roots and — if everything is
/// granted again — (staggered) wake of the sessions parked for TCC.
fn retry_and_recover(app: &AppHandle, monitor: &Arc<FolderAccessMonitor>) -> Value {
    let state = monitor.reprobe_denied_roots();
    let all_granted = state.get("denied").and_then(|v| v.as_bool()) == Some(false);
    let mut parked = Vec::new();
    if all_granted {
        if let Some(wake) = monitor.wake_parked_fn.lock().clone() {
            parked = wake();
            if !parked.is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(WAKE_STAGGER_MS));
            }
        }
    }
    monitor.push_if_transition(app);
    monitor.payload(parked)
}

/// folder-access:check.
#[tauri::command]
pub fn folder_access_check(monitor: tauri::State<'_, Arc<FolderAccessMonitor>>) -> Value {
    monitor.payload(Vec::new())
}

/// folder-access:retry — force re-probe + recovery.
#[tauri::command]
pub async fn folder_access_retry(
    app: AppHandle,
    monitor: tauri::State<'_, Arc<FolderAccessMonitor>>,
) -> Result<Value, String> {
    let monitor = monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || retry_and_recover(&app, &monitor))
        .await
        .map_err(|e| e.to_string())
}

/// folder-access:open-settings — deep link to the Files & Folders panel,
/// falling back to the Privacy & Security root.
#[tauri::command]
pub fn folder_access_open_settings() {
    if !cfg!(target_os = "macos") {
        return;
    }
    let ok = crate::commands::util_cmd::cmd("open")
        .arg(FILES_AND_FOLDERS_SETTINGS_URL)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        let _ = crate::commands::util_cmd::cmd("open")
            .arg(PRIVACY_SETTINGS_URL)
            .status();
    }
}

/// folder-access:reset — `tccutil reset` of the denied roots' services, then
/// retry (re-arms the consent dialog: "Allow" wakes the sessions).
#[tauri::command]
pub async fn folder_access_reset_permissions(
    app: AppHandle,
    monitor: tauri::State<'_, Arc<FolderAccessMonitor>>,
) -> Result<Value, String> {
    let monitor = monitor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !cfg!(target_os = "macos") {
            return monitor.payload(Vec::new());
        }
        let home = home_dir();
        let mut services: Vec<&'static str> = Vec::new();
        if let Some(roots) = monitor
            .state()
            .get("deniedRoots")
            .and_then(|v| v.as_array())
        {
            for root in roots.iter().filter_map(|r| r.as_str()) {
                for service in tcc_services_for_root(root, &home) {
                    if !services.contains(&service) {
                        services.push(service);
                    }
                }
            }
        }
        let bundle_id = tcc_bundle_id(&app);
        for service in services {
            let res = crate::commands::util_cmd::cmd("tccutil")
                .args(["reset", service, &bundle_id])
                .status();
            if let Err(err) = res {
                eprintln!("[folder-access] tccutil reset {service} failed: {err}");
            }
        }
        retry_and_recover(&app, &monitor)
    })
    .await
    .map_err(|e| e.to_string())
}

/// folder-access:relaunch — a Full Disk Access granted at runtime only applies
/// after a relaunch. The quit flow persists the sessions, so it's safe.
#[tauri::command]
pub fn folder_access_relaunch(app: AppHandle) {
    app.restart();
}

/// Starts the revocation watcher (60s) — probe of the TCC roots of the active
/// sessions. A granted→denied transition pushes the banner. Live shells are NOT
/// parked (killing a shell mid-work is worse).
pub fn start_watcher(app: AppHandle, monitor: Arc<FolderAccessMonitor>) {
    if !cfg!(target_os = "macos") {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(WATCHER_INTERVAL_MS));
        let roots: Vec<String> = {
            let Some(list) = monitor.session_roots_fn.lock().clone() else {
                continue;
            };
            let mut roots: Vec<String> = list()
                .iter()
                .filter_map(|cwd| monitor.get_tcc_root(Some(cwd)))
                .collect();
            roots.sort();
            roots.dedup();
            roots
        };
        for root in roots {
            let _ = monitor.probe(Some(&root), false);
        }
        monitor.push_if_transition(&app);
    });
}

/// Re-probe on window focus (self-heal when the user comes back from System
/// Settings), with debounce. Called from lib.rs on_window_event.
pub fn on_window_focus(app: &AppHandle, monitor: &Arc<FolderAccessMonitor>) {
    if !cfg!(target_os = "macos") {
        return;
    }
    if monitor.state().get("denied").and_then(|v| v.as_bool()) != Some(true) {
        return;
    }
    {
        let mut last = monitor.last_focus_retry_ms.lock();
        let now = now_ms();
        if now.saturating_sub(*last) < FOCUS_RETRY_DEBOUNCE_MS {
            return;
        }
        *last = now;
    }
    let app = app.clone();
    let monitor = monitor.clone();
    std::thread::spawn(move || {
        let _ = retry_and_recover(&app, &monitor);
    });
}
