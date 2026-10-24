//! Smart-Context domain — four IPC domains in a single Tauri 2 command module:
//!
//!  - smart actions      (smart-action:*)
//!  - intents            (intent:*)
//!  - shared context     (shared-context:*)
//!  - context snapshots  (context-snapshot:*)
//!
//! …plus their helpers: smart-action detector, shared-context store,
//! context-snapshot engine, desktop-state store (context-transfer prefs) and
//! the provider CLI runner (spawnProvider / enhanceText).
//!
//! Conventions (same as `git.rs`/`terminal.rs`): every `<domain>:<name>` IPC
//! channel is a `#[tauri::command] pub fn <domain>_<name>(...) -> Result<T, String>`
//! in snake_case. The return shapes (`{ ok, result, error, … }`) match
//! exactly the objects the renderer expects. The push channels
//! (`smart-action:suggestion`, `shared-context:changed`,
//! `context-snapshot:progress`/`complete`) are emitted via `AppHandle::emit`.
//!
//! The AI calls (`intent:generate-plan`, `intent:enhance-prompt`,
//! `smart-action` detect/execute non-AI, `context-snapshot:generate` git info)
//! go through the `spawn_provider()` provider CLI pipeline: the agent CLI you
//! already use, on your machine, with your own account.
//!
//! SELF-CONTAINED file: does NOT touch mod.rs / lib.rs / Cargo.toml. Uses only crates already
//! present in the workspace ({tauri, parking_lot, serde, serde_json, uuid}).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

// ─────────────────────────────────────────────────────────────────────────────
// Push channels to the renderer.
// ─────────────────────────────────────────────────────────────────────────────
const SHARED_CONTEXT_CHANGED: &str = "shared-context:changed";
const CONTEXT_SNAPSHOT_PROGRESS: &str = "context-snapshot:progress";
const CONTEXT_SNAPSHOT_COMPLETE: &str = "context-snapshot:complete";

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// ISO-8601 UTC without chrono. Second + millis granularity, monotonic and
/// lexicographically sortable like `new Date().toISOString()` for the store
/// uses (updatedAt/createdAt). RFC3339-ish form.
fn now_iso() -> String {
    let dur = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}.{millis:03}Z")
}

/// Howard Hinnant's days→civil date algorithm (proleptic Gregorian).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ═════════════════════════════════════════════════════════════════════════════
// provider-cli: the one shared pipeline in providers.rs (headless command line
// per provider, private temp dir). This file used to carry its own copy, with
// command lines that no longer work for grok and Copilot.
// ═════════════════════════════════════════════════════════════════════════════

/// Ceiling of an intent plan / prompt enhancement call. The renderer stops
/// waiting much earlier (5 s plan, 15 s enhance); past this the provider CLI
/// and its process group are killed instead of running on unseen.
const INTENT_TIMEOUT_SECS: u64 = 30;

fn spawn_provider(provider: &str, prompt: &str, cwd: &str) -> Result<String, String> {
    crate::commands::providers::spawn_provider_timeout(
        provider,
        prompt,
        cwd,
        INTENT_TIMEOUT_SECS,
        None,
    )
}

/// `enhanceText(cliProvider, prompt, cwd, opts)` — rewrites text through the provider CLI.
/// The composite prompt for the CLI is `system\n\nuser`.
fn enhance_text(
    cli_provider: &str,
    prompt: &str,
    cwd: &str,
    system: Option<&str>,
) -> Result<(String, &'static str), String> {
    let composed = match system {
        Some(s) => format!("{s}\n\n{prompt}"),
        None => prompt.to_string(),
    };
    let text = spawn_provider(cli_provider, &composed, cwd)?;
    Ok((text.trim().to_string(), "cli"))
}

// ═════════════════════════════════════════════════════════════════════════════
// DOMAIN 1 — smart-action:* (handlers + detector)
// ═════════════════════════════════════════════════════════════════════════════

// ── Domain types (same JSON shape as the web UI types) ─────────────────────

#[derive(Clone, Serialize)]
pub struct SmartActionAlternative {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    #[serde(rename = "folderName")]
    pub folder_name: String,
    #[serde(rename = "fullCommand")]
    pub full_command: String,
}

#[derive(Clone, Serialize)]
pub struct SmartActionResult {
    pub detected: bool,
    pub command: Option<String>,
    pub label: Option<String>,
    pub source: Option<String>,
    /// 'high' | 'medium' | 'low'.
    pub confidence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternatives: Option<Vec<SmartActionAlternative>>,
}

#[derive(Clone, Serialize)]
pub struct WorkspaceCommands {
    #[serde(rename = "npmScripts")]
    pub npm_scripts: HashMap<String, String>,
    #[serde(rename = "hasDockerCompose")]
    pub has_docker_compose: bool,
    #[serde(rename = "hasMakefile")]
    pub has_makefile: bool,
    #[serde(rename = "makeTargets")]
    pub make_targets: Vec<String>,
    #[serde(rename = "scriptFiles")]
    pub script_files: Vec<String>,
    /// 'npm' | 'yarn' | 'pnpm'.
    #[serde(rename = "packageManager")]
    pub package_manager: String,
}

#[derive(Clone, Serialize)]
pub struct FolderCommandEntry {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    #[serde(rename = "folderName")]
    pub folder_name: String,
    pub commands: WorkspaceCommands,
}

#[derive(Deserialize)]
pub struct SmartActionRequest {
    pub prompt: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: Option<String>,
}

// Handler responses (shape `{ ok, result/commands/folderMap, error }`).
#[derive(Serialize)]
pub struct DetectResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<SmartActionResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct OkResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CommandsResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<WorkspaceCommands>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ScanFoldersResponse {
    pub ok: bool,
    #[serde(rename = "folderMap", skip_serializing_if = "Option::is_none")]
    pub folder_map: Option<Vec<FolderCommandEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct RunTerminalResponse {
    pub ok: bool,
    #[serde(rename = "subAgentId", skip_serializing_if = "Option::is_none")]
    pub sub_agent_id: Option<String>,
    #[serde(rename = "parentId", skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Detector ──────────────────────────────────────────────────────────────
//
// The patterns are implemented as lowercase matching + manual word
// boundaries (to avoid the `regex` crate).

/// INTENT_PATTERNS — (keyword-set, category, label). The "\b…\b" become a
/// word-boundary match; the alternatives `(a|b|...)` become the keyword
/// keyword. Match case-insensitive.
fn intent_patterns() -> Vec<(Vec<&'static str>, &'static str, &'static str)> {
    vec![
        (
            vec![
                "deploy",
                "deployment",
                "ship",
                "release",
                "publish",
                "pubblica",
                "rilascia",
                "rilascio",
            ],
            "deploy",
            "Deploy",
        ),
        (
            vec![
                "build",
                "builda",
                "rebuilda",
                "compile",
                "bundle",
                "transpile",
                "compila",
                "costruisci",
                "ricostruisci",
                "nuova versione",
            ],
            "build",
            "Build",
        ),
        (
            vec![
                "test",
                "tests",
                "testing",
                "run tests",
                "unit test",
                "e2e",
                "spec",
                "testa",
                "esegui test",
                "lancia test",
            ],
            "test",
            "Run tests",
        ),
        (
            vec![
                "start",
                "serve",
                "run server",
                "dev server",
                "launch",
                "boot",
                "avvia",
                "lancia",
                "partire",
                "fai partire",
            ],
            "start",
            "Start server",
        ),
        (
            vec![
                "install",
                "install dependencies",
                "install packages",
                "add packages",
                "installa",
                "installa dipendenze",
            ],
            "install",
            "Install dependencies",
        ),
        (
            vec![
                "lint",
                "linting",
                "format",
                "formatting",
                "prettier",
                "eslint",
                "formatta",
            ],
            "lint",
            "Lint/Format",
        ),
        (
            vec![
                "docker",
                "container",
                "compose",
                "docker-compose",
                "docker compose",
            ],
            "docker",
            "Docker",
        ),
        (
            vec![
                "clean",
                "cleanup",
                "clear cache",
                "purge",
                "pulisci",
                "svuota cache",
            ],
            "clean",
            "Clean",
        ),
        (
            vec![
                "migrate",
                "migration",
                "db migrate",
                "database migrate",
                "migra",
                "migrazione",
            ],
            "migrate",
            "Run migrations",
        ),
        (
            vec![
                "seed",
                "db seed",
                "database seed",
                "popola",
                "popola database",
            ],
            "seed",
            "Seed database",
        ),
    ]
}

fn category_to_scripts(category: &str) -> Vec<&'static str> {
    match category {
        "deploy" => vec![
            "deploy",
            "deploy:prod",
            "deploy:staging",
            "publish",
            "release",
            "ship",
        ],
        "build" => vec!["build", "build:prod", "build:dev", "compile", "bundle"],
        "test" => vec![
            "test",
            "test:unit",
            "test:e2e",
            "test:integration",
            "test:watch",
            "spec",
            "jest",
            "vitest",
        ],
        "start" => vec!["start", "dev", "serve", "start:dev", "develop", "watch"],
        "install" => vec![],
        "lint" => vec!["lint", "lint:fix", "format", "prettier", "eslint", "check"],
        "docker" => vec![],
        "clean" => vec!["clean", "clear", "purge", "reset"],
        "migrate" => vec![
            "migrate",
            "db:migrate",
            "migration",
            "migration:run",
            "typeorm:migrate",
        ],
        "seed" => vec!["seed", "db:seed", "seed:run"],
        _ => vec![],
    }
}

fn category_to_docker(category: &str) -> Option<&'static str> {
    match category {
        "deploy" => Some("docker compose up -d"),
        "build" => Some("docker compose build"),
        "start" => Some("docker compose up"),
        "docker" => Some("docker compose up"),
        "clean" => Some("docker compose down"),
        _ => None,
    }
}

fn category_to_make(category: &str) -> Vec<&'static str> {
    match category {
        "deploy" => vec!["deploy", "release", "publish"],
        "build" => vec!["build", "compile", "all"],
        "test" => vec!["test", "tests", "check"],
        "start" => vec!["run", "serve", "start", "dev"],
        "install" => vec!["install", "deps", "dependencies"],
        "lint" => vec!["lint", "format", "check"],
        "clean" => vec!["clean", "distclean", "purge"],
        "migrate" => vec!["migrate", "db-migrate"],
        "seed" => vec!["seed", "db-seed"],
        _ => vec![],
    }
}

/// `\bword\b` case-insensitive on `haystack` (already lowercase). Boundary = start/
/// end of string or non-alphanumeric char. For keywords with spaces (e.g. "run tests")
/// the boundary applies to the ends of the phrase.
fn word_match(haystack_lower: &str, needle_lower: &str) -> bool {
    let bytes = haystack_lower.as_bytes();
    let nlen = needle_lower.len();
    if nlen == 0 {
        return false;
    }
    let mut from = 0;
    while let Some(rel) = haystack_lower[from..].find(needle_lower) {
        let idx = from + rel;
        let left_ok = idx == 0 || {
            let prev = bytes[idx - 1];
            !(prev.is_ascii_alphanumeric() || prev == b'_')
        };
        let end = idx + nlen;
        let right_ok = end >= bytes.len() || {
            let next = bytes[end];
            !(next.is_ascii_alphanumeric() || next == b'_')
        };
        if left_ok && right_ok {
            return true;
        }
        from = idx + 1;
        if from >= haystack_lower.len() {
            break;
        }
    }
    false
}

/// `commandCache` — 4h TTL (CACHE_TTL_MS). State shared in the manager.
struct CachedCommands {
    commands: WorkspaceCommands,
    timestamp: u128,
}
struct CachedFolderMap {
    map: Vec<FolderCommandEntry>,
    timestamp: u128,
}
const CACHE_TTL_MS: u128 = 4 * 60 * 60 * 1000;
const FOLDER_MAP_TTL_MS: u128 = 4 * 60 * 60 * 1000;

