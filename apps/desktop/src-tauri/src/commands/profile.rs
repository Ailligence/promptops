//! Profile domain.
//!
//! CRUD for AgentProfiles (provider presets + session config). Profiles live in
//! the encrypted local store (`local_store.rs`, collection `agent_profiles`),
//! like every other record of the app: a profile's config can hold paths and
//! environment values, so it is never kept in clear text.
//!
//! Older builds kept them in `<app_data_dir>/agent-profiles.json`, in clear
//! text. The first access moves those profiles into the store and removes the
//! file; a file that cannot be read is left where it is (never deleted) and
//! the error is logged.
//!
//! Every change runs under one lock, from read to write, so two windows
//! creating profiles at the same time never drop each other's profile.
//!
//! Notes:
//!  - `config` is `Partial<SessionConfig>`: on the Rust side we treat it as an opaque
//!    `serde_json::Value` bag to keep the renderer's shape without coupling to session.rs.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::Manager;
use uuid::Uuid;

use crate::local_store::LocalStore;

// =====================================================================
//  Data model (shared with the web UI)
// =====================================================================

/// AgentProfile — same shape as the web UI's `AgentProfile`.
///
/// `provider` is `ProviderType` (free string, as in session.rs).
/// `config` is `Partial<SessionConfig>`: opaque bag preserved verbatim.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub config: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// Input of `profile:create` — `Omit<AgentProfile, 'id' | 'createdAt' | 'updatedAt'>`.
#[derive(Clone, Debug, Deserialize)]
pub struct CreateProfileInput {
    pub name: String,
    pub provider: String,
    #[serde(default)]
    pub config: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
}

/// Input of `profile:update` — `Partial<Omit<AgentProfile, 'id' | 'createdAt'>>`.
/// Every missing field leaves the existing value unchanged (JS spread semantics).
/// NB: `updatedAt` is always set to the current time on update,
/// so any incoming `updatedAt` is ignored (there is no field).
#[derive(Clone, Debug, Default, Deserialize)]
pub struct UpdateProfileInput {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub config: Option<JsonValue>,
    #[serde(default)]
    pub description: Option<String>,
}

/// Return envelope of create/update — `{ ok, profile } | { ok, error }`.
#[derive(Clone, Debug, Serialize)]
pub struct ProfileResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<AgentProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Return envelope of delete — `{ ok } | { ok, error }`.
#[derive(Clone, Debug, Serialize)]
pub struct DeleteResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Shape of the legacy `agent-profiles.json` file.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct LegacyProfileFile {
    #[serde(default)]
    profiles: Vec<AgentProfile>,
}

/// Collection of the local store that holds the profiles.
const COLLECTION: &str = "agent_profiles";
const MAX_NAME: usize = 255;
const MAX_PROVIDER: usize = 100;
const MAX_DESCRIPTION: usize = 2000;

/// Legacy file path: `<app_data_dir>/agent-profiles.json` (never created now).
fn legacy_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("agent-profiles.json"))
}

fn now_iso() -> String {
    // Milliseconds since epoch, as text: the format earlier builds stored, so
    // the UI's ordering and parsing stay the same.
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms}")
}

fn store() -> Result<&'static LocalStore, String> {
    crate::local_store::get().ok_or_else(|| "The local store is not available.".to_string())
}

/// Text that must be present and at most `max` characters; returned trimmed.
fn required_text(value: &str, what: &str, max: usize) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(format!("{what} is required."));
    }
    if v.chars().count() > max {
        return Err(format!("{what} is too long (at most {max} characters)."));
    }
    Ok(v.to_string())
}

fn check_description(description: &Option<String>) -> Result<(), String> {
    match description {
        Some(d) if d.chars().count() > MAX_DESCRIPTION => Err(format!(
            "Description is too long (at most {MAX_DESCRIPTION} characters)."
        )),
        _ => Ok(()),
    }
}

// =====================================================================
//  Manager — profiles in the local store
// =====================================================================

/// Serializes every profile change and remembers whether the legacy file was
/// already looked at.
#[derive(Default)]
pub struct ProfileManager {
    op: Mutex<()>,
    legacy_checked: AtomicBool,
}

