//! Dev Links.
//!
//! Discovers the project's local development URLs (frontend dev server, API,
//! docs, storybook, db admin, …) and opens them in the system browser. The
//! heuristic scan reads ONLY key files (no traversal) with a 4-hour TTL cache.
//! Local-only: nothing leaves the device.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use parking_lot::Mutex;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};

const HOST: &str = "localhost";
const SCAN_TTL_MS: u128 = 4 * 60 * 60 * 1000;
const AI_SOURCE_MAX: usize = 6000;

#[derive(Clone, Serialize)]
pub struct DevLink {
    pub label: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// File/heuristic that produced the link.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

struct ScanCacheEntry {
    timestamp: u128,
    links: Vec<DevLink>,
    ai_source: String,
}

fn scan_cache() -> &'static Mutex<HashMap<String, ScanCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ScanCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn push_unique(links: &mut Vec<DevLink>, link: DevLink) {
    if !links.iter().any(|l| l.url == link.url) {
        links.push(link);
    }
}

fn take_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Host ports from a docker-compose "ports:" mapping.
fn scan_compose(root: &Path, links: &mut Vec<DevLink>, notes: &mut Vec<String>) {
    static PORT_RE: OnceLock<Regex> = OnceLock::new();
    static SVC_RE: OnceLock<Regex> = OnceLock::new();
    let port_re = PORT_RE.get_or_init(|| {
        Regex::new(r#"(?:^|\s|["'-])(?:\d{1,3}(?:\.\d{1,3}){3}:)?(\d{2,5}):\d{2,5}"#).unwrap()
    });
    let svc_re = SVC_RE.get_or_init(|| Regex::new(r"^\s{2}([a-zA-Z0-9_-]+):\s*$").unwrap());

    for name in [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
        "docker-compose.prod.yml",
    ] {
        let Ok(text) = std::fs::read_to_string(root.join(name)) else {
            continue;
        };
        notes.push(format!("# {name}\n{}", take_chars(&text, 4000)));
        let mut svc = String::new();
        for line in text.lines() {
            if let Some(m) = svc_re.captures(line) {
                svc = m[1].to_string();
            }
            for m in port_re.captures_iter(line) {
                let port = &m[1];
                let label = if svc.is_empty() {
                    format!("Service :{port}")
                } else {
                    format!("{svc} (:{port})")
                };
                push_unique(
                    links,
                    DevLink {
                        label,
                        url: format!("http://{HOST}:{port}"),
                        description: None,
                        source: Some(name.to_string()),
                    },
                );
            }
        }
    }
}

/// Explicit ports in package.json scripts.
fn scan_package_json(root: &Path, links: &mut Vec<DevLink>, notes: &mut Vec<String>) {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?:--port[= ]|-p[= ]|PORT=)(\d{2,5})").unwrap());

    let Ok(raw) = std::fs::read_to_string(root.join("package.json")) else {
        return;
    };
    let Ok(pkg) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    let scripts = pkg
        .get("scripts")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let scripts_json = serde_json::to_string_pretty(&scripts).unwrap_or_default();
    notes.push(format!(
        "# package.json scripts\n{}",
        take_chars(&scripts_json, 2000)
    ));

    let mut seen = std::collections::HashSet::new();
    for (name, raw_cmd) in scripts {
        let cmd = raw_cmd
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| raw_cmd.to_string());
        if let Some(m) = re.captures(&cmd) {
            let port = m[1].to_string();
            if seen.insert(port.clone()) {
                push_unique(
                    links,
                    DevLink {
                        label: format!("{name} (:{port})"),
                        url: format!("http://{HOST}:{port}"),
                        description: None,
                        source: Some(format!("package.json:{name}")),
                    },
                );
            }
        }
    }
}

