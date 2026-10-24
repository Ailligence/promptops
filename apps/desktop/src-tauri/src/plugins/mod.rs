//! Third-party plugin runtime.
//!
//! Security model (see docs/plugins/plugin-guidelines.md):
//!  - a plugin's code is JavaScript ONLY and runs in an iframe
//!    `sandbox="allow-scripts"` inside a dedicated webview (`plugin-host`) that
//!    has no Tauri capability at all: two independent barriers toward the IPC;
//!  - the iframe has no network, storage or navigation (`frame-src 'none'` on the
//!    host page, verified by security_selftest);
//!  - every effect goes through the broker (broker.rs), which applies the permissions of
//!    the INSTALLED manifest, not those declared by the caller;
//!  - secrets stay in Rust: the plugin writes `{{secret:key}}` and the
//!    broker substitutes it on the way out, only toward declared hosts;
//!  - the bundle is downloaded by Rust from the public repository at the pinned commit and
//!    its SHA-256 must match the one approved in the registry; the hash is
//!    rechecked on every load;
//!  - plugins never see user tokens or the app's stored data.

pub mod broker;
pub mod commands;
pub mod host;
pub mod native;
pub mod secrets;
pub mod studio;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    net::IpAddr,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

pub const HOST_LABEL: &str = "plugin-host";
pub const SCHEME: &str = "po-plugin";
pub const MANIFEST_FILE: &str = "promptops-plugin.json";
pub const MAX_FILE_BYTES: usize = 2_000_000;
pub const RAW_HOST: &str = "https://raw.githubusercontent.com";

/// Permissions allowed in v1 of the runtime. `net:<host>` is validated separately.
pub const ALLOWED_PERMISSIONS: &[&str] = &[
    "secrets",
    "storage",
    "notify",
    "sessions:read",
    "tasks:read",
    // Required by the write methods of the `tasks` contract (see `contract_permission`).
    "tasks:write",
    "prompt:propose",
    // `agents:propose` is NOT here: no SDK call implements it, so a manifest that asks for it
    // is refused instead of showing the person a permission that means nothing.
    // `pages` section. Each one goes through a user choice or confirmation in the main window.
    "git:read",
    "workspace:write",
    "ai:generate",
    "ai:benchmark",
    // Buttons in the row below the session composer. Every send to an agent goes through the
    // confirmation policy chosen by the user; `composer:read` also delivers the draft text.
    "session:buttons",
    "composer:read",
];

/// Permissions that grant access to a repository chosen by the user.
pub const REPO_PERMISSIONS: &[&str] = &["git:read", "workspace:write"];
pub const MAX_PAGES_PER_PLUGIN: usize = 3;
pub const MAX_SESSION_BUTTONS_PER_PLUGIN: usize = 2;

/// Button declared in the manifest for the row below the composer. Title and icon come from the
/// approved manifest; `target` says which agent it makes sense on (main, sub-agent or both).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionButtonDecl {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub target: String,
    /// Where it shows up: `terminal` (bar of every terminal, default), `header` (session bar,
    /// next to SSH/Database/Docker), `composer` (spawn composer tools), `runtime`
    /// (AI Squad, Goal and Worker row).
    #[serde(default = "default_place")]
    pub place: String,
}

fn default_place() -> String {
    "terminal".into()
}

pub const SESSION_BUTTON_PLACES: &[&str] = &["terminal", "header", "composer", "runtime"];
/// Where a page shows up: `menu` (under Plugins in the menu) or `sidebar` (item at the top of the
/// sessions sidebar, above folders and workspaces).
pub const PAGE_PLACES: &[&str] = &["menu", "sidebar"];

fn default_page_place() -> String {
    "menu".into()
}

/// Menu item declared by a plugin in the `pages` section. It comes from the approved
/// manifest: title and icon are never chosen by the running code.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageDecl {
    pub id: String,
    pub title: String,
    pub icon: String,
    /// `menu` (default) or `sidebar`. See [`PAGE_PLACES`].
    #[serde(default = "default_page_place")]
    pub place: String,
}

/// Repository the user chose for a plugin. The plugin only sees the handle and
/// the folder name, never the path. Lives in memory: every launch starts from scratch.
#[derive(Clone, Debug)]
pub struct RepoGrant {
    pub plugin_id: String,
    pub root: PathBuf,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub plugin_id: String,
    pub name: String,
    pub version: String,
    pub category: String,
    pub commit_sha: String,
    pub bundle_sha256: String,
    /// Granted permissions = those of the approved manifest at install time.
    pub permissions: Vec<String>,
    pub enabled: bool,
    /// Linked from a local folder in developer mode: same sandbox,
    /// no hash check (the file changes while it is being written).
    pub dev: bool,
    /// Repository (registry install) or local folder (dev).
    pub source: String,
    /// GitHub repository declared in the manifest (`repository`). Only to show owner and
    /// avatar in the UI: it is NOT the download source, which stays the approved one.
    #[serde(default)]
    pub repository: Option<String>,
    pub entry: String,
    pub installed_at: u64,
    pub disabled_reason: Option<String>,
    /// Menu items declared in the manifest (`pages` section only).
    #[serde(default)]
    pub pages: Vec<PageDecl>,
    /// AI providers the author declares the plugin works with. Optional, display only.
    #[serde(default)]
    pub providers: Vec<String>,
    /// Session buttons declared in the manifest (`session:buttons` permission).
    #[serde(default)]
    pub session_buttons: Vec<SessionButtonDecl>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Index {
    developer_mode: bool,
    plugins: BTreeMap<String, InstalledPlugin>,
}

/// Data the webapp passes to install: it comes from the registry catalog.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallSpec {
    pub plugin_id: String,
    pub name: String,
    pub version: String,
    pub category: String,
    pub repo_url: String,
    pub commit_sha: String,
    pub bundle_sha256: String,
    pub source_dir: Option<String>,
    pub manifest: Value,
}

