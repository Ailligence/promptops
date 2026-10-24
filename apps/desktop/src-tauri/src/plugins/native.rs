//! Local effects of the `pages` section: git reads, writes to `docs/`, AI generation.
//!
//! Three rules apply to the whole file:
//!  - the plugin never names an absolute path: it works on a handle that exists
//!    only because the user chose that repository on the page;
//!  - whatever modifies the disk or starts a model goes through a confirmation shown
//!    by the main window, with the full content;
//!  - the AI CLI starts without tools and in an empty folder: it produces text and nothing else.

use super::{err, valid_rel_path, InstalledPlugin, PluginRuntime, RepoGrant};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const GIT_TIMEOUT: Duration = Duration::from_secs(20);
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(180);
const AI_TIMEOUT: Duration = Duration::from_secs(300);
pub const MAX_PROMPT_CHARS: usize = 200_000;
const MAX_AI_OUTPUT_CHARS: usize = 200_000;
const MAX_DIFF_BYTES: usize = 200_000;
const MAX_WRITE_BYTES: usize = 500_000;
const MAX_STATUS_FILES: usize = 500;
const MAX_LOG_ENTRIES: u64 = 100;
const MAX_AI_PER_HOUR: u32 = 30;
const WRITE_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];

// ── User confirmation ──────────────────────────────────────────────────────────

/// Asks for confirmation in the main window and waits. No answer counts as a refusal.
/// The two negative outcomes start with a stable code, so a plugin can tell them apart from a failure.
async fn confirm(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin: &InstalledPlugin,
    mut payload: Value,
) -> Result<(), String> {
    // Debug builds ONLY, for the end-to-end test without a person in front: in release this branch does not exist.
    #[cfg(debug_assertions)]
    if plugin.dev && std::env::var("PROMPTOPS_PLUGIN_DEV_AUTOCONFIRM").as_deref() == Ok("1") {
        eprintln!(
            "[plugins] DEV AUTOCONFIRM {} per {}",
            payload["kind"], plugin.plugin_id
        );
        return Ok(());
    }
    if app.get_webview_window("main").is_none() {
        return Err("main window not available for the confirmation".into());
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    rt.confirms.lock().insert(id.clone(), tx);
    payload["id"] = json!(id);
    payload["pluginId"] = json!(plugin.plugin_id);
    payload["name"] = json!(plugin.name);
    if let Err(e) = app.emit_to("main", "plugin-confirm", payload) {
        rt.confirms.lock().remove(&id);
        return Err(err(e));
    }
    match tokio::time::timeout(CONFIRM_TIMEOUT, rx).await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err("user_denied: rejected by the user".into()),
        _ => {
            rt.confirms.lock().remove(&id);
            let _ = app.emit_to("main", "plugin-confirm-expired", json!({ "id": id }));
            Err("confirm_timeout: no confirmation within three minutes".into())
        }
    }
}

// ── Network sends from a plugin that can read a repository ─────────────────────

/// How much of the first request's body is shown in the consent window.
const EGRESS_PREVIEW_BYTES: usize = 4_000;

/// `git:read` together with a network host makes it possible to move code off the computer. The permission was
/// approved at install time, but here it is asked again at the moment it happens: the first
/// time the plugin talks to a host, on every app launch, showing what it is sending.
/// It applies to every call and not only after a read: a plugin could stash the data
/// in its own storage and send it on a later launch. A "no" stays a no until the plugin
/// is turned off and on again, so a pushy plugin cannot flood the user with windows.
pub(super) async fn confirm_egress(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin: &InstalledPlugin,
    host: &str,
    method: &str,
    body: Option<&str>,
) -> Result<(), String> {
    if !needs_egress_consent(plugin) {
        return Ok(());
    }
    let _one_at_a_time = rt.egress_gate.lock().await;
    if let Some(known) = egress_known(rt, &plugin.plugin_id, host) {
        return known;
    }
    let body = body.unwrap_or("");
    let repo = rt.last_repo_read.lock().get(&plugin.plugin_id).cloned();
    let answer = confirm(
        app,
        rt,
        plugin,
        json!({
            "kind": "egress",
            "host": host,
            "method": method,
            "repo": repo,
            "bytes": body.len(),
            "content": truncate_bytes(body, EGRESS_PREVIEW_BYTES).0,
            "truncated": body.len() > EGRESS_PREVIEW_BYTES,
        }),
    )
    .await;
    record_egress(rt, &plugin.plugin_id, host, &answer);
    answer
}

