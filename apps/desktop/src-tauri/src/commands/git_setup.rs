//! Git Setup Assistant.
//!
//! Diagnosis + automatic fixes for the most common push failures:
//! remote URL type, SSH keys, ssh-agent, git identity, connection
//! test.
//!
//! Conventions (see terminal.rs):
//!  - every command is `#[tauri::command] pub fn <name>(...) -> Result<T, String>`,
//!    in snake_case (`git-setup:generate-key` → `git_setup_generate_key`, etc.).
//!  - the logic mostly shells out to `ssh-keygen`, `ssh-add`, `ssh-agent`,
//!    `git config`, `ssh -T git@...` with the SAME arguments/flags and the SAME
//!    stdout parsing as the TS, to guarantee identical behavior.
//!  - per-workspace preferences are persisted in `~/.promptops/git-setup.json`
//!    with the same shape `{ "<cwd>": { "selectedKeyPath": "..." } }`.
//!
//! In-process agent env:
//!  `start-agent` must make the new agent (`SSH_AUTH_SOCK`, `SSH_AGENT_PID`)
//!  visible to the process's later calls. This is done with a
//!  `GitSetupAgentEnv` State (env overlay) that is applied to every
//!  login-shell command. The State must be registered in lib.rs with
//!  `.manage(std::sync::Arc::new(GitSetupAgentEnv::new()))`.

use std::collections::HashMap;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf, MAIN_SEPARATOR};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;

// =====================================================================
//  State — agent env overlay
// =====================================================================

/// Overlay of environment variables set by `git_setup_start_agent`
/// (`SSH_AUTH_SOCK`, `SSH_AGENT_PID`). It is applied to all subsequent
/// login-shell commands, so the new agent is visible process-wide.
#[derive(Default)]
pub struct GitSetupAgentEnv {
    vars: Mutex<HashMap<String, String>>,
}

impl GitSetupAgentEnv {
    pub fn new() -> Self {
        Self::default()
    }

    fn set(&self, key: &str, value: &str) {
        self.vars.lock().insert(key.to_string(), value.to_string());
    }

    fn snapshot(&self) -> HashMap<String, String> {
        self.vars.lock().clone()
    }

    /// Resolves a var by reading the overlay first and then the real process
    /// environment (mirror of `process.env.X` after any mutation).
    fn get(&self, key: &str) -> Option<String> {
        if let Some(v) = self.vars.lock().get(key) {
            if !v.is_empty() {
                return Some(v.clone());
            }
        }
        std::env::var(key).ok().filter(|v| !v.is_empty())
    }
}

/// Single overlay instance: the same one lib.rs registers as State and that
/// `git.rs` uses for push/pull/fetch. Previously push/pull did NOT see the agent
/// started by Fix Setup (overlay applied only to git_setup commands) →
/// the key added there "disappeared" on the next push.
pub fn shared_agent_env() -> Arc<GitSetupAgentEnv> {
    static SHARED: std::sync::OnceLock<Arc<GitSetupAgentEnv>> = std::sync::OnceLock::new();
    SHARED
        .get_or_init(|| {
            let env = Arc::new(GitSetupAgentEnv::new());
            env.restore_persisted_agent();
            env
        })
        .clone()
}

impl GitSetupAgentEnv {
    /// Reattaches the agent started in a previous app session (sock
    /// persisted in git-setup.json) if the socket is still alive. Unix only:
    /// on Windows the agent is a service with a fixed named pipe.
    fn restore_persisted_agent(&self) {
        if is_windows() {
            return;
        }
        let prefs = read_prefs();
        let Some(agent) = prefs.get(AGENT_PREFS_KEY) else {
            return;
        };
        let sock = agent.get("sock").and_then(|v| v.as_str()).unwrap_or("");
        if sock.is_empty() || !Path::new(sock).exists() {
            return;
        }
        // If the process environment already has a working agent, that one wins.
        if std::env::var("SSH_AUTH_SOCK")
            .map(|v| !v.is_empty())
            .unwrap_or(false)
        {
            return;
        }
        self.set("SSH_AUTH_SOCK", sock);
        if let Some(pid) = agent.get("pid").and_then(|v| v.as_str()) {
            self.set("SSH_AGENT_PID", pid);
        }
    }

    fn persist_agent(&self) {
        let snap = self.snapshot();
        let Some(sock) = snap.get("SSH_AUTH_SOCK") else {
            return;
        };
        let mut prefs = read_prefs();
        prefs.insert(
            AGENT_PREFS_KEY.to_string(),
            serde_json::json!({ "sock": sock, "pid": snap.get("SSH_AGENT_PID") }),
        );
        write_prefs(&prefs);
    }
}

/// Reserved key in git-setup.json (the others are absolute cwds).
const AGENT_PREFS_KEY: &str = "__agent";

// =====================================================================
//  SSH context for git network operations (push/pull/fetch)
// =====================================================================

/// Env to apply to EVERY git network command. Goals:
///  1. never hang: no tty prompts (credentials, passphrase, merge
///     editor) — without a tty the app stayed stuck forever;
///  2. ALWAYS use the same agent as Fix Setup (overlay → process env),
///     even if the user's login shell starts another one in the profile;
///  3. offer the key chosen in Fix Setup for that workspace.
pub fn git_network_env(cwd: &str) -> Vec<(String, String)> {
    let env = shared_agent_env();
    let mut out: Vec<(String, String)> = vec![
        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
        ("GIT_EDITOR".into(), "true".into()),
        ("GIT_MERGE_AUTOEDIT".into(), "no".into()),
    ];
    for (k, v) in env.snapshot() {
        out.push((k, v));
    }
    if is_windows() {
        return out;
    }
    let sock = env.get("SSH_AUTH_SOCK");
    if let Some(s) = sock.as_ref() {
        out.push(("SSH_AUTH_SOCK".into(), s.clone()));
    }
    // Respect an explicit user ssh configuration.
    let user_ssh_cmd = std::env::var("GIT_SSH_COMMAND")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
        || crate::commands::util_cmd::cmd("git")
            .args(["config", "--get", "core.sshCommand"])
            .current_dir(cwd)
            .output()
            .map(|o| o.status.success() && !o.stdout.is_empty())
            .unwrap_or(false);
    if user_ssh_cmd {
        return out;
    }
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let mut ssh = String::from("ssh -o BatchMode=yes -o ConnectTimeout=20");
    if let Some(s) = sock.as_ref() {
        ssh.push_str(&format!(" -o IdentityAgent={}", q(s)));
    }
    if let Some(k) = read_selected_key_path(cwd).filter(|k| Path::new(k).exists()) {
        ssh.push_str(&format!(" -i {}", q(&k)));
    }
    out.push(("GIT_SSH_COMMAND".into(), ssh));
    out
}

/// Before a network operation: if the key chosen for the workspace is
/// encrypted and not in the agent, try to silently reload it from the macOS
/// Keychain (where `--apple-use-keychain` saved it at the first passphrase).
/// This is the key's "memory" between one push and the next and across restarts.
pub fn ensure_selected_key_loaded(cwd: &str) {
    if !is_mac() {
        return;
    }
    let Some(key) = read_selected_key_path(cwd).filter(|k| Path::new(k).exists()) else {
        return;
    };
    let env = shared_agent_env();
    if agent_has_key(&env, &key) || !is_key_encrypted(&key) {
        return;
    }
    let _ = ssh_add_silent_from_keychain(&env, &key);
}

/// Does the agent already have the key? Fingerprint comparison (`ssh-keygen -lf`).
fn agent_has_key(env: &GitSetupAgentEnv, key_path: &str) -> bool {
    let pub_path = format!("{key_path}.pub");
    let fp = crate::commands::util_cmd::cmd("ssh-keygen")
        .args(["-lf", &pub_path])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .split_whitespace()
                .nth(1)
                .map(|s| s.to_string())
        });
    let Some(fp) = fp else { return false };
    list_agent_keys(env).iter().any(|l| l.contains(&fp))
}