#[derive(Default)]
pub struct SmartActionCache {
    command_cache: Mutex<HashMap<String, CachedCommands>>,
    folder_map_cache: Mutex<HashMap<String, CachedFolderMap>>,
}

impl SmartActionCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn clear_folder_map_cache(&self, workspace_path: Option<&str>) {
        let mut c = self.folder_map_cache.lock();
        match workspace_path {
            Some(p) => {
                c.remove(p);
            }
            None => c.clear(),
        }
    }
}

/// `scanWorkspaceCommands(workspacePath)` — reads package.json/Makefile/compose/
/// scripts. Cache 4h.
fn scan_workspace_commands(cache: &SmartActionCache, workspace_path: &str) -> WorkspaceCommands {
    {
        let c = cache.command_cache.lock();
        if let Some(cached) = c.get(workspace_path) {
            if now_millis() - cached.timestamp < CACHE_TTL_MS {
                return cached.commands.clone();
            }
        }
    }

    let mut commands = WorkspaceCommands {
        npm_scripts: HashMap::new(),
        has_docker_compose: false,
        has_makefile: false,
        make_targets: vec![],
        script_files: vec![],
        package_manager: "npm".to_string(),
    };

    // 1. package.json → scripts + package manager.
    let pkg_path = Path::new(workspace_path).join("package.json");
    if pkg_path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&pkg_path) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
                    for (k, val) in scripts {
                        if let Some(s) = val.as_str() {
                            commands.npm_scripts.insert(k.clone(), s.to_string());
                        }
                    }
                }
            }
        }
    }

    if Path::new(workspace_path).join("pnpm-lock.yaml").exists() {
        commands.package_manager = "pnpm".to_string();
    } else if Path::new(workspace_path).join("yarn.lock").exists() {
        commands.package_manager = "yarn".to_string();
    }

    // 2. docker-compose.
    commands.has_docker_compose = [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ]
    .iter()
    .any(|f| Path::new(workspace_path).join(f).exists());

    // 3. Makefile → targets (^[a-zA-Z_][a-zA-Z0-9_-]*\s*: in multiline).
    let makefile_path = Path::new(workspace_path).join("Makefile");
    if makefile_path.exists() {
        commands.has_makefile = true;
        if let Ok(content) = std::fs::read_to_string(&makefile_path) {
            for line in content.split('\n') {
                if let Some(target) = parse_make_target(line) {
                    commands.make_targets.push(target);
                }
            }
        }
    }

    // 4. scripts/ → executable files (known extensions or no extension).
    let scripts_dir = Path::new(workspace_path).join("scripts");
    if scripts_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&scripts_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_script_file(&name) {
                    commands.script_files.push(name);
                }
            }
        }
    }

    cache.command_cache.lock().insert(
        workspace_path.to_string(),
        CachedCommands {
            commands: commands.clone(),
            timestamp: now_millis(),
        },
    );
    commands
}

/// `/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/` on a Makefile line.
fn parse_make_target(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let first = bytes[0];
    if !(first.is_ascii_alphabetic() || first == b'_') {
        return None;
    }
    let mut end = 1;
    while end < bytes.len() {
        let c = bytes[end];
        if c.is_ascii_alphanumeric() || c == b'_' || c == b'-' {
            end += 1;
        } else {
            break;
        }
    }
    let target = &line[..end];
    // \s*:
    let mut pos = end;
    while pos < bytes.len() && (bytes[pos] == b' ' || bytes[pos] == b'\t') {
        pos += 1;
    }
    if pos < bytes.len() && bytes[pos] == b':' {
        Some(target.to_string())
    } else {
        None
    }
}

/// `/\.(sh|bash|py|js|ts|rb|ps1)$/.test(e) || !e.includes('.')`.
fn is_script_file(name: &str) -> bool {
    let exts = [".sh", ".bash", ".py", ".js", ".ts", ".rb", ".ps1"];
    if exts.iter().any(|e| name.ends_with(e)) {
        return true;
    }
    !name.contains('.')
}

/// DIRECT_COMMAND_REGEX — shell command prefixes. Case-insensitive match
/// at the start of the string (already trimmed). Each alternative is one prefix.
fn matches_direct_command(prompt: &str) -> bool {
    let p = prompt.to_lowercase();
    // Helper: prefix (case-insensitive) at the start.
    let starts = |s: &str| p.starts_with(s);
    starts("npm run ")
        || starts("npm ")
        || starts("yarn ")
        || starts("pnpm run ")
        || starts("pnpm ")
        || starts("npx ")
        || p.starts_with("make")
        || starts("docker compose ")
        || starts("docker ")
        || starts("node ")
        || starts("python ")
        || starts("python3 ")
        || starts("pip ")
        || starts("pip3 ")
        || starts("cargo ")
        || starts("go ")
        || p.starts_with("./")
        || starts("sh ")
        || starts("bash ")
        || starts("zsh ")
        || starts("git ")
        || starts("curl ")
        || starts("wget ")
        || starts("php ")
        || starts("artisan ")
        || starts("composer ")
}

/// DIRECT_COMMAND_LABELS — first matching prefix → label.
fn direct_command_label(prompt: &str) -> String {
    let p = prompt.to_lowercase();
    let starts = |s: &str| p.starts_with(s);
    if starts("npm run deploy") {
        "Deploy"
    } else if starts("npm run build") {
        "Build"
    } else if starts("npm run test") {
        "Test"
    } else if starts("npm run start") {
        "Start"
    } else if starts("npm run dev") {
        "Dev Server"
    } else if starts("npm run lint") {
        "Lint"
    } else if starts("npm run ") || starts("npm ") {
        "npm script"
    } else if starts("yarn ") {
        "Yarn"
    } else if starts("pnpm ") {
        "pnpm"
    } else if starts("npx ") {
        "npx"
    } else if p.starts_with("make") {
        "Make"
    } else if starts("docker compose") {
        "Docker Compose"
    } else if starts("docker ") {
        "Docker"
    } else if starts("git ") {
        "Git"
    } else if starts("python ") || starts("python3 ") || starts("pip ") || starts("pip3 ") {
        "Python"
    } else if starts("cargo ") {
        "Cargo"
    } else if starts("go ") {
        "Go"
    } else if starts("sh ") || starts("bash ") || starts("zsh ") {
        "Shell script"
    } else if p.starts_with("./") {
        "Script"
    } else if starts("php ") || starts("artisan ") || starts("composer ") {
        "PHP"
    } else if starts("node ") || starts("curl ") || starts("wget ") {
        "Command"
    } else {
        "Terminal"
    }
    .to_string()
}

/// `detectDirectCommand(prompt)`.
fn detect_direct_command(prompt: &str) -> Option<SmartActionResult> {
    if !matches_direct_command(prompt) {
        return None;
    }
    // conversational guards
    if prompt.contains('?') {
        return None;
    }
    let lower = prompt.to_lowercase();
    for starter in [
        "can you",
        "please",
        "could you",
        "i want",
        "how to",
        "what",
        "why",
        "when",
        "where",
        "who",
    ] {
        if lower.starts_with(starter) {
            return None;
        }
    }
    Some(SmartActionResult {
        detected: true,
        command: Some(prompt.to_string()),
        label: Some(direct_command_label(prompt)),
        source: Some("direct command".to_string()),
        confidence: "high".to_string(),
        alternatives: None,
    })
}

/// `matchIntentToCommand(category, label, commands)`.
fn match_intent_to_command(
    category: &str,
    label: &str,
    commands: &WorkspaceCommands,
) -> Option<SmartActionResult> {
    let pm = &commands.package_manager;
    let run_cmd = if pm == "npm" {
        "npm run".to_string()
    } else {
        pm.clone()
    };

    if category == "install" {
        let install_cmd = if pm == "npm" {
            "npm install".to_string()
        } else {
            format!("{pm} install")
        };
        return Some(SmartActionResult {
            detected: true,
            command: Some(install_cmd),
            label: Some(label.to_string()),
            source: Some("package manager".to_string()),
            confidence: "high".to_string(),
            alternatives: None,
        });
    }

    // 1. npm scripts.
    for script_name in category_to_scripts(category) {
        if commands.npm_scripts.contains_key(script_name) {
            return Some(SmartActionResult {
                detected: true,
                command: Some(format!("{run_cmd} {script_name}")),
                label: Some(label.to_string()),
                source: Some("package.json scripts".to_string()),
                confidence: "high".to_string(),
                alternatives: None,
            });
        }
    }

    // 2. docker compose.
    if commands.has_docker_compose {
        if let Some(dcmd) = category_to_docker(category) {
            return Some(SmartActionResult {
                detected: true,
                command: Some(dcmd.to_string()),
                label: Some(label.to_string()),
                source: Some("docker-compose.yml".to_string()),
                confidence: "medium".to_string(),
                alternatives: None,
            });
        }
    }

    // 3. Makefile targets.
    if commands.has_makefile {
        for target in category_to_make(category) {
            if commands.make_targets.iter().any(|t| t == target) {
                return Some(SmartActionResult {
                    detected: true,
                    command: Some(format!("make {target}")),
                    label: Some(label.to_string()),
                    source: Some("Makefile".to_string()),
                    confidence: "high".to_string(),
                    alternatives: None,
                });
            }
        }
    }

    None
}

/// `folderDisplayName(folderPath)` — last 1-2 segments.
fn folder_display_name(folder_path: &str) -> String {
    let trimmed = folder_path.trim_end_matches('/');
    let sep = std::path::MAIN_SEPARATOR;
    let parts: Vec<&str> = trimmed.split(sep).filter(|s| !s.is_empty()).collect();
    if parts.len() > 2 {
        parts[parts.len() - 2..].join("/")
    } else {
        let joined = parts.join("/");
        if joined.is_empty() {
            folder_path.to_string()
        } else {
            joined
        }
    }
}

/// `scanMultiFolderCommands(workspacePath, forceRefresh)` — depth ≤ 2.
fn scan_multi_folder_commands(
    cache: &SmartActionCache,
    workspace_path: &str,
    force_refresh: bool,
) -> Vec<FolderCommandEntry> {
    if force_refresh {
        cache.command_cache.lock().clear();
    } else {
        let c = cache.folder_map_cache.lock();
        if let Some(cached) = c.get(workspace_path) {
            if now_millis() - cached.timestamp < FOLDER_MAP_TTL_MS {
                return cached.map.clone();
            }
        }
    }

    let mut result: Vec<FolderCommandEntry> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    scan_dir(cache, workspace_path, 0, &mut result, &mut visited);

    cache.folder_map_cache.lock().insert(
        workspace_path.to_string(),
        CachedFolderMap {
            map: result.clone(),
            timestamp: now_millis(),
        },
    );
    result
}

fn has_command_sources(dir: &str) -> bool {
    [
        "package.json",
        "Makefile",
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ]
    .iter()
    .any(|f| Path::new(dir).join(f).exists())
}

fn scan_dir(
    cache: &SmartActionCache,
    dir: &str,
    depth: u32,
    result: &mut Vec<FolderCommandEntry>,
    visited: &mut HashSet<String>,
) {
    if depth > 2 || visited.contains(dir) {
        return;
    }
    visited.insert(dir.to_string());

    let base = Path::new(dir)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if [
        "node_modules",
        ".git",
        "dist",
        "build",
        ".next",
        "vendor",
        "__pycache__",
        ".cache",
    ]
    .contains(&base.as_str())
    {
        return;
    }

    if has_command_sources(dir) {
        let commands = scan_workspace_commands(cache, dir);
        let has_content = !commands.npm_scripts.is_empty()
            || commands.has_docker_compose
            || commands.has_makefile
            || !commands.script_files.is_empty();
        if has_content {
            result.push(FolderCommandEntry {
                folder_path: dir.to_string(),
                folder_name: folder_display_name(dir),
                commands,
            });
        }
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let name = entry.file_name().to_string_lossy().to_string();
            if is_dir && !name.starts_with('.') {
                let child = entry.path().to_string_lossy().to_string();
                scan_dir(cache, &child, depth + 1, result, visited);
            }
        }
    }
}

