//! Broker: the ONLY point through which a plugin produces effects.
//!
//! Every call arrives from the host page with the plugin id; permissions are
//! read from the INSTALLED record, never from the parameters. Anything not
//! declared is denied. Every call ends up in the local log.

use super::{err, is_forbidden_ip, native, now_secs, write_atomic, InstalledPlugin, PluginRuntime};
use serde_json::{json, Map, Value};
use std::{collections::BTreeMap, fs, net::SocketAddr, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter};

const MAX_CALLS_PER_MINUTE: u32 = 120;
const MAX_REQUEST_BODY: usize = 1_000_000;
const MAX_RESPONSE_BODY: usize = 2_000_000;
const MAX_STORAGE_BYTES: usize = 1_000_000;
const MAX_PAGE_VIEW_BYTES: usize = 256_000;
const RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "location",
    "retry-after",
    "link",
    "etag",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
];
/// Headers the plugin cannot set: the client handles them or they would open the door to smuggling.
const FORBIDDEN_REQUEST_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "upgrade",
    "proxy-authorization",
    "cookie",
    "te",
    "expect",
];

pub async fn handle(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin_id: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let plugin = rt
        .get(plugin_id)
        .filter(|p| p.enabled)
        .ok_or("plugin not active")?;

    let mut target = Value::Null;
    let result = if !rt.rate_ok(plugin_id, MAX_CALLS_PER_MINUTE) {
        Err("per-minute call limit exceeded".to_string())
    } else {
        dispatch(app, rt, &plugin, method, &params, &mut target).await
    };

    rt.audit(json!({
        "ts": now_secs(),
        "plugin": plugin_id,
        "method": method,
        "target": target,
        "ok": result.is_ok(),
        "error": result.as_ref().err(),
        "ms": started.elapsed().as_millis() as u64,
    }));
    result
}