// =====================================================================
//  Types (1:1 mirror of the TS interfaces)
// =====================================================================

/// `GitRemoteInfo`.
#[derive(Clone, Debug, Serialize)]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
    /// `'ssh' | 'https' | 'unknown'`.
    #[serde(rename = "type")]
    pub kind: String,
    pub host: Option<String>,
    pub owner: Option<String>,
    pub repo: Option<String>,
}

/// `SshKeyInfo`.
#[derive(Clone, Debug, Serialize)]
pub struct SshKeyInfo {
    pub name: String,
    #[serde(rename = "privatePath")]
    pub private_path: String,
    #[serde(rename = "publicPath")]
    pub public_path: String,
    #[serde(rename = "publicKey")]
    pub public_key: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// `GitSetupIssue`.
#[derive(Clone, Debug, Serialize)]
pub struct GitSetupIssue {
    pub id: String,
    /// `'error' | 'warning' | 'info'`.
    pub severity: String,
    pub message: String,
    /// `'remote' | 'keys' | 'agent' | 'identity' | 'test'`.
    pub step: String,
}

/// `{ name, email }`.
#[derive(Clone, Debug, Serialize)]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// `classifiedError` — `{ kind, message }`.
#[derive(Clone, Debug, Serialize)]
pub struct ClassifiedError {
    /// `'permission-denied' | 'unknown-host' | 'auth-failed' | 'not-a-repo' | 'no-remote' | 'other'`.
    pub kind: String,
    pub message: String,
}

/// `GitSetupDiagnosis`.
#[derive(Clone, Debug, Serialize)]
pub struct GitSetupDiagnosis {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub remote: Option<GitRemoteInfo>,
    pub remotes: Vec<GitRemoteInfo>,
    #[serde(rename = "sshKeys")]
    pub ssh_keys: Vec<SshKeyInfo>,
    #[serde(rename = "sshDirExists")]
    pub ssh_dir_exists: bool,
    #[serde(rename = "agentRunning")]
    pub agent_running: bool,
    #[serde(rename = "agentLoadedKeys")]
    pub agent_loaded_keys: Vec<String>,
    pub identity: GitIdentity,
    #[serde(rename = "selectedKeyPath")]
    pub selected_key_path: Option<String>,
    pub issues: Vec<GitSetupIssue>,
    #[serde(rename = "classifiedError", skip_serializing_if = "Option::is_none")]
    pub classified_error: Option<ClassifiedError>,
}

// ── Command return DTOs (mirror of the JS `{ ok, ... }`) ────────────────

#[derive(Serialize)]
pub struct ListKeysResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keys: Option<Vec<SshKeyInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct GenerateKeyResult {
    pub ok: bool,
    #[serde(rename = "privatePath", skip_serializing_if = "Option::is_none")]
    pub private_path: Option<String>,
    #[serde(rename = "publicPath", skip_serializing_if = "Option::is_none")]
    pub public_path: Option<String>,
    #[serde(rename = "publicKey", skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SaveKeyResult {
    pub ok: bool,
    #[serde(rename = "privatePath", skip_serializing_if = "Option::is_none")]
    pub private_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct StartAgentResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sock: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct AddKeyResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(rename = "needsPassphrase", skip_serializing_if = "Option::is_none")]
    pub needs_passphrase: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ListAgentKeysResult {
    pub ok: bool,
    pub keys: Vec<String>,
    pub running: bool,
}

#[derive(Serialize)]
pub struct SetIdentityResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<GitIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ConvertRemoteResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unchanged: Option<bool>,
    #[serde(rename = "previousUrl", skip_serializing_if = "Option::is_none")]
    pub previous_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct TestConnectionResult {
    pub ok: bool,
    pub output: String,
    pub code: i32,
}

#[derive(Serialize)]
pub struct SetPrefResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// =====================================================================
//  shell utils (self-contained)
// =====================================================================

fn is_windows() -> bool {
    cfg!(windows)
}

/// `getShell()` — powershell.exe on Windows, $SHELL || /bin/zsh elsewhere.
fn get_shell() -> String {
    if is_windows() {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

/// `getRunArgs(cmd)` — args to run a single command via the shell.
fn get_run_args(cmd: &str) -> Vec<String> {
    if is_windows() {
        crate::commands::util_cmd::powershell_args(cmd)
    } else {
        vec!["-l".to_string(), "-c".to_string(), cmd.to_string()]
    }
}

/// `homeDir()`.
fn home_dir() -> PathBuf {
    #[allow(deprecated)]
    std::env::home_dir().unwrap_or_default()
}

/// `defaultExtraPaths()`.
fn default_extra_paths() -> Vec<String> {
    let home = home_dir().to_string_lossy().to_string();
    if is_windows() {
        vec![
            format!("{home}\\AppData\\Local\\Programs"),
            format!("{home}\\AppData\\Roaming\\npm"),
            format!("{home}\\.local\\bin"),
        ]
    } else {
        vec![
            format!("{home}/.local/bin"),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ]
    }
}

/// `buildPath(extraDirs)` — join with the platform separator + current PATH.
fn build_path(extra_dirs: &[String]) -> String {
    let sep = if is_windows() { ";" } else { ":" };
    let fallback = if is_windows() { "" } else { "/usr/bin:/bin" };
    let current = std::env::var("PATH").unwrap_or_else(|_| fallback.to_string());
    format!("{}{}{}", extra_dirs.join(sep), sep, current)
}

fn is_mac() -> bool {
    cfg!(target_os = "macos")
}

// =====================================================================
//  Per-workspace preference store (~/.promptops/git-setup.json)
// =====================================================================

fn prefs_path() -> PathBuf {
    let dir = home_dir().join(".promptops");
    let _ = fs::create_dir_all(&dir);
    dir.join("git-setup.json")
}

/// `readPrefs()` — `{ "<cwd>": { "selectedKeyPath"?: string } }`.
/// We use `serde_json::Value` to preserve the on-disk shape 1:1 even for
/// unknown keys/fields, exactly like the TS `JSON.parse`.
fn read_prefs() -> serde_json::Map<String, serde_json::Value> {
    match fs::read_to_string(prefs_path()) {
        Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(serde_json::Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        },
        Err(_) => serde_json::Map::new(),
    }
}

/// `writePrefs(data)` — pretty-print with 2 spaces (mirror of `JSON.stringify(.,null,2)`).
fn write_prefs(data: &serde_json::Map<String, serde_json::Value>) {
    if let Ok(s) = serde_json::to_string_pretty(data) {
        let _ = fs::write(prefs_path(), s);
    }
}

/// `prefsKey(cwd)` — canonicalizes (realpath + strip trailing sep).
fn prefs_key(cwd: &str) -> String {
    // `fs.realpathSync` → canonicalize; on failure, use the raw path.
    let mut resolved = match fs::canonicalize(cwd) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => cwd.to_string(),
    };
    let sep = MAIN_SEPARATOR;
    if resolved.chars().count() > 1 && resolved.ends_with(sep) {
        resolved.pop();
    }
    resolved
}

/// `readSelectedKeyPath(cwd)` — canonical, with fallback to the raw key.
fn read_selected_key_path(cwd: &str) -> Option<String> {
    let prefs = read_prefs();
    let canonical = prefs_key(cwd);
    let from = |k: &str| -> Option<String> {
        prefs
            .get(k)
            .and_then(|v| v.get("selectedKeyPath"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    };
    from(&canonical).or_else(|| from(cwd))
}

// =====================================================================
//  Domain helpers
// =====================================================================

fn ssh_dir() -> PathBuf {
    home_dir().join(".ssh")
}

/// `parseRemote(line)` — `"origin\tgit@github.com:user/repo.git (fetch)"`.
fn parse_remote(line: &str) -> Option<GitRemoteInfo> {
    // /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/
    let trimmed = line.trim_end();
    if !(trimmed.ends_with("(fetch)") || trimmed.ends_with("(push)")) {
        return None;
    }
    // Tokens: name, url, "(fetch)"/"(push)" — split on whitespace.
    let mut parts = trimmed.split_whitespace();
    let name = parts.next()?;
    let url = parts.next()?;
    let paren = parts.next()?;
    // Must be exactly 3 tokens and the last one "(fetch)"/"(push)".
    if parts.next().is_some() {
        return None;
    }
    if paren != "(fetch)" && paren != "(push)" {
        return None;
    }
    if name.is_empty() || url.is_empty() {
        return None;
    }
    Some(to_remote_info(name, url))
}

/// Strip of the optional `.git` suffix from the repo path.
fn strip_git_suffix(s: &str) -> &str {
    s.strip_suffix(".git").unwrap_or(s)
}

/// `toRemoteInfo(name, url)`.
fn to_remote_info(name: &str, url: &str) -> GitRemoteInfo {
    let mut kind = "unknown".to_string();
    let mut host: Option<String> = None;
    let mut owner: Option<String> = None;
    let mut repo: Option<String> = None;

    // SSH scp-like: /^([^@]+)@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/
    if let Some(m) = match_scp_ssh(url) {
        kind = "ssh".to_string();
        host = Some(m.0);
        owner = Some(m.1);
        repo = Some(m.2);
    } else if url.starts_with("ssh://") {
        // /^ssh:\/\/(?:([^@]+)@)?([^/]+)\/(.+?)(?:\.git)?$/
        if let Some((h, rest)) = parse_ssh_url(url) {
            kind = "ssh".to_string();
            host = Some(h);
            let rest_parts: Vec<&str> = rest.split('/').collect();
            if rest_parts.len() >= 2 {
                owner = Some(rest_parts[0].to_string());
                repo = Some(rest_parts[1..].join("/"));
            }
        }
    } else if url.starts_with("http://") || url.starts_with("https://") {
        // /^https?:\/\/(?:[^@]*@)?([^/]+)\/(.+?)(?:\.git)?$/
        if let Some((h, path_part)) = parse_http_url(url) {
            kind = "https".to_string();
            host = Some(h);
            let parts: Vec<&str> = path_part.split('/').collect();
            if parts.len() >= 2 {
                owner = Some(parts[0].to_string());
                repo = Some(parts[1..].join("/"));
            }
        }
    }

    GitRemoteInfo {
        name: name.to_string(),
        url: url.to_string(),
        kind,
        host,
        owner,
        repo,
    }
}

/// /^([^@]+)@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/ → (host, owner, repo).
fn match_scp_ssh(url: &str) -> Option<(String, String, String)> {
    let at = url.find('@')?;
    let user = &url[..at];
    if user.is_empty() || user.contains('@') {
        return None;
    }
    let after_at = &url[at + 1..];
    let colon = after_at.find(':')?;
    let host = &after_at[..colon];
    if host.is_empty() || host.contains(':') {
        return None;
    }
    let after_colon = &after_at[colon + 1..];
    let slash = after_colon.find('/')?;
    let owner = &after_colon[..slash];
    if owner.is_empty() || owner.contains('/') {
        return None;
    }
    let rest = &after_colon[slash + 1..];
    if rest.is_empty() {
        return None;
    }
    Some((
        host.to_string(),
        owner.to_string(),
        strip_git_suffix(rest).to_string(),
    ))
}

/// /^ssh:\/\/(?:([^@]+)@)?([^/]+)\/(.+?)(?:\.git)?$/ → (host, rest-after-host).
fn parse_ssh_url(url: &str) -> Option<(String, String)> {
    let body = url.strip_prefix("ssh://")?;
    // host part: up to the first '/', accounting for an optional user@.
    let slash = body.find('/')?;
    let authority = &body[..slash];
    let rest = &body[slash + 1..];
    if rest.is_empty() {
        return None;
    }
    // authority = (user@)?host
    let host = match authority.find('@') {
        Some(i) => &authority[i + 1..],
        None => authority,
    };
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), strip_git_suffix(rest).to_string()))
}

/// /^https?:\/\/(?:[^@]*@)?([^/]+)\/(.+?)(?:\.git)?$/ → (host, path-after-host).
fn parse_http_url(url: &str) -> Option<(String, String)> {
    let body = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let slash = body.find('/')?;
    let authority = &body[..slash];
    let rest = &body[slash + 1..];
    if rest.is_empty() {
        return None;
    }
    // authority = (userinfo@)?host
    let host = match authority.rfind('@') {
        Some(i) => &authority[i + 1..],
        None => authority,
    };
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), strip_git_suffix(rest).to_string()))
}

