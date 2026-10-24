//! Dedicated webview for plugins and the `po-plugin://` protocol.
//!
//! The `plugin-host` webview does not appear in any capability: for the Tauri ACL
//! it cannot invoke anything. It talks to Rust only through this protocol, which
//! answers exclusively to it and only with the per-launch token.

use super::{broker, PluginRuntime, HOST_LABEL, SCHEME};
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{
    http::{header::HeaderValue, Request, Response, StatusCode},
    AppHandle, Manager, UriSchemeContext, UriSchemeResponder, Wry,
};

/// `frame-src 'none'`: prevents plugin iframes from navigating outside themselves,
/// i.e. the only exit channel that the CSP inside the iframe does not cover.
/// `'unsafe-inline'` is acceptable because third-party HTML never gets in here.
const HOST_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// Largest message the host page may forward (broker call, contract reply).
pub const MAX_HOST_BODY: usize = 4_000_000;

/// The waiting contract call a reply belongs to, only if it comes from the plugin it was
/// sent to: request ids are unguessable, and the plugin id is checked as well.
fn take_pending(
    rt: &PluginRuntime,
    body: &Value,
) -> Option<tokio::sync::oneshot::Sender<Result<Value, String>>> {
    let id = body["requestId"].as_str()?;
    let from = body["pluginId"].as_str()?;
    let mut pending = rt.pending.lock();
    if pending.get(id).map(|(owner, _)| owner == from) != Some(true) {
        return None;
    }
    pending.remove(id).map(|(_, tx)| tx)
}

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Content-Security-Policy", HOST_CSP)
        .header("X-Frame-Options", "DENY")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(Cow::Owned(body))
        .unwrap()
}

fn json_response(status: StatusCode, value: Value) -> Response<Cow<'static, [u8]>> {
    respond(
        status,
        "application/json",
        serde_json::to_vec(&value).unwrap_or_default(),
    )
}