async fn dispatch(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin: &InstalledPlugin,
    method: &str,
    params: &Value,
    target: &mut Value,
) -> Result<Value, String> {
    match method {
        "http.fetch" => http_fetch(app, rt, plugin, params, target).await,
        "storage.get" => {
            require(plugin, "storage")?;
            let key = str_param(params, "key")?;
            Ok(read_json_map(rt, plugin, "storage.json")?
                .get(key)
                .cloned()
                .unwrap_or(Value::Null))
        }
        "storage.set" => {
            require(plugin, "storage")?;
            let key = str_param(params, "key")?;
            if key.len() > 200 {
                return Err("key too long".into());
            }
            let mut map = read_json_map(rt, plugin, "storage.json")?;
            match params.get("value") {
                None | Some(Value::Null) => map.remove(key),
                Some(v) => map.insert(key.to_string(), v.clone()),
            };
            let bytes = serde_json::to_vec(&map).map_err(err)?;
            if bytes.len() > MAX_STORAGE_BYTES {
                return Err("plugin storage quota exceeded".into());
            }
            write_atomic(
                &rt.plugin_dir(&plugin.plugin_id)?.join("storage.json"),
                &bytes,
                false,
            )?;
            Ok(Value::Bool(true))
        }
        // Non-secret configuration is readable; about secrets the plugin only learns WHETHER they exist.
        "config.get" => {
            let mut config = read_json_map(rt, plugin, "config.json")?;
            let secrets: Vec<Value> = read_secrets(rt, plugin)?
                .keys()
                .map(|k| Value::String(k.clone()))
                .collect();
            config.insert("__secretsSet".into(), Value::Array(secrets));
            Ok(Value::Object(config))
        }
        "notify.toast" => {
            require(plugin, "notify")?;
            let message = plain_text(str_param(params, "message")?, 300, false);
            *target = json!("toast");
            app.emit_to(
                "main",
                "plugin-toast",
                json!({ "pluginId": plugin.plugin_id, "name": plugin.name, "message": message }),
            )
            .map_err(err)?;
            Ok(Value::Bool(true))
        }
        // A plugin NEVER writes to an agent: it prepares a proposal that the user
        // sees, can edit and confirms. The text is marked as untrusted.
        "prompt.propose" => {
            require(plugin, "prompt:propose")?;
            // Plain text only: escape sequences would be invisible in the preview and, once the
            // person copies the text into a terminal, could end a bracketed paste and submit it.
            let text = plain_text(str_param(params, "text")?, 8000, true);
            let title = plain_text(
                params.get("title").and_then(Value::as_str).unwrap_or(""),
                120,
                false,
            );
            *target = json!("proposal");
            app.emit_to("main", "plugin-prompt-proposal", json!({
                "pluginId": plugin.plugin_id, "name": plugin.name, "title": title, "text": text, "untrusted": true,
            })).map_err(err)?;
            Ok(Value::Bool(true))
        }
        // ── `pages` section ──────────────────────────────────────────────────────
        // The repository is always a handle born from a user choice, never a path.
        "git.status" => {
            require(plugin, "git:read")?;
            let grant = rt.repo_of(&plugin.plugin_id, str_param(params, "repo")?)?;
            *target = json!(grant.name);
            rt.last_repo_read
                .lock()
                .insert(plugin.plugin_id.clone(), grant.name.clone());
            native::git_status(&grant).await
        }
        "git.log" => {
            require(plugin, "git:read")?;
            let grant = rt.repo_of(&plugin.plugin_id, str_param(params, "repo")?)?;
            *target = json!(grant.name);
            rt.last_repo_read
                .lock()
                .insert(plugin.plugin_id.clone(), grant.name.clone());
            native::git_log(
                &grant,
                params.get("limit").and_then(Value::as_u64).unwrap_or(20),
            )
            .await
        }
        "git.diff" => {
            require(plugin, "git:read")?;
            let grant = rt.repo_of(&plugin.plugin_id, str_param(params, "repo")?)?;
            *target = json!(grant.name);
            rt.last_repo_read
                .lock()
                .insert(plugin.plugin_id.clone(), grant.name.clone());
            native::git_diff(
                &grant,
                params
                    .get("staged")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .await
        }
        "workspace.writeFile" => {
            require(plugin, "workspace:write")?;
            let grant = rt.repo_of(&plugin.plugin_id, str_param(params, "repo")?)?;
            let path = str_param(params, "path")?;
            *target = json!(format!(
                "{}/{}",
                grant.name,
                path.chars().take(200).collect::<String>()
            ));
            native::write_file(app, rt, plugin, &grant, path, str_param(params, "content")?).await
        }
        "ai.generate" => {
            require(plugin, "ai:generate")?;
            native::ai_generate(app, rt, plugin, params, target).await
        }
        // Speed measurements: the prompt belongs to the app, the plugin picks the models and only gets numbers back.
        "ai.benchmarkModels" => {
            require(plugin, "ai:benchmark")?;
            Ok(crate::commands::speedtest::speedtest_list_models().await)
        }
        "ai.benchmark" => {
            require(plugin, "ai:benchmark")?;
            native::ai_benchmark(app, rt, plugin, params, target).await
        }
        // Update of its own page: DATA only, the app draws it.
        "pages.update" => {
            let page_id = str_param(params, "pageId")?;
            if !plugin.pages.iter().any(|p| p.id == page_id) {
                return Err("page not declared in the manifest".into());
            }
            let view = params.get("view").cloned().unwrap_or(Value::Null);
            if serde_json::to_vec(&view).map_err(err)?.len() > MAX_PAGE_VIEW_BYTES {
                return Err("view exceeds the size limit".into());
            }
            *target = json!(page_id);
            app.emit_to(
                "main",
                "plugin-page-update",
                json!({ "pluginId": plugin.plugin_id, "pageId": page_id, "view": view }),
            )
            .map_err(err)?;
            Ok(Value::Bool(true))
        }
        "log" => {
            let message = plain_text(str_param(params, "message")?, 500, false);
            *target = json!(message);
            Ok(Value::Bool(true))
        }
        _ => Err(format!(
            "method `{}` not supported by the runtime",
            plain_text(method, 60, false)
        )),
    }
}

/// Text from a plugin as it may reach the person: control characters (ESC, C1, NUL…) removed,
/// line breaks kept only where `multiline`, at most `max` characters.
pub fn plain_text(text: &str, max: usize, multiline: bool) -> String {
    text.chars()
        .map(|c| if c == '\r' { '\n' } else { c })
        .filter(|c| !c.is_control() || (multiline && matches!(c, '\n' | '\t')))
        .take(max)
        .collect()
}

fn require(plugin: &InstalledPlugin, permission: &str) -> Result<(), String> {
    if plugin.permissions.iter().any(|p| p == permission) {
        Ok(())
    } else {
        Err(format!(
            "permission `{permission}` not granted to this plugin"
        ))
    }
}

fn str_param<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing parameter `{key}`"))
}