/// `getRemotes(cwd)` — `git remote -v`, dedup by name, `[]` on error.
fn get_remotes(cwd: &str) -> Vec<GitRemoteInfo> {
    let output = crate::commands::util_cmd::cmd("git")
        .args(["remote", "-v"])
        .current_dir(cwd)
        .output();
    let raw = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return Vec::new(),
    };
    if raw.is_empty() {
        return Vec::new();
    }
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<GitRemoteInfo> = Vec::new();
    for line in raw.split('\n') {
        if let Some(info) = parse_remote(line) {
            if !seen.contains(&info.name) {
                seen.push(info.name.clone());
                out.push(info);
            }
        }
    }
    out
}

/// `listSshKeys()` — scans ~/.ssh for `<name>` + `<name>.pub` pairs.
fn list_ssh_keys() -> Vec<SshKeyInfo> {
    let dir = ssh_dir();
    if !dir.exists() {
        return Vec::new();
    }
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<SshKeyInfo> = Vec::new();
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();
        if !name.ends_with(".pub") {
            continue;
        }
        let pub_path = dir.join(&name);
        // `entry.replace(/\.pub$/, '')` — removes EXACTLY one `.pub` suffix.
        let priv_name = name.strip_suffix(".pub").unwrap_or(&name).to_string();
        let priv_path = dir.join(&priv_name);
        if !priv_path.exists() {
            continue;
        }
        let public_key = match fs::read_to_string(&pub_path) {
            Ok(s) => s.trim().to_string(),
            Err(_) => continue,
        };
        // /^(ssh-\w+|ecdsa-\S+)/ → type, then `.replace(/^ssh-/, '')` (a single prefix).
        let kind = match key_type_from_pub(&public_key) {
            Some(t) => t.strip_prefix("ssh-").unwrap_or(&t).to_string(),
            None => "unknown".to_string(),
        };
        out.push(SshKeyInfo {
            name: priv_name,
            private_path: priv_path.to_string_lossy().to_string(),
            public_path: pub_path.to_string_lossy().to_string(),
            public_key,
            kind,
        });
    }
    out
}

/// /^(ssh-\w+|ecdsa-\S+)/ — first matching token.
fn key_type_from_pub(public_key: &str) -> Option<String> {
    let bytes = public_key.as_bytes();
    if public_key.starts_with("ssh-") {
        // ssh- + \w+ (alphanumeric or '_')
        let mut end = 4;
        while end < bytes.len() {
            let c = bytes[end];
            if c.is_ascii_alphanumeric() || c == b'_' {
                end += 1;
            } else {
                break;
            }
        }
        if end > 4 {
            return Some(public_key[..end].to_string());
        }
        return None;
    }
    if public_key.starts_with("ecdsa-") {
        // ecdsa- + \S+ (non-whitespace)
        let mut end = 6;
        while end < bytes.len() && !bytes[end].is_ascii_whitespace() {
            end += 1;
        }
        if end > 6 {
            return Some(public_key[..end].to_string());
        }
        return None;
    }
    None
}