pub fn handle(
    ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    // Only the host webview: neither `main` nor other windows have any reason to go through here.
    if ctx.webview_label() != HOST_LABEL {
        return responder.respond(json_response(
            StatusCode::FORBIDDEN,
            json!({ "ok": false, "error": "forbidden" }),
        ));
    }
    let Some(rt) = app
        .try_state::<Arc<PluginRuntime>>()
        .map(|s| s.inner().clone())
    else {
        return responder.respond(json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({ "ok": false, "error": "runtime" }),
        ));
    };

    let path = request.uri().path().to_string();
    // Every message from a plugin is bounded before parsing: the broker's own limits are
    // 1-2 MB, a bigger body is a plugin trying to exhaust memory.
    if request.body().len() > MAX_HOST_BODY {
        return responder.respond(json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "ok": false, "error": "message too large" }),
        ));
    }
    if path == "/index.html" {
        let sdk = serde_json::to_string(include_str!("sdk.js")).unwrap_or_else(|_| "\"\"".into());
        // `</script` inside the JSON string would close the tag that contains it.
        let sdk = sdk.replace("</", "<\\/").replace("<!--", "<\\!--");
        let page = include_str!("host_page.html")
            .replace("__PO_HOST_TOKEN__", &rt.host_token)
            .replace("__PO_SDK_JSON__", &sdk);
        return responder.respond(respond(StatusCode::OK, "text/html", page.into_bytes()));
    }

    let token_ok = request.headers().get("x-po-host-token")
        == HeaderValue::from_str(&rt.host_token).ok().as_ref();
    if !token_ok {
        return responder.respond(json_response(
            StatusCode::FORBIDDEN,
            json!({ "ok": false, "error": "forbidden" }),
        ));
    }

    match (request.method().as_str(), path.as_str()) {
        ("GET", "/plugins") => {
            let mut plugins = Vec::new();
            for plugin in rt.enabled() {
                match rt.load_bundle(&plugin) {
                    Ok(bundle) => plugins.push(json!({ "pluginId": plugin.plugin_id, "bundle": bundle, "permissions": plugin.permissions })),
                    Err(reason) => {
                        // Bundle missing or tampered with: it is not run, it gets disabled and logged.
                        rt.audit(json!({ "ts": super::now_secs(), "plugin": plugin.plugin_id, "method": "load", "ok": false, "error": reason }));
                        let _ = rt.update(&plugin.plugin_id, |p| {
                            p.enabled = false;
                            p.disabled_reason = Some(reason.clone());
                        });
                    }
                }
            }
            rt.contributions.lock().clear();
            responder.respond(json_response(StatusCode::OK, json!({ "plugins": plugins })));
        }
        // Host page diagnostics (our code): goes to stderr.
        ("POST", "/host-log") => {
            eprintln!(
                "[plugins] host: {}",
                String::from_utf8_lossy(request.body())
                    .chars()
                    .take(500)
                    .collect::<String>()
            );
            responder.respond(json_response(StatusCode::OK, json!({ "ok": true })));
        }
        ("POST", "/contributions") => {
            let body: Value = serde_json::from_slice(request.body()).unwrap_or(Value::Null);
            if let Some(id) = body["pluginId"].as_str() {
                rt.contributions.lock().insert(id.to_string(), json!({
                    "contributions": body["contributions"], "events": body["events"], "actions": body["actions"],
                }));
            }
            responder.respond(json_response(StatusCode::OK, json!({ "ok": true })));
        }
        ("POST", "/invoke-result") => {
            let body: Value = serde_json::from_slice(request.body()).unwrap_or(Value::Null);
            if let Some(tx) = take_pending(&rt, &body) {
                let outcome = if body["ok"] == true {
                    Ok(body["result"].clone())
                } else {
                    Err(body["error"]
                        .as_str()
                        .unwrap_or("plugin error")
                        .chars()
                        .take(500)
                        .collect())
                };
                let _ = tx.send(outcome);
            }
            responder.respond(json_response(StatusCode::OK, json!({ "ok": true })));
        }
        ("POST", "/broker") => {
            let body: Value = serde_json::from_slice(request.body()).unwrap_or(Value::Null);
            tauri::async_runtime::spawn(async move {
                let plugin_id = body["pluginId"].as_str().unwrap_or_default().to_string();
                let method = body["method"].as_str().unwrap_or_default().to_string();
                let started = std::time::Instant::now();
                let out =
                    match broker::handle(&app, &rt, &plugin_id, &method, body["params"].clone())
                        .await
                    {
                        Ok(result) => json!({ "ok": true, "result": result }),
                        Err(error) => json!({ "ok": false, "error": error }),
                    };
                responder.respond(json_response(StatusCode::OK, out));
                // The host webview is hidden: during a long wait (user confirmation,
                // AI generation) WebKit suspends its process and the response stays stuck in the queue.
                // Running a script wakes it up and delivers it.
                if started.elapsed() > std::time::Duration::from_millis(1500) {
                    wake(&app);
                }
            });
        }
        _ => responder.respond(json_response(
            StatusCode::NOT_FOUND,
            json!({ "ok": false, "error": "not found" }),
        )),
    }
}

/// Wakes up the web process of the host page, if the system suspended it.
fn wake(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(HOST_LABEL) {
        let _ = window.eval("void 0");
    }
}

/// Delivers an event to ONE plugin. It originates from the app and concerns a job that plugin requested
/// (the progress of a measurement): that is why it does not go through the session event permission filter.
/// Running the script also wakes up the host page, if the system had suspended it.
pub fn notify_plugin(app: &AppHandle, plugin_id: &str, name: &str, payload: &Value) {
    let Some(window) = app.get_webview_window(HOST_LABEL) else {
        return;
    };
    let args = [
        serde_json::to_string(plugin_id),
        serde_json::to_string(name),
        serde_json::to_string(payload),
    ];
    if let [Ok(id), Ok(name), Ok(payload)] = args {
        let _ = window.eval(format!(
            "window.__poHost && window.__poHost.notify({id}, {name}, {payload})"
        ));
    }
}

/// Avoids double creation when two `sync` calls arrive before the window exists.
static CREATING: AtomicBool = AtomicBool::new(false);