pub struct PluginRuntime {
    root: OnceLock<PathBuf>,
    index: Mutex<Index>,
    /// Per-launch secret known only to the host page: plugin iframes cannot
    /// read it (opaque origin) or set headers on a navigation.
    pub host_token: String,
    rate: Mutex<HashMap<String, (u64, u32)>>,
    /// Contract calls waiting for a reply from the plugin iframe, with the plugin each was sent to:
    /// a reply counts only when it comes from that plugin's frame.
    pub pending:
        Mutex<HashMap<String, (String, tokio::sync::oneshot::Sender<Result<Value, String>>)>>,
    /// What each plugin registered at startup (section, methods, events, actions).
    pub contributions: Mutex<HashMap<String, Value>>,
    /// Repositories granted by the user, by handle.
    pub grants: Mutex<HashMap<String, RepoGrant>>,
    /// Pending confirmations in the main window: writing a file, starting the AI.
    pub confirms: Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>,
    /// Plugins with an AI generation in progress: one at a time.
    pub ai_busy: Mutex<HashSet<String>>,
    ai_hour: Mutex<HashMap<String, (u64, u32)>>,
    audit_lock: Mutex<()>,
    /// Key that encrypts plugin secrets, taken from the system keychain on first use.
    secret_key: Mutex<secrets::KeyState>,
    /// Plugin that can read a repository: the user's answer to the first network send toward
    /// each host, for this app launch. `true` = allowed, `false` = refused.
    pub egress: Mutex<HashMap<(String, String), bool>>,
    /// Only one send-consent request at a time: two parallel calls don't open two windows.
    pub egress_gate: tokio::sync::Mutex<()>,
    /// Last repository read by each plugin, to name in the consent request.
    pub last_repo_read: Mutex<HashMap<String, String>>,
}