/// `getIdentity(cwd)` — `git config --get user.name|user.email`.
fn get_identity(cwd: &str) -> GitIdentity {
    let read = |key: &str| -> Option<String> {
        let out = crate::commands::util_cmd::cmd("git")
            .args(["config", "--get", key])
            .current_dir(cwd)
            .output();
        match out {
            Ok(o) if o.status.success() => {
                let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if v.is_empty() {
                    None
                } else {
                    Some(v)
                }
            }
            _ => None,
        }
    };
    GitIdentity {
        name: read("user.name"),
        email: read("user.email"),
    }
}

/// Result of a login-shell command.
struct ShellRun {
    code: i32,
    stdout: String,
    stderr: String,
}

/// `runLoginShell(cmd, timeoutMs)` — runs `cmd` via the user's login shell,
/// so it inherits SSH_AUTH_SOCK / PATH.
fn run_login_shell(env: &GitSetupAgentEnv, cmd: &str, timeout_ms: u64) -> ShellRun {
    run_login_shell_with(env, cmd, &[], timeout_ms)
}

/// Like `run_login_shell`, with values the script references as `"$NAME"`
/// (`$env:NAME` on Windows) instead of having them pasted into its text: a key
/// path or host from the repository config can never become shell code.
fn run_login_shell_with(
    env: &GitSetupAgentEnv,
    cmd: &str,
    vars: &[(&str, &str)],
    _timeout_ms: u64,
) -> ShellRun {
    let shell = get_shell();
    let args = get_run_args(cmd);
    let env_path = build_path(&default_extra_paths());

    let mut command = crate::commands::util_cmd::cmd(&shell);
    command.args(&args).env("PATH", env_path);
    for (k, v) in vars {
        command.env(k, v);
    }
    // Apply the agent env overlay (SSH_AUTH_SOCK / SSH_AGENT_PID).
    for (k, v) in env.snapshot() {
        command.env(k, v);
    }

    match command.output() {
        Ok(output) => ShellRun {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Err(e) => ShellRun {
            code: -1,
            stdout: String::new(),
            stderr: e.to_string(),
        },
    }
}

/// `isAgentRunning()`.
fn is_agent_running(env: &GitSetupAgentEnv) -> bool {
    let res = run_login_shell(env, "ssh-add -l", 5000);
    // 0 = keys present, 1 = no keys but agent OK, 2 = agent NOT running.
    if res.code == 2 {
        return false;
    }
    if env.get("SSH_AUTH_SOCK").is_some() {
        return true;
    }
    res.code == 0 || res.code == 1
}

/// `listAgentKeys()`.
fn list_agent_keys(env: &GitSetupAgentEnv) -> Vec<String> {
    let res = run_login_shell(env, "ssh-add -l", 5000);
    if res.code != 0 {
        return Vec::new();
    }
    res.stdout
        .split('\n')
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// `isKeyEncrypted(keyPath)` — `ssh-keygen -y -P "" -f <path>`; exit ≠0 ⇒ encrypted.
fn is_key_encrypted(key_path: &str) -> bool {
    match crate::commands::util_cmd::cmd("ssh-keygen")
        .args(["-y", "-P", "", "-f", key_path])
        .output()
    {
        Ok(o) => !o.status.success(),
        Err(_) => true,
    }
}

/// Result of an `ssh-add` with passphrase / from keychain.
struct SshAddOutcome {
    ok: bool,
    output: Option<String>,
    error: Option<String>,
}

/// `sshAddWithPassphrase` — ssh-add with passphrase via a temp SSH_ASKPASS helper.
fn ssh_add_with_passphrase(
    env: &GitSetupAgentEnv,
    key_path: &str,
    passphrase: &str,
) -> SshAddOutcome {
    let tmp_dir = match make_temp_dir("promptops-askpass-") {
        Ok(d) => d,
        Err(e) => {
            return SshAddOutcome {
                ok: false,
                output: None,
                error: Some(e),
            }
        }
    };
    let script_path = tmp_dir.join("askpass.sh");
    let result: Result<SshAddOutcome, String> = (|| {
        write_script(
            &script_path,
            "#!/bin/sh\nprintf \"%s\\n\" \"$PROMPTOPS_PP\"\n",
        )?;

        let path = build_path(&default_extra_paths());
        let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string());
        let script_str = script_path.to_string_lossy().to_string();

        let overlay = env.snapshot();
        let try_run = |args: &[&str]| -> Result<std::process::Output, String> {
            crate::commands::util_cmd::cmd("ssh-add")
                .args(args)
                .envs(overlay.iter())
                .env("PATH", &path)
                .env("SSH_ASKPASS", &script_str)
                .env("SSH_ASKPASS_REQUIRE", "force")
                .env("DISPLAY", &display)
                .env("PROMPTOPS_PP", passphrase)
                .stdin(std::process::Stdio::null())
                .output()
                .map_err(|e| e.to_string())
        };

        let first_args: Vec<&str> = if is_mac() {
            vec!["--apple-use-keychain", key_path]
        } else {
            vec![key_path]
        };
        let mut r = try_run(&first_args)?;
        if !r.status.success() && is_mac() {
            r = try_run(&[key_path])?;
        }

        if r.status.success() {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&r.stdout),
                String::from_utf8_lossy(&r.stderr)
            );
            return Ok(SshAddOutcome {
                ok: true,
                output: Some(combined.trim().to_string()),
                error: None,
            });
        }

        let err_raw = format!(
            "{}{}",
            String::from_utf8_lossy(&r.stderr),
            String::from_utf8_lossy(&r.stdout)
        );
        let err_raw = err_raw.trim().to_string();
        let lower = err_raw.to_lowercase();
        let wrong = lower.contains("incorrect passphrase")
            || lower.contains("bad passphrase")
            || lower.contains("wrong passphrase");
        let error = if wrong {
            "Incorrect passphrase".to_string()
        } else if !err_raw.is_empty() {
            err_raw
        } else {
            "ssh-add failed".to_string()
        };
        Ok(SshAddOutcome {
            ok: false,
            output: None,
            error: Some(error),
        })
    })();

    cleanup_temp(&script_path, &tmp_dir);

    match result {
        Ok(o) => o,
        Err(e) => SshAddOutcome {
            ok: false,
            output: None,
            error: Some(e),
        },
    }
}

/// `sshAddSilentFromKeychain` — macOS: tries to add using the passphrase
/// already in the Keychain; every prompt is neutralized with a no-op askpass.
fn ssh_add_silent_from_keychain(env: &GitSetupAgentEnv, key_path: &str) -> SshAddOutcome {
    if !is_mac() {
        return SshAddOutcome {
            ok: false,
            output: None,
            error: Some("Keychain auto-load is macOS-only".to_string()),
        };
    }
    let tmp_dir = match make_temp_dir("promptops-askpass-noop-") {
        Ok(d) => d,
        Err(e) => {
            return SshAddOutcome {
                ok: false,
                output: None,
                error: Some(e),
            }
        }
    };
    let script_path = tmp_dir.join("askpass-noop.sh");
    let result: Result<SshAddOutcome, String> = (|| {
        write_script(&script_path, "#!/bin/sh\nexit 1\n")?;

        let path = build_path(&default_extra_paths());
        let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string());
        let script_str = script_path.to_string_lossy().to_string();

        let r = crate::commands::util_cmd::cmd("ssh-add")
            .args(["--apple-use-keychain", key_path])
            .envs(env.snapshot().iter())
            .env("PATH", &path)
            .env("SSH_ASKPASS", &script_str)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", &display)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| e.to_string())?;

        if r.status.success() {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&r.stdout),
                String::from_utf8_lossy(&r.stderr)
            );
            return Ok(SshAddOutcome {
                ok: true,
                output: Some(combined.trim().to_string()),
                error: None,
            });
        }
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&r.stderr),
            String::from_utf8_lossy(&r.stdout)
        );
        let combined = combined.trim().to_string();
        Ok(SshAddOutcome {
            ok: false,
            output: None,
            error: Some(if combined.is_empty() {
                "Not in Keychain".to_string()
            } else {
                combined
            }),
        })
    })();

    cleanup_temp(&script_path, &tmp_dir);

    match result {
        Ok(o) => o,
        Err(e) => SshAddOutcome {
            ok: false,
            output: None,
            error: Some(e),
        },
    }
}