/// Framework config files with known default ports.
fn scan_framework_defaults(root: &Path, links: &mut Vec<DevLink>) {
    let has = |f: &str| root.join(f).exists();
    let mut add = |cond: bool, label: &str, port: u16, source: &str| {
        if cond {
            push_unique(
                links,
                DevLink {
                    label: label.to_string(),
                    url: format!("http://{HOST}:{port}"),
                    description: None,
                    source: Some(source.to_string()),
                },
            );
        }
    };
    add(
        has("angular.json"),
        "Angular dev server",
        4200,
        "angular.json",
    );
    add(
        has("vite.config.ts") || has("vite.config.js"),
        "Vite dev server",
        5173,
        "vite.config",
    );
    add(
        has("next.config.ts") || has("next.config.js") || has("next.config.mjs"),
        "Next.js",
        3000,
        "next.config",
    );
    add(
        has("nuxt.config.ts") || has("nuxt.config.js"),
        "Nuxt",
        3000,
        "nuxt.config",
    );
    add(has("svelte.config.js"), "SvelteKit", 5173, "svelte.config");
    add(
        has("artisan"),
        "Laravel (php artisan serve)",
        8000,
        "artisan",
    );
    add(has("manage.py"), "Django", 8000, "manage.py");
    add(has("Gemfile"), "Rails", 3000, "Gemfile");
    add(
        has(".storybook/main.ts") || has(".storybook/main.js"),
        "Storybook",
        6006,
        ".storybook",
    );
}