impl PluginRuntime {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            root: OnceLock::new(),
            index: Mutex::new(Index::default()),
            host_token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
            rate: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            contributions: Mutex::new(HashMap::new()),
            grants: Mutex::new(HashMap::new()),
            confirms: Mutex::new(HashMap::new()),
            ai_busy: Mutex::new(HashSet::new()),
            ai_hour: Mutex::new(HashMap::new()),
            audit_lock: Mutex::new(()),
            secret_key: Mutex::new(secrets::KeyState::Unknown),
            egress: Mutex::new(HashMap::new()),
            egress_gate: tokio::sync::Mutex::new(()),
            last_repo_read: Mutex::new(HashMap::new()),
        })
    }

    pub fn init(&self, root: PathBuf) {
        let _ = fs::create_dir_all(&root);
        if let Ok(raw) = fs::read(root.join("index.json")) {
            if let Ok(index) = serde_json::from_slice::<Index>(&raw) {
                *self.index.lock() = index;
            }
        }
        let _ = self.root.set(root);
    }

    pub fn root(&self) -> Result<&PathBuf, String> {
        self.root
            .get()
            .ok_or_else(|| "plugin runtime not initialized".to_string())
    }

    fn save(&self, index: &Index) -> Result<(), String> {
        write_atomic(
            &self.root()?.join("index.json"),
            &serde_json::to_vec_pretty(index).map_err(err)?,
            false,
        )
    }

    pub fn list(&self) -> Vec<InstalledPlugin> {
        self.index.lock().plugins.values().cloned().collect()
    }

    pub fn get(&self, plugin_id: &str) -> Option<InstalledPlugin> {
        self.index.lock().plugins.get(plugin_id).cloned()
    }

    pub fn enabled(&self) -> Vec<InstalledPlugin> {
        self.list().into_iter().filter(|p| p.enabled).collect()
    }

    pub fn developer_mode(&self) -> bool {
        self.index.lock().developer_mode
    }

    pub fn set_developer_mode(&self, on: bool) -> Result<(), String> {
        let mut index = self.index.lock();
        index.developer_mode = on;
        self.save(&index)
    }

    pub fn upsert(&self, plugin: InstalledPlugin) -> Result<(), String> {
        let mut index = self.index.lock();
        index.plugins.insert(plugin.plugin_id.clone(), plugin);
        self.save(&index)
    }

    pub fn update<F: FnOnce(&mut InstalledPlugin)>(
        &self,
        plugin_id: &str,
        f: F,
    ) -> Result<InstalledPlugin, String> {
        let mut index = self.index.lock();
        let plugin = index
            .plugins
            .get_mut(plugin_id)
            .ok_or("plugin not installed")?;
        f(plugin);
        let out = plugin.clone();
        self.save(&index)?;
        Ok(out)
    }

    pub fn remove(&self, plugin_id: &str) -> Result<(), String> {
        let mut index = self.index.lock();
        index.plugins.remove(plugin_id);
        self.save(&index)?;
        let dir = self.plugin_dir(plugin_id)?;
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(err)?;
        }
        Ok(())
    }

    /// Plugin data folder. The id is already validated: no path separators.
    pub fn plugin_dir(&self, plugin_id: &str) -> Result<PathBuf, String> {
        if !valid_plugin_id(plugin_id) {
            return Err("invalid plugin id".into());
        }
        Ok(self.root()?.join(plugin_id))
    }

    /// Reads the bundle to run. For registry plugins it rechecks the hash:
    /// a file tampered with on disk disables the plugin instead of running it.
    pub fn load_bundle(&self, plugin: &InstalledPlugin) -> Result<String, String> {
        let path = if plugin.dev {
            let dir = PathBuf::from(&plugin.source);
            safe_join(&dir, &plugin.entry)?
        } else {
            self.plugin_dir(&plugin.plugin_id)?
                .join(&plugin.version)
                .join("entry.js")
        };
        let bytes = fs::read(&path).map_err(|e| format!("unreadable bundle: {e}"))?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err("bundle over the size limit".into());
        }
        if !plugin.dev && sha256_hex(&bytes) != plugin.bundle_sha256 {
            return Err(
                "integrity: the hash of the bundle on disk does not match the approved one".into(),
            );
        }
        String::from_utf8(bytes).map_err(|_| "bundle is not UTF-8".to_string())
    }

    /// One-minute sliding window per plugin: a runaway plugin does not saturate the app.
    pub fn rate_ok(&self, plugin_id: &str, max_per_minute: u32) -> bool {
        let now = now_secs() / 60;
        let mut rate = self.rate.lock();
        let slot = rate.entry(plugin_id.to_string()).or_insert((now, 0));
        if slot.0 != now {
            *slot = (now, 0);
        }
        slot.1 += 1;
        slot.1 <= max_per_minute
    }

    /// Hourly cap on AI generations per plugin, on top of confirming every single request.
    pub fn ai_rate_ok(&self, plugin_id: &str, max_per_hour: u32) -> bool {
        let now = now_secs() / 3600;
        let mut rate = self.ai_hour.lock();
        let slot = rate.entry(plugin_id.to_string()).or_insert((now, 0));
        if slot.0 != now {
            *slot = (now, 0);
        }
        slot.1 += 1;
        slot.1 <= max_per_hour
    }

    /// Records the user's choice and returns the handle to pass to the plugin.
    pub fn grant_repo(&self, plugin_id: &str, root: PathBuf, name: String) -> String {
        let mut grants = self.grants.lock();
        if let Some((handle, _)) = grants
            .iter()
            .find(|(_, g)| g.plugin_id == plugin_id && g.root == root)
        {
            return handle.clone();
        }
        let handle = format!("repo_{}", uuid::Uuid::new_v4().simple());
        grants.insert(
            handle.clone(),
            RepoGrant {
                plugin_id: plugin_id.to_string(),
                root,
                name,
            },
        );
        handle
    }

    /// A handle is valid only for the plugin the user granted it to.
    pub fn repo_of(&self, plugin_id: &str, handle: &str) -> Result<RepoGrant, String> {
        self.grants
            .lock()
            .get(handle)
            .filter(|g| g.plugin_id == plugin_id)
            .cloned()
            .ok_or_else(|| {
                "repository not granted to this plugin: the user must pick it in the page"
                    .to_string()
            })
    }

    pub fn revoke_grants(&self, plugin_id: &str) {
        self.grants.lock().retain(|_, g| g.plugin_id != plugin_id);
        // Turning the plugin off and on also resets the network send consents: they are asked again.
        self.egress.lock().retain(|(id, _), _| id != plugin_id);
        self.last_repo_read.lock().remove(plugin_id);
    }

    /// Local log of every broker call. Never request bodies or secrets.
    pub fn audit(&self, entry: Value) {
        let Ok(root) = self.root() else { return };
        let path = root.join("audit.log");
        // Simple rotation: over 2 MB we start over, keeping the previous file.
        if fs::metadata(&path)
            .map(|m| m.len() > 2_000_000)
            .unwrap_or(false)
        {
            let _ = fs::rename(&path, root.join("audit.log.1"));
        }
        // One line, a single write: two parallel calls must not interleave.
        let line = format!("{entry}\n");
        let _guard = self.audit_lock.lock();
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(line.as_bytes());
        }
    }

    pub fn audit_tail(&self, plugin_id: Option<&str>, limit: usize) -> Vec<Value> {
        let Ok(root) = self.root() else { return vec![] };
        let raw = fs::read_to_string(root.join("audit.log")).unwrap_or_default();
        let mut out: Vec<Value> = raw
            .lines()
            .rev()
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .filter(|v| plugin_id.map(|id| v["plugin"] == id).unwrap_or(true))
            .take(limit)
            .collect();
        out.reverse();
        out
    }
}

// ── Pure validations (tested below) ────────────────────────────────────────────

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub(crate) fn slug_ok(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 2
        && b.len() <= 60
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && b[0] != b'-'
        && b[b.len() - 1] != b'-'
}

/// `<handle>.<slug>`: lowercase letters, digits and hyphens only. No `/`, `\` or `..`.
pub fn valid_plugin_id(id: &str) -> bool {
    let mut parts = id.split('.');
    matches!((parts.next(), parts.next(), parts.next()), (Some(h), Some(s), None) if slug_ok(h) && slug_ok(s))
}

pub fn valid_rel_path(path: &str, ext: &str) -> bool {
    !path.is_empty()
        && path.len() <= 200
        && !path.contains("..")
        && !path.starts_with('/')
        && !path.starts_with('.')
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | '-'))
        && path.to_ascii_lowercase().ends_with(&format!(".{ext}"))
}

pub fn safe_join(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    if !valid_rel_path(rel, "js") && !valid_rel_path(rel, "json") {
        return Err("invalid path in the manifest".into());
    }
    Ok(dir.join(rel))
}