/// Runs `ssh-keygen <args>` for a NEW key. The passphrase never goes on the
/// command line (`-N <passphrase>` is visible to every local user in `ps`):
/// on unix ssh-keygen asks for it through an SSH_ASKPASS helper that reads it
/// from the environment, as `ssh_add_with_passphrase` does. ssh-keygen falls
/// back to an UNENCRYPTED key when the helper fails, so the result is checked
/// and the key files are deleted if they came out without a passphrase.
/// Windows keeps `-N` (no POSIX helper to run there).
fn run_ssh_keygen(
    args: &[String],
    passphrase: &str,
    target: &Path,
) -> Result<std::process::Output, String> {
    let mut command = crate::commands::util_cmd::cmd("ssh-keygen");
    command.args(args).stdin(std::process::Stdio::null());
    if passphrase.is_empty() || !cfg!(unix) {
        return command
            .args(["-N", passphrase])
            .output()
            .map_err(|e| e.to_string());
    }
    let tmp = crate::commands::util_cmd::PrivateTempDir::new("promptops-keygen")?;
    let script = tmp.path().join("askpass.sh");
    write_script(&script, "#!/bin/sh\nprintf \"%s\\n\" \"$PROMPTOPS_PP\"\n")?;
    let output = command
        .env("SSH_ASKPASS", &script)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env(
            "DISPLAY",
            std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string()),
        )
        .env("PROMPTOPS_PP", passphrase)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() && !is_key_encrypted(&target.to_string_lossy()) {
        let _ = fs::remove_file(target);
        let _ = fs::remove_file(format!("{}.pub", target.to_string_lossy()));
        return Err("ssh-keygen did not apply the passphrase: no key was created".into());
    }
    Ok(output)
}

/// Creates a unique temp dir under `std::env::temp_dir()`, mirror of `mkdtemp`.
fn make_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let base = std::env::temp_dir();
    let unique = format!("{}{}", prefix, uuid::Uuid::new_v4().simple());
    let dir = base.join(unique);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Writes the askpass script with mode 0700.
fn write_script(path: &Path, contents: &str) -> Result<(), String> {
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(contents.as_bytes())
        .map_err(|e| e.to_string())?;
    drop(file);
    set_mode_0700(path);
    Ok(())
}

#[cfg(unix)]
fn set_mode_0700(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn set_mode_0700(_path: &Path) {}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) {}

fn cleanup_temp(script_path: &Path, tmp_dir: &Path) {
    let _ = fs::remove_file(script_path);
    let _ = fs::remove_dir(tmp_dir);
}

/// `classifyPushError(msg)`.
fn classify_push_error(msg: &str) -> Option<ClassifiedError> {
    let m = msg.to_lowercase();
    let mk = |kind: &str| {
        Some(ClassifiedError {
            kind: kind.to_string(),
            message: msg.to_string(),
        })
    };
    if m.contains("permission denied (publickey)") {
        return mk("permission-denied");
    }
    if m.contains("host key verification failed") || m.contains("unknown host") {
        return mk("unknown-host");
    }
    if m.contains("authentication failed") || m.contains("could not read username") {
        return mk("auth-failed");
    }
    if m.contains("not a git repository") {
        return mk("not-a-repo");
    }
    if m.contains("no such remote") || m.contains("no configured push destination") {
        return mk("no-remote");
    }
    if msg.is_empty() {
        return None;
    }
    mk("other")
}

/// `convertHttpsToSsh(url)` — /^https?:\/\/(?:[^@]*@)?([^/]+)\/(.+?)(?:\.git)?\/?$/.
fn convert_https_to_ssh(url: &str) -> Option<String> {
    let body = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let slash = body.find('/')?;
    let authority = &body[..slash];
    let mut rest = &body[slash + 1..];
    if rest.is_empty() {
        return None;
    }
    // Optional trailing slash.
    rest = rest.strip_suffix('/').unwrap_or(rest);
    let repo_path = strip_git_suffix(rest);
    if repo_path.is_empty() {
        return None;
    }
    let host = match authority.rfind('@') {
        Some(i) => &authority[i + 1..],
        None => authority,
    };
    if host.is_empty() {
        return None;
    }
    Some(format!("git@{host}:{repo_path}.git"))
}

/// `"$NAME"` in a POSIX shell, `$env:NAME` in PowerShell.
fn shell_var_ref(name: &str) -> String {
    if is_windows() {
        format!("$env:{name}")
    } else {
        format!("\"${name}\"")
    }
}

/// `host`, `host:port` or `[v6]:port` → (host, port). Only characters a host
/// name or address can contain; never a leading `-` (ssh option).
fn split_host_port(raw: &str) -> Option<(String, Option<String>)> {
    let (host, port) = if let Some(rest) = raw.strip_prefix('[') {
        let end = rest.find(']')?;
        let host = &rest[..end];
        let port = rest[end + 1..].strip_prefix(':');
        (host, port)
    } else if raw.matches(':').count() == 1 {
        let (h, p) = raw.split_once(':')?;
        (h, Some(p))
    } else {
        (raw, None)
    };
    let host_ok = !host.is_empty()
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'));
    let port_ok =
        port.is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.chars().all(|c| c.is_ascii_digit()));
    if host_ok && port_ok {
        Some((host.to_string(), port.map(str::to_string)))
    } else {
        None
    }
}