/// `findCommandAlternatives(command, workspacePath)`.
fn find_command_alternatives(
    cache: &SmartActionCache,
    command: &str,
    workspace_path: &str,
) -> Vec<SmartActionAlternative> {
    let map = scan_multi_folder_commands(cache, workspace_path, false);
    if map.is_empty() {
        return vec![];
    }

    // /^(?:npm\s+run|yarn|pnpm(?:\s+run)?)\s+(\S+)/i  → npm script name.
    let npm_run_name = extract_npm_run_name(command);
    // /^make\s+(\S+)/i.
    let make_name = extract_make_name(command);
    // /^docker\s+compose\s+/i.
    let lower = command.to_lowercase();
    let is_docker = lower.starts_with("docker compose ")
        || lower.starts_with("docker  compose")
        || lower.starts_with("docker\tcompose");

    let mut alternatives: Vec<SmartActionAlternative> = Vec::new();
    for entry in &map {
        let has_command = if let Some(ref n) = npm_run_name {
            entry.commands.npm_scripts.contains_key(n)
        } else if let Some(ref n) = make_name {
            entry.commands.make_targets.iter().any(|t| t == n)
        } else if is_docker {
            entry.commands.has_docker_compose
        } else {
            false
        };

        if has_command {
            // Folder names come from the repository: quoted, never pasted raw
            // into the line the terminal runs.
            let Some(cd) = cd_prefix(&entry.folder_path) else {
                continue;
            };
            alternatives.push(SmartActionAlternative {
                folder_path: entry.folder_path.clone(),
                folder_name: entry.folder_name.clone(),
                full_command: format!("{cd} && {command}"),
            });
        }
    }
    alternatives
}

/// `cd <folder>` for the session shell. POSIX shells: single-quoted word.
/// Windows (PowerShell or cmd): double quotes, and only for folders without
/// characters either shell would still interpret inside them.
fn cd_prefix(folder: &str) -> Option<String> {
    if folder.is_empty() || folder.chars().any(char::is_control) {
        return None;
    }
    if cfg!(windows) {
        if folder
            .chars()
            .any(|c| matches!(c, '"' | '%' | '$' | '`' | '!'))
        {
            return None;
        }
        Some(format!("cd \"{folder}\""))
    } else {
        Some(format!("cd '{}'", folder.replace('\'', "'\\''")))
    }
}

fn extract_npm_run_name(command: &str) -> Option<String> {
    let lower = command.to_lowercase();
    let rest = if let Some(r) = lower.strip_prefix("npm run") {
        r
    } else if let Some(r) = lower.strip_prefix("pnpm run") {
        r
    } else if let Some(r) = lower.strip_prefix("yarn") {
        r
    } else {
        lower.strip_prefix("pnpm")?
    };
    // \s+(\S+) — first non-space token. We use the original (case) for the name.
    let consumed = command.len() - rest.len();
    let tail = &command[consumed..];
    let first = tail.split_whitespace().next()?;
    Some(first.to_string())
}

fn extract_make_name(command: &str) -> Option<String> {
    let lower = command.to_lowercase();
    let rest = lower.strip_prefix("make")?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let consumed = command.len() - rest.len();
    let tail = &command[consumed..];
    let first = tail.split_whitespace().next()?;
    Some(first.to_string())
}

/// `detectSmartAction(prompt, workspacePath)`.
fn detect_smart_action(
    cache: &SmartActionCache,
    prompt: &str,
    workspace_path: &str,
) -> SmartActionResult {
    let no_result = SmartActionResult {
        detected: false,
        command: None,
        label: None,
        source: None,
        confidence: "low".to_string(),
        alternatives: None,
    };

    let trimmed = prompt.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 300 {
        return no_result;
    }

    // 0. Direct command.
    if let Some(mut direct) = detect_direct_command(trimmed) {
        if !workspace_path.is_empty() {
            if let Some(cmd) = direct.command.clone() {
                let alts = find_command_alternatives(cache, &cmd, workspace_path);
                if !alts.is_empty() {
                    direct.alternatives = Some(alts);
                }
            }
        }
        return direct;
    }

    // 1. Intent matching.
    let lower = trimmed.to_lowercase();
    let mut matched: Vec<(&str, &str)> = Vec::new();
    for (keywords, category, label) in intent_patterns() {
        if keywords
            .iter()
            .any(|k| word_match(&lower, &k.to_lowercase()))
        {
            matched.push((category, label));
        }
    }
    if matched.is_empty() {
        return no_result;
    }

    // 2. Scan workspace.
    if workspace_path.is_empty() {
        return no_result;
    }
    let commands = scan_workspace_commands(cache, workspace_path);

    // 3. Match intent → command.
    for (category, label) in matched {
        if let Some(mut result) = match_intent_to_command(category, label, &commands) {
            if let Some(cmd) = result.command.clone() {
                let alts = find_command_alternatives(cache, &cmd, workspace_path);
                if !alts.is_empty() {
                    result.alternatives = Some(alts);
                }
            }
            return result;
        }
    }

    no_result
}

// ── COMMANDS smart-action:* ──────────────────────────────────────────────────

/// smart-action:detect
#[tauri::command]
pub async fn smart_action_detect(
    cache: tauri::State<'_, Arc<SmartActionCache>>,
    request: SmartActionRequest,
) -> Result<DetectResponse, String> {
    let prompt = request.prompt;
    if prompt.is_empty() {
        return Ok(DetectResponse {
            ok: true,
            result: Some(SmartActionResult {
                detected: false,
                command: None,
                label: None,
                source: None,
                confidence: "low".to_string(),
                alternatives: None,
            }),
            error: None,
        });
    }
    let ws = request.workspace_path.unwrap_or_default();
    let result = detect_smart_action(&cache, &prompt, &ws);
    Ok(DetectResponse {
        ok: true,
        result: Some(result),
        error: None,
    })
}

/// smart-action:execute — injects `command + '\r'` into the session terminal.
///
/// smart-action:execute — writes the command to the session PTY
/// (`sessionManager.writeToSession(sessionId, command + '\r')`).
#[tauri::command]
pub async fn smart_action_execute(
    app: AppHandle,
    session_id: String,
    command: String,
) -> Result<OkResponse, String> {
    let sessions = app
        .state::<Arc<crate::commands::session::SessionManager>>()
        .inner()
        .clone();
    match sessions.write(&session_id, &format!("{command}\r"), true) {
        Ok(()) => Ok(OkResponse {
            ok: true,
            error: None,
        }),
        Err(err) => Ok(OkResponse {
            ok: false,
            error: Some(err),
        }),
    }
}

/// smart-action:commands
#[tauri::command]
pub async fn smart_action_commands(
    cache: tauri::State<'_, Arc<SmartActionCache>>,
    workspace_path: String,
) -> Result<CommandsResponse, String> {
    let commands = scan_workspace_commands(&cache, &workspace_path);
    Ok(CommandsResponse {
        ok: true,
        commands: Some(commands),
        error: None,
    })
}

/// smart-action:scan-folders
#[tauri::command]
pub async fn smart_action_scan_folders(
    cache: tauri::State<'_, Arc<SmartActionCache>>,
    workspace_path: String,
    force_refresh: Option<bool>,
) -> Result<ScanFoldersResponse, String> {
    if workspace_path.is_empty() {
        return Ok(ScanFoldersResponse {
            ok: true,
            folder_map: Some(vec![]),
            error: None,
        });
    }
    let force = force_refresh.unwrap_or(false);
    if force {
        cache.clear_folder_map_cache(Some(&workspace_path));
    }
    let folder_map = scan_multi_folder_commands(&cache, &workspace_path, force);
    Ok(ScanFoldersResponse {
        ok: true,
        folder_map: Some(folder_map),
        error: None,
    })
}

/// smart-action:run-terminal — runs the command in a new terminal sub-agent.
///
/// Resolves the parent session and spawns a `generic-shell` sub-agent that
/// runs the command (role `smart-action`, title `⚡ <label>`). The parent is
/// matched by `parent_session_id` when the caller passes it: two sessions can
/// share a name, and matching by name ran the command in the other one. The
/// name is only a fallback for callers that do not send the id yet.
#[tauri::command]
pub async fn smart_action_run_terminal(
    app: AppHandle,
    parent_session_name: String,
    label: String,
    command: String,
    parent_session_id: Option<String>,
) -> Result<RunTerminalResponse, String> {
    let sessions = app
        .state::<Arc<crate::commands::session::SessionManager>>()
        .inner()
        .clone();
    let list = sessions.list();
    let Some(parent) = find_run_terminal_parent(
        &list,
        parent_session_id.as_deref(),
        &parent_session_name,
        |s| (s.id.as_str(), s.name.as_str()),
    )
    .cloned() else {
        return Ok(RunTerminalResponse {
            ok: false,
            sub_agent_id: None,
            parent_id: None,
            error: Some(format!("Session not found: {parent_session_name}")),
        });
    };

    let subagents = app
        .state::<Arc<crate::commands::subagent::SubAgentManager>>()
        .inner()
        .clone();
    let request = crate::commands::subagent::SpawnSubAgentRequest {
        parent_session_id: parent.id.clone(),
        role: "smart-action".into(),
        title: format!("⚡ {label}"),
        prompt: command,
        provider: Some("generic-shell".into()),
        model: None,
        effort: None,
        icon: None,
        mode: None,
        claude_session_id: None,
        custom_config: None,
        soft_skill: None,
        defer_prompt: None,
        eco_level: None,
        provider_account_id: None,
        restored: None,
        ephemeral: None,
        workspace_override: None,
        execution_mode: None,
        goal_spec: None,
        credit_prompt: None,
    };
    match crate::commands::subagent::do_spawn(&app, &subagents, request) {
        Ok(view) => Ok(RunTerminalResponse {
            ok: true,
            sub_agent_id: Some(view.id),
            parent_id: Some(parent.id),
            error: None,
        }),
        Err(err) => Ok(RunTerminalResponse {
            ok: false,
            sub_agent_id: None,
            parent_id: Some(parent.id),
            error: Some(err),
        }),
    }
}

