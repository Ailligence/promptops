//! Commands for the `main` webview (the only one the ACL grants them to).

use super::{
    contract_permission, err, host, manifest_pages, manifest_permissions, manifest_providers,
    manifest_repository, manifest_session_buttons, native, now_secs, raw_base, sha256_hex,
    valid_plugin_id, valid_rel_path, valid_version, validate_category_permissions,
    validate_permissions, write_atomic, InstallSpec, InstalledPlugin, PluginRuntime, MANIFEST_FILE,
    MAX_FILE_BYTES, RAW_HOST,
};
use serde_json::{json, Map, Value};
use std::{collections::BTreeMap, fs, path::PathBuf, sync::Arc, time::Duration};
use tauri::{AppHandle, State};

type Rt<'a> = State<'a, Arc<PluginRuntime>>;

#[tauri::command]
pub fn plugin_runtime_list(rt: Rt<'_>) -> Value {
    json!({ "developerMode": rt.developer_mode(), "plugins": rt.list(), "contributions": *rt.contributions.lock() })
}

/// Downloads from GitHub at the pinned commit. No redirects, size cap.
async fn download(url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with(&format!("{RAW_HOST}/")) {
        return Err("download origin not allowed".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(err)?;
    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {}", e.without_url()))?;
    if res.status().as_u16() != 200 {
        return Err(format!("download failed: HTTP {}", res.status().as_u16()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("download interrupted: {}", e.without_url()))?
    {
        if body.len() + chunk.len() > MAX_FILE_BYTES {
            return Err("file exceeds the size limit".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn entry_of(manifest: &Value) -> Result<String, String> {
    let entry = manifest["entry"]
        .as_str()
        .ok_or("the manifest has no `entry`")?;
    if !valid_rel_path(entry, "js") {
        return Err("`entry` must be a relative path to a .js file".into());
    }
    Ok(entry.to_string())
}

/// Installs the approved version into the registry. Verification is all in Rust:
/// manifest in the repository equal to the approved one and bundle SHA-256 equal
/// to the approved one. An install never enables the plugin by itself.
#[tauri::command]
pub async fn plugin_runtime_install(
    app: AppHandle,
    rt: Rt<'_>,
    spec: InstallSpec,
) -> Result<InstalledPlugin, String> {
    let rt = rt.inner().clone();
    if !valid_plugin_id(&spec.plugin_id) {
        return Err("invalid plugin id".into());
    }
    if spec.manifest["id"].as_str() != Some(spec.plugin_id.as_str()) {
        return Err("the manifest id does not match the registry one".into());
    }
    let permissions = manifest_permissions(&spec.manifest)?;
    validate_permissions(&permissions)?;
    if spec.manifest["category"].as_str() != Some(spec.category.as_str()) {
        return Err("the manifest section does not match the registry one".into());
    }
    validate_category_permissions(&spec.category, &permissions)?;
    let pages = manifest_pages(&spec.manifest, &spec.category)?;
    let session_buttons = manifest_session_buttons(&spec.manifest, &permissions)?;
    let entry = entry_of(&spec.manifest)?;
    let base = raw_base(&spec.repo_url, &spec.commit_sha, spec.source_dir.as_deref())?;

    let manifest_bytes = download(&format!("{base}{MANIFEST_FILE}")).await?;
    let repo_manifest: Value =
        serde_json::from_slice(&manifest_bytes).map_err(|_| "invalid repository manifest")?;
    if repo_manifest != spec.manifest {
        return Err("the manifest in the repository differs from the approved one".into());
    }
    let bundle = download(&format!("{base}{entry}")).await?;
    if sha256_hex(&bundle) != spec.bundle_sha256.to_ascii_lowercase() {
        return Err("the downloaded bundle hash does not match the approved one".into());
    }

    // The version becomes a folder name: `..` or an empty string would write outside it.
    if !valid_version(&spec.version) {
        return Err("invalid version".into());
    }
    let dir = rt.plugin_dir(&spec.plugin_id)?.join(&spec.version);
    write_atomic(&dir.join(MANIFEST_FILE), &manifest_bytes, false)?;
    write_atomic(&dir.join("entry.js"), &bundle, false)?;

    // An update keeps the enabled state only if permissions do not grow:
    // new permissions require a new explicit approval from the user.
    let previous = rt.get(&spec.plugin_id);
    let keeps_enabled = previous
        .as_ref()
        .map(|p| p.enabled && !p.dev && permissions.iter().all(|perm| p.permissions.contains(perm)))
        .unwrap_or(false);

    let plugin = InstalledPlugin {
        plugin_id: spec.plugin_id.clone(),
        name: spec.name.chars().take(80).collect(),
        version: spec.version.clone(),
        category: spec.category.chars().take(20).collect(),
        commit_sha: spec.commit_sha.clone(),
        bundle_sha256: spec.bundle_sha256.to_ascii_lowercase(),
        permissions,
        enabled: keeps_enabled,
        dev: false,
        source: spec.repo_url.clone(),
        repository: Some(spec.repo_url.trim_end_matches('/').to_string()),
        entry,
        installed_at: now_secs(),
        disabled_reason: None,
        pages,
        providers: manifest_providers(&spec.manifest),
        session_buttons,
    };
    rt.upsert(plugin.clone())?;
    rt.audit(json!({ "ts": now_secs(), "plugin": plugin.plugin_id, "method": "install", "target": plugin.version, "ok": true }));
    host::sync(&app);
    Ok(plugin)
}

#[tauri::command]
pub fn plugin_runtime_uninstall(
    app: AppHandle,
    rt: Rt<'_>,
    plugin_id: String,
) -> Result<(), String> {
    // Removes bundle, storage, configuration and secrets.
    rt.remove(&plugin_id)?;
    rt.revoke_grants(&plugin_id);
    rt.audit(json!({ "ts": now_secs(), "plugin": plugin_id, "method": "uninstall", "ok": true }));
    host::sync(&app);
    Ok(())
}

#[tauri::command]
pub fn plugin_runtime_set_enabled(
    app: AppHandle,
    rt: Rt<'_>,
    plugin_id: String,
    enabled: bool,
) -> Result<InstalledPlugin, String> {
    let plugin = rt.update(&plugin_id, |p| {
        p.enabled = enabled;
        if enabled {
            p.disabled_reason = None;
        }
    })?;
    if !enabled {
        rt.revoke_grants(&plugin_id);
    }
    rt.audit(json!({ "ts": now_secs(), "plugin": plugin_id, "method": if enabled { "enable" } else { "disable" }, "ok": true }));
    host::sync(&app);
    Ok(plugin)
}

#[tauri::command]
pub fn plugin_runtime_get_config(rt: Rt<'_>, plugin_id: String) -> Result<Value, String> {
    let plugin = rt.get(&plugin_id).ok_or("plugin not installed")?;
    let dir = rt.plugin_dir(&plugin_id)?;
    let values: Map<String, Value> = fs::read(dir.join("config.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    // Unreadable secrets do not block the form: they show as unset, and the status says why.
    let secrets_set: Vec<String> = super::secrets::load(&rt, &plugin_id)
        .map(|s| s.into_keys().collect())
        .unwrap_or_default();
    let manifest: Value = if plugin.dev {
        fs::read(PathBuf::from(&plugin.source).join(MANIFEST_FILE)).ok()
    } else {
        fs::read(dir.join(&plugin.version).join(MANIFEST_FILE)).ok()
    }
    .and_then(|b| serde_json::from_slice(&b).ok())
    .unwrap_or(Value::Null);
    // Secret values NEVER go back to the UI: only which ones are set.
    Ok(
        json!({ "values": values, "secretsSet": secrets_set, "fields": manifest["config"]["fields"], "secretStorage": super::secrets::status(&rt, &plugin_id) }),
    )
}

#[tauri::command]
pub fn plugin_runtime_set_config(
    app: AppHandle,
    rt: Rt<'_>,
    plugin_id: String,
    values: Map<String, Value>,
    secrets: BTreeMap<String, String>,
) -> Result<(), String> {
    rt.get(&plugin_id).ok_or("plugin not installed")?;
    let dir = rt.plugin_dir(&plugin_id)?;
    let bytes = serde_json::to_vec(&values).map_err(err)?;
    if bytes.len() > 100_000 {
        return Err("configuration too large".into());
    }
    write_atomic(&dir.join("config.json"), &bytes, false)?;

    // Empty string = remove the secret; missing key = leave as is.
    let mut stored = super::secrets::load_for_update(&rt, &plugin_id)?;
    for (key, value) in secrets {
        if key.len() > 100 || value.len() > 8000 {
            return Err("secret exceeds the limit".into());
        }
        if value.is_empty() {
            stored.remove(&key);
        } else {
            stored.insert(key, value);
        }
    }
    super::secrets::save(&rt, &plugin_id, &stored)?;
    rt.audit(json!({ "ts": now_secs(), "plugin": plugin_id, "method": "configure", "ok": true }));
    host::sync(&app);
    Ok(())
}

/// Applies the registry state: revoked ones are disabled right away, and for the
/// others it flags whether a newer approved version exists.
#[tauri::command]
pub fn plugin_runtime_apply_registry_status(
    app: AppHandle,
    rt: Rt<'_>,
    items: Vec<Value>,
) -> Result<Value, String> {
    let mut revoked = Vec::new();
    let mut updates = Vec::new();
    for item in &items {
        let Some(id) = item["plugin_id"].as_str() else {
            continue;
        };
        let Some(installed) = rt.get(id).filter(|p| !p.dev) else {
            continue;
        };
        if item["status"] == "revoked" {
            let note = item["revoked_note"]
                .as_str()
                .unwrap_or("revoked by the registry")
                .to_string();
            if installed.enabled || installed.disabled_reason.is_none() {
                rt.update(id, |p| {
                    p.enabled = false;
                    p.disabled_reason = Some(format!("Revoked: {note}"));
                })?;
                rt.audit(json!({ "ts": now_secs(), "plugin": id, "method": "revoked", "target": note, "ok": true }));
            }
            revoked.push(id.to_string());
        } else if item["status"] == "published"
            && item["bundle_sha256"].as_str() != Some(installed.bundle_sha256.as_str())
        {
            updates.push(json!({ "pluginId": id, "installed": installed.version, "available": item["version"] }));
        }
    }
    if !revoked.is_empty() {
        host::sync(&app);
    }
    Ok(json!({ "revoked": revoked, "updates": updates }))
}

#[tauri::command]
pub fn plugin_runtime_audit(
    rt: Rt<'_>,
    plugin_id: Option<String>,
    limit: Option<usize>,
) -> Vec<Value> {
    rt.audit_tail(plugin_id.as_deref(), limit.unwrap_or(100).min(500))
}

#[tauri::command]
pub fn plugin_runtime_set_developer_mode(rt: Rt<'_>, enabled: bool) -> Result<(), String> {
    rt.set_developer_mode(enabled)
}

/// Links a local folder. Only in developer mode, and still in the
/// SAME sandbox and with the SAME broker as published plugins.
#[tauri::command]
pub fn plugin_runtime_link_local(
    app: AppHandle,
    rt: Rt<'_>,
    path: String,
) -> Result<InstalledPlugin, String> {
    if !rt.developer_mode() {
        return Err("enable developer mode first".into());
    }
    link_local(&app, rt.inner(), &path)
}

pub fn link_local(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    path: &str,
) -> Result<InstalledPlugin, String> {
    let dir = PathBuf::from(path);
    let manifest: Value = serde_json::from_slice(
        &fs::read(dir.join(MANIFEST_FILE)).map_err(|e| format!("{MANIFEST_FILE}: {e}"))?,
    )
    .map_err(|_| "invalid manifest")?;
    let plugin_id = manifest["id"]
        .as_str()
        .ok_or("the manifest has no `id`")?
        .to_string();
    if !valid_plugin_id(&plugin_id) {
        return Err("invalid plugin id".into());
    }
    if rt.get(&plugin_id).map(|p| !p.dev).unwrap_or(false) {
        return Err(
            "a version installed from the registry already exists: uninstall it first".into(),
        );
    }
    let permissions = manifest_permissions(&manifest)?;
    validate_permissions(&permissions)?;
    let category = manifest["category"].as_str().unwrap_or("");
    validate_category_permissions(category, &permissions)?;
    let pages = manifest_pages(&manifest, category)?;
    let session_buttons = manifest_session_buttons(&manifest, &permissions)?;
    let entry = entry_of(&manifest)?;
    let bundle = fs::read(dir.join(&entry)).map_err(|e| format!("{entry}: {e}"))?;

    let plugin = InstalledPlugin {
        plugin_id: plugin_id.clone(),
        name: manifest["name"]
            .as_str()
            .unwrap_or(&plugin_id)
            .chars()
            .take(80)
            .collect(),
        // Shown in the UI and sent in the User-Agent: only a well-formed version.
        version: manifest["version"]
            .as_str()
            .filter(|v| valid_version(v))
            .unwrap_or("0.0.0-dev")
            .to_string(),
        category: manifest["category"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(20)
            .collect(),
        commit_sha: String::new(),
        bundle_sha256: sha256_hex(&bundle),
        permissions,
        enabled: true,
        dev: true,
        source: dir.to_string_lossy().into_owned(),
        repository: manifest_repository(&manifest),
        entry,
        installed_at: now_secs(),
        disabled_reason: None,
        pages,
        providers: manifest_providers(&manifest),
        session_buttons,
    };
    rt.upsert(plugin.clone())?;
    rt.audit(json!({ "ts": now_secs(), "plugin": plugin_id, "method": "link-local", "target": plugin.source, "ok": true }));
    host::sync(app);
    Ok(plugin)
}

#[tauri::command]
pub fn plugin_runtime_run_action(
    app: AppHandle,
    rt: Rt<'_>,
    plugin_id: String,
    action_id: String,
    context: Option<Value>,
) -> Result<(), String> {
    rt.get(&plugin_id)
        .filter(|p| p.enabled)
        .ok_or("plugin not active")?;
    host::run_action(
        &app,
        &plugin_id,
        &action_id,
        &context.unwrap_or(Value::Null),
    )
}

/// Calls a plugin's section contract. A plugin answers ONLY for its
/// own category: a `notify` plugin cannot pass itself off as a task source.
#[tauri::command]
pub async fn plugin_runtime_invoke(
    app: AppHandle,
    rt: Rt<'_>,
    plugin_id: String,
    kind: String,
    method: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let rt = rt.inner().clone();
    let plugin = rt
        .get(&plugin_id)
        .filter(|p| p.enabled)
        .ok_or("plugin not active")?;
    // Session buttons are not a section: a plugin of any category can have them,
    // as long as they are declared in the approved manifest. Only `action` is called, with the id of a declared button.
    let mut args = args;
    if kind == "session" {
        let button_id = args
            .as_ref()
            .and_then(|a| a.get(0))
            .and_then(Value::as_str)
            .unwrap_or("");
        if method != "action" || !plugin.session_buttons.iter().any(|b| b.id == button_id) {
            return Err("button or method not supported for this plugin".into());
        }
        // The composer draft text only reaches those with `composer:read`.
        if !plugin.permissions.iter().any(|p| p == "composer:read") {
            if let Some(ctx) = args
                .as_mut()
                .and_then(|a| a.get_mut(1))
                .and_then(Value::as_object_mut)
            {
                ctx.remove("composerText");
            }
        }
    } else if plugin.category != kind {
        return Err(format!(
            "the plugin belongs to the `{}` section and cannot answer for `{kind}`",
            plugin.category
        ));
    }
    if method.is_empty() || method.len() > 60 || !method.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("invalid method name".into());
    }
    if let Some(needed) = contract_permission(&kind, &method) {
        if !plugin.permissions.iter().any(|p| p == needed) {
            return Err(format!(
                "permission `{needed}` not granted to this plugin: `{kind}.{method}` is refused"
            ));
        }
    }
    if kind == "pages" {
        // A page opens only if it is in the approved manifest: the first argument is its id.
        let page_id = args
            .as_ref()
            .and_then(|a| a.get(0))
            .and_then(Value::as_str)
            .unwrap_or("");
        if !matches!(method.as_str(), "open" | "event")
            || !plugin.pages.iter().any(|p| p.id == page_id)
        {
            return Err("page or method not declared by this plugin".into());
        }
    }
    let started = std::time::Instant::now();
    let result = host::invoke(
        &app,
        &rt,
        &plugin_id,
        &kind,
        &method,
        &args.unwrap_or(Value::Array(vec![])),
    )
    .await;
    rt.audit(json!({
        "ts": now_secs(), "plugin": plugin_id, "method": "invoke", "target": format!("{kind}.{method}"),
        "ok": result.is_ok(), "error": result.as_ref().err(), "ms": started.elapsed().as_millis() as u64,
    }));
    result
}

/// Forwards an app event to plugins. The caller (the webapp, a trusted party)
/// passes ONLY metadata; the host page delivers it to whoever has the permission.
#[tauri::command]
pub fn plugin_runtime_emit_event(
    app: AppHandle,
    name: String,
    payload: Option<Value>,
) -> Result<(), String> {
    const EVENTS: &[&str] = &[
        "session.started",
        "session.ended",
        "turn.completed",
        "approval.requested",
        "task.status_changed",
    ];
    if !EVENTS.contains(&name.as_str()) {
        return Err(format!("unknown event `{name}`"));
    }
    host::emit_event(&app, &name, &payload.unwrap_or(Value::Null))
}

/// The user picked a repository in a plugin's page: this is where the handle is born.
/// The path comes from the webapp, a trusted party, and is never shown to the plugin.
#[tauri::command]
pub async fn plugin_runtime_grant_repo(
    rt: Rt<'_>,
    plugin_id: String,
    path: String,
) -> Result<Value, String> {
    let rt = rt.inner().clone();
    let plugin = rt
        .get(&plugin_id)
        .filter(|p| p.enabled)
        .ok_or("plugin not active")?;
    if !plugin
        .permissions
        .iter()
        .any(|p| super::REPO_PERMISSIONS.contains(&p.as_str()))
    {
        return Err("this plugin has no repository permissions".into());
    }
    let (root, name) = native::resolve_repo(&path).await?;
    let branch = native::current_branch(&root).await;
    let handle = rt.grant_repo(&plugin_id, root, name.clone());
    rt.audit(json!({ "ts": now_secs(), "plugin": plugin_id, "method": "grant-repo", "target": name, "ok": true }));
    Ok(json!({ "handle": handle, "name": name, "branch": branch }))
}

/// The user's answer to a confirmation request. An unknown or expired id does nothing.
#[tauri::command]
pub fn plugin_runtime_confirm(rt: Rt<'_>, id: String, approved: bool) -> bool {
    match rt.confirms.lock().remove(&id) {
        Some(tx) => tx.send(approved).is_ok(),
        None => false,
    }
}