/// Filename validation for save-key — /^[A-Za-z0-9._-]+$/.
fn is_valid_filename(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

// =====================================================================
//  Tauri commands
// =====================================================================

/// git-setup:diagnose
#[tauri::command]
pub async fn git_setup_diagnose(
    env: tauri::State<'_, Arc<GitSetupAgentEnv>>,
    cwd: Option<String>,
    last_error: Option<String>,
) -> Result<GitSetupDiagnosis, String> {
    let mut diag = GitSetupDiagnosis {
        ok: true,
        error: None,
        remote: None,
        remotes: Vec::new(),
        ssh_keys: Vec::new(),
        ssh_dir_exists: ssh_dir().exists(),
        agent_running: false,
        agent_loaded_keys: Vec::new(),
        identity: GitIdentity {
            name: None,
            email: None,
        },
        selected_key_path: None,
        issues: Vec::new(),
        classified_error: None,
    };

    let cwd = match cwd {
        Some(c) if !c.is_empty() => c,
        _ => {
            diag.ok = false;
            diag.error = Some("No workspace path provided".to_string());
            return Ok(diag);
        }
    };

    // Remotes (getRemotes never throws: on error it returns []).
    let remotes = get_remotes(&cwd);
    diag.remotes = remotes.clone();
    diag.remote = remotes
        .iter()
        .find(|r| r.name == "origin")
        .cloned()
        .or_else(|| remotes.first().cloned());

    match &diag.remote {
        None => diag.issues.push(GitSetupIssue {
            id: "no-remote".to_string(),
            severity: "error".to_string(),
            step: "remote".to_string(),
            message: "No git remote configured. Add an origin to push.".to_string(),
        }),
        Some(r) if r.kind == "https" => diag.issues.push(GitSetupIssue {
            id: "remote-https".to_string(),
            severity: "warning".to_string(),
            step: "remote".to_string(),
            message: "Remote uses HTTPS. Switch to SSH for key-based authentication.".to_string(),
        }),
        _ => {}
    }

    // SSH keys.
    diag.ssh_keys = list_ssh_keys();
    if diag.ssh_dir_exists && diag.ssh_keys.is_empty() {
        diag.issues.push(GitSetupIssue {
            id: "no-keys".to_string(),
            severity: "warning".to_string(),
            step: "keys".to_string(),
            message: "No SSH keys found in ~/.ssh. Generate one or paste an existing private key."
                .to_string(),
        });
    }
    if !diag.ssh_dir_exists {
        diag.issues.push(GitSetupIssue {
            id: "no-ssh-dir".to_string(),
            severity: "warning".to_string(),
            step: "keys".to_string(),
            message: "~/.ssh does not exist. It will be created when you generate/save a key."
                .to_string(),
        });
    }

    // Agent.
    diag.agent_running = is_agent_running(env.inner());
    if diag.agent_running {
        diag.agent_loaded_keys = list_agent_keys(env.inner());
        if diag.agent_loaded_keys.is_empty() {
            diag.issues.push(GitSetupIssue {
                id: "no-agent-keys".to_string(),
                severity: "warning".to_string(),
                step: "agent".to_string(),
                message: "ssh-agent is running but no keys are loaded.".to_string(),
            });
        }
    } else {
        diag.issues.push(GitSetupIssue {
            id: "agent-down".to_string(),
            severity: "warning".to_string(),
            step: "agent".to_string(),
            message: "ssh-agent is not running. Start it and add a key.".to_string(),
        });
    }

    // Identity.
    diag.identity = get_identity(&cwd);
    if diag.identity.name.is_none() || diag.identity.email.is_none() {
        diag.issues.push(GitSetupIssue {
            id: "no-identity".to_string(),
            severity: "error".to_string(),
            step: "identity".to_string(),
            message: "Git user.name or user.email is not set.".to_string(),
        });
    }

    // Selected key preference.
    diag.selected_key_path = read_selected_key_path(&cwd);

    // Classify error.
    if let Some(le) = last_error {
        diag.classified_error = classify_push_error(&le);
    }

    Ok(diag)
}

/// git-setup:list-keys
#[tauri::command]
pub async fn git_setup_list_keys() -> Result<ListKeysResult, String> {
    Ok(ListKeysResult {
        ok: true,
        keys: Some(list_ssh_keys()),
        error: None,
    })
}

/// git-setup:generate-key
///
/// NB: the `type` field of the JS payload is a Rust keyword; we receive it as
/// the raw identifier `r#type` — Tauri still maps it to the `type` key on the JS side.
#[tauri::command]
pub async fn git_setup_generate_key(
    email: Option<String>,
    filename: Option<String>,
    r#type: Option<String>,
    passphrase: Option<String>,
) -> Result<GenerateKeyResult, String> {
    let err = |msg: String| {
        Ok(GenerateKeyResult {
            ok: false,
            private_path: None,
            public_path: None,
            public_key: None,
            error: Some(msg),
        })
    };

    let dir = ssh_dir();
    if !dir.exists() {
        if let Err(e) = fs::create_dir_all(&dir) {
            return err(e.to_string());
        }
        set_mode(&dir, 0o700);
    }

    let key_type = r#type.as_deref();
    // `filename || (type === 'rsa' ? 'id_rsa' : 'id_ed25519')` — `||` treats
    // the empty string as falsy too, so None *or* "" falls back to the default.
    let name = match filename {
        Some(f) if !f.is_empty() => f,
        _ => {
            if key_type == Some("rsa") {
                "id_rsa".to_string()
            } else {
                "id_ed25519".to_string()
            }
        }
    };
    // Same rule as save-key: a plain file name inside ~/.ssh (`../x` or an
    // absolute path used to put the new key anywhere).
    if !is_valid_filename(&name) || name.starts_with('.') {
        return err("Invalid filename: use letters, digits, '.', '_' or '-'".to_string());
    }
    if !matches!(
        key_type.unwrap_or("ed25519"),
        "" | "ed25519" | "rsa" | "ecdsa"
    ) {
        return err("Unsupported key type".to_string());
    }
    let target = dir.join(&name);
    let target_str = target.to_string_lossy().to_string();
    if target.exists() {
        return err(format!("Key already exists: {}", target_str));
    }

    let email_val = match &email {
        Some(e) if !e.is_empty() => e.clone(),
        _ => "promptops@localhost".to_string(),
    };
    let type_val = match key_type {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => "ed25519".to_string(),
    };
    let pass_val = passphrase.unwrap_or_default();

    let mut args: Vec<String> = vec![
        "-q".to_string(),
        "-t".to_string(),
        type_val,
        "-C".to_string(),
        email_val,
        "-f".to_string(),
        target_str.clone(),
    ];
    if key_type == Some("rsa") {
        args.push("-b".to_string());
        args.push("4096".to_string());
    }

    let output = run_ssh_keygen(&args, &pass_val, &target);
    match output {
        Ok(o) if o.status.success() => {
            set_mode(&target, 0o600);
            let pub_path = format!("{}.pub", target_str);
            set_mode(Path::new(&pub_path), 0o644);
            let pub_key = match fs::read_to_string(&pub_path) {
                Ok(s) => s.trim().to_string(),
                Err(e) => return err(e.to_string()),
            };
            Ok(GenerateKeyResult {
                ok: true,
                private_path: Some(target_str),
                public_path: Some(pub_path),
                public_key: Some(pub_key),
                error: None,
            })
        }
        Ok(o) => {
            // err.stderr?.toString?.() || err.message || 'Keygen failed'
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            err(if stderr.trim().is_empty() {
                "Keygen failed".to_string()
            } else {
                stderr
            })
        }
        Err(e) => err(e.to_string()),
    }
}

/// git-setup:save-key
///
/// snake_case params → Tauri exposes them on the JS side as `filename`, `privateKey`,
/// `publicKey` (auto camelCase), as in the TS payload.
#[tauri::command]
pub async fn git_setup_save_key(
    filename: Option<String>,
    private_key: Option<String>,
    public_key: Option<String>,
) -> Result<SaveKeyResult, String> {
    let err = |msg: String| {
        Ok(SaveKeyResult {
            ok: false,
            private_path: None,
            error: Some(msg),
        })
    };

    let filename = filename.unwrap_or_default();
    let private_key = private_key.unwrap_or_default();
    if filename.is_empty() || private_key.is_empty() {
        return err("filename and privateKey are required".to_string());
    }
    if !is_valid_filename(&filename) || filename.starts_with('.') {
        return err("Invalid filename".to_string());
    }

    let dir = ssh_dir();
    if !dir.exists() {
        if let Err(e) = fs::create_dir_all(&dir) {
            return err(e.to_string());
        }
        set_mode(&dir, 0o700);
    }
    let target = dir.join(&filename);
    let target_str = target.to_string_lossy().to_string();
    if target.exists() {
        return err(format!("Key already exists: {}", target_str));
    }

    let normalized = if private_key.ends_with('\n') {
        private_key
    } else {
        format!("{private_key}\n")
    };
    if let Err(e) = fs::write(&target, normalized.as_bytes()) {
        return err(e.to_string());
    }
    set_mode(&target, 0o600);

    if let Some(pubk) = public_key {
        let pub_path = format!("{}.pub", target_str);
        if let Err(e) = fs::write(&pub_path, format!("{}\n", pubk.trim())) {
            return err(e.to_string());
        }
        set_mode(Path::new(&pub_path), 0o644);
    }

    Ok(SaveKeyResult {
        ok: true,
        private_path: Some(target_str),
        error: None,
    })
}

/// git-setup:start-agent
#[tauri::command]
pub async fn git_setup_start_agent(
    env: tauri::State<'_, Arc<GitSetupAgentEnv>>,
) -> Result<StartAgentResult, String> {
    let env: &GitSetupAgentEnv = env.inner();
    let res = run_login_shell(env, "ssh-agent -s", 5000);
    if res.code != 0 {
        let msg = res.stderr.trim();
        return Ok(StartAgentResult {
            ok: false,
            sock: None,
            pid: None,
            error: Some(if msg.is_empty() {
                "ssh-agent failed".to_string()
            } else {
                msg.to_string()
            }),
        });
    }

    // SSH_AUTH_SOCK=([^;]+) / SSH_AGENT_PID=(\d+)
    let sock = capture_after(&res.stdout, "SSH_AUTH_SOCK=", |c| c != ';');
    let pid = capture_after(&res.stdout, "SSH_AGENT_PID=", |c| c.is_ascii_digit());

    if let Some(ref s) = sock {
        env.set("SSH_AUTH_SOCK", s);
    }
    if let Some(ref p) = pid {
        env.set("SSH_AGENT_PID", p);
    }
    env.persist_agent();

    Ok(StartAgentResult {
        ok: true,
        sock,
        pid,
        error: None,
    })
}

/// Captures the substring after `marker` while `pred` holds (mirror of the
/// capture groups `([^;]+)` and `(\d+)`). Returns None if empty or missing.
fn capture_after<F: Fn(char) -> bool>(haystack: &str, marker: &str, pred: F) -> Option<String> {
    let idx = haystack.find(marker)?;
    let after = &haystack[idx + marker.len()..];
    let captured: String = after.chars().take_while(|&c| pred(c)).collect();
    if captured.is_empty() {
        None
    } else {
        Some(captured)
    }
}

/// git-setup:add-key
#[tauri::command]
pub async fn git_setup_add_key(
    env: tauri::State<'_, Arc<GitSetupAgentEnv>>,
    key_path: Option<String>,
    passphrase: Option<String>,
) -> Result<AddKeyResult, String> {
    let err = |msg: String| {
        Ok(AddKeyResult {
            ok: false,
            output: None,
            needs_passphrase: None,
            error: Some(msg),
        })
    };

    let key_path = key_path.unwrap_or_default();
    if key_path.is_empty() || !Path::new(&key_path).exists() {
        return err("Key file not found".to_string());
    }

    // Passphrase provided → SSH_ASKPASS helper.
    if let Some(pp) = passphrase.as_ref() {
        if !pp.is_empty() {
            let o = ssh_add_with_passphrase(env.inner(), &key_path, pp);
            return Ok(AddKeyResult {
                ok: o.ok,
                output: o.output,
                needs_passphrase: None,
                error: o.error,
            });
        }
    }

    // No passphrase: detect to avoid a blocking interactive prompt.
    if is_key_encrypted(&key_path) {
        if is_mac() {
            let from_kc = ssh_add_silent_from_keychain(env.inner(), &key_path);
            if from_kc.ok {
                return Ok(AddKeyResult {
                    ok: true,
                    output: Some(
                        from_kc
                            .output
                            .filter(|s| !s.is_empty())
                            .unwrap_or_else(|| "Key added (passphrase from Keychain)".to_string()),
                    ),
                    needs_passphrase: None,
                    error: None,
                });
            }
        }
        return Ok(AddKeyResult {
            ok: false,
            output: None,
            needs_passphrase: Some(true),
            error: Some("This key is passphrase-protected.".to_string()),
        });
    }

    // Unencrypted key → original flow. The path used to be pasted between
    // double quotes, where `$(…)` and backticks still expand.
    let key_ref = shell_var_ref("PO_KEY_PATH");
    let vars = [("PO_KEY_PATH", key_path.as_str())];
    let cmd = if is_mac() {
        format!("ssh-add --apple-use-keychain {key_ref}")
    } else {
        format!("ssh-add {key_ref}")
    };
    let res = run_login_shell_with(env.inner(), &cmd, &vars, 10000);
    if res.code == 0 {
        return Ok(AddKeyResult {
            ok: true,
            output: Some(format!("{}{}", res.stdout, res.stderr).trim().to_string()),
            needs_passphrase: None,
            error: None,
        });
    }
    // Fallback without --apple-use-keychain (mac only).
    if is_mac() {
        let res2 = run_login_shell_with(env.inner(), &format!("ssh-add {key_ref}"), &vars, 10000);
        if res2.code == 0 {
            return Ok(AddKeyResult {
                ok: true,
                output: Some(format!("{}{}", res2.stdout, res2.stderr).trim().to_string()),
                needs_passphrase: None,
                error: None,
            });
        }
    }
    // `(res.stderr || res.stdout || 'ssh-add failed').trim()` — the JS `||`
    // picks the first value *non-empty in raw form* and only then is it trimmed.
    let chosen = if !res.stderr.is_empty() {
        res.stderr.as_str()
    } else if !res.stdout.is_empty() {
        res.stdout.as_str()
    } else {
        "ssh-add failed"
    };
    err(chosen.trim().to_string())
}

/// git-setup:list-agent-keys
#[tauri::command]
pub async fn git_setup_list_agent_keys(
    env: tauri::State<'_, Arc<GitSetupAgentEnv>>,
) -> Result<ListAgentKeysResult, String> {
    Ok(ListAgentKeysResult {
        ok: true,
        keys: list_agent_keys(env.inner()),
        running: is_agent_running(env.inner()),
    })
}

/// git-setup:set-identity
#[tauri::command]
pub async fn git_setup_set_identity(
    cwd: String,
    name: Option<String>,
    email: Option<String>,
    global: Option<bool>,
) -> Result<SetIdentityResult, String> {
    let err = |msg: String| {
        Ok(SetIdentityResult {
            ok: false,
            identity: None,
            error: Some(msg),
        })
    };

    let scope: Vec<&str> = if global.unwrap_or(false) {
        vec!["--global"]
    } else {
        vec![]
    };

    // git config <scope> user.name / user.email (only if non-empty, like the TS).
    let run_config = |key: &str, value: &str| -> Result<(), String> {
        let mut args: Vec<&str> = vec!["config"];
        args.extend(scope.iter().copied());
        // `--`: a name or email starting with `-` is a value, not an option.
        args.push("--");
        args.push(key);
        args.push(value);
        let out = crate::commands::util_cmd::cmd("git")
            .args(&args)
            .current_dir(&cwd)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            Err(if stderr.trim().is_empty() {
                "Failed to set identity".to_string()
            } else {
                stderr
            })
        }
    };

    if let Some(n) = name.as_ref() {
        if !n.is_empty() {
            if let Err(e) = run_config("user.name", n) {
                return err(e);
            }
        }
    }
    if let Some(em) = email.as_ref() {
        if !em.is_empty() {
            if let Err(e) = run_config("user.email", em) {
                return err(e);
            }
        }
    }

    Ok(SetIdentityResult {
        ok: true,
        identity: Some(get_identity(&cwd)),
        error: None,
    })
}