fn read_json_map(
    rt: &PluginRuntime,
    plugin: &InstalledPlugin,
    file: &str,
) -> Result<Map<String, Value>, String> {
    let path = rt.plugin_dir(&plugin.plugin_id)?.join(file);
    Ok(fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default())
}

/// Secrets are stored encrypted on disk, with the key in the system keychain: see `secrets.rs`.
pub fn read_secrets(
    rt: &PluginRuntime,
    plugin: &InstalledPlugin,
) -> Result<BTreeMap<String, String>, String> {
    super::secrets::load(rt, &plugin.plugin_id)
}

/// Replaces `{{secret:key}}`. Fails if the secret does not exist: better an
/// error than sending the placeholder in clear text to a third-party service.
pub fn substitute_secrets(
    value: &str,
    secrets: &BTreeMap<String, String>,
) -> Result<String, String> {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("{{secret:") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 9..];
        let end = after.find("}}").ok_or("unclosed secret placeholder")?;
        let key = after[..end].trim();
        out.push_str(
            secrets
                .get(key)
                .ok_or_else(|| format!("secret `{key}` not configured"))?,
        );
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Replaces `{{basic:user:secret}}` with `base64(user:password)`, for HTTP Basic authentication.
/// The plugin cannot compute it itself: it does not see the secret. `user` is a configuration key
/// (or a secret), `secret` must be a secret. Also returns the produced values, to be stripped from responses.
pub fn substitute_basic(
    value: &str,
    secrets: &BTreeMap<String, String>,
    config: &Map<String, Value>,
) -> Result<(String, Vec<String>), String> {
    use base64::Engine;
    let mut out = String::with_capacity(value.len());
    let mut produced = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find("{{basic:") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 8..];
        let end = after.find("}}").ok_or("unclosed basic placeholder")?;
        let (user_key, pass_key) = after[..end]
            .split_once(':')
            .ok_or("the basic placeholder expects `{{basic:user:secret}}`")?;
        let (user_key, pass_key) = (user_key.trim(), pass_key.trim());
        let user = secrets
            .get(user_key)
            .cloned()
            .or_else(|| {
                config
                    .get(user_key)
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .filter(|u| !u.is_empty())
            .ok_or_else(|| format!("value `{user_key}` not configured"))?;
        if user.contains(':') {
            return Err(format!("`{user_key}` cannot contain a colon"));
        }
        let pass = secrets
            .get(pass_key)
            .ok_or_else(|| format!("secret `{pass_key}` not configured"))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"));
        out.push_str(&encoded);
        produced.push(encoded);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok((out, produced))
}

/// Strips secrets from what goes back to the plugin: a service that echoes
/// headers must not become a way to read them.
pub fn scrub_secrets(text: &str, secrets: &BTreeMap<String, String>) -> String {
    secrets
        .values()
        .filter(|s| s.len() >= 6)
        .fold(text.to_string(), |acc, s| {
            acc.replace(s.as_str(), "[secret]")
        })
}

/// URL checks that do not require the network. Returns the host.
pub fn check_url(plugin: &InstalledPlugin, url: &reqwest::Url) -> Result<String, String> {
    if url.scheme() != "https" {
        return Err("HTTPS only".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("credentials in the URL are not allowed".into());
    }
    if url.port().map(|p| p != 443).unwrap_or(false) {
        return Err("port 443 only".into());
    }
    // `domain()` is None for literal IPs: a plugin never connects to an address.
    let host = url
        .domain()
        .ok_or("the host must be a domain name")?
        .to_ascii_lowercase();
    if !plugin.permissions.iter().any(|p| {
        p.strip_prefix("net:")
            .map(|h| h.eq_ignore_ascii_case(&host))
            .unwrap_or(false)
    }) {
        return Err(format!(
            "host `{host}` not declared in the plugin permissions"
        ));
    }
    Ok(host)
}

/// Resolves the URL requested by the plugin. Secrets are allowed in path and query
/// (many webhooks carry the token in the address) but NEVER in the host: the host is
/// validated on the template, before substitution, and must stay identical afterwards.
/// Also returns the form to write to the log, which contains no secrets.
pub fn resolve_url(
    plugin: &InstalledPlugin,
    template: &str,
    secrets: &BTreeMap<String, String>,
) -> Result<(reqwest::Url, String, String), String> {
    if !template.contains("{{secret:") {
        let url = reqwest::Url::parse(template).map_err(|_| "invalid URL")?;
        let host = check_url(plugin, &url)?;
        let audit = format!("{host}{}", url.path());
        return Ok((url, host, audit));
    }
    require(plugin, "secrets")?;
    let authority_end = template.find("://").map(|i| i + 3).ok_or("invalid URL")?;
    let authority = template[authority_end..]
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");
    if authority.contains('{') {
        return Err("secrets are not allowed in the URL host".into());
    }
    // Secret-free form: used to validate the host and to write the log.
    let masked_secrets: BTreeMap<String, String> = secrets
        .keys()
        .map(|k| (k.clone(), "SECRET".to_string()))
        .collect();
    let masked = reqwest::Url::parse(&substitute_secrets(template, &masked_secrets)?)
        .map_err(|_| "invalid URL")?;
    let host = check_url(plugin, &masked)?;

    let url = reqwest::Url::parse(&substitute_secrets(template, secrets)?)
        .map_err(|_| "invalid URL after secret substitution")?;
    if check_url(plugin, &url)? != host {
        return Err("secret substitution changed the host".into());
    }
    Ok((url, host.clone(), format!("{host}{}", masked.path())))
}

async fn http_fetch(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin: &InstalledPlugin,
    params: &Value,
    target: &mut Value,
) -> Result<Value, String> {
    let mut secrets = read_secrets(rt, plugin)?;
    let template = str_param(params, "url")?;
    if template.contains("{{basic:") {
        return Err("the basic placeholder is only allowed in headers".into());
    }
    // Before any error, only the host goes into the log: never a URL with secrets.
    *target = json!(template
        .split("{{")
        .next()
        .unwrap_or("")
        .chars()
        .take(120)
        .collect::<String>());
    let (url, host, audit_target) = resolve_url(plugin, template, &secrets)?;
    *target = json!(audit_target);

    let method = params
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET")
        .to_ascii_uppercase();
    let method = match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" => {
            reqwest::Method::from_bytes(method.as_bytes()).map_err(err)?
        }
        _ => return Err("HTTP method not allowed".into()),
    };

    // A plugin that can read a repository asks for consent before talking to a host, once per launch.
    native::confirm_egress(
        app,
        rt,
        plugin,
        &host,
        method.as_str(),
        params.get("body").and_then(Value::as_str),
    )
    .await?;

    // Controlled DNS resolution: if ANY of the addresses is internal it is
    // denied (DNS rebinding defense), and the connection is pinned to the validated IP.
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 443))
        .await
        .map_err(|e| format!("DNS: {e}"))?
        .collect();
    if addrs.is_empty() || addrs.iter().any(|a| is_forbidden_ip(a.ip())) {
        return Err("the host resolves to an internal or reserved address".into());
    }

    let mut request = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .resolve(&host, addrs[0])
        .user_agent(format!(
            "PromptOps-Plugin/{} ({})",
            plugin.version, plugin.plugin_id
        ))
        .build()
        .map_err(err)?
        .request(method, url);

    if let Some(headers) = params.get("headers").and_then(Value::as_object) {
        for (name, value) in headers {
            let lower = name.to_ascii_lowercase();
            if FORBIDDEN_REQUEST_HEADERS.contains(&lower.as_str())
                || lower.starts_with("sec-")
                || lower.starts_with("proxy-")
            {
                return Err(format!("header `{name}` cannot be set by a plugin"));
            }
            let raw = value.as_str().ok_or("header values must be strings")?;
            let mut resolved = raw.to_string();
            if resolved.contains("{{basic:") {
                require(plugin, "secrets")?;
                let (value, produced) = substitute_basic(
                    &resolved,
                    &secrets,
                    &read_json_map(rt, plugin, "config.json")?,
                )?;
                resolved = value;
                // The encoded form is a secret too: it must be stripped from responses like the others.
                for (i, encoded) in produced.into_iter().enumerate() {
                    secrets.insert(format!("__basic_{name}_{i}"), encoded);
                }
            }
            if resolved.contains("{{secret:") {
                require(plugin, "secrets")?;
                resolved = substitute_secrets(&resolved, &secrets)?;
            }
            request = request.header(name.as_str(), resolved);
        }
    }
    if let Some(body) = params.get("body").and_then(Value::as_str) {
        if body.len() > MAX_REQUEST_BODY {
            return Err("request body exceeds the limit".into());
        }
        if body.contains("{{secret:") || body.contains("{{basic:") {
            return Err("secrets are only allowed in headers".into());
        }
        request = request.body(body.to_string());
    }

    let mut response = request
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e.without_url()))?;
    let status = response.status().as_u16();
    let mut headers = Map::new();
    for name in RESPONSE_HEADERS {
        if let Some(v) = response.headers().get(*name).and_then(|v| v.to_str().ok()) {
            headers.insert(
                (*name).to_string(),
                Value::String(scrub_secrets(v, &secrets)),
            );
        }
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("read failed: {}", e.without_url()))?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BODY {
            return Err("response exceeds the size limit".into());
        }
        body.extend_from_slice(&chunk);
    }

    Ok(json!({
        "status": status,
        "ok": (200..300).contains(&status),
        "headers": headers,
        "body": scrub_secrets(&String::from_utf8_lossy(&body), &secrets),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(perms: &[&str]) -> InstalledPlugin {
        InstalledPlugin {
            plugin_id: "acme.demo".into(),
            name: "Demo".into(),
            version: "0.1.0".into(),
            category: "notify".into(),
            commit_sha: "a".repeat(40),
            bundle_sha256: "b".repeat(64),
            permissions: perms.iter().map(|s| s.to_string()).collect(),
            enabled: true,
            dev: false,
            source: String::new(),
            repository: None,
            entry: "dist/plugin.js".into(),
            installed_at: 0,
            disabled_reason: None,
            pages: vec![],
            providers: vec![],
            session_buttons: vec![],
        }
    }

    #[test]
    fn basic_auth_is_built_by_the_broker_and_scrubbed() {
        let secrets: BTreeMap<String, String> =
            [("token".to_string(), "s3cr3t-token".to_string())].into();
        let config: Map<String, Value> =
            serde_json::from_value(json!({ "email": "marta@acme.io", "empty": "" })).unwrap();
        let (header, produced) =
            substitute_basic("Basic {{basic:email:token}}", &secrets, &config).unwrap();
        assert_eq!(header, "Basic bWFydGFAYWNtZS5pbzpzM2NyM3QtdG9rZW4=");
        assert_eq!(produced, vec!["bWFydGFAYWNtZS5pbzpzM2NyM3QtdG9rZW4="]);

        // The encoded form is stripped from responses like any other secret.
        let mut scrub = secrets.clone();
        scrub.insert("__basic".into(), produced[0].clone());
        assert_eq!(
            scrub_secrets("echo: Basic bWFydGFAYWNtZS5pbzpzM2NyM3QtdG9rZW4=", &scrub),
            "echo: Basic [secret]"
        );

        for bad in [
            "{{basic:email}}",
            "{{basic:email:missing}}",
            "{{basic:missing:token}}",
            "{{basic:empty:token}}",
            "{{basic:email:token",
        ] {
            assert!(substitute_basic(bad, &secrets, &config).is_err(), "{bad}");
        }
        let colon: Map<String, Value> = serde_json::from_value(json!({ "email": "a:b" })).unwrap();
        assert!(
            substitute_basic("{{basic:email:token}}", &secrets, &colon).is_err(),
            "a user with a colon would shift the boundary"
        );
    }

    #[test]
    fn url_policy() {
        let p = plugin(&["net:api.linear.app"]);
        let ok = |u: &str| check_url(&p, &reqwest::Url::parse(u).unwrap());
        assert_eq!(
            ok("https://API.linear.app/graphql").unwrap(),
            "api.linear.app"
        );
        for bad in [
            "http://api.linear.app/",
            "https://evil.example.org/",
            "https://api.linear.app.evil.org/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://user:pw@api.linear.app/",
            "https://api.linear.app:8443/",
            "https://linear.app/",
        ] {
            assert!(ok(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn secrets_are_substituted_and_scrubbed() {
        let secrets = BTreeMap::from([("apiKey".to_string(), "lin_api_SUPERSECRET".to_string())]);
        assert_eq!(
            substitute_secrets("Bearer {{secret:apiKey}}", &secrets).unwrap(),
            "Bearer lin_api_SUPERSECRET"
        );
        assert!(substitute_secrets("{{secret:missing}}", &secrets).is_err());
        assert!(substitute_secrets("{{secret:apiKey", &secrets).is_err());
        assert_eq!(
            scrub_secrets("echo: lin_api_SUPERSECRET!", &secrets),
            "echo: [secret]!"
        );
    }

    #[test]
    fn secrets_in_url_never_reach_the_host_part_nor_the_log() {
        let secrets = BTreeMap::from([("hook".to_string(), "T0K3N/abc".to_string())]);
        let p = plugin(&["net:discord.com", "secrets"]);
        let (url, host, audit) = resolve_url(
            &p,
            "https://discord.com/api/webhooks/{{secret:hook}}?wait=true",
            &secrets,
        )
        .unwrap();
        assert_eq!(host, "discord.com");
        assert_eq!(
            url.as_str(),
            "https://discord.com/api/webhooks/T0K3N/abc?wait=true"
        );
        assert!(!audit.contains("T0K3N"), "{audit}");

        // Secret in the host, or trying to move the host: denied
        assert!(resolve_url(&p, "https://{{secret:hook}}/x", &secrets).is_err());
        assert!(resolve_url(&p, "https://discord.com.{{secret:hook}}/x", &secrets).is_err());
        let evil = BTreeMap::from([("hook".to_string(), "@evil.example.org/".to_string())]);
        assert!(resolve_url(&p, "https://discord.com{{secret:hook}}", &evil).is_err());
        // Without the `secrets` permission placeholders are not used
        assert!(resolve_url(
            &plugin(&["net:discord.com"]),
            "https://discord.com/{{secret:hook}}",
            &secrets
        )
        .is_err());
        // Missing secret: error, not a clear-text placeholder sent to third parties
        assert!(resolve_url(&p, "https://discord.com/{{secret:other}}", &secrets).is_err());
    }

    #[test]
    fn plugin_text_reaching_the_person_has_no_control_characters() {
        let hostile = "ok\u{1b}[201~\rrm -rf ~\r\u{9b}2J\u{0}\tend";
        assert_eq!(plain_text(hostile, 100, true), "ok[201~\nrm -rf ~\n2J\tend");
        assert_eq!(plain_text(hostile, 100, false), "ok[201~rm -rf ~2Jend");
        assert_eq!(plain_text("abcdef", 3, false), "abc");
    }

    #[test]
    fn permissions_are_required() {
        assert!(require(&plugin(&["notify"]), "notify").is_ok());
        assert!(require(&plugin(&["notify"]), "storage").is_err());
        assert!(require(&plugin(&[]), "prompt:propose").is_err());
    }
}