/// Aligns the host webview with the state: it exists only if there is at least one
/// active plugin (lazy activation), otherwise it is closed.
pub fn sync(app: &AppHandle) {
    let Some(rt) = app
        .try_state::<Arc<PluginRuntime>>()
        .map(|s| s.inner().clone())
    else {
        return;
    };
    let wanted = !rt.enabled().is_empty();
    match (app.get_webview_window(HOST_LABEL), wanted) {
        (Some(window), true) => {
            let _ = window.eval("window.__poHost && window.__poHost.reload()");
        }
        (Some(window), false) => {
            let _ = window.destroy();
        }
        (None, true) => {
            if CREATING.swap(true, Ordering::SeqCst) {
                // Already being created: the page reads the updated list when it starts.
                return;
            }
            let app = app.clone();
            // Off the current thread: creating a window inside a handler can block on Windows.
            std::thread::spawn(move || {
                let url = format!("{SCHEME}://localhost/index.html")
                    .parse()
                    .expect("url host plugin");
                let built = tauri::WebviewWindowBuilder::new(
                    &app,
                    HOST_LABEL,
                    tauri::WebviewUrl::CustomProtocol(url),
                )
                .title("PromptOps plugin host")
                .visible(false)
                .skip_taskbar(true)
                .focused(false)
                .build();
                if let Err(e) = built {
                    eprintln!("[plugins] host webview not created: {e}");
                }
                CREATING.store(false, Ordering::SeqCst);
            });
        }
        (None, false) => {}
    }
}

pub fn run_action(
    app: &AppHandle,
    plugin_id: &str,
    action_id: &str,
    context: &Value,
) -> Result<(), String> {
    let window = app
        .get_webview_window(HOST_LABEL)
        .ok_or("no active plugin")?;
    let script = format!(
        "window.__poHost && window.__poHost.action({}, {}, {})",
        serde_json::to_string(plugin_id).map_err(super::err)?,
        serde_json::to_string(action_id).map_err(super::err)?,
        serde_json::to_string(context).map_err(super::err)?,
    );
    window.eval(script).map_err(super::err)
}

/// Calls a method of a plugin's section contract and waits for the returned DATA.
pub async fn invoke(
    app: &AppHandle,
    rt: &Arc<PluginRuntime>,
    plugin_id: &str,
    kind: &str,
    method: &str,
    args: &Value,
) -> Result<Value, String> {
    let window = app
        .get_webview_window(HOST_LABEL)
        .ok_or("no active plugin")?;
    let request_id = uuid::Uuid::new_v4().simple().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    rt.pending
        .lock()
        .insert(request_id.clone(), (plugin_id.to_string(), tx));

    let script = format!(
        "window.__poHost && window.__poHost.invoke({}, {}, {}, {}, {})",
        serde_json::to_string(&request_id).map_err(super::err)?,
        serde_json::to_string(plugin_id).map_err(super::err)?,
        serde_json::to_string(kind).map_err(super::err)?,
        serde_json::to_string(method).map_err(super::err)?,
        serde_json::to_string(args).map_err(super::err)?,
    );
    if let Err(e) = window.eval(script) {
        rt.pending.lock().remove(&request_id);
        return Err(super::err(e));
    }
    // A page may wait for a user confirmation and then an AI generation.
    let wait = if kind == "pages" { 600 } else { 30 };
    match tokio::time::timeout(std::time::Duration::from_secs(wait), rx).await {
        Ok(Ok(outcome)) => outcome,
        _ => {
            rt.pending.lock().remove(&request_id);
            Err(format!("the plugin did not respond within {wait} seconds"))
        }
    }
}

pub fn emit_event(app: &AppHandle, name: &str, payload: &Value) -> Result<(), String> {
    let Some(window) = app.get_webview_window(HOST_LABEL) else {
        return Ok(());
    };
    let script = format!(
        "window.__poHost && window.__poHost.event({}, {})",
        serde_json::to_string(name).map_err(super::err)?,
        serde_json::to_string(payload).map_err(super::err)?,
    );
    window.eval(script).map_err(super::err)
}

/// Wraps a Tauri plugin so its JS init script never runs in the plugin host
/// webview. Plugin init scripts are injected into EVERY webview; the host has
/// no capability, so e.g. tauri-plugin-notification's script (which asks
/// `is_permission_granted` at load) failed there with "not allowed", and the
/// other plugins' scripts had no business in a page that runs third-party
/// code anyway. The commands and Rust hooks of the plugin are untouched.
pub struct NotInPluginHost<P>(pub P);