/// Public hostname: no IPs, localhost, wildcards or internal domains.
pub fn is_public_hostname(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    if host.len() < 4 || host.len() > 253 || host.parse::<IpAddr>().is_ok() {
        return false;
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    let tld = labels[labels.len() - 1];
    if tld.len() < 2 || !tld.chars().all(|c| c.is_ascii_lowercase()) {
        return false;
    }
    if matches!(
        tld,
        "localhost" | "local" | "internal" | "lan" | "home" | "corp"
    ) {
        return false;
    }
    labels.iter().all(|l| {
        !l.is_empty()
            && l.len() <= 63
            && l.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            && !l.starts_with('-')
            && !l.ends_with('-')
    })
}

/// Permission the app requires before calling a method of a section contract. The plugin
/// declares the method, but writing to a third-party tracker on the person's behalf (moving a
/// card) needs the permission the person approved at install time.
pub fn contract_permission(kind: &str, method: &str) -> Option<&'static str> {
    match (kind, method) {
        ("tasks", "setStatus" | "createTask" | "updateTask" | "deleteTask" | "addComment") => {
            Some("tasks:write")
        }
        _ => None,
    }
}

/// Version as it ends up in a folder name: `1.2.3`, `0.1.0-beta.1`. Never empty, never a
/// path component like `.` or `..`.
pub fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 40
        && version
            .chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
        && !version.contains("..")
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

/// Validates a manifest's permission list and returns the declared `net:` hosts.
pub fn validate_permissions(permissions: &[String]) -> Result<Vec<String>, String> {
    let mut hosts = Vec::new();
    for p in permissions {
        if let Some(host) = p.strip_prefix("net:") {
            if !is_public_hostname(host) {
                return Err(format!("host not allowed in permission `{p}`"));
            }
            hosts.push(host.to_ascii_lowercase());
        } else if !ALLOWED_PERMISSIONS.contains(&p.as_str()) {
            return Err(format!("permission `{p}` is not supported by the runtime"));
        }
    }
    Ok(hosts)
}

/// Addresses the broker NEVER connects to, even if the host is declared:
/// loopback, private networks, link-local (cloud metadata), CGNAT, multicast, ULA,
/// and every IPv6 form that carries one of those IPv4 addresses inside it.
pub fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.is_documentation()
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                // IETF protocol assignments (192.0.0.0/24) and benchmarking (198.18.0.0/15).
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
                || o[0] == 0
                || o[0] >= 240
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_forbidden_ip(IpAddr::V4(v4));
            }
            let seg = v6.segments();
            // IPv4 embedded in the last 32 bits: NAT64 (64:ff9b::/96 and the local-use
            // 64:ff9b:1::/48) and the deprecated IPv4-compatible form (::a.b.c.d). On a
            // NAT64 network 64:ff9b::a00:1 reaches 10.0.0.1: judge the IPv4 inside.
            let low_v4 = || {
                std::net::Ipv4Addr::new(
                    (seg[6] >> 8) as u8,
                    seg[6] as u8,
                    (seg[7] >> 8) as u8,
                    seg[7] as u8,
                )
            };
            let nat64 = seg[0] == 0x0064 && seg[1] == 0xff9b && seg[2..6] == [0, 0, 0, 0];
            let nat64_local = seg[0] == 0x0064 && seg[1] == 0xff9b && seg[2] == 0x0001;
            let v4_compatible = seg[0..6] == [0, 0, 0, 0, 0, 0];
            if nat64 || nat64_local || (v4_compatible && !v6.is_loopback() && !v6.is_unspecified())
            {
                return nat64_local || is_forbidden_ip(IpAddr::V4(low_v4()));
            }
            // 6to4 (2002::/16): the IPv4 is in segments 1 and 2.
            if seg[0] == 0x2002 {
                let v4 = std::net::Ipv4Addr::new(
                    (seg[1] >> 8) as u8,
                    seg[1] as u8,
                    (seg[2] >> 8) as u8,
                    seg[2] as u8,
                );
                return is_forbidden_ip(IpAddr::V4(v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // Teredo (2001::/32) tunnels to an obfuscated IPv4; documentation (2001:db8::/32).
                || (seg[0] == 0x2001 && seg[1] == 0x0000)
                || (seg[0] == 0x2001 && seg[1] == 0x0db8)
                || (seg[0] & 0xfe00) == 0xfc00
                || (seg[0] & 0xffc0) == 0xfe80
                // Deprecated site-local (fec0::/10).
                || (seg[0] & 0xffc0) == 0xfec0
        }
    }
}

/// Raw base of a public GitHub repository at the pinned commit.
pub fn raw_base(
    repo_url: &str,
    commit_sha: &str,
    source_dir: Option<&str>,
) -> Result<String, String> {
    let rest = repo_url
        .strip_prefix("https://github.com/")
        .ok_or("the repository must be https://github.com/<owner>/<repo>")?;
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.split('/');
    let (owner, repo) = match (parts.next(), parts.next(), parts.next()) {
        (Some(o), Some(r), None) => (o, r),
        _ => return Err("invalid repository URL".into()),
    };
    let ok = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && !s.starts_with('.')
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    };
    if !ok(owner) || !ok(repo) {
        return Err("invalid owner or repository".into());
    }
    if commit_sha.len() != 40
        || !commit_sha
            .chars()
            .all(|c| matches!(c, '0'..='9' | 'a'..='f'))
    {
        return Err("the commit must be 40 hexadecimal characters".into());
    }
    let dir = source_dir.unwrap_or("").trim_matches('/');
    if !dir.is_empty()
        && (dir.contains("..")
            || !dir
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | '-')))
    {
        return Err("invalid subfolder".into());
    }
    Ok(format!(
        "{RAW_HOST}/{owner}/{repo}/{commit_sha}/{}",
        if dir.is_empty() {
            String::new()
        } else {
            format!("{dir}/")
        }
    ))
}