impl ProfileManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Moves the profiles of the legacy clear-text file into the store, once
    /// per run. Profiles already in the store win (same id). The file is
    /// removed only after every profile was saved.
    fn migrate_legacy(&self, store: &LocalStore, legacy: Option<&Path>) {
        if self.legacy_checked.swap(true, Ordering::SeqCst) {
            return;
        }
        let Some(path) = legacy.filter(|p| p.exists()) else {
            return;
        };
        let parsed = std::fs::read(path)
            .map_err(|e| e.to_string())
            .and_then(|b| {
                serde_json::from_slice::<LegacyProfileFile>(&b).map_err(|e| e.to_string())
            });
        let file = match parsed {
            Ok(f) => f,
            Err(err) => {
                eprintln!(
                    "[profiles] {} could not be read ({err}); left in place",
                    path.display()
                );
                return;
            }
        };
        for p in file.profiles {
            if store.get(COLLECTION, &p.id).is_some() {
                continue;
            }
            let Ok(value) = serde_json::to_value(&p) else {
                return;
            };
            if let Err(err) = store.put(COLLECTION, &p.id, value) {
                eprintln!("[profiles] migration stopped: {err}; legacy file kept");
                return;
            }
        }
        if let Err(err) = std::fs::remove_file(path) {
            eprintln!("[profiles] {} not removed: {err}", path.display());
        }
    }

    /// Every profile, oldest first (creation time, then id).
    fn list_in(&self, store: &LocalStore, legacy: Option<&Path>) -> Vec<AgentProfile> {
        self.migrate_legacy(store, legacy);
        let mut profiles: Vec<AgentProfile> = store
            .list(COLLECTION)
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect();
        profiles.sort_by(|a, b| {
            let ta = a.created_at.parse::<u128>().unwrap_or(0);
            let tb = b.created_at.parse::<u128>().unwrap_or(0);
            ta.cmp(&tb).then_with(|| a.id.cmp(&b.id))
        });
        profiles
    }

    fn put(store: &LocalStore, profile: &AgentProfile) -> Result<(), String> {
        let value = serde_json::to_value(profile).map_err(|e| e.to_string())?;
        store.put(COLLECTION, &profile.id, value)
    }

    fn create_in(
        &self,
        store: &LocalStore,
        legacy: Option<&Path>,
        data: CreateProfileInput,
    ) -> Result<AgentProfile, String> {
        let _op = self.op.lock();
        self.migrate_legacy(store, legacy);
        let now = now_iso();
        check_description(&data.description)?;
        let profile = AgentProfile {
            id: Uuid::new_v4().to_string(),
            name: required_text(&data.name, "Name", MAX_NAME)?,
            provider: required_text(&data.provider, "Provider", MAX_PROVIDER)?,
            config: data.config,
            description: data.description,
            created_at: now.clone(),
            updated_at: now,
        };
        Self::put(store, &profile)?;
        Ok(profile)
    }

    fn update_in(
        &self,
        store: &LocalStore,
        legacy: Option<&Path>,
        profile_id: &str,
        updates: UpdateProfileInput,
    ) -> Result<AgentProfile, String> {
        let _op = self.op.lock();
        self.migrate_legacy(store, legacy);
        let mut p: AgentProfile = store
            .get(COLLECTION, profile_id)
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or_else(|| format!("Profile not found: {profile_id}"))?;
        // Spread `{ ...existing, ...updates, updatedAt: now }`: applies only the fields present.
        if let Some(name) = updates.name {
            p.name = required_text(&name, "Name", MAX_NAME)?;
        }
        if let Some(provider) = updates.provider {
            p.provider = required_text(&provider, "Provider", MAX_PROVIDER)?;
        }
        if let Some(config) = updates.config {
            p.config = config;
        }
        if updates.description.is_some() {
            check_description(&updates.description)?;
            p.description = updates.description;
        }
        p.updated_at = now_iso();
        Self::put(store, &p)?;
        Ok(p)
    }

    fn delete_in(
        &self,
        store: &LocalStore,
        legacy: Option<&Path>,
        profile_id: &str,
    ) -> Result<(), String> {
        let _op = self.op.lock();
        self.migrate_legacy(store, legacy);
        if store.get(COLLECTION, profile_id).is_none() {
            return Err(format!("Profile not found: {profile_id}"));
        }
        store.delete(COLLECTION, profile_id)
    }
}

// =====================================================================
//  Tauri commands — the 5 profile IPC handlers
// =====================================================================

/// profile:list — returns all profiles (raw shape).
#[tauri::command]
pub fn profile_list(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<ProfileManager>>,
) -> Result<Vec<AgentProfile>, String> {
    Ok(manager.list_in(store()?, legacy_path(&app).as_deref()))
}

/// profile:get — returns the profile or `null` if not found.
///
/// "Not found" maps to `Ok(None)` (→ JSON `null`) instead of propagating an error.
#[tauri::command]
pub fn profile_get(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<ProfileManager>>,
    profile_id: String,
) -> Result<Option<AgentProfile>, String> {
    Ok(manager
        .list_in(store()?, legacy_path(&app).as_deref())
        .into_iter()
        .find(|p| p.id == profile_id))
}

/// profile:create — creates a new profile, returns `{ ok, profile }` / `{ ok, error }`.
#[tauri::command]
pub fn profile_create(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<ProfileManager>>,
    data: CreateProfileInput,
) -> ProfileResult {
    let result = store().and_then(|s| manager.create_in(s, legacy_path(&app).as_deref(), data));
    match result {
        Ok(profile) => ProfileResult {
            ok: true,
            profile: Some(profile),
            error: None,
        },
        Err(err) => ProfileResult {
            ok: false,
            profile: None,
            error: Some(err),
        },
    }
}