/// git-setup:convert-remote
#[tauri::command]
pub async fn git_setup_convert_remote(
    cwd: String,
    remote_name: Option<String>,
) -> Result<ConvertRemoteResult, String> {
    let err = |msg: String| {
        Ok(ConvertRemoteResult {
            ok: false,
            url: None,
            unchanged: None,
            previous_url: None,
            error: Some(msg),
        })
    };

    let name = match remote_name {
        Some(n) if !n.is_empty() => n,
        _ => "origin".to_string(),
    };
    let remotes = get_remotes(&cwd);
    let target = match remotes.iter().find(|r| r.name == name) {
        Some(t) => t,
        None => return err(format!("Remote \"{}\" not found", name)),
    };
    if target.kind == "ssh" {
        return Ok(ConvertRemoteResult {
            ok: true,
            url: Some(target.url.clone()),
            unchanged: Some(true),
            previous_url: None,
            error: None,
        });
    }
    let converted = match convert_https_to_ssh(&target.url) {
        Some(c) => c,
        None => return err(format!("Cannot convert URL: {}", target.url)),
    };
    let previous_url = target.url.clone();

    let out = crate::commands::util_cmd::cmd("git")
        .args(["remote", "set-url", "--", &name, &converted])
        .current_dir(&cwd)
        .output();
    match out {
        Ok(o) if o.status.success() => Ok(ConvertRemoteResult {
            ok: true,
            url: Some(converted),
            unchanged: None,
            previous_url: Some(previous_url),
            error: None,
        }),
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            err(if stderr.trim().is_empty() {
                "Failed to convert remote".to_string()
            } else {
                stderr
            })
        }
        Err(e) => err(e.to_string()),
    }
}