/// The parent of a smart-action terminal: by id when given (an unknown id is
/// "not found", never a fallback to a same-named session), else by name.
fn find_run_terminal_parent<'a, T>(
    sessions: &'a [T],
    id: Option<&str>,
    name: &str,
    key: impl Fn(&T) -> (&str, &str),
) -> Option<&'a T> {
    match id.filter(|i| !i.is_empty()) {
        Some(id) => sessions.iter().find(|s| key(s).0 == id),
        None => sessions.iter().find(|s| key(s).1 == name),
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// DOMAIN 2 — intent:*
// ═════════════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
pub struct GeneratePlanResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct EnhancePromptResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enhanced: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// intent:generate-plan — `${systemPrompt}\n\n${userMessage}` → spawnProvider →
/// extract the first `{…}` block (regex /\{[\s\S]*\}/) → JSON.parse.
///
/// AI call via spawn_provider (CLI, full context). cwd = the process's
/// current directory.
/// Sync Tauri commands run on the main thread: a provider call that takes a
/// minute would freeze every window. These run on a blocking worker.
#[tauri::command]
pub async fn intent_generate_plan(
    app: tauri::AppHandle,
    system_prompt: String,
    user_message: String,
    provider: String,
) -> Result<GeneratePlanResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        intent_generate_plan_blocking(app, system_prompt, user_message, provider)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn intent_generate_plan_blocking(
    app: tauri::AppHandle,
    system_prompt: String,
    user_message: String,
    provider: String,
) -> Result<GeneratePlanResponse, String> {
    let full_prompt = format!("{system_prompt}\n\n{user_message}");
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // AI call, killed after INTENT_TIMEOUT_SECS.
    let result = match spawn_provider(&provider, &full_prompt, &cwd) {
        Ok(r) => r,
        Err(e) => {
            return Ok(GeneratePlanResponse {
                ok: false,
                plan: None,
                error: Some(e),
            })
        }
    };

    // /\{[\s\S]*\}/ — from the first '{' to the last '}'.
    let json_match = extract_json_block(&result);
    let json_str = match json_match {
        Some(s) => s,
        None => {
            return Ok(GeneratePlanResponse {
                ok: false,
                plan: None,
                error: Some("Could not parse plan from provider response".to_string()),
            })
        }
    };

    match serde_json::from_str::<Value>(&json_str) {
        Ok(plan) => {
            // creditAiPrompt('intent-generate-plan').
            crate::commands::session::credit_ai_utility_with_text(
                &app,
                "intent-generate-plan",
                None,
                None,
                Some(&user_message),
            );
            Ok(GeneratePlanResponse {
                ok: true,
                plan: Some(plan),
                error: None,
            })
        }
        Err(e) => Ok(GeneratePlanResponse {
            ok: false,
            plan: None,
            error: Some(e.to_string()),
        }),
    }
}

/// `/\{[\s\S]*\}/` — greedy: first `{` … last `}`.
fn extract_json_block(s: &str) -> Option<String> {
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    if end >= start {
        Some(s[start..=end].to_string())
    } else {
        None
    }
}

/// intent:enhance-prompt — rewrites the user prompt into a clearer/more actionable one.
/// Runs through the provider CLI (`enhance_text`).
#[tauri::command]
pub async fn intent_enhance_prompt(
    app: tauri::AppHandle,
    prompt: String,
    provider: String,
    session_context: Option<String>,
    project_structure: Option<String>,
    depth: Option<String>,
) -> Result<EnhancePromptResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        intent_enhance_prompt_blocking(
            app,
            prompt,
            provider,
            session_context,
            project_structure,
            depth,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn intent_enhance_prompt_blocking(
    app: tauri::AppHandle,
    prompt: String,
    provider: String,
    session_context: Option<String>,
    project_structure: Option<String>,
    depth: Option<String>,
) -> Result<EnhancePromptResponse, String> {
    let depth_rule = match depth.as_deref().unwrap_or("medium") {
        "short" => "- Be CONCISE — 1-2 sentences maximum. Add only the most essential clarification, no extras.",
        "strong" => "- Be THOROUGH — 5-8 sentences. Add detailed context, explicit acceptance criteria, mention specific files/components/areas when inferrable, and list edge cases to consider.",
        _ => "- Keep it balanced — 3-4 sentences. Add specificity and basic acceptance criteria.",
    };

    let system_prompt = format!(
        "You are a prompt enhancement assistant. Given a user's rough intent, rewrite it into a clear, detailed, and actionable prompt that will produce the best results when used to generate an execution plan for AI coding agents.\n\nRULES:\n- Keep the original intent and meaning intact\n- Add specificity: mention files, components, or areas if inferrable from the USER PROMPT or PROJECT STRUCTURE / SESSION CONTEXT provided\n- Add acceptance criteria when possible\n- DO NOT recommend or assume specific programming languages, frameworks, libraries, runtimes, build tools, package managers, testing tools, or design systems unless they are explicitly named in the USER PROMPT, the PROJECT STRUCTURE, or the SESSION CONTEXT. If the tech stack is not visible in the input, stay tech-agnostic and describe the WHAT and the WHY, not the HOW.\n- DO NOT invent file paths, component names, or APIs that are not present in the input\n{depth_rule}\n- Output ONLY the enhanced prompt text, nothing else — no quotes, no preamble, no explanation"
    );

    // parts = [USER PROMPT, SESSION CONTEXT?, PROJECT STRUCTURE?].filter(Boolean).join('\n')
    let mut parts: Vec<String> = vec![format!("USER PROMPT: {prompt}")];
    if let Some(sc) = session_context.as_ref().filter(|s| !s.is_empty()) {
        parts.push(format!("\nSESSION CONTEXT:\n{sc}"));
    }
    if let Some(ps) = project_structure.as_ref().filter(|s| !s.is_empty()) {
        parts.push(format!("\nPROJECT STRUCTURE:\n{ps}"));
    }
    let joined = parts.join("\n");

    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    match enhance_text(&provider, &joined, &cwd, Some(&system_prompt)) {
        Ok((text, engine)) => {
            if text.is_empty() {
                Ok(EnhancePromptResponse {
                    ok: false,
                    enhanced: None,
                    engine: None,
                    error: Some("Empty response from provider".to_string()),
                })
            } else {
                // creditAiPrompt('intent-enhance-prompt').
                crate::commands::session::credit_ai_utility_with_text(
                    &app,
                    "intent-enhance-prompt",
                    None,
                    None,
                    Some(&joined),
                );
                Ok(EnhancePromptResponse {
                    ok: true,
                    enhanced: Some(text),
                    engine: Some(engine.to_string()),
                    error: None,
                })
            }
        }
        Err(e) => Ok(EnhancePromptResponse {
            ok: false,
            enhanced: None,
            engine: None,
            error: Some(e),
        }),
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// DOMAIN 3 — shared-context:* (handlers + store + desktop-state store for the
//             context-transfer prefs)
// ═════════════════════════════════════════════════════════════════════════════

// ── Domain types (same JSON shape as the web UI types) ─────────────────────
// serde with the camelCase field names the renderer uses.

const SHARED_CONTEXT_FOLDER: &str = ".promptops";
const SHARED_CONTEXT_FILE: &str = "shared-context.json";

// SHARED_CONTEXT_LIMITS.
const MAX_FILE_SIZE_BYTES: usize = 64 * 1024;
const MAX_DECISIONS: usize = 20;
const MAX_FILE_REFS: usize = 50;
const MAX_NOTES: usize = 10;
const DECISION_SUMMARY_MAX: usize = 140;
const DECISION_RATIONALE_MAX: usize = 500;
const FILE_REF_REASON_MAX: usize = 80;
const NOTE_TEXT_MAX: usize = 280;

#[derive(Clone, Serialize, Deserialize)]
pub struct SharedContextIntent {
    pub goal: String,
    #[serde(rename = "activeTaskId")]
    pub active_task_id: Option<String>,
    #[serde(rename = "updatedBy")]
    pub updated_by: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SharedContextPlanStep {
    pub id: String,
    pub title: String,
    pub status: String, // 'todo' | 'doing' | 'done'
    #[serde(rename = "ownedBy", skip_serializing_if = "Option::is_none")]
    pub owned_by: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SharedContextPlan {
    pub id: String,
    pub steps: Vec<SharedContextPlanStep>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SharedContextDecision {
    pub id: String,
    pub provider: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SharedContextFileRef {
    pub path: String,
    pub reason: String,
    #[serde(rename = "touchedBy")]
    pub touched_by: Vec<String>,
    #[serde(rename = "lastTouched")]
    pub last_touched: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SharedContextNote {
    pub id: String,
    pub provider: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SharedContext {
    pub version: u8, // always 1
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub intent: Option<SharedContextIntent>,
    pub plan: Option<SharedContextPlan>,
    pub decisions: Vec<SharedContextDecision>,
    #[serde(rename = "fileRefs")]
    pub file_refs: Vec<SharedContextFileRef>,
    pub notes: Vec<SharedContextNote>,
}

fn empty_context(workspace_path: &str) -> SharedContext {
    SharedContext {
        version: 1,
        workspace_path: workspace_path.to_string(),
        updated_at: now_iso(),
        intent: None,
        plan: None,
        decisions: vec![],
        file_refs: vec![],
        notes: vec![],
    }
}

fn truncate(s: &str, max: usize) -> String {
    // JS `str.slice(0, max)` works on UTF-16; close enough to count chars here.
    if s.chars().count() > max {
        s.chars().take(max).collect()
    } else {
        s.to_string()
    }
}

// ── Patch payload (SharedContextPatch) ──────────────────────────────────────

#[derive(Deserialize)]
pub struct AddDecisionInput {
    pub id: Option<String>,
    pub provider: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub summary: String,
    pub rationale: Option<String>,
    pub files: Option<Vec<String>>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
pub struct TouchFileRefInput {
    pub path: String,
    pub reason: String,
    pub provider: String,
}

#[derive(Deserialize)]
pub struct AddNoteInput {
    pub id: Option<String>,
    pub provider: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
    pub source: Option<String>,
}

#[derive(Deserialize)]
pub struct SharedContextPatchInput {
    // `intent`/`plan` present = set (even to null). We use Option<Option<..>> to
    // distinguish "absent" from "present=null" as `patch.intent !== undefined` does.
    #[serde(default, deserialize_with = "double_option")]
    pub intent: Option<Option<SharedContextIntent>>,
    #[serde(default, deserialize_with = "double_option")]
    pub plan: Option<Option<SharedContextPlan>>,
    #[serde(rename = "addDecision")]
    pub add_decision: Option<AddDecisionInput>,
    #[serde(rename = "touchFileRef")]
    pub touch_file_ref: Option<TouchFileRefInput>,
    #[serde(rename = "addNote")]
    pub add_note: Option<AddNoteInput>,
}

/// Deserializes an optional field that can be absent, null, or set,
/// preserving the absent↔null distinction (for `!== undefined`).
fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

// ── Store (SharedContextStore) — State manager with cache + persistence ───────
//
// Persistence is SYNCHRONOUS and immediate (no debounce — irrelevant for the
// on-disk shape; a debounce would only be an I/O optimization). Keeps an
// in-memory cache and enforces the 64KB cap.

#[derive(Default)]
pub struct SharedContextStore {
    cache: Mutex<HashMap<String, SharedContext>>,
}

impl SharedContextStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn file_path(workspace_path: &str) -> PathBuf {
        Path::new(workspace_path)
            .join(SHARED_CONTEXT_FOLDER)
            .join(SHARED_CONTEXT_FILE)
    }

    /// `get(workspacePath)` — cache → load → empty.
    fn get(&self, workspace_path: &str) -> SharedContext {
        if let Some(c) = self.cache.lock().get(workspace_path) {
            return c.clone();
        }
        let loaded = Self::load(workspace_path);
        self.cache
            .lock()
            .insert(workspace_path.to_string(), loaded.clone());
        loaded
    }

    fn load(workspace_path: &str) -> SharedContext {
        let file = Self::file_path(workspace_path);
        if let Ok(raw) = std::fs::read_to_string(&file) {
            if let Ok(parsed) = serde_json::from_str::<SharedContext>(&raw) {
                if parsed.version == 1 && !parsed.workspace_path.is_empty() {
                    return parsed;
                }
            }
            // invalid shape → reinitialize.
        }
        empty_context(workspace_path)
    }

    /// `patch(workspacePath, patch)`.
    fn patch(&self, workspace_path: &str, patch: SharedContextPatchInput) -> SharedContext {
        let mut ctx = self.get(workspace_path);
        let now = now_iso();

        if let Some(intent) = patch.intent {
            ctx.intent = intent;
        }
        if let Some(plan) = patch.plan {
            ctx.plan = plan;
        }

        if let Some(d_in) = patch.add_decision {
            let d = SharedContextDecision {
                id: d_in.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
                provider: d_in.provider,
                session_id: d_in.session_id,
                summary: truncate(&d_in.summary, DECISION_SUMMARY_MAX),
                rationale: d_in.rationale.map(|r| truncate(&r, DECISION_RATIONALE_MAX)),
                files: d_in.files,
                created_at: d_in.created_at.unwrap_or_else(|| now.clone()),
            };
            ctx.decisions.insert(0, d);
            while ctx.decisions.len() > MAX_DECISIONS {
                ctx.decisions.pop();
            }
        }

        if let Some(t) = patch.touch_file_ref {
            let provider_id = t.provider;
            if let Some(idx) = ctx.file_refs.iter().position(|f| f.path == t.path) {
                let mut r = ctx.file_refs.remove(idx);
                if !r.touched_by.contains(&provider_id) {
                    r.touched_by.push(provider_id);
                }
                r.reason = truncate(&t.reason, FILE_REF_REASON_MAX);
                r.last_touched = now.clone();
                ctx.file_refs.insert(0, r);
            } else {
                let new_ref = SharedContextFileRef {
                    path: t.path,
                    reason: truncate(&t.reason, FILE_REF_REASON_MAX),
                    touched_by: vec![provider_id],
                    last_touched: now.clone(),
                };
                ctx.file_refs.insert(0, new_ref);
                while ctx.file_refs.len() > MAX_FILE_REFS {
                    ctx.file_refs.pop();
                }
            }
        }

        if let Some(n_in) = patch.add_note {
            let n = SharedContextNote {
                id: n_in.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
                provider: n_in.provider,
                text: truncate(&n_in.text, NOTE_TEXT_MAX),
                created_at: n_in.created_at.unwrap_or_else(|| now.clone()),
                source: n_in.source,
            };
            ctx.notes.insert(0, n);
            while ctx.notes.len() > MAX_NOTES {
                ctx.notes.pop();
            }
        }

        ctx.updated_at = now;
        Self::enforce_size_cap(&mut ctx);
        self.cache
            .lock()
            .insert(workspace_path.to_string(), ctx.clone());
        Self::persist(workspace_path, &ctx);
        ctx
    }

    /// `clear(workspacePath)`.
    fn clear(&self, workspace_path: &str) {
        self.cache.lock().remove(workspace_path);
        let _ = std::fs::remove_file(Self::file_path(workspace_path));
    }

    fn persist(workspace_path: &str, ctx: &SharedContext) {
        let file = Self::file_path(workspace_path);
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(serialized) = serde_json::to_string_pretty(ctx) {
            let _ = std::fs::write(&file, serialized);
        }
    }

    /// `enforceSizeCap` — trims notes → fileRefs → decisions (oldest first).
    fn enforce_size_cap(ctx: &mut SharedContext) {
        let measure =
            |c: &SharedContext| -> usize { serde_json::to_string(c).map(|s| s.len()).unwrap_or(0) };
        let mut guard = 2000;
        while measure(ctx) > MAX_FILE_SIZE_BYTES && guard > 0 {
            guard -= 1;
            let mut trimmed = false;
            if !ctx.notes.is_empty() {
                ctx.notes.pop();
                trimmed = true;
            } else if !ctx.file_refs.is_empty() {
                ctx.file_refs.pop();
                trimmed = true;
            } else if !ctx.decisions.is_empty() {
                ctx.decisions.pop();
                trimmed = true;
            }
            if !trimmed {
                break;
            }
        }
    }
}

// ── Context-transfer prefs (DesktopStateStore) ────────────────────────────────
//
// Kept in the encrypted local store (`ui_state` / `context-transfer-prefs`):
// the map is keyed by workspace PATH, which is personal. Older versions kept
// it in clear text in `<app data>/desktop-state.json` under
// `contextTransferPrefs`; that key is moved into the store on first use and
// removed from the file (the file goes when nothing else is left in it).

const PREFS_COLLECTION: &str = "ui_state";
const PREFS_ID: &str = "context-transfer-prefs";
const LEGACY_PREFS_KEY: &str = "contextTransferPrefs";

#[derive(Default)]
pub struct DesktopStateStore {
    file_path: Mutex<Option<PathBuf>>,
}

impl DesktopStateStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Legacy `desktop-state.json` in `app_data_dir()`, read only to migrate.
    fn legacy_path(&self, app: &AppHandle) -> Option<PathBuf> {
        if let Some(p) = self.file_path.lock().clone() {
            return Some(p);
        }
        let p = app.path().app_data_dir().ok()?.join("desktop-state.json");
        *self.file_path.lock() = Some(p.clone());
        Some(p)
    }

    /// `getContextTransferPref(workspacePath, providerId)` — default 'ask'.
    fn get_pref(&self, app: &AppHandle, workspace_path: &str, provider_id: &str) -> String {
        match crate::local_store::get() {
            Some(store) => get_pref_in(
                store,
                self.legacy_path(app).as_deref(),
                workspace_path,
                provider_id,
            ),
            None => "ask".to_string(),
        }
    }

    /// `setContextTransferPref(workspacePath, providerId, pref)`.
    fn set_pref(
        &self,
        app: &AppHandle,
        workspace_path: &str,
        provider_id: &str,
        pref: &str,
    ) -> Result<(), String> {
        let store = crate::local_store::get()
            .ok_or_else(|| "The local store is not available.".to_string())?;
        set_pref_in(
            store,
            self.legacy_path(app).as_deref(),
            workspace_path,
            provider_id,
            pref,
        )
    }
}

/// The prefs map `{ workspace: { provider: pref } }`, moving a legacy clear
/// text copy into the store the first time.
fn load_prefs_in(store: &crate::local_store::LocalStore, legacy: Option<&Path>) -> Value {
    if let Some(v) = store
        .get(PREFS_COLLECTION, PREFS_ID)
        .and_then(|r| r.get("prefs").cloned())
        .filter(Value::is_object)
    {
        return v;
    }
    let Some(path) = legacy else {
        return json!({});
    };
    let Some(mut file) = std::fs::read(path)
        .ok()
        .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok())
        .filter(Value::is_object)
    else {
        return json!({});
    };
    let Some(prefs) = file
        .as_object_mut()
        .and_then(|o| o.remove(LEGACY_PREFS_KEY))
    else {
        return json!({});
    };
    let prefs = if prefs.is_object() { prefs } else { json!({}) };
    if store
        .put(
            PREFS_COLLECTION,
            PREFS_ID,
            json!({ "prefs": prefs.clone() }),
        )
        .is_ok()
    {
        let obj = file.as_object().cloned().unwrap_or_default();
        if obj.keys().all(|k| k == "savedAt") {
            let _ = std::fs::remove_file(path);
        } else if let Ok(body) = serde_json::to_vec_pretty(&file) {
            let _ = crate::local_store::replace_file_private(path, &body);
        }
    }
    prefs
}

fn get_pref_in(
    store: &crate::local_store::LocalStore,
    legacy: Option<&Path>,
    workspace_path: &str,
    provider_id: &str,
) -> String {
    load_prefs_in(store, legacy)
        .get(workspace_path)
        .and_then(|w| w.get(provider_id))
        .and_then(|v| v.as_str())
        .unwrap_or("ask")
        .to_string()
}

fn set_pref_in(
    store: &crate::local_store::LocalStore,
    legacy: Option<&Path>,
    workspace_path: &str,
    provider_id: &str,
    pref: &str,
) -> Result<(), String> {
    let mut prefs = load_prefs_in(store, legacy);
    let Some(prefs_obj) = prefs.as_object_mut() else {
        return Err("invalid preferences record".into());
    };
    let mut for_workspace = prefs_obj
        .get(workspace_path)
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    if pref == "ask" {
        for_workspace.remove(provider_id);
    } else {
        for_workspace.insert(provider_id.to_string(), json!(pref));
    }
    if for_workspace.is_empty() {
        prefs_obj.remove(workspace_path);
    } else {
        prefs_obj.insert(workspace_path.to_string(), Value::Object(for_workspace));
    }
    store.put(
        PREFS_COLLECTION,
        PREFS_ID,
        json!({ "prefs": prefs, "savedAt": now_iso() }),
    )
}

// ── shared-context handler responses ──────────────────────────────────────────

#[derive(Serialize)]
pub struct ContextResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<SharedContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct PrefResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── COMMANDS shared-context:* ────────────────────────────────────────────────

/// shared-context:get
#[tauri::command]
pub fn shared_context_get(
    store: tauri::State<'_, Arc<SharedContextStore>>,
    workspace_path: String,
) -> Result<ContextResponse, String> {
    let ctx = store.get(&workspace_path);
    Ok(ContextResponse {
        ok: true,
        context: Some(ctx),
        error: None,
    })
}

/// shared-context:patch — emits `shared-context:changed`.
#[tauri::command]
pub fn shared_context_patch(
    app: AppHandle,
    store: tauri::State<'_, Arc<SharedContextStore>>,
    workspace_path: String,
    patch: SharedContextPatchInput,
) -> Result<ContextResponse, String> {
    let ctx = store.patch(&workspace_path, patch);
    let _ = app.emit(
        SHARED_CONTEXT_CHANGED,
        json!({ "workspacePath": workspace_path, "context": ctx }),
    );
    Ok(ContextResponse {
        ok: true,
        context: Some(ctx),
        error: None,
    })
}

/// shared-context:clear — emits `shared-context:changed` with context=null.
#[tauri::command]
pub fn shared_context_clear(
    app: AppHandle,
    store: tauri::State<'_, Arc<SharedContextStore>>,
    workspace_path: String,
) -> Result<OkResponse, String> {
    store.clear(&workspace_path);
    let _ = app.emit(
        SHARED_CONTEXT_CHANGED,
        json!({ "workspacePath": workspace_path, "context": Value::Null }),
    );
    Ok(OkResponse {
        ok: true,
        error: None,
    })
}

/// shared-context:get-pref
#[tauri::command]
pub fn shared_context_get_pref(
    app: AppHandle,
    desktop_state: tauri::State<'_, Arc<DesktopStateStore>>,
    workspace_path: String,
    provider_id: String,
) -> Result<PrefResponse, String> {
    let pref = desktop_state.get_pref(&app, &workspace_path, &provider_id);
    Ok(PrefResponse {
        ok: true,
        pref: Some(pref),
        error: None,
    })
}

/// shared-context:set-pref
#[tauri::command]
pub fn shared_context_set_pref(
    app: AppHandle,
    desktop_state: tauri::State<'_, Arc<DesktopStateStore>>,
    workspace_path: String,
    provider_id: String,
    pref: String,
) -> Result<OkResponse, String> {
    Ok(
        match desktop_state.set_pref(&app, &workspace_path, &provider_id, &pref) {
            Ok(()) => OkResponse {
                ok: true,
                error: None,
            },
            Err(e) => OkResponse {
                ok: false,
                error: Some(e),
            },
        },
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// DOMAIN 4 — context-snapshot:* (handlers + engine + types)
// ═════════════════════════════════════════════════════════════════════════════

const SNAPSHOT_DIR: &str = ".promptops";
const SNAPSHOT_FILE: &str = "project-context.json";
/// Folder under the app data dir that holds one snapshot per workspace.
const SNAPSHOT_STORE_DIR: &str = "context-snapshots";

/// Where the project context snapshot of a workspace lives: the app data dir,
/// keyed by a hash of the workspace path. It used to be written to
/// `<repo>/.promptops/project-context.json` (plus a `.gitignore` edit) every
/// time a session was created — an open-source tool must not touch the
/// user's repository without being asked.
pub(crate) fn project_context_snapshot_path(workspace_path: &str) -> PathBuf {
    project_context_snapshot_path_in(&crate::commands::hook::hook_data_dir(), workspace_path)
}

fn project_context_snapshot_path_in(data_dir: &Path, workspace_path: &str) -> PathBuf {
    data_dir
        .join(SNAPSHOT_STORE_DIR)
        .join(format!("{}.json", workspace_key(workspace_path)))
}

/// Stable file-name key of a workspace for per-workspace data kept in the app
/// data folder (context snapshots, semantic index): 32 hex chars of the
/// SHA-256 of the path without trailing separators. Never the path itself.
pub(crate) fn workspace_key(workspace_path: &str) -> String {
    use sha2::{Digest, Sha256};
    let normalized = workspace_path.trim().trim_end_matches(['/', '\\']);
    let digest = Sha256::digest(normalized.as_bytes());
    digest[..16].iter().map(|b| format!("{b:02x}")).collect()
}

/// Raw snapshot JSON of a workspace: the app data copy, else a legacy
/// `<repo>/.promptops/project-context.json` left by older versions (read
/// only, never written).
pub(crate) fn read_project_context(workspace_path: &str) -> Option<String> {
    std::fs::read_to_string(project_context_snapshot_path(workspace_path))
        .ok()
        .or_else(|| {
            std::fs::read_to_string(
                Path::new(workspace_path)
                    .join(SNAPSHOT_DIR)
                    .join(SNAPSHOT_FILE),
            )
            .ok()
        })
}
const SNAPSHOT_VERSION: &str = "1.0";

fn skip_dirs() -> HashSet<&'static str> {
    [
        "node_modules",
        "vendor",
        ".git",
        ".next",
        ".nuxt",
        "dist",
        "build",
        "__pycache__",
        ".venv",
        "venv",
        ".tox",
        "target",
        ".gradle",
        "coverage",
        ".cache",
        ".turbo",
        ".svelte-kit",
        ".output",
        "storage",
        ".idea",
        ".vscode",
        "tmp",
        "logs",
        ".promptops-assets",
    ]
    .into_iter()
    .collect()
}

// ── Types (same JSON shape as the web UI types) ────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct SnapshotFolderEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String, // 'directory' | 'file'
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SnapshotFolderEntry>>,
    #[serde(rename = "fileCount", skip_serializing_if = "Option::is_none")]
    pub file_count: Option<usize>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SnapshotRuntime {
    pub docker: bool,
    #[serde(rename = "dockerCompose")]
    pub docker_compose: bool,
    pub ci: Option<String>,
    #[serde(rename = "ciConfigFiles")]
    pub ci_config_files: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SnapshotGitInfo {
    pub branch: Option<String>,
    #[serde(rename = "recentFiles")]
    pub recent_files: Vec<String>,
    #[serde(rename = "lastCommitMessage")]
    pub last_commit_message: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ProjectContextSnapshot {
    pub version: String,
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    pub status: String,
    pub frameworks: Vec<String>,
    pub languages: Vec<String>,
    #[serde(rename = "entryPoints")]
    pub entry_points: Vec<String>,
    #[serde(rename = "importantFiles")]
    pub important_files: Vec<String>,
    #[serde(rename = "configFiles")]
    pub config_files: Vec<String>,
    pub folders: Vec<SnapshotFolderEntry>,
    pub runtime: SnapshotRuntime,
    #[serde(rename = "packageManager")]
    pub package_manager: Option<String>,
    pub git: SnapshotGitInfo,
    #[serde(rename = "ignoredFolders")]
    pub ignored_folders: Vec<String>,
    #[serde(rename = "databaseFiles")]
    pub database_files: Vec<String>,
    #[serde(rename = "testFiles")]
    pub test_files: Vec<String>,
    pub summary: String,
}

#[derive(Serialize)]
pub struct SnapshotGenerateResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<ProjectContextSnapshot>,
    #[serde(rename = "filePath", skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SnapshotStatusResult {
    pub status: String,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<ProjectContextSnapshot>,
}

#[derive(Serialize)]
pub struct SnapshotGetResult {
    pub ok: bool,
    pub snapshot: Option<ProjectContextSnapshot>,
}

#[derive(Serialize)]
pub struct ProviderSummaryResult {
    pub ok: bool,
    pub summary: Option<String>,
}

// ── Engine (ContextSnapshotEngine) — State manager ────────────────────────────
//
// Phase 2 (deep scan) runs SYNCHRONOUSLY right after Phase 1. The final
// effect on disk/cache is status advanced_ready, and the progress/complete
// events are emitted in order.
// TODO: framework detection is MINIMAL; a full workspace analyzer is missing.

#[derive(Default)]
pub struct ContextSnapshotEngine {
    status_map: Mutex<HashMap<String, String>>,
    snapshot_cache: Mutex<HashMap<String, ProjectContextSnapshot>>,
}

impl ContextSnapshotEngine {
    pub fn new() -> Self {
        Self::default()
    }

    fn snapshot_path(workspace_path: &str) -> PathBuf {
        project_context_snapshot_path(workspace_path)
    }

    /// `generate(workspacePath)` — Phase 1 + (here) synchronous Phase 2.
    fn generate(&self, app: &AppHandle, workspace_path: &str) -> SnapshotGenerateResult {
        self.status_map
            .lock()
            .insert(workspace_path.to_string(), "scanning".to_string());
        self.emit_progress(app, workspace_path, 1, 4, "Scanning directories");

        let project_name = Path::new(workspace_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| workspace_path.to_string());

        // Step 1: folders depth 2.
        let folders = self.scan_folders(workspace_path, 0, 2);
        self.emit_progress(app, workspace_path, 2, 4, "Detecting frameworks");

        // Step 2: framework/language detection.
        // TODO: no full workspace analyzer yet — we use a minimal
        // detection for package.json/composer.json, so some frameworks
        // are not detected.
        let (mut frameworks, mut languages) = detect_framework_minimal(workspace_path);
        self.detect_additional_frameworks(workspace_path, &mut frameworks, &mut languages);

        self.emit_progress(app, workspace_path, 3, 4, "Identifying entry points");

        let entry_points = detect_entry_points(workspace_path, &frameworks);
        let config_files = detect_config_files(workspace_path);
        let important_files = detect_important_files(workspace_path);

        let runtime = detect_runtime(workspace_path);
        let package_manager = detect_package_manager(workspace_path);
        let database_files = detect_database_files(workspace_path);
        // TODO: detect the test setup (needs a workspace analyzer).
        let test_files: Vec<String> = vec![];

        self.emit_progress(app, workspace_path, 4, 4, "Preparing project map");

        // Quick git info (branch only).
        let git = get_quick_git_info(workspace_path);

        // dedupe languages (new Set).
        let languages_dedup = dedup(&languages);

        let mut snapshot = ProjectContextSnapshot {
            version: SNAPSHOT_VERSION.to_string(),
            project_name: project_name.clone(),
            generated_at: now_iso(),
            status: "basic_ready".to_string(),
            frameworks: frameworks.clone(),
            languages: languages_dedup.clone(),
            entry_points: entry_points.clone(),
            important_files: important_files.clone(),
            config_files,
            folders,
            runtime: runtime.clone(),
            package_manager: package_manager.clone(),
            git,
            ignored_folders: skip_dirs().into_iter().map(|s| s.to_string()).collect(),
            database_files,
            test_files,
            summary: build_summary(
                &project_name,
                &frameworks,
                &languages_dedup,
                &entry_points,
                &runtime,
                &package_manager,
            ),
        };

        // Write snapshot (non-fatal). It goes to the app data dir, never into
        // the user's repository (no `.promptops/` folder, no `.gitignore` edit).
        let mut file_path: Option<String> = None;
        if let Ok(p) = self.write_snapshot(workspace_path, &snapshot) {
            file_path = Some(p);
        }

        self.status_map
            .lock()
            .insert(workspace_path.to_string(), "basic_ready".to_string());
        self.snapshot_cache
            .lock()
            .insert(workspace_path.to_string(), snapshot.clone());

        // ── Phase 2 (synchronous) ─────────────────────────────────────────────────────
        // TODO: run Phase 2 in the background so it does not block; it runs in sequence now.
        let deep_git = get_deep_git_info(workspace_path);
        snapshot.git = deep_git;
        snapshot.folders = self.scan_folders(workspace_path, 0, 3);
        let deep_important = deep_scan_important_files(workspace_path);
        let mut merged_important = snapshot.important_files.clone();
        for f in deep_important {
            if !merged_important.contains(&f) {
                merged_important.push(f);
            }
        }
        snapshot.important_files = merged_important;
        snapshot.status = "advanced_ready".to_string();
        snapshot.generated_at = now_iso();
        snapshot.summary = build_summary(
            &snapshot.project_name,
            &snapshot.frameworks,
            &snapshot.languages,
            &snapshot.entry_points,
            &snapshot.runtime,
            &snapshot.package_manager,
        );
        self.snapshot_cache
            .lock()
            .insert(workspace_path.to_string(), snapshot.clone());
        self.status_map
            .lock()
            .insert(workspace_path.to_string(), "advanced_ready".to_string());
        let _ = self.write_snapshot(workspace_path, &snapshot);
        let _ = app.emit(
            CONTEXT_SNAPSHOT_COMPLETE,
            json!({ "workspacePath": workspace_path, "status": "advanced_ready" }),
        );

        SnapshotGenerateResult {
            ok: true,
            snapshot: Some(snapshot),
            file_path,
            error: None,
        }
    }

    fn get_status(&self, workspace_path: &str) -> SnapshotStatusResult {
        let status = self
            .status_map
            .lock()
            .get(workspace_path)
            .cloned()
            .unwrap_or_else(|| "idle".to_string());
        let file = Self::snapshot_path(workspace_path);
        let exists = file.exists();
        SnapshotStatusResult {
            status,
            file_path: if exists {
                Some(file.to_string_lossy().to_string())
            } else {
                None
            },
            snapshot: self.snapshot_cache.lock().get(workspace_path).cloned(),
        }
    }

    fn read_snapshot(workspace_path: &str) -> Option<ProjectContextSnapshot> {
        read_project_context(workspace_path)
            .and_then(|c| serde_json::from_str::<ProjectContextSnapshot>(&c).ok())
    }

    /// `scanFolders(dirPath, depth, maxDepth)`.
    fn scan_folders(&self, dir_path: &str, depth: u32, max_depth: u32) -> Vec<SnapshotFolderEntry> {
        if depth > max_depth {
            return vec![];
        }
        let skip = skip_dirs();
        let mut entries: Vec<SnapshotFolderEntry> = Vec::new();

        let read = match std::fs::read_dir(dir_path) {
            Ok(r) => r,
            Err(_) => return entries,
        };

        let mut dirs: Vec<(String, PathBuf)> = Vec::new();
        let mut files: Vec<String> = Vec::new();
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let ft = entry.file_type().ok();
            let is_dir = ft.map(|t| t.is_dir()).unwrap_or(false);
            let is_file = ft.map(|t| t.is_file()).unwrap_or(false);
            if is_dir && !skip.contains(name.as_str()) {
                dirs.push((name, entry.path()));
            } else if is_file {
                files.push(name);
            }
        }

        dirs.sort_by(|a, b| a.0.cmp(&b.0));
        files.sort();

        for (name, path) in dirs {
            let children = if depth < max_depth {
                Some(self.scan_folders(&path.to_string_lossy(), depth + 1, max_depth))
            } else {
                None
            };
            let mut entry = SnapshotFolderEntry {
                name,
                kind: "directory".to_string(),
                children,
                file_count: None,
            };
            if depth <= 1 {
                entry.file_count = Some(count_files_quick(&path.to_string_lossy()));
            }
            entries.push(entry);
        }

        if depth <= 1 {
            for file in files {
                if is_key_file(&file) {
                    entries.push(SnapshotFolderEntry {
                        name: file,
                        kind: "file".to_string(),
                        children: None,
                        file_count: None,
                    });
                }
            }
        }

        entries
    }

    fn detect_additional_frameworks(
        &self,
        workspace_path: &str,
        frameworks: &mut Vec<String>,
        languages: &mut Vec<String>,
    ) {
        let subdirs = [
            "backend",
            "frontend",
            "webapp",
            "desktop-app",
            "api",
            "web",
            "server",
            "client",
        ];
        for sub in subdirs {
            let sub_path = Path::new(workspace_path).join(sub);
            if !sub_path.exists() {
                continue;
            }
            let (fw, lang) = detect_framework_minimal(&sub_path.to_string_lossy());
            for (i, name) in fw.iter().enumerate() {
                if !frameworks.contains(name) {
                    frameworks.push(name.clone());
                    if let Some(l) = lang.get(i) {
                        if !languages.contains(l) {
                            languages.push(l.clone());
                        }
                    }
                }
            }
        }
    }

    fn write_snapshot(
        &self,
        workspace_path: &str,
        snapshot: &ProjectContextSnapshot,
    ) -> Result<String, String> {
        let file = Self::snapshot_path(workspace_path);
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let serialized = serde_json::to_string_pretty(snapshot).map_err(|e| e.to_string())?;
        std::fs::write(&file, serialized).map_err(|e| e.to_string())?;
        Ok(file.to_string_lossy().to_string())
    }

    fn get_provider_summary(workspace_path: &str, snapshot: &ProjectContextSnapshot) -> String {
        let mut lines: Vec<String> = Vec::new();
        lines.push("# Project Context Snapshot (auto-generated by PromptOps)".to_string());
        lines.push(String::new());
        lines.push(format!("Project: {}", snapshot.project_name));

        if !snapshot.frameworks.is_empty() {
            lines.push(format!("Frameworks: {}", snapshot.frameworks.join(", ")));
        }
        if !snapshot.languages.is_empty() {
            lines.push(format!("Languages: {}", snapshot.languages.join(", ")));
        }
        if let Some(pm) = &snapshot.package_manager {
            lines.push(format!("Package Manager: {pm}"));
        }
        if !snapshot.entry_points.is_empty() {
            lines.push(format!(
                "Entry Points: {}",
                slice_join(&snapshot.entry_points, 8)
            ));
        }
        if !snapshot.config_files.is_empty() {
            lines.push(format!(
                "Config Files: {}",
                slice_join(&snapshot.config_files, 8)
            ));
        }
        if snapshot.runtime.docker {
            lines.push("Docker: present".to_string());
        }
        if let Some(ci) = &snapshot.runtime.ci {
            lines.push(format!("CI/CD: {ci}"));
        }
        if !snapshot.database_files.is_empty() {
            lines.push(format!(
                "Database: {}",
                slice_join(&snapshot.database_files, 5)
            ));
        }
        if let Some(branch) = &snapshot.git.branch {
            lines.push(format!("Git Branch: {branch}"));
        }
        if !snapshot.git.recent_files.is_empty() {
            lines.push(format!(
                "Recently Changed: {}",
                slice_join(&snapshot.git.recent_files, 10)
            ));
        }

        lines.push(String::new());
        lines.push(format!(
            "Use this context before exploring the repository. A full snapshot is at {}",
            project_context_snapshot_path(workspace_path).display()
        ));

        lines.join("\n")
    }

    fn emit_progress(
        &self,
        app: &AppHandle,
        workspace_path: &str,
        step: u32,
        total_steps: u32,
        label: &str,
    ) {
        let status = self
            .status_map
            .lock()
            .get(workspace_path)
            .cloned()
            .unwrap_or_else(|| "scanning".to_string());
        let _ = app.emit(
            CONTEXT_SNAPSHOT_PROGRESS,
            json!({
                "workspacePath": workspace_path,
                "step": step,
                "totalSteps": total_steps,
                "label": label,
                "status": status,
            }),
        );
    }
}

// ── Engine helpers (free functions) ─────────────────────────────────────────

fn count_files_quick(dir_path: &str) -> usize {
    std::fs::read_dir(dir_path)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                .count()
        })
        .unwrap_or(0)
}

/// `isKeyFile(name)` — matches the key-file name patterns.
fn is_key_file(name: &str) -> bool {
    let exact = [
        "package.json",
        "composer.json",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
        "Makefile",
        ".env.example",
        "Dockerfile",
        "artisan",
        "manage.py",
        "angular.json",
    ];
    if exact.contains(&name) {
        return true;
    }
    let lower = name.to_lowercase();
    if lower == "readme.md" || lower == "claude.md" {
        return true;
    }
    // ^tsconfig.*\.json$
    if name.starts_with("tsconfig") && name.ends_with(".json") {
        return true;
    }
    // ^docker-compose.*\.ya?ml$
    if name.starts_with("docker-compose") && (name.ends_with(".yml") || name.ends_with(".yaml")) {
        return true;
    }
    // \.config\.(ts|js|mjs)$
    if name.ends_with(".config.ts") || name.ends_with(".config.js") || name.ends_with(".config.mjs")
    {
        return true;
    }
    // known config prefixes.
    for p in [
        "vite.config",
        "next.config",
        "tailwind.config",
        "webpack.config",
    ] {
        if name.starts_with(p) {
            return true;
        }
    }
    false
}

/// Minimal framework detection (replaces WorkspaceAnalyzer.analyze).
/// TODO: cover more frameworks + test/cicd/domainHints.
fn detect_framework_minimal(cwd: &str) -> (Vec<String>, Vec<String>) {
    // composer.json → laravel/symfony.
    let composer = Path::new(cwd).join("composer.json");
    if composer.exists() {
        if let Ok(raw) = std::fs::read_to_string(&composer) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                let mut req = serde_json::Map::new();
                if let Some(r) = v.get("require").and_then(|x| x.as_object()) {
                    req.extend(r.clone());
                }
                if let Some(r) = v.get("require-dev").and_then(|x| x.as_object()) {
                    req.extend(r.clone());
                }
                if req.contains_key("laravel/framework") {
                    return (vec!["laravel".to_string()], vec!["php".to_string()]);
                }
                if req.contains_key("symfony/framework-bundle") {
                    return (vec!["symfony".to_string()], vec!["php".to_string()]);
                }
            }
        }
    }
    // package.json → JS/TS frameworks.
    let pkg = Path::new(cwd).join("package.json");
    if pkg.exists() {
        if let Ok(raw) = std::fs::read_to_string(&pkg) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                let mut deps = serde_json::Map::new();
                if let Some(d) = v.get("dependencies").and_then(|x| x.as_object()) {
                    deps.extend(d.clone());
                }
                if let Some(d) = v.get("devDependencies").and_then(|x| x.as_object()) {
                    deps.extend(d.clone());
                }
                let has = |k: &str| deps.contains_key(k);
                let ts = vec!["typescript".to_string()];
                if has("next") {
                    return (vec!["nextjs".to_string()], ts);
                }
                if has("nuxt") || has("nuxt3") {
                    return (vec!["nuxt".to_string()], ts);
                }
                if has("@angular/core") {
                    return (vec!["angular".to_string()], ts);
                }
                if has("react") {
                    return (vec!["react".to_string()], ts);
                }
                if has("vue") {
                    return (vec!["vue".to_string()], ts);
                }
                if has("svelte") || has("@sveltejs/kit") {
                    return (vec!["svelte".to_string()], ts);
                }
                if has("express") {
                    return (vec!["express".to_string()], ts);
                }
                if has("fastify") {
                    return (vec!["fastify".to_string()], ts);
                }
                if has("nestjs") || has("@nestjs/core") {
                    return (vec!["nestjs".to_string()], ts);
                }
            }
        }
    }
    (vec![], vec![])
}

fn detect_entry_points(workspace_path: &str, frameworks: &[String]) -> Vec<String> {
    let mut entries: Vec<String> = Vec::new();
    let check = |rel: &str, out: &mut Vec<String>| {
        if Path::new(workspace_path).join(rel).exists() {
            out.push(rel.to_string());
        }
    };
    let fw = |n: &str| frameworks.iter().any(|f| f == n);

    if fw("laravel") {
        check("routes/api.php", &mut entries);
        check("routes/web.php", &mut entries);
        check("bootstrap/app.php", &mut entries);
        check("artisan", &mut entries);
    }
    if fw("angular") {
        check("src/main.ts", &mut entries);
        check("src/app/app.config.ts", &mut entries);
        check("src/app/app.routes.ts", &mut entries);
    }
    if fw("nextjs") {
        check("next.config.js", &mut entries);
        check("next.config.mjs", &mut entries);
        check("next.config.ts", &mut entries);
    }
    if fw("react") {
        check("src/App.tsx", &mut entries);
        check("src/index.tsx", &mut entries);
    }
    if fw("django") {
        check("manage.py", &mut entries);
    }
    if fw("express") || fw("fastify") || fw("nestjs") {
        check("src/index.ts", &mut entries);
        check("src/main.ts", &mut entries);
        check("src/server.ts", &mut entries);
    }
    // Generic.
    check("src/index.ts", &mut entries);
    check("src/main.ts", &mut entries);
    check("index.ts", &mut entries);
    check("main.py", &mut entries);
    check("app.py", &mut entries);
    check("server.py", &mut entries);
    check("main.go", &mut entries);
    check("cmd/main.go", &mut entries);

    dedup(&entries)
}

fn detect_config_files(workspace_path: &str) -> Vec<String> {
    let candidates = [
        "package.json",
        "composer.json",
        "tsconfig.json",
        "angular.json",
        "vite.config.ts",
        "vite.config.js",
        "next.config.js",
        "next.config.mjs",
        "next.config.ts",
        "webpack.config.js",
        "tailwind.config.js",
        "tailwind.config.ts",
        "postcss.config.js",
        "postcss.config.mjs",
        "pyproject.toml",
        "requirements.txt",
        "Cargo.toml",
        "go.mod",
        ".env.example",
        ".env",
        "Dockerfile",
        "docker-compose.yml",
        "docker-compose.prod.yml",
        ".github/workflows",
        ".gitlab-ci.yml",
    ];
    candidates
        .iter()
        .filter(|rel| Path::new(workspace_path).join(rel).exists())
        .map(|s| s.to_string())
        .collect()
}

fn detect_important_files(workspace_path: &str) -> Vec<String> {
    let candidates = [
        "README.md",
        "CLAUDE.md",
        "CONTRIBUTING.md",
        "LICENSE",
        ".gitignore",
        ".editorconfig",
        "Makefile",
        "Procfile",
    ];
    candidates
        .iter()
        .filter(|rel| Path::new(workspace_path).join(rel).exists())
        .map(|s| s.to_string())
        .collect()
}

fn detect_database_files(workspace_path: &str) -> Vec<String> {
    let candidates = [
        "database/migrations",
        "prisma/schema.prisma",
        "drizzle.config.ts",
        "knexfile.js",
        "knexfile.ts",
        "ormconfig.json",
        "typeorm.config.ts",
        "config/database.php",
        "models",
        "app/Models",
        "alembic.ini",
        "alembic/",
    ];
    candidates
        .iter()
        .filter(|rel| {
            Path::new(workspace_path)
                .join(rel.trim_end_matches('/'))
                .exists()
        })
        .map(|s| s.to_string())
        .collect()
}

fn detect_runtime(workspace_path: &str) -> SnapshotRuntime {
    let exists = |rel: &str| Path::new(workspace_path).join(rel).exists();
    // TODO: detect CI (ci/ciConfigFiles) — null/[] for now, it needs a
    // workspace analyzer.
    SnapshotRuntime {
        docker: exists("Dockerfile"),
        docker_compose: exists("docker-compose.yml") || exists("docker-compose.prod.yml"),
        ci: None,
        ci_config_files: vec![],
    }
}

fn detect_package_manager(workspace_path: &str) -> Option<String> {
    let pairs = [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("package-lock.json", "npm"),
        ("composer.lock", "composer"),
        ("Pipfile.lock", "pipenv"),
        ("poetry.lock", "poetry"),
        ("Cargo.lock", "cargo"),
        ("go.sum", "go"),
    ];
    for (file, pm) in pairs {
        if Path::new(workspace_path).join(file).exists() {
            return Some(pm.to_string());
        }
    }
    None
}

/// `getQuickGitInfoAsync` — solo branch (`git rev-parse --abbrev-ref HEAD`).
fn get_quick_git_info(workspace_path: &str) -> SnapshotGitInfo {
    let branch = run_git_capture(workspace_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|s| !s.is_empty());
    SnapshotGitInfo {
        branch,
        recent_files: vec![],
        last_commit_message: None,
    }
}

/// `getDeepGitInfoAsync` — branch + recentFiles + lastCommitMessage.
fn get_deep_git_info(workspace_path: &str) -> SnapshotGitInfo {
    let mut info = SnapshotGitInfo {
        branch: None,
        recent_files: vec![],
        last_commit_message: None,
    };

    info.branch = run_git_capture(workspace_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|s| !s.is_empty());

    // `git diff --name-only HEAD~5`, else (fewer than 5 commits) the working
    // tree diff. Two direct calls: no shell, no `2>/dev/null` that PowerShell
    // and cmd do not understand.
    let recent = run_git_capture(
        workspace_path,
        &["diff", "--no-ext-diff", "--name-only", "HEAD~5", "--"],
    )
    .or_else(|| {
        run_git_capture(
            workspace_path,
            &["diff", "--no-ext-diff", "--name-only", "--"],
        )
    });
    if let Some(r) = recent.filter(|s| !s.is_empty()) {
        info.recent_files = r
            .split('\n')
            .filter(|l| !l.is_empty())
            .take(20)
            .map(|s| s.to_string())
            .collect();
    }

    info.last_commit_message =
        run_git_capture(workspace_path, &["log", "-1", "--pretty=%s"]).filter(|s| !s.is_empty());

    info
}

/// `git <args>` → trimmed stdout, None on error/empty.
fn run_git_capture(cwd: &str, args: &[&str]) -> Option<String> {
    // Read-only probes of a folder the user just opened: a hostile repository
    // config (core.fsmonitor, an external diff driver) must not run programs.
    crate::commands::util_cmd::cmd("git")
        .args(["-c", "core.fsmonitor=false"])
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

fn deep_scan_important_files(workspace_path: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for sub in ["docs", "doc", "backend", "frontend", "webapp", "api"] {
        let readme = Path::new(workspace_path).join(sub).join("README.md");
        if readme.exists() {
            files.push(format!("{sub}/README.md"));
        }
    }
    files
}

fn build_summary(
    project_name: &str,
    frameworks: &[String],
    languages: &[String],
    entry_points: &[String],
    runtime: &SnapshotRuntime,
    package_manager: &Option<String>,
) -> String {
    let mut parts: Vec<String> = vec![project_name.to_string()];
    if !frameworks.is_empty() {
        parts.push(format!("using {}", frameworks.join(" + ")));
    } else if !languages.is_empty() {
        parts.push(format!("({})", languages.join(", ")));
    }
    if let Some(pm) = package_manager {
        parts.push(format!("[{pm}]"));
    }
    if runtime.docker {
        parts.push("with Docker".to_string());
    }
    if let Some(ci) = &runtime.ci {
        parts.push(format!("CI: {ci}"));
    }
    parts.push(format!("— {} entry points detected", entry_points.len()));
    parts.join(" ")
}

/// `[...new Set(v)]` preserving first-appearance order.
fn dedup(v: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in v {
        if seen.insert(item.clone()) {
            out.push(item.clone());
        }
    }
    out
}

/// `arr.slice(0, n).join(', ')`.
fn slice_join(v: &[String], n: usize) -> String {
    v.iter().take(n).cloned().collect::<Vec<_>>().join(", ")
}

// ── COMMANDS context-snapshot:* ──────────────────────────────────────────────

/// context-snapshot:generate — directory scan + git calls: off the main thread.
#[tauri::command]
pub async fn context_snapshot_generate(
    app: AppHandle,
    engine: tauri::State<'_, Arc<ContextSnapshotEngine>>,
    workspace_path: String,
) -> Result<SnapshotGenerateResult, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.generate(&app, &workspace_path))
        .await
        .map_err(|e| e.to_string())
}

/// context-snapshot:status
#[tauri::command]
pub fn context_snapshot_status(
    engine: tauri::State<'_, Arc<ContextSnapshotEngine>>,
    workspace_path: String,
) -> Result<SnapshotStatusResult, String> {
    Ok(engine.get_status(&workspace_path))
}

/// context-snapshot:get — reads the snapshot from disk.
#[tauri::command]
pub fn context_snapshot_get(workspace_path: String) -> Result<SnapshotGetResult, String> {
    let snapshot = ContextSnapshotEngine::read_snapshot(&workspace_path);
    Ok(SnapshotGetResult {
        ok: snapshot.is_some(),
        snapshot,
    })
}

/// context-snapshot:refresh — regenerates (alias of generate).
#[tauri::command]
pub async fn context_snapshot_refresh(
    app: AppHandle,
    engine: tauri::State<'_, Arc<ContextSnapshotEngine>>,
    workspace_path: String,
) -> Result<SnapshotGenerateResult, String> {
    context_snapshot_generate(app, engine, workspace_path).await
}

/// context-snapshot:provider-summary — compact summary from the on-disk snapshot.
#[tauri::command]
pub fn context_snapshot_provider_summary(
    workspace_path: String,
) -> Result<ProviderSummaryResult, String> {
    match ContextSnapshotEngine::read_snapshot(&workspace_path) {
        Some(snapshot) => Ok(ProviderSummaryResult {
            ok: true,
            summary: Some(ContextSnapshotEngine::get_provider_summary(
                &workspace_path,
                &snapshot,
            )),
        }),
        None => Ok(ProviderSummaryResult {
            ok: false,
            summary: None,
        }),
    }
}

#[cfg(test)]
mod snapshot_location_tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn folder_alternatives_quote_repository_names() {
        assert_eq!(cd_prefix("/w/app").as_deref(), Some("cd '/w/app'"));
        // A folder named like a command stays one argument of `cd`.
        assert_eq!(
            cd_prefix("/w/x;rm -rf ~").as_deref(),
            Some("cd '/w/x;rm -rf ~'")
        );
        assert_eq!(cd_prefix("/w/it's").as_deref(), Some("cd '/w/it'\\''s'"));
        assert_eq!(cd_prefix("/w/a\nb"), None);
        let out = std::process::Command::new("sh")
            .arg("-c")
            .arg(format!("{} && pwd", cd_prefix("/tmp").unwrap()))
            .output()
            .unwrap();
        assert!(out.status.success());
    }

    #[test]
    fn recent_files_need_no_shell() {
        let dir = std::env::temp_dir().join(format!("po-snap-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(&dir)
                .output()
                .unwrap()
        };
        git(&["init", "-q"]);
        git(&[
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "first",
        ]);
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        git(&["add", "a.txt"]);
        // A repository config that would run a program on every status/diff.
        let marker = dir.join("fsmonitor-ran");
        let hook = dir.join("hook.sh");
        std::fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        git(&["config", "core.fsmonitor", &hook.to_string_lossy()]);
        let info = get_deep_git_info(&dir.to_string_lossy());
        assert!(!marker.exists(), "repository fsmonitor hook ran");
        // Fewer than 5 commits: falls back to the working tree diff.
        assert_eq!(info.last_commit_message.as_deref(), Some("first"));
        assert!(info.recent_files.is_empty() || info.recent_files == vec!["a.txt".to_string()]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn snapshot_lives_in_the_data_dir_not_in_the_repo() {
        let data = Path::new("/data");
        let p = project_context_snapshot_path_in(data, "/Users/me/repo");
        assert!(p.starts_with("/data/context-snapshots"));
        assert!(!p.starts_with("/Users/me/repo"));
        // Same folder with or without a trailing slash, different folders apart.
        assert_eq!(p, project_context_snapshot_path_in(data, "/Users/me/repo/"));
        assert_ne!(p, project_context_snapshot_path_in(data, "/Users/me/other"));
    }

    fn prefs_store() -> (crate::local_store::LocalStore, PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("po-ctx-prefs-{}", crate::local_store::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = crate::local_store::LocalStore::open_at(
            &dir,
            crate::vault::VaultKey::from_bytes([5; 32]),
        )
        .unwrap();
        (store, dir)
    }

    #[test]
    fn context_transfer_prefs_are_encrypted_and_the_clear_copy_is_moved() {
        let (store, dir) = prefs_store();
        let legacy = dir.join("desktop-state.json");
        std::fs::write(
            &legacy,
            r#"{"savedAt":"x","contextTransferPrefs":{"/Users/me/secret-client":{"codex":"always"}}}"#,
        )
        .unwrap();
        assert_eq!(
            get_pref_in(&store, Some(&legacy), "/Users/me/secret-client", "codex"),
            "always"
        );
        // Moved: the clear-text file had nothing else, so it is gone.
        assert!(!legacy.exists());
        set_pref_in(&store, Some(&legacy), "/w", "claude", "never").unwrap();
        assert_eq!(get_pref_in(&store, None, "/w", "claude"), "never");
        assert_eq!(get_pref_in(&store, None, "/w", "gemini"), "ask");
        set_pref_in(&store, None, "/w", "claude", "ask").unwrap();
        assert_eq!(get_pref_in(&store, None, "/w", "claude"), "ask");
        assert!(!legacy.exists());
        // Nothing of the workspace path is readable in the store file.
        let mut on_disk = String::new();
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            on_disk.push_str(&std::fs::read_to_string(e.path()).unwrap_or_default());
        }
        assert!(!on_disk.contains("secret-client"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_legacy_file_with_other_fields_keeps_them() {
        let (store, dir) = prefs_store();
        let legacy = dir.join("desktop-state.json");
        std::fs::write(
            &legacy,
            r#"{"autoLaunchDefaultApplied":true,"contextTransferPrefs":{"/w":{"codex":"never"}}}"#,
        )
        .unwrap();
        assert_eq!(get_pref_in(&store, Some(&legacy), "/w", "codex"), "never");
        let left = std::fs::read_to_string(&legacy).unwrap();
        assert!(
            left.contains("autoLaunchDefaultApplied") && !left.contains("contextTransferPrefs")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn run_terminal_parent_is_matched_by_id_before_name() {
        let sessions = vec![("id-1", "api"), ("id-2", "api"), ("id-3", "web")];
        fn key<'a>(s: &'a (&'static str, &'static str)) -> (&'a str, &'a str) {
            (s.0, s.1)
        }
        assert_eq!(
            find_run_terminal_parent(&sessions, Some("id-2"), "api", key).map(|s| s.0),
            Some("id-2")
        );
        // An unknown id never falls back to a same-named session.
        assert!(find_run_terminal_parent(&sessions, Some("gone"), "api", key).is_none());
        // Callers without an id keep the name lookup.
        assert_eq!(
            find_run_terminal_parent(&sessions, None, "web", key).map(|s| s.0),
            Some("id-3")
        );
        assert_eq!(
            find_run_terminal_parent(&sessions, Some(""), "web", key).map(|s| s.0),
            Some("id-3")
        );
    }
}