/// The manifest's `repository`, only if it is a well-formed GitHub URL. It ends up in a
/// `src` attribute in the UI, so only the expected shape is accepted.
pub fn manifest_repository(manifest: &Value) -> Option<String> {
    let url = manifest["repository"].as_str()?;
    raw_base(url, &"a".repeat(40), None)
        .ok()
        .map(|_| url.trim_end_matches('/').to_string())
}

/// Menu items of the manifest. Only the `pages` section can declare them, and it must declare at least one.
/// The title ends up in the app menu: no control characters, limited length.
/// The icon is a Tabler name (`ti-...`) because it becomes a CSS class.
pub fn manifest_pages(manifest: &Value, category: &str) -> Result<Vec<PageDecl>, String> {
    let declared = manifest["contributes"]["pages"].as_array();
    if category != "pages" {
        return if declared.map(|a| !a.is_empty()).unwrap_or(false) {
            Err("only the `pages` section can declare menu items".into())
        } else {
            Ok(vec![])
        };
    }
    let declared = declared
        .filter(|a| !a.is_empty())
        .ok_or("a `pages` plugin must declare at least one item in `contributes.pages`")?;
    if declared.len() > MAX_PAGES_PER_PLUGIN {
        return Err(format!(
            "at most {MAX_PAGES_PER_PLUGIN} menu items per plugin"
        ));
    }
    let mut pages: Vec<PageDecl> = Vec::new();
    for item in declared {
        let id = item["id"].as_str().unwrap_or("");
        if !slug_ok(id) {
            return Err(
                "`contributes.pages[].id` must be lowercase, with digits and hyphens".into(),
            );
        }
        if pages.iter().any(|p| p.id == id) {
            return Err(format!("menu item `{id}` declared twice"));
        }
        let title = item["title"].as_str().unwrap_or("").trim();
        if title.is_empty() || title.chars().count() > 40 || title.chars().any(char::is_control) {
            return Err("`contributes.pages[].title` is required, at most 40 characters".into());
        }
        let icon = item["icon"].as_str().unwrap_or("ti-puzzle");
        if !valid_icon(icon) {
            return Err(
                "`contributes.pages[].icon` must be a Tabler icon, for example `ti-file-pencil`"
                    .into(),
            );
        }
        let place = item["place"].as_str().unwrap_or("menu");
        if !PAGE_PLACES.contains(&place) {
            return Err("`contributes.pages[].place` must be `menu` or `sidebar`".into());
        }
        pages.push(PageDecl {
            id: id.to_string(),
            title: title.to_string(),
            icon: icon.to_string(),
            place: place.to_string(),
        });
    }
    Ok(pages)
}

/// Session buttons of the manifest. Any section can declare them, but only with the
/// `session:buttons` permission, and the permission without buttons makes no sense.
pub fn manifest_session_buttons(
    manifest: &Value,
    permissions: &[String],
) -> Result<Vec<SessionButtonDecl>, String> {
    let declared = manifest["contributes"]["sessionButtons"]
        .as_array()
        .filter(|a| !a.is_empty());
    let allowed = permissions.iter().any(|p| p == "session:buttons");
    let Some(declared) = declared else {
        return if allowed {
            Err("the `session:buttons` permission requires at least one button in `contributes.sessionButtons`".into())
        } else {
            Ok(vec![])
        };
    };
    if !allowed {
        return Err(
            "`contributes.sessionButtons` requires the `session:buttons` permission".into(),
        );
    }
    if declared.len() > MAX_SESSION_BUTTONS_PER_PLUGIN {
        return Err(format!(
            "at most {MAX_SESSION_BUTTONS_PER_PLUGIN} session buttons per plugin"
        ));
    }
    let mut buttons: Vec<SessionButtonDecl> = Vec::new();
    for item in declared {
        let id = item["id"].as_str().unwrap_or("");
        if !slug_ok(id) {
            return Err(
                "`contributes.sessionButtons[].id` must be lowercase, with digits and hyphens"
                    .into(),
            );
        }
        if buttons.iter().any(|b| b.id == id) {
            return Err(format!("button `{id}` declared twice"));
        }
        let title = item["title"].as_str().unwrap_or("").trim();
        if title.is_empty() || title.chars().count() > 40 || title.chars().any(char::is_control) {
            return Err(
                "`contributes.sessionButtons[].title` is required, at most 40 characters".into(),
            );
        }
        let icon = item["icon"].as_str().unwrap_or("ti-puzzle");
        if !valid_icon(icon) {
            return Err("`contributes.sessionButtons[].icon` must be a Tabler icon, for example `ti-eye-check`".into());
        }
        let target = item["target"].as_str().unwrap_or("both");
        if !matches!(target, "main" | "subagent" | "both") {
            return Err(
                "`contributes.sessionButtons[].target` must be `main`, `subagent` or `both`".into(),
            );
        }
        let place = item["place"].as_str().unwrap_or("terminal");
        if !SESSION_BUTTON_PLACES.contains(&place) {
            return Err("`contributes.sessionButtons[].place` must be `terminal`, `header`, `composer` or `runtime`".into());
        }
        buttons.push(SessionButtonDecl {
            id: id.to_string(),
            title: title.to_string(),
            icon: icon.to_string(),
            target: target.to_string(),
            place: place.to_string(),
        });
    }
    Ok(buttons)
}

/// The manifest's `providers`: the author's declaration, only used to show icons.
/// The list of known ids is kept by the scanner and the webapp: here it is enough that the shape is harmless.
pub fn manifest_providers(manifest: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in manifest["providers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if slug_ok(id) && id.len() <= 40 && !out.iter().any(|p| p == id) && out.len() < 12 {
            out.push(id.to_string());
        }
    }
    out
}