/// The answer already given during this launch, if any.
fn egress_known(rt: &PluginRuntime, plugin_id: &str, host: &str) -> Option<Result<(), String>> {
    match rt.egress.lock().get(&(plugin_id.to_string(), host.to_string())).copied() {
        Some(true) => Some(Ok(())),
        Some(false) => Some(Err(format!("user_denied: sending to {host} was rejected. Turn the plugin off and on again to decide again"))),
        None => None,
    }
}

/// A yes and a no are remembered. An expired confirmation is not an answer: the next call asks again.
fn record_egress(rt: &PluginRuntime, plugin_id: &str, host: &str, answer: &Result<(), String>) {
    let decided = match answer {
        Ok(()) => true,
        Err(e) if e.starts_with("user_denied") => false,
        Err(_) => return,
    };
    rt.egress
        .lock()
        .insert((plugin_id.to_string(), host.to_string()), decided);
}

pub fn needs_egress_consent(plugin: &InstalledPlugin) -> bool {
    plugin.permissions.iter().any(|p| p == "git:read")
}

// ── Read-only git ────────────────────────────────────────────────────────

/// Fixed arguments, no shell. The repository's external diff drivers and text filters
/// are not run: a `.gitattributes` must not start programs.
async fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = crate::commands::util_cmd::tokio_cmd("git");
    cmd.args([
        "--no-pager",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotepath=false",
    ])
    .args(args)
    .current_dir(root)
    .env("GIT_TERMINAL_PROMPT", "0")
    .env("GIT_OPTIONAL_LOCKS", "0")
    .stdin(Stdio::null())
    .kill_on_drop(true);
    let out = tokio::time::timeout(GIT_TIMEOUT, cmd.output())
        .await
        .map_err(|_| "git did not respond in time".to_string())?
        .map_err(|e| format!("git could not be started: {e}"))?;
    if !out.status.success() {
        let detail: String = String::from_utf8_lossy(&out.stderr)
            .trim()
            .chars()
            .take(300)
            .collect();
        return Err(if detail.is_empty() {
            "git returned an error".into()
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// From the path chosen by the user to the root of the repository that contains it.
pub async fn resolve_repo(path: &str) -> Result<(PathBuf, String), String> {
    let dir = std::fs::canonicalize(path).map_err(|_| "folder not found".to_string())?;
    if !dir.is_dir() {
        return Err("the path is not a folder".into());
    }
    let top = git(&dir, &["rev-parse", "--show-toplevel"])
        .await
        .map_err(|_| "the folder is not a git repository".to_string())?;
    let root =
        std::fs::canonicalize(top.trim()).map_err(|_| "repository root not found".to_string())?;
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repository".into());
    Ok((root, name))
}

pub async fn current_branch(root: &Path) -> String {
    git(root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// `git status --porcelain=v1 -b`: first line the branch, then `XY path`.
pub fn parse_status(raw: &str) -> Value {
    let mut branch = String::new();
    let mut files = Vec::new();
    let mut total = 0usize;
    for line in raw.lines() {
        if let Some(head) = line.strip_prefix("## ") {
            branch = head
                .split("...")
                .next()
                .unwrap_or(head)
                .trim_start_matches("No commits yet on ")
                .to_string();
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        total += 1;
        if files.len() < MAX_STATUS_FILES {
            files.push(json!({ "status": line[..2].trim(), "path": line[3..].trim_matches('"') }));
        }
    }
    json!({ "branch": branch, "files": files, "total": total, "truncated": total > MAX_STATUS_FILES })
}

pub fn parse_log(raw: &str) -> Value {
    let commits: Vec<Value> = raw
        .split('\u{1e}')
        .filter_map(|entry| {
            let mut f = entry.trim().split('\u{1f}');
            let hash = f.next().filter(|h| !h.is_empty())?;
            Some(json!({
                "shortHash": hash,
                "message": f.next().unwrap_or(""),
                "relativeDate": f.next().unwrap_or(""),
                "author": f.next().unwrap_or(""),
            }))
        })
        .collect();
    json!(commits)
}

/// Cuts on a character boundary: a diff truncated in the middle of a byte is not UTF-8.
pub fn truncate_bytes(text: &str, max: usize) -> (&str, bool) {
    if text.len() <= max {
        return (text, false);
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

pub async fn git_status(grant: &RepoGrant) -> Result<Value, String> {
    Ok(parse_status(
        &git(&grant.root, &["status", "--porcelain=v1", "-b"]).await?,
    ))
}

pub async fn git_log(grant: &RepoGrant, limit: u64) -> Result<Value, String> {
    let n = format!("-n{}", limit.clamp(1, MAX_LOG_ENTRIES));
    // Author name yes, email address no.
    Ok(parse_log(
        &git(
            &grant.root,
            &["log", &n, "--format=%h%x1f%s%x1f%cr%x1f%an%x1e"],
        )
        .await?,
    ))
}

pub async fn git_diff(grant: &RepoGrant, staged: bool) -> Result<Value, String> {
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv"];
    if staged {
        args.push("--cached");
    }
    let raw = git(&grant.root, &args).await?;
    let (diff, truncated) = truncate_bytes(raw.trim(), MAX_DIFF_BYTES);
    Ok(json!({ "diff": diff, "truncated": truncated }))
}

// ── Writing to docs/ ─────────────────────────────────────────────────────────

/// Only `docs/<...>.md|markdown|txt`, relative, without `..` or hidden files.
pub fn valid_docs_path(path: &str) -> bool {
    path.starts_with("docs/")
        && path.len() > "docs/".len()
        && !path
            .split('/')
            .any(|seg| seg.is_empty() || seg.starts_with('.'))
        && WRITE_EXTENSIONS.iter().any(|ext| valid_rel_path(path, ext))
}

/// The destination folder, after following symlinks, must stay inside the repository.
fn contained_target(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let target = root.join(rel);
    if std::fs::symlink_metadata(&target)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("the destination is a symbolic link".into());
    }
    let mut existing = target.parent().ok_or("invalid path")?.to_path_buf();
    while !existing.exists() {
        existing = existing.parent().ok_or("invalid path")?.to_path_buf();
    }
    let real = std::fs::canonicalize(&existing).map_err(err)?;
    if !real.starts_with(root) {
        return Err("the destination is outside the repository".into());
    }
    Ok(target)
}

pub async fn write_file(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin: &InstalledPlugin,
    grant: &RepoGrant,
    rel: &str,
    content: &str,
) -> Result<Value, String> {
    if !valid_docs_path(rel) {
        return Err("you can only write to `docs/`, in .md, .markdown or .txt files".into());
    }
    if content.len() > MAX_WRITE_BYTES || content.contains('\0') {
        return Err("content too large or not text".into());
    }
    let target = contained_target(&grant.root, rel)?;
    let exists = target.exists();
    confirm(app, rt, plugin, json!({
        "kind": "write", "repo": grant.name, "path": rel, "exists": exists, "bytes": content.len(), "content": content,
    })).await?;

    // The disk may have changed between the confirmation and the write: check again.
    let target = contained_target(&grant.root, rel)?;
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    let target = contained_target(&grant.root, rel)?;
    std::fs::write(&target, content.as_bytes()).map_err(err)?;
    Ok(json!({ "path": rel, "repo": grant.name, "overwritten": exists }))
}

// ── AI generation ─────────────────────────────────────────────────────────────

pub fn valid_model(model: &str) -> bool {
    // Starts with a letter or a digit: it must never be able to look like a CLI option.
    model.len() <= 60
        && model
            .chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

struct BusyGuard<'a>(&'a PluginRuntime, String);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.ai_busy.lock().remove(&self.1);
    }
}

/// Runs the plugin's prompt on the user's CLI. The generated text is the only effect:
/// no tools, no MCP servers, no skills, empty working folder.
pub async fn ai_generate(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin: &InstalledPlugin,
    params: &Value,
    target: &mut Value,
) -> Result<Value, String> {
    let prompt = params
        .get("prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or("missing `prompt` parameter")?;
    let chars = prompt.chars().count();
    if chars > MAX_PROMPT_CHARS {
        return Err("prompt over the size limit".into());
    }
    let model = params
        .get("model")
        .and_then(Value::as_str)
        .filter(|m| !m.is_empty());
    if model.map(|m| !valid_model(m)).unwrap_or(false) {
        return Err("invalid model name".into());
    }
    *target = json!({ "provider": "claude", "model": model, "promptChars": chars });

    if !rt.ai_busy.lock().insert(plugin.plugin_id.clone()) {
        return Err("a generation is already running for this plugin".into());
    }
    let _busy = BusyGuard(rt.as_ref(), plugin.plugin_id.clone());
    if !rt.ai_rate_ok(&plugin.plugin_id, MAX_AI_PER_HOUR) {
        return Err("hourly generation limit exceeded".into());
    }

    confirm(app, rt, plugin, json!({
        "kind": "ai", "provider": "Claude", "model": model, "promptChars": chars, "prompt": prompt,
    })).await?;

    let text = crate::commands::providers::spawn_claude_isolated(prompt, model, AI_TIMEOUT).await?;
    let truncated = text.chars().count() > MAX_AI_OUTPUT_CHARS;
    let text: String = text.chars().take(MAX_AI_OUTPUT_CHARS).collect();
    Ok(json!({ "text": text, "truncated": truncated }))
}

// ── Speed measurement ──────────────────────────────────────────────────────────

const MAX_BENCHMARK_MODELS: usize = 12;
const MAX_BENCHMARKS_PER_HOUR: u32 = 6;

/// Models requested by the plugin, kept only if they are in the app catalog. Order preserved, no duplicates.
pub fn benchmark_targets(
    params: &Value,
) -> Result<Vec<crate::commands::speedtest::SpeedTestModelInfo>, String> {
    let catalog = crate::commands::speedtest::speed_test_models();
    let mut out: Vec<crate::commands::speedtest::SpeedTestModelInfo> = Vec::new();
    for id in params
        .get("models")
        .and_then(Value::as_array)
        .ok_or("missing `models` parameter")?
    {
        let id = id.as_str().ok_or("every model is a text id")?;
        let model = catalog.iter().find(|m| m.id == id).ok_or_else(|| {
            format!(
                "model `{}` not in catalog",
                id.chars().take(60).collect::<String>()
            )
        })?;
        if !out.iter().any(|m| m.id == model.id) {
            out.push(model.clone());
        }
    }
    if out.is_empty() || out.len() > MAX_BENCHMARK_MODELS {
        return Err(format!(
            "from 1 to {MAX_BENCHMARK_MODELS} models per measurement"
        ));
    }
    Ok(out)
}

/// The plugin does NOT write the prompt and does NOT receive text: it picks models from an app list and gets numbers.
/// That is why it applies to every provider, even where there is no tool-less mode.
/// A single confirmation for the whole series: the user sees which models and how many calls run on their accounts.
pub async fn ai_benchmark(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin: &InstalledPlugin,
    params: &Value,
    target: &mut Value,
) -> Result<Value, String> {
    let models = benchmark_targets(params)?;
    let samples = crate::commands::speedtest::SPEED_SAMPLES;
    *target =
        json!({ "models": models.iter().map(|m| m.id).collect::<Vec<_>>(), "samples": samples });

    if !rt.ai_busy.lock().insert(plugin.plugin_id.clone()) {
        return Err("an AI job is already running for this plugin".into());
    }
    let _busy = BusyGuard(rt.as_ref(), plugin.plugin_id.clone());
    if !rt.ai_rate_ok(
        &format!("{}#benchmark", plugin.plugin_id),
        MAX_BENCHMARKS_PER_HOUR,
    ) {
        return Err("hourly measurement limit exceeded".into());
    }
    confirm(app, rt, plugin, json!({
        "kind": "benchmark", "samples": samples, "calls": models.len() * samples,
        "models": models.iter().map(|m| json!({ "id": m.id, "label": m.label, "providerLabel": m.provider_label })).collect::<Vec<_>>(),
    })).await?;

    let total = models.len();
    let mut results: Vec<Value> = Vec::new();
    for (index, model) in models.iter().enumerate() {
        let progress = |done: usize, of: usize, results: &[Value]| {
            super::host::notify_plugin(
                app,
                &plugin.plugin_id,
                "benchmark.progress",
                &json!({
                    "index": index, "total": total, "modelId": model.id, "label": model.label, "sample": done, "samples": of, "results": results,
                }),
            );
        };
        progress(0, samples, &results);
        let done_so_far = results.clone();
        let result = crate::commands::speedtest::benchmark_model(model.id, |done, of| {
            progress(done, of, &done_so_far)
        })
        .await;
        results.push(result);
    }
    super::host::notify_plugin(
        app,
        &plugin.plugin_id,
        "benchmark.progress",
        &json!({ "index": total, "total": total, "done": true, "results": results }),
    );
    Ok(json!({ "results": results }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn egress_consent_is_per_plugin_and_host_and_resets_with_the_plugin() {
        let rt = PluginRuntime::new();
        let plugin = |perms: &[&str]| InstalledPlugin {
            plugin_id: "acme.sync".into(),
            name: "Sync".into(),
            version: "1.0.0".into(),
            category: "pages".into(),
            commit_sha: String::new(),
            bundle_sha256: String::new(),
            permissions: perms.iter().map(|p| p.to_string()).collect(),
            enabled: true,
            dev: false,
            source: String::new(),
            repository: None,
            entry: "src/plugin.js".into(),
            installed_at: 0,
            disabled_reason: None,
            pages: vec![],
            providers: vec![],
            session_buttons: vec![],
        };
        // Only plugins that can read a repository go through consent.
        assert!(needs_egress_consent(&plugin(&[
            "git:read",
            "net:api.acme.dev"
        ])));
        assert!(!needs_egress_consent(&plugin(&[
            "net:api.acme.dev",
            "secrets",
            "storage"
        ])));

        assert!(egress_known(&rt, "acme.sync", "api.acme.dev").is_none());
        // An expired confirmation leaves no trace: ask again.
        record_egress(
            &rt,
            "acme.sync",
            "api.acme.dev",
            &Err("confirm_timeout: no confirmation".into()),
        );
        assert!(egress_known(&rt, "acme.sync", "api.acme.dev").is_none());

        record_egress(&rt, "acme.sync", "api.acme.dev", &Ok(()));
        assert!(egress_known(&rt, "acme.sync", "api.acme.dev")
            .unwrap()
            .is_ok());
        // The yes applies to that host and that plugin, no further.
        assert!(egress_known(&rt, "acme.sync", "files.acme.dev").is_none());
        assert!(egress_known(&rt, "other.plugin", "api.acme.dev").is_none());

        // The no stays, so a pushy plugin does not reopen the window on every call.
        record_egress(
            &rt,
            "acme.sync",
            "files.acme.dev",
            &Err("user_denied: rejected by the user".into()),
        );
        assert!(egress_known(&rt, "acme.sync", "files.acme.dev")
            .unwrap()
            .unwrap_err()
            .starts_with("user_denied"));

        // Turning the plugin off and on again resets the answers.
        rt.revoke_grants("acme.sync");
        assert!(egress_known(&rt, "acme.sync", "api.acme.dev").is_none());
        assert!(egress_known(&rt, "acme.sync", "files.acme.dev").is_none());
    }

    #[test]
    fn docs_path_is_confined() {
        for ok in [
            "docs/report.md",
            "docs/2026/handover-2026-09-20.md",
            "docs/notes.txt",
            "docs/a.markdown",
        ] {
            assert!(valid_docs_path(ok), "{ok}");
        }
        for bad in [
            "report.md",
            "src/docs/a.md",
            "docs/../.git/config",
            "docs/.hidden.md",
            "docs//a.md",
            "/docs/a.md",
            "docs/a.sh",
            "docs/a.md/",
            "docs/",
            "docs/a b.md",
            "docs\\a.md",
            "docs/a.MD.exe",
        ] {
            assert!(!valid_docs_path(bad), "{bad}");
        }
    }

    #[test]
    fn write_target_cannot_leave_the_repository() {
        let base = std::env::temp_dir().join(format!(
            "po-plugin-native-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let root = base.join("repo");
        let outside = base.join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let root = std::fs::canonicalize(&root).unwrap();

        assert!(contained_target(&root, "docs/new/file.md").is_ok());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("docs")).unwrap();
            assert!(
                contained_target(&root, "docs/file.md").is_err(),
                "docs linked outside the repository"
            );
            std::fs::remove_file(root.join("docs")).unwrap();
            std::fs::create_dir_all(root.join("docs")).unwrap();
            std::os::unix::fs::symlink(outside.join("x.md"), root.join("docs/link.md")).unwrap();
            assert!(
                contained_target(&root, "docs/link.md").is_err(),
                "file that is a link"
            );
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn status_and_log_are_parsed_as_data() {
        let status = parse_status("## main...origin/main [ahead 2]\n M src/app.ts\n?? docs/new file.md\nA  \"with space.md\"\n");
        assert_eq!(status["branch"], "main");
        assert_eq!(status["total"], 3);
        assert_eq!(
            status["files"][0],
            json!({ "status": "M", "path": "src/app.ts" })
        );
        assert_eq!(status["files"][1]["status"], "??");
        assert_eq!(status["files"][2]["path"], "with space.md");

        let log = parse_log("a1b2c3d\u{1f}Fix the thing\u{1f}2 hours ago\u{1f}Ada\u{1e}\ne4f5a6b\u{1f}Add docs\u{1f}3 days ago\u{1f}Bob\u{1e}\n");
        assert_eq!(log.as_array().unwrap().len(), 2);
        assert_eq!(log[1]["message"], "Add docs");
        assert_eq!(log[0]["author"], "Ada");
    }

    #[test]
    fn benchmark_models_come_only_from_the_app_catalog() {
        let ok = benchmark_targets(
            &json!({ "models": ["claude-haiku-4-5", "gpt-5.5", "claude-haiku-4-5"] }),
        )
        .unwrap();
        assert_eq!(
            ok.iter().map(|m| m.id).collect::<Vec<_>>(),
            vec!["claude-haiku-4-5", "gpt-5.5"]
        );
        for bad in [
            json!({}),
            json!({ "models": [] }),
            json!({ "models": ["made-up"] }),
            json!({ "models": ["x'; rm -rf ~; '"] }),
            json!({ "models": [7] }),
            json!({ "models": "claude-haiku-4-5" }),
        ] {
            assert!(benchmark_targets(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn truncation_respects_char_boundaries() {
        let (cut, truncated) = truncate_bytes("aàèì", 2);
        assert!(truncated);
        assert_eq!(cut, "a");
        assert_eq!(truncate_bytes("short", 100), ("short", false));
    }

    #[test]
    fn model_names_cannot_carry_shell_syntax() {
        assert!(valid_model("claude-fable-5-1"));
        for bad in ["", "a b", "x';rm -rf ~;'", "$(id)", "a/b", "--tools", "-p"] {
            assert!(!valid_model(bad), "{bad}");
        }
    }
}