/// profile:update — updates profile fields, returns `{ ok, profile }` / `{ ok, error }`.
#[tauri::command]
pub fn profile_update(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<ProfileManager>>,
    profile_id: String,
    updates: UpdateProfileInput,
) -> ProfileResult {
    let result = store()
        .and_then(|s| manager.update_in(s, legacy_path(&app).as_deref(), &profile_id, updates));
    match result {
        Ok(profile) => ProfileResult {
            ok: true,
            profile: Some(profile),
            error: None,
        },
        Err(err) => ProfileResult {
            ok: false,
            profile: None,
            error: Some(err),
        },
    }
}

/// profile:delete — deletes the profile, returns `{ ok }` / `{ ok, error }`.
#[tauri::command]
pub fn profile_delete(
    app: tauri::AppHandle,
    manager: tauri::State<'_, Arc<ProfileManager>>,
    profile_id: String,
) -> DeleteResult {
    let result =
        store().and_then(|s| manager.delete_in(s, legacy_path(&app).as_deref(), &profile_id));
    match result {
        Ok(()) => DeleteResult {
            ok: true,
            error: None,
        },
        Err(err) => DeleteResult {
            ok: false,
            error: Some(err),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::VaultKey;

    fn temp_store() -> (LocalStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "promptops-profiles-{}",
            crate::local_store::new_id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        (
            LocalStore::open_at(&dir, VaultKey::from_bytes([5; 32])).unwrap(),
            dir,
        )
    }

    fn input(name: &str) -> CreateProfileInput {
        CreateProfileInput {
            name: name.into(),
            provider: "codex".into(),
            config: serde_json::json!({ "cwd": "/Users/alice/secret-project" }),
            description: None,
        }
    }

    #[test]
    fn profiles_live_in_the_encrypted_store_not_in_clear_text() {
        let (store, dir) = temp_store();
        let m = ProfileManager::new();
        let p = m.create_in(&store, None, input("  Work  ")).unwrap();
        assert_eq!(p.name, "Work");
        let raw = std::fs::read_to_string(dir.join("local-store.json")).unwrap();
        assert!(!raw.contains("secret-project") && !raw.contains("Work"));
        assert_eq!(m.list_in(&store, None).len(), 1);
        let u = m
            .update_in(
                &store,
                None,
                &p.id,
                UpdateProfileInput {
                    name: Some("Home".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(u.name, "Home");
        assert_eq!(u.provider, "codex");
        m.delete_in(&store, None, &p.id).unwrap();
        assert!(m.list_in(&store, None).is_empty());
        assert!(m.delete_in(&store, None, &p.id).is_err());
    }

    #[test]
    fn invalid_names_and_providers_are_refused() {
        let (store, _) = temp_store();
        let m = ProfileManager::new();
        assert!(m.create_in(&store, None, input("   ")).is_err());
        let mut long = input(&"x".repeat(MAX_NAME + 1));
        assert!(m.create_in(&store, None, long.clone()).is_err());
        long.name = "ok".into();
        long.provider = String::new();
        assert!(m.create_in(&store, None, long).is_err());
        let p = m.create_in(&store, None, input("ok")).unwrap();
        let blank = UpdateProfileInput {
            name: Some(" ".into()),
            ..Default::default()
        };
        assert!(m.update_in(&store, None, &p.id, blank).is_err());
        assert_eq!(m.list_in(&store, None)[0].name, "ok");
    }

    #[test]
    fn legacy_clear_text_file_is_moved_into_the_store_and_removed() {
        let (store, dir) = temp_store();
        let legacy = dir.join("agent-profiles.json");
        let old = AgentProfile {
            id: "legacy-1".into(),
            name: "Old".into(),
            provider: "claude-code-cli".into(),
            config: serde_json::json!({}),
            description: None,
            created_at: "1".into(),
            updated_at: "1".into(),
        };
        std::fs::write(
            &legacy,
            serde_json::to_vec(&LegacyProfileFile {
                profiles: vec![old],
            })
            .unwrap(),
        )
        .unwrap();
        let m = ProfileManager::new();
        let listed = m.list_in(&store, Some(&legacy));
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "legacy-1");
        assert!(!legacy.exists());
    }

    #[test]
    fn an_unreadable_legacy_file_is_left_alone() {
        let (store, dir) = temp_store();
        let legacy = dir.join("agent-profiles.json");
        std::fs::write(&legacy, b"{ not json").unwrap();
        let m = ProfileManager::new();
        assert!(m.list_in(&store, Some(&legacy)).is_empty());
        assert_eq!(std::fs::read(&legacy).unwrap(), b"{ not json");
    }

    #[test]
    fn two_windows_creating_at_once_keep_every_profile() {
        let (store, _) = temp_store();
        let store = Arc::new(store);
        let m = Arc::new(ProfileManager::new());
        let threads: Vec<_> = (0..8)
            .map(|i| {
                let (store, m) = (store.clone(), m.clone());
                std::thread::spawn(move || {
                    for j in 0..10 {
                        m.create_in(&store, None, input(&format!("p{i}-{j}")))
                            .unwrap();
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(m.list_in(&store, None).len(), 80);
    }
}