/// Ports and URLs declared in .env files (never lines with SECRET/KEY/TOKEN/PASSWORD).
fn scan_env(root: &Path, links: &mut Vec<DevLink>, notes: &mut Vec<String>) {
    static RELEVANT: OnceLock<Regex> = OnceLock::new();
    static SECRET: OnceLock<Regex> = OnceLock::new();
    static URL_RE: OnceLock<Regex> = OnceLock::new();
    static PORT_RE: OnceLock<Regex> = OnceLock::new();
    let relevant = RELEVANT.get_or_init(|| Regex::new(r"(?i)PORT|_URL|HOST|BASE_URL").unwrap());
    let secret = SECRET.get_or_init(|| Regex::new(r"(?i)SECRET|KEY|TOKEN|PASSWORD").unwrap());
    let url_re = URL_RE.get_or_init(|| Regex::new(r#"(?i)=\s*["']?(https?://[^\s"']+)"#).unwrap());
    let port_re =
        PORT_RE.get_or_init(|| Regex::new(r#"(?i)([A-Z0-9_]*PORT)\s*=\s*["']?(\d{2,5})"#).unwrap());

    for name in [".env", ".env.local", ".env.development", ".env.example"] {
        let Ok(text) = std::fs::read_to_string(root.join(name)) else {
            continue;
        };
        let lines: Vec<&str> = text
            .lines()
            .filter(|l| {
                relevant.is_match(l) && !l.trim_start().starts_with('#') && !secret.is_match(l)
            })
            .collect();
        if !lines.is_empty() {
            let redacted: Vec<String> = lines.iter().map(|l| redact_userinfo(l)).collect();
            notes.push(format!(
                "# {name}\n{}",
                take_chars(&redacted.join("\n"), 1500)
            ));
        }
        for line in lines {
            if let Some(m) = url_re.captures(line) {
                let url = &m[1];
                if url.contains("localhost") || url.contains("127.0.0.1") || url.contains("0.0.0.0")
                {
                    let key = line.split('=').next().unwrap_or("").trim().to_string();
                    push_unique(
                        links,
                        DevLink {
                            label: key,
                            url: url.replace("0.0.0.0", HOST),
                            description: None,
                            source: Some(name.to_string()),
                        },
                    );
                }
            }
            if let Some(m) = port_re.captures(line) {
                push_unique(
                    links,
                    DevLink {
                        label: m[1].to_string(),
                        url: format!("http://{HOST}:{}", &m[2]),
                        description: None,
                        source: Some(name.to_string()),
                    },
                );
            }
        }
    }
}

/// `scheme://user:password@host` → `scheme://***@host`. `DATABASE_URL`-style
/// lines pass the name filter, and `aiSource` is sent to the AI provider.
fn redact_userinfo(line: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i)([a-z][a-z0-9+.-]*://)[^/\s@'\x22]+@").unwrap());
    re.replace_all(line, "${1}***@").into_owned()
}

fn scan_project(root: &Path) -> (Vec<DevLink>, String) {
    let mut links = Vec::new();
    let mut notes = Vec::new();
    scan_compose(root, &mut links, &mut notes);
    scan_package_json(root, &mut links, &mut notes);
    scan_env(root, &mut links, &mut notes);
    scan_framework_defaults(root, &mut links);
    (links, take_chars(&notes.join("\n\n"), AI_SOURCE_MAX))
}

/// devlinks:scan — heuristic scan with a 4h TTL cache (force bypasses it).
#[tauri::command]
pub async fn dev_links_scan(cwd: String, force: Option<bool>) -> Value {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&cwd);
        if cwd.is_empty() || !root.exists() {
            return json!({ "ok": false, "error": "invalid_cwd", "links": [], "aiSource": "" });
        }
        if !force.unwrap_or(false) {
            let cache = scan_cache().lock();
            if let Some(entry) = cache.get(&cwd) {
                if now_ms() - entry.timestamp < SCAN_TTL_MS {
                    return json!({
                        "ok": true,
                        "links": entry.links,
                        "aiSource": entry.ai_source,
                        "cached": true,
                    });
                }
            }
        }
        let (links, ai_source) = scan_project(root);
        scan_cache().lock().insert(
            cwd.clone(),
            ScanCacheEntry {
                timestamp: now_ms(),
                links: links.clone(),
                ai_source: ai_source.clone(),
            },
        );
        json!({ "ok": true, "links": links, "aiSource": ai_source, "cached": false })
    })
    .await
    .unwrap_or_else(|e| json!({ "ok": false, "error": e.to_string(), "links": [], "aiSource": "" }))
}

/// devlinks:open — opens the URL in the system browser (http/https only).
#[tauri::command]
pub fn dev_links_open(url: String) -> Value {
    let lower = url.trim().to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return json!({ "ok": false, "error": "unsupported_protocol" });
    }
    let res = crate::commands::shell::open_external_url(&url);
    match res {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

/// devlinks:default-browser — name/icon of the default browser (memoized:
/// it almost never changes during a session).
#[tauri::command]
pub async fn dev_links_default_browser() -> Value {
    static PROBE: OnceLock<(String, String)> = OnceLock::new();
    if let Some((name, icon)) = PROBE.get() {
        return json!({ "ok": true, "browser": { "name": name, "icon": icon } });
    }
    let detected = tauri::async_runtime::spawn_blocking(detect_default_browser)
        .await
        .unwrap_or_else(|_| ("Browser".into(), "solar:global-linear".into()));
    let (name, icon) = PROBE.get_or_init(|| detected).clone();
    json!({ "ok": true, "browser": { "name": name, "icon": icon } })
}

fn detect_default_browser() -> (String, String) {
    let output = if cfg!(target_os = "macos") {
        crate::commands::util_cmd::cmd("sh")
            .arg("-c")
            .arg(
                "defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null | grep -A2 'https' | grep LSHandlerRoleAll",
            )
            .output()
    } else if cfg!(target_os = "windows") {
        crate::commands::util_cmd::cmd("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
                "/v",
                "ProgId",
            ])
            .output()
    } else {
        crate::commands::util_cmd::cmd("sh")
            .arg("-c")
            .arg("xdg-settings get default-web-browser 2>/dev/null")
            .output()
    };
    let raw = output
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    map_browser(&raw)
}

fn map_browser(raw: &str) -> (String, String) {
    let s = raw.to_lowercase();
    if s.contains("chrome") {
        ("Chrome".into(), "logos:chrome".into())
    } else if s.contains("firefox") {
        ("Firefox".into(), "logos:firefox".into())
    } else if s.contains("safari") {
        ("Safari".into(), "logos:safari".into())
    } else if s.contains("edge") || s.contains("msedge") {
        ("Edge".into(), "logos:microsoft-edge".into())
    } else if s.contains("brave") {
        ("Brave".into(), "logos:brave".into())
    } else if s.contains("arc") {
        ("Arc".into(), "solar:global-linear".into())
    } else {
        ("Browser".into(), "solar:global-linear".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_in_env_urls_never_reach_the_ai_source() {
        let dir = std::env::temp_dir().join(format!("po-devlinks-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".env"),
            "DATABASE_URL=postgres://app:s3cr3t@localhost:5432/db\nAPI_URL=http://localhost:8000\nAPP_KEY=base64:zzz\n",
        )
        .unwrap();
        let (links, ai) = scan_project(&dir);
        assert!(!ai.contains("s3cr3t") && ai.contains("postgres://***@localhost"));
        assert!(!ai.contains("base64:zzz"));
        assert!(links.iter().any(|l| l.url == "http://localhost:8000"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