/// Notification plugin without its JS init script anywhere: the app never
/// uses the web `Notification` shim (native notifications go through its own
/// commands), and no webview holds the `notification:*` permissions, so the
/// shim only produced a rejected `is_permission_granted` on every launch in
/// every webview.
pub struct WithoutInitScript<P>(pub P);

/// The init script runs only when the page is not the plugin host
/// (`po-plugin://localhost` on macOS/Linux, `http(s)://po-plugin.localhost`
/// on Windows).
pub(crate) fn guard_init_script(script: &str) -> String {
    format!(
        "if (!/^(?:{SCHEME}:|https?:\\/\\/{SCHEME}\\.localhost(?:[:/]|$))/.test(window.location.href)) {{\n{script}\n}}"
    )
}

macro_rules! delegate_plugin {
    () => {
        fn name(&self) -> &'static str {
            self.0.name()
        }
        fn initialize(
            &mut self,
            app: &AppHandle<R>,
            config: Value,
        ) -> Result<(), Box<dyn std::error::Error>> {
            self.0.initialize(app, config)
        }
        fn window_created(&mut self, window: tauri::Window<R>) {
            self.0.window_created(window)
        }
        fn webview_created(&mut self, webview: tauri::Webview<R>) {
            self.0.webview_created(webview)
        }
        fn on_navigation(
            &mut self,
            webview: &tauri::Webview<R>,
            url: &tauri::webview::Url,
        ) -> bool {
            self.0.on_navigation(webview, url)
        }
        fn on_page_load(
            &mut self,
            webview: &tauri::Webview<R>,
            payload: &tauri::webview::PageLoadPayload<'_>,
        ) {
            self.0.on_page_load(webview, payload)
        }
        fn on_event(&mut self, app: &AppHandle<R>, event: &tauri::RunEvent) {
            self.0.on_event(app, event)
        }
        fn extend_api(&mut self, invoke: tauri::ipc::Invoke<R>) -> bool {
            self.0.extend_api(invoke)
        }
    };
}

impl<R: tauri::Runtime, P: tauri::plugin::Plugin<R>> tauri::plugin::Plugin<R>
    for NotInPluginHost<P>
{
    delegate_plugin!();

    // Only main-frame scripts are wrapped (the default `initialization_script_2`
    // maps this back to a main-frame script), which is what the wrapped
    // plugins register.
    fn initialization_script(&self) -> Option<String> {
        self.0
            .initialization_script_2()
            .map(|s| guard_init_script(&s.script))
    }
}

impl<R: tauri::Runtime, P: tauri::plugin::Plugin<R>> tauri::plugin::Plugin<R>
    for WithoutInitScript<P>
{
    delegate_plugin!();

    fn initialization_script(&self) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod init_script_guard_tests {
    use super::guard_init_script;

    #[test]
    fn a_contract_reply_counts_only_from_the_plugin_it_was_sent_to() {
        let rt = super::PluginRuntime::new();
        let (tx, mut rx) = tokio::sync::oneshot::channel();
        rt.pending
            .lock()
            .insert("req1".into(), ("acme.one".into(), tx));
        let spoof = serde_json::json!({ "requestId": "req1", "pluginId": "evil.two" });
        assert!(super::take_pending(&rt, &spoof).is_none());
        assert!(
            rt.pending.lock().contains_key("req1"),
            "a spoofed reply does not consume it"
        );
        assert!(super::take_pending(&rt, &serde_json::json!({ "requestId": "req1" })).is_none());
        let real = serde_json::json!({ "requestId": "req1", "pluginId": "acme.one" });
        let sender = super::take_pending(&rt, &real).expect("owner reply");
        sender.send(Ok(serde_json::json!(1))).unwrap();
        assert!(rx.try_recv().is_ok());
        assert!(rt.pending.lock().is_empty());
    }

    #[test]
    fn guard_wraps_the_script_and_names_the_host_origins() {
        let g = guard_init_script("window.x = 1;");
        assert!(g.starts_with("if (!/^(?:po-plugin:|https?:\\/\\/po-plugin\\.localhost"));
        assert!(g.contains("window.x = 1;"));
        assert!(g.trim_end().ends_with('}'));
    }
}