pub fn valid_icon(icon: &str) -> bool {
    icon.len() <= 48
        && icon
            .strip_prefix("ti-")
            .map(|rest| {
                rest.len() >= 2
                    && rest
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            })
            .unwrap_or(false)
}

/// Repository and AI permissions exist only for the `pages` section: there every
/// request originates from a page the user opened and is looking at.
pub fn validate_category_permissions(category: &str, permissions: &[String]) -> Result<(), String> {
    if category == "pages" {
        return Ok(());
    }
    match permissions.iter().find(|p| {
        matches!(
            p.as_str(),
            "git:read" | "workspace:write" | "ai:generate" | "ai:benchmark"
        )
    }) {
        Some(p) => Err(format!(
            "the `{p}` permission is reserved for the `pages` section"
        )),
        None => Ok(()),
    }
}

pub fn manifest_permissions(manifest: &Value) -> Result<Vec<String>, String> {
    manifest["permissions"]
        .as_array()
        .ok_or("the manifest has no `permissions`")?
        .iter()
        .map(|v| {
            v.as_str()
                .map(str::to_string)
                .ok_or_else(|| "non-text permission in the manifest".to_string())
        })
        .collect()
}

pub fn write_atomic(path: &Path, bytes: &[u8], private: bool) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(err)?;
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = private;
    fs::rename(&tmp, path).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_ids() {
        assert!(valid_plugin_id("acme.linear-tasks"));
        for bad in [
            "acme",
            "acme.linear.tasks",
            "../x.y",
            "acme/x.y",
            "Acme.x1",
            "a.b",
            "acme.-x",
            "acme.x/..",
            "",
        ] {
            assert!(!valid_plugin_id(bad), "{bad}");
        }
    }

    #[test]
    fn rel_paths() {
        assert!(valid_rel_path("dist/plugin.js", "js"));
        for bad in [
            "../plugin.js",
            "/etc/x.js",
            "dist/../../x.js",
            "dist/plugin.exe",
            ".hidden/x.js",
            "a b.js",
            "dist\\x.js",
        ] {
            assert!(!valid_rel_path(bad, "js"), "{bad}");
        }
    }

    #[test]
    fn hostnames_and_permissions() {
        assert!(is_public_hostname("api.linear.app"));
        for bad in [
            "localhost",
            "127.0.0.1",
            "10.0.0.5",
            "*.linear.app",
            "db.internal",
            "printer.local",
            "api",
            "[::1]",
            "a..b.com",
            "-x.com",
        ] {
            assert!(!is_public_hostname(bad), "{bad}");
        }
        let ok = vec![
            "net:api.linear.app".to_string(),
            "secrets".into(),
            "notify".into(),
        ];
        assert_eq!(validate_permissions(&ok).unwrap(), vec!["api.linear.app"]);
        for bad in [
            "exec",
            "fs:workspace",
            "net:169.254.169.254",
            "net:localhost",
            "prompts:read",
            // Declared but never enforced by any SDK call: refused, not silently granted.
            "agents:propose",
        ] {
            assert!(validate_permissions(&[bad.to_string()]).is_err(), "{bad}");
        }
        assert!(validate_permissions(&["tasks:write".to_string()]).is_ok());
    }

    #[test]
    fn write_methods_of_the_tasks_contract_need_tasks_write() {
        assert_eq!(
            contract_permission("tasks", "setStatus"),
            Some("tasks:write")
        );
        assert_eq!(
            contract_permission("tasks", "createTask"),
            Some("tasks:write")
        );
        for (kind, method) in [
            ("tasks", "listTasks"),
            ("tasks", "getTask"),
            ("tasks", "validate"),
            ("pages", "setStatus"),
            ("data", "query"),
        ] {
            assert_eq!(contract_permission(kind, method), None, "{kind}.{method}");
        }
    }

    #[test]
    fn versions_never_become_path_tricks() {
        for ok in ["0.1.0", "1.2.3-beta.1", "2.0.0+build5", "10"] {
            assert!(valid_version(ok), "{ok}");
        }
        for bad in [
            "",
            ".",
            "..",
            "../x",
            "1/2",
            ".1.0",
            "1..2",
            "1.0\\x",
            "-1",
            &"1".repeat(41),
        ] {
            assert!(!valid_version(bad), "{bad}");
        }
    }

    #[test]
    fn forbidden_ips() {
        for bad in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fc00::1",
            "::ffff:10.0.0.1",
            "224.0.0.1",
        ] {
            assert!(is_forbidden_ip(bad.parse().unwrap()), "{bad}");
        }
        for ok in ["140.82.112.3", "2606:50c0:8000::154"] {
            assert!(!is_forbidden_ip(ok.parse().unwrap()), "{ok}");
        }
    }

    /// IPv6 forms that carry an IPv4 address: the IPv4 inside decides.
    #[test]
    fn forbidden_ips_hidden_inside_ipv6() {
        for bad in [
            // NAT64 well-known prefix toward private, loopback and metadata addresses.
            "64:ff9b::a00:1",
            "64:ff9b::7f00:1",
            "64:ff9b::a9fe:a9fe",
            "64:ff9b::192.168.1.1",
            // NAT64 local-use prefix: the operator's own network, always refused.
            "64:ff9b:1::808:808",
            // IPv4-compatible (deprecated) and IPv4-mapped.
            "::10.0.0.1",
            "::127.0.0.1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            // 6to4 with a private IPv4 inside.
            "2002:a00:1::1",
            "2002:c0a8:101::",
            "2002:7f00:1::",
            // Teredo, documentation and site-local.
            "2001:0:4136:e378:8000:63bf:3fff:fdd2",
            "2001:db8::1",
            "fec0::1",
            // IPv4 benchmarking and IETF protocol assignments.
            "198.18.0.1",
            "198.19.255.254",
            "192.0.0.8",
        ] {
            assert!(is_forbidden_ip(bad.parse().unwrap()), "{bad}");
        }
        for ok in [
            // The same forms toward a public IPv4 stay allowed.
            "64:ff9b::8c52:7003",
            "2002:8c52:7003::1",
            "::ffff:140.82.112.3",
            "2a00:1450:4001:80b::200e",
            "198.20.0.1",
        ] {
            assert!(!is_forbidden_ip(ok.parse().unwrap()), "{ok}");
        }
    }

    #[test]
    fn raw_base_is_pinned_to_github() {
        let sha = "a".repeat(40);
        assert_eq!(
            raw_base(
                "https://github.com/acme/linear-tasks.git",
                &sha,
                Some("plugin/")
            )
            .unwrap(),
            format!("https://raw.githubusercontent.com/acme/linear-tasks/{sha}/plugin/")
        );
        for bad in [
            "https://gitlab.com/acme/x",
            "https://github.com/acme",
            "https://github.com/acme/x/tree/main",
            "http://github.com/acme/x",
            "https://github.com/../x",
        ] {
            assert!(raw_base(bad, &sha, None).is_err(), "{bad}");
        }
        assert!(raw_base("https://github.com/acme/x", "main", None).is_err());
        assert!(raw_base("https://github.com/acme/x", &sha, Some("../other")).is_err());
    }

    /// The templates playground must use the SAME SDK as the runtime. If the
    /// templates folder is missing (container build) the check is skipped.
    #[test]
    fn menu_pages_come_only_from_a_pages_manifest() {
        let ok = serde_json::json!({ "contributes": { "pages": [{ "id": "writer", "title": "AI Git Writer", "icon": "ti-file-pencil" }, { "id": "log", "title": "History" }] } });
        let pages = manifest_pages(&ok, "pages").unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(
            pages[0],
            PageDecl {
                id: "writer".into(),
                title: "AI Git Writer".into(),
                icon: "ti-file-pencil".into(),
                place: "menu".into()
            }
        );
        assert_eq!(pages[1].icon, "ti-puzzle");
        let side = serde_json::json!({ "contributes": { "pages": [{ "id": "map", "title": "Floor plan", "icon": "ti-layout-board", "place": "sidebar" }] } });
        assert_eq!(manifest_pages(&side, "pages").unwrap()[0].place, "sidebar");
        let bad_place = serde_json::json!({ "contributes": { "pages": [{ "id": "map", "title": "x", "place": "topbar" }] } });
        assert!(manifest_pages(&bad_place, "pages").is_err());

        assert!(
            manifest_pages(&ok, "tasks").is_err(),
            "another section cannot add menu items"
        );
        assert_eq!(
            manifest_pages(&serde_json::json!({}), "tasks").unwrap(),
            vec![]
        );
        assert!(
            manifest_pages(&serde_json::json!({}), "pages").is_err(),
            "a page without items makes no sense"
        );

        let page = |id: &str, title: &str, icon: &str| serde_json::json!({ "contributes": { "pages": [{ "id": id, "title": title, "icon": icon }] } });
        for bad in [
            page("Writer", "x", "ti-book"),
            page("w", "x", "ti-book"),
            page("writer", "", "ti-book"),
            page("writer", &"x".repeat(41), "ti-book"),
            page("writer", "a\nb", "ti-book"),
            page("writer", "x", "fa-book"),
            page("writer", "x", "ti-book\" onload=\"x"),
            page("writer", "x", "ti-a b"),
        ] {
            assert!(manifest_pages(&bad, "pages").is_err(), "{bad}");
        }
        let many: Vec<_> = (0..4)
            .map(|i| serde_json::json!({ "id": format!("page-{i}"), "title": "x" }))
            .collect();
        assert!(manifest_pages(
            &serde_json::json!({ "contributes": { "pages": many } }),
            "pages"
        )
        .is_err());
        let twice = serde_json::json!({ "contributes": { "pages": [{ "id": "aa", "title": "x" }, { "id": "aa", "title": "y" }] } });
        assert!(manifest_pages(&twice, "pages").is_err());
    }

    #[test]
    fn declared_providers_are_kept_only_when_harmless() {
        let m = serde_json::json!({ "providers": ["claude-code-cli", "codex", "codex", "Bad Id", "x\" onload=\"y", 7, "gemini-cli"] });
        assert_eq!(
            manifest_providers(&m),
            vec!["claude-code-cli", "codex", "gemini-cli"]
        );
        assert!(manifest_providers(&serde_json::json!({})).is_empty());
        assert!(manifest_providers(&serde_json::json!({ "providers": "codex" })).is_empty());
    }

    #[test]
    fn session_buttons_need_their_permission_and_a_clean_shape() {
        let perm = vec!["session:buttons".to_string()];
        let ok = serde_json::json!({ "contributes": { "sessionButtons": [
            { "id": "review", "title": "Review with Codex", "icon": "ti-eye-check", "target": "subagent" },
            { "id": "tests", "title": "Write tests" } ] } });
        let buttons = manifest_session_buttons(&ok, &perm).unwrap();
        assert_eq!(buttons.len(), 2);
        assert_eq!(buttons[1].icon, "ti-puzzle");
        assert_eq!(buttons[1].target, "both");
        assert_eq!(buttons[1].place, "terminal");
        let header = serde_json::json!({ "contributes": { "sessionButtons": [{ "id": "aa", "title": "A", "place": "header" }] } });
        assert_eq!(
            manifest_session_buttons(&header, &perm).unwrap()[0].place,
            "header"
        );
        let bad_place = serde_json::json!({ "contributes": { "sessionButtons": [{ "id": "aa", "title": "A", "place": "sidebar" }] } });
        assert!(manifest_session_buttons(&bad_place, &perm).is_err());
        assert!(
            manifest_session_buttons(&ok, &[]).is_err(),
            "buttons without permission"
        );
        assert!(
            manifest_session_buttons(&serde_json::json!({}), &perm).is_err(),
            "permission without buttons"
        );
        assert_eq!(
            manifest_session_buttons(&serde_json::json!({}), &[]).unwrap(),
            vec![]
        );
        for bad in [
            serde_json::json!({ "contributes": { "sessionButtons": [{ "id": "Bad Id", "title": "x" }] } }),
            serde_json::json!({ "contributes": { "sessionButtons": [{ "id": "a", "title": "" }] } }),
            serde_json::json!({ "contributes": { "sessionButtons": [{ "id": "ok", "title": "x", "icon": "fa-x" }] } }),
            serde_json::json!({ "contributes": { "sessionButtons": [{ "id": "ok", "title": "x", "target": "all" }] } }),
            serde_json::json!({ "contributes": { "sessionButtons": [{ "id": "ok", "title": "a" }, { "id": "ok", "title": "b" }] } }),
            serde_json::json!({ "contributes": { "sessionButtons": [{ "id": "aa", "title": "a" }, { "id": "bb", "title": "b" }, { "id": "cc", "title": "c" }] } }),
        ] {
            assert!(manifest_session_buttons(&bad, &perm).is_err(), "{bad}");
        }
    }

    #[test]
    fn repository_and_ai_permissions_belong_to_pages_only() {
        let perms = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(validate_permissions(&perms(&[
            "git:read",
            "workspace:write",
            "ai:generate",
            "storage"
        ]))
        .is_ok());
        assert!(
            validate_category_permissions("pages", &perms(&["git:read", "ai:generate"])).is_ok()
        );
        for p in ["git:read", "workspace:write", "ai:generate", "ai:benchmark"] {
            assert!(
                validate_category_permissions("tasks", &perms(&[p])).is_err(),
                "{p}"
            );
        }
        assert!(validate_category_permissions(
            "tasks",
            &perms(&["storage", "net:api.clickup.com"])
        )
        .is_ok());
    }

    #[test]
    fn a_repository_handle_is_bound_to_one_plugin() {
        let rt = PluginRuntime::new();
        let handle = rt.grant_repo("acme.writer", PathBuf::from("/repo/a"), "a".into());
        assert_eq!(
            rt.grant_repo("acme.writer", PathBuf::from("/repo/a"), "a".into()),
            handle,
            "the same choice does not create two handles"
        );
        assert!(rt.repo_of("acme.writer", &handle).is_ok());
        assert!(
            rt.repo_of("evil.other", &handle).is_err(),
            "another plugin cannot use the handle"
        );
        assert!(rt.repo_of("acme.writer", "repo_guess").is_err());
        rt.revoke_grants("acme.writer");
        assert!(rt.repo_of("acme.writer", &handle).is_err());
    }

    #[test]
    fn playground_sdk_is_in_sync() {
        let copy = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../promptops-plugin-templates/playground/sdk.js");
        if let Ok(theirs) = fs::read_to_string(copy) {
            assert_eq!(
                theirs,
                include_str!("sdk.js"),
                "playground/sdk.js is out of sync: copy src/plugins/sdk.js again"
            );
        }
    }

    #[test]
    fn repository_is_accepted_only_as_a_github_url() {
        let ok = serde_json::json!({ "repository": "https://github.com/shellonback/promptops-plugin-clickup/" });
        assert_eq!(
            manifest_repository(&ok).as_deref(),
            Some("https://github.com/shellonback/promptops-plugin-clickup")
        );
        for bad in [
            "javascript:alert(1)",
            "https://evil.example.org/x/y",
            "https://github.com/only-owner",
            "https://github.com/a/b/../../c",
        ] {
            assert!(
                manifest_repository(&serde_json::json!({ "repository": bad })).is_none(),
                "{bad}"
            );
        }
        assert!(manifest_repository(&serde_json::json!({})).is_none());
    }

    #[test]
    fn bundle_integrity_is_enforced() {
        let dir = std::env::temp_dir().join(format!("po-plugin-test-{}", uuid::Uuid::new_v4()));
        let rt = PluginRuntime::new();
        rt.init(dir.clone());
        let bundle = b"promptops.onActivate(() => {});";
        let mut plugin = InstalledPlugin {
            plugin_id: "acme.demo".into(),
            name: "Demo".into(),
            version: "0.1.0".into(),
            category: "notify".into(),
            commit_sha: "a".repeat(40),
            bundle_sha256: sha256_hex(bundle),
            permissions: vec![],
            enabled: true,
            dev: false,
            source: "https://github.com/acme/demo".into(),
            repository: None,
            entry: "dist/plugin.js".into(),
            installed_at: 0,
            disabled_reason: None,
            pages: vec![],
            providers: vec![],
            session_buttons: vec![],
        };
        let file = rt
            .plugin_dir("acme.demo")
            .unwrap()
            .join("0.1.0")
            .join("entry.js");
        write_atomic(&file, bundle, false).unwrap();
        assert!(rt.load_bundle(&plugin).is_ok());

        fs::write(&file, b"fetch('https://evil.example')").unwrap();
        assert!(rt.load_bundle(&plugin).unwrap_err().contains("integrit"));

        plugin.plugin_id = "../escape".into();
        assert!(rt.load_bundle(&plugin).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