/// git-setup:test-connection
#[tauri::command]
pub async fn git_setup_test_connection(
    env: tauri::State<'_, Arc<GitSetupAgentEnv>>,
    host: Option<String>,
) -> Result<TestConnectionResult, String> {
    let target = match host {
        Some(h) if !h.trim().is_empty() => h.trim().to_string(),
        _ => "github.com".to_string(),
    };
    // The host comes from the repository's remote URL: it was pasted into the
    // shell text unquoted (`git@x;touch y` ran `touch y`).
    let (host_only, port) = match split_host_port(&target) {
        Some(hp) => hp,
        None => {
            return Ok(TestConnectionResult {
                ok: false,
                output: format!("Invalid host name: {target}"),
                code: -1,
            })
        }
    };
    let dest = format!("git@{host_only}");
    let mut vars: Vec<(&str, &str)> = vec![("PO_SSH_DEST", dest.as_str())];
    let port_part = match &port {
        Some(p) => {
            vars.push(("PO_SSH_PORT", p.as_str()));
            format!(" -p {}", shell_var_ref("PO_SSH_PORT"))
        }
        None => String::new(),
    };
    let cmd = format!(
        "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15{port_part} -T {}",
        shell_var_ref("PO_SSH_DEST")
    );
    let res = run_login_shell_with(env.inner(), &cmd, &vars, 15000);
    let combined = format!("{}\n{}", res.stdout, res.stderr).trim().to_string();
    // GitHub/GitLab → /successfully authenticated|welcome/i.
    let lower = combined.to_lowercase();
    let success = lower.contains("successfully authenticated") || lower.contains("welcome");
    Ok(TestConnectionResult {
        ok: success,
        output: combined,
        code: res.code,
    })
}

/// git-setup:set-pref
#[tauri::command]
pub async fn git_setup_set_pref(
    cwd: String,
    selected_key_path: Option<String>,
) -> Result<SetPrefResult, String> {
    let mut prefs = read_prefs();
    let key = prefs_key(&cwd);

    // Ensure the entry object.
    if !prefs.get(&key).map(|v| v.is_object()).unwrap_or(false) {
        prefs.insert(key.clone(), serde_json::Value::Object(Default::default()));
    }
    if let Some(entry) = prefs.get_mut(&key).and_then(|v| v.as_object_mut()) {
        match selected_key_path {
            Some(p) if !p.is_empty() => {
                entry.insert("selectedKeyPath".to_string(), serde_json::Value::String(p));
            }
            _ => {
                entry.remove("selectedKeyPath");
            }
        }
    }
    write_prefs(&prefs);
    Ok(SetPrefResult {
        ok: true,
        error: None,
    })
}

#[cfg(test)]
mod hostile_input_tests {
    use super::*;

    #[test]
    fn host_validation_blocks_shell_and_option_injection() {
        assert_eq!(
            split_host_port("github.com"),
            Some(("github.com".into(), None))
        );
        assert_eq!(
            split_host_port("git.example.com:2222"),
            Some(("git.example.com".into(), Some("2222".into())))
        );
        assert_eq!(
            split_host_port("[::1]:22"),
            Some(("::1".into(), Some("22".into())))
        );
        for bad in [
            "github.com;touch PWNED",
            "$(touch PWNED)",
            "-oProxyCommand=sh",
            "host name",
            "a`id`",
            "host:22x",
            "",
        ] {
            assert!(split_host_port(bad).is_none(), "{bad:?} accepted");
        }
    }

    #[cfg(unix)]
    #[test]
    fn login_shell_values_are_never_expanded() {
        let dir = std::env::temp_dir().join(format!("po-gs-shell-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("PWNED");
        let value = format!(
            "x$(touch {m})`touch {m}`\"';touch {m}",
            m = marker.display()
        );
        let env = GitSetupAgentEnv::new();
        let res = run_login_shell_with(
            &env,
            &format!("printf %s {}", shell_var_ref("PO_VALUE")),
            &[("PO_VALUE", value.as_str())],
            5000,
        );
        assert_eq!(res.code, 0, "{}", res.stderr);
        assert_eq!(res.stdout, value);
        assert!(!marker.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn key_file_names_cannot_leave_the_ssh_folder() {
        for name in ["../evil", "/tmp/evil", "..", ".", "a/b", ".hidden"] {
            let r = git_setup_generate_key(None, Some(name.into()), None, None)
                .await
                .unwrap();
            assert!(!r.ok, "{name:?} accepted");
            let s = git_setup_save_key(Some(name.into()), Some("k".into()), None)
                .await
                .unwrap();
            assert!(!s.ok, "{name:?} accepted by save-key");
        }
        let r = git_setup_generate_key(None, Some("ok_name".into()), Some("-f/tmp/x".into()), None)
            .await
            .unwrap();
        assert!(!r.ok);
    }
}

#[cfg(all(test, unix))]
mod keygen_tests {
    use super::*;

    /// A name that looks like an option is stored as the value.
    #[tokio::test]
    async fn identity_values_starting_with_a_dash_are_values() {
        let dir = crate::commands::util_cmd::PrivateTempDir::new("po-ident").unwrap();
        let cwd = dir.path().to_string_lossy().into_owned();
        let init = std::process::Command::new("git")
            .args(["init", "-q", &cwd])
            .output()
            .unwrap();
        assert!(init.status.success());
        let r = git_setup_set_identity(
            cwd.clone(),
            Some("--global".into()),
            Some("-x@example.com".into()),
            Some(false),
        )
        .await
        .unwrap();
        assert!(r.ok, "{:?}", r.error);
        let get = |key: &str| {
            let o = std::process::Command::new("git")
                .args(["config", "--local", "--get", key])
                .current_dir(&cwd)
                .output()
                .unwrap();
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        };
        assert_eq!(get("user.name"), "--global");
        assert_eq!(get("user.email"), "-x@example.com");
    }

    /// The passphrase reaches ssh-keygen through the askpass helper (never in
    /// argv) and the key really is encrypted with it.
    #[test]
    fn new_key_passphrase_is_applied_without_the_command_line() {
        if crate::commands::util_cmd::find_in_path(
            "ssh-keygen",
            &std::env::var_os("PATH").unwrap_or_default(),
        )
        .is_none()
        {
            return;
        }
        let dir = crate::commands::util_cmd::PrivateTempDir::new("po-keygen").unwrap();
        let target = dir.path().join("id_test");
        let pass = "s3cr et \"quoted\" $(x)";
        let args: Vec<String> = ["-q", "-t", "ed25519", "-C", "t", "-f"]
            .iter()
            .map(|s| s.to_string())
            .chain([target.to_string_lossy().into_owned()])
            .collect();
        assert!(!args.iter().any(|a| a.contains("s3cr")));
        let out = run_ssh_keygen(&args, pass, &target).unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(is_key_encrypted(&target.to_string_lossy()));
        let ok = std::process::Command::new("ssh-keygen")
            .args(["-y", "-P", pass, "-f"])
            .arg(&target)
            .output()
            .unwrap();
        assert!(ok.status.success());
    }
}
