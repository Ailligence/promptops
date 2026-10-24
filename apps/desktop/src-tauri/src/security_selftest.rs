//! Webview containment self-test (prerequisite of the plugin system).
//!
//! Active ONLY in debug builds and ONLY with `PROMPTOPS_SECURITY_SELFTEST=1`.
//! In release `attach` is the identity: zero code, zero registered protocols.
//!
//! Verifies three things at runtime, on the platform it runs on:
//!  1. `main`: the main webview can still invoke app commands
//!     (no regression after introducing the ACL in build.rs).
//!  2. `secondary-webview`: a secondary webview served by a custom
//!     protocol (hence a "local" origin for Tauri, the worst case) CANNOT
//!     invoke app commands or the event system, and has no network.
//!  3. `sandboxed-iframe`: a `sandbox="allow-scripts"` iframe inside the
//!     main webview sees no IPC, bridge, parent, storage or network.
//!
//! Output: `[security-selftest]` lines on stderr + JSON in
//! `PROMPTOPS_SECURITY_SELFTEST_OUT` (default: system temp dir).
//! To be rerun on Windows and Linux before hosting third-party code.

pub fn attach(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(debug_assertions)]
    {
        if std::env::var("PROMPTOPS_SECURITY_SELFTEST").as_deref() == Ok("1") {
            eprintln!("[security-selftest] ACTIVE (debug only)");
            return builder.plugin(imp::plugin());
        }
    }
    builder
}

#[cfg(debug_assertions)]
mod imp {
    use serde_json::{json, Value};
    use std::{
        borrow::Cow,
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
    };
    use tauri::{
        http::{Response, StatusCode},
        plugin::{Builder as PluginBuilder, TauriPlugin},
        webview::PageLoadEvent,
        AppHandle, Listener, Manager, Wry,
    };

    const SCHEME: &str = "po-selftest";
    const SECONDARY_LABEL: &str = "plugin-selftest";
    const CONTROL_LABEL: &str = "plugin-selftest-control";
    const EVENT: &str = "po-selftest";
    const LEAK_EVENT: &str = "po-selftest-leak";

    /// Policy the future plugin host will apply to every context.
    /// `ipc:` stays open on purpose: this way the rejection we measure comes from
    /// the Tauri ACL and not from an upstream CSP block.
    const SECONDARY_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost";

    /// Counter-test: same page but with a permissive `frame-src`. Here the nested
    /// iframe navigation MUST go through, otherwise the "blocked" check proves nothing.
    const CONTROL_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-src po-selftest: http://po-selftest.localhost";

    const CONTROL_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>selftest control</title><body><script>
(async () => {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"><script>setTimeout(()=>{location.href='${location.origin}/nav-control';},300);<\/script>`;
  document.body.appendChild(f);
  await new Promise(res => setTimeout(res, 2500));
  await fetch('/report', { method: 'POST', body: JSON.stringify({ ctx: 'control' }) });
})();
</script>"#;

    const PROBE_FNS: &str = r#"
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r({ allowed: false, error: 'timeout' }), ms))]);
const tryInvoke = (cmd, args) => withTimeout(
  window.__TAURI_INTERNALS__.invoke(cmd, args)
    .then(() => ({ allowed: true }))
    .catch(e => ({ allowed: false, error: String(e && e.message || e).slice(0, 220) })), 5000);
const tryNetwork = () => withTimeout(
  fetch('https://example.com/', { mode: 'no-cors' })
    .then(() => ({ reached: true }))
    .catch(e => ({ reached: false, error: String(e).slice(0, 120) })), 8000);
"#;

    fn secondary_page() -> String {
        format!(
            r#"<!doctype html><meta charset="utf-8"><title>selftest</title><script>
{PROBE_FNS}
(async () => {{
  const r = {{ ctx: 'secondary-webview', origin: location.origin }};
  r.hasInternals = typeof window.__TAURI_INTERNALS__ !== 'undefined';
  r.hasGlobalTauri = typeof window.__TAURI__ !== 'undefined';
  r.hasBridge = typeof window.promptops !== 'undefined';
  if (r.hasInternals) {{
    r.appCommand = await tryInvoke('diagnostics_report', {{ kind: 'selftest', location: 'secondary' }});
    r.coreEvent = await tryInvoke('plugin:event|emit', {{ event: '{LEAK_EVENT}', payload: 1 }});
  }}
  // Nested iframe: this is how the plugin host will host third-party code.
  // The CSP inside the iframe does NOT limit its own navigation: the host
  // page's `frame-src` must block it. If navigation goes through, Rust
  // receives a request on /nav-leak and the check fails.
  if (document.readyState === 'loading') await new Promise(res => addEventListener('DOMContentLoaded', res));
  const nested = await new Promise(res => {{
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    const t = setTimeout(() => res({{ alive: false }}), 3000);
    window.addEventListener('message', ev => {{
      if (ev.source === f.contentWindow && ev.data === 'nested-alive') {{ clearTimeout(t); res({{ alive: true }}); }}
    }});
    f.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"><script>parent.postMessage('nested-alive','*');setTimeout(()=>{{location.href='${{location.origin}}/nav-leak';}},300);<\/script>`;
    (document.body || document.documentElement).appendChild(f);
  }});
  r.nestedIframeAlive = nested.alive;
  await new Promise(res => setTimeout(res, 1500));
  r.network = await tryNetwork();
  await fetch('/report', {{ method: 'POST', body: JSON.stringify(r) }});
}})();
</script>"#
        )
    }

    /// Script evaluated in the main webview: tests `main` and mounts the iframe.
    fn main_probe() -> String {
        let iframe_doc = format!(
            r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"><script>
{PROBE_FNS}
(async () => {{
  const r = {{ __poSelftest: true, ctx: 'sandboxed-iframe', origin: location.origin }};
  r.hasInternals = typeof window.__TAURI_INTERNALS__ !== 'undefined';
  r.hasGlobalTauri = typeof window.__TAURI__ !== 'undefined';
  r.hasBridge = typeof window.promptops !== 'undefined';
  r.hasRawIpcHandle = !!(window.ipc
    || (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ipc)
    || (window.chrome && window.chrome.webview));
  try {{ r.parentAccess = !!parent.__TAURI_INTERNALS__; }} catch (e) {{ r.parentAccess = false; }}
  try {{ localStorage.getItem('x'); r.storage = true; }} catch (e) {{ r.storage = false; }}
  r.invokeKeyVisible = typeof window.__TAURI_INVOKE_KEY__ !== 'undefined';
  // Raw IPC send WITHOUT the invoke key: if Rust accepted it, the
  // `po-selftest-leak` listener would fire and the check would fail.
  const raw = JSON.stringify({{ cmd: 'plugin:event|emit', callback: 0, error: 0,
    payload: {{ event: '{LEAK_EVENT}', payload: 'iframe-raw' }}, options: {{}}, __TAURI_INVOKE_KEY__: 'guess' }});
  try {{
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ipc) window.webkit.messageHandlers.ipc.postMessage(raw);
    else if (window.ipc) window.ipc.postMessage(raw);
    else if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(raw);
    r.rawIpcPosted = r.hasRawIpcHandle;
  }} catch (e) {{ r.rawIpcPosted = false; }}
  if (r.hasInternals) {{
    r.appCommand = await tryInvoke('diagnostics_report', {{ kind: 'selftest', location: 'iframe' }});
  }}
  r.network = await tryNetwork();
  parent.postMessage(r, '*');
}})();
</script>"#
        );
        // Evaluated with `eval`, it does not go through an HTML parser: `</script>` is harmless.
        let iframe_doc_js = serde_json::to_string(&iframe_doc).unwrap();
        format!(
            r#"(() => {{
  if (window.__poSelftestStarted) return; window.__poSelftestStarted = true;
  setTimeout(async () => {{
    const emit = p => window.__TAURI__.event.emit('{EVENT}', p);
    const main = {{ ctx: 'main', origin: location.origin, hasBridge: typeof window.promptops !== 'undefined' }};
    try {{
      await window.__TAURI__.core.invoke('diagnostics_report', {{ kind: 'selftest', location: 'main' }});
      main.appCommand = {{ allowed: true }};
    }} catch (e) {{ main.appCommand = {{ allowed: false, error: String(e).slice(0, 220) }}; }}
    emit(main);
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.display = 'none';
    window.addEventListener('message', ev => {{
      if (ev.source === f.contentWindow && ev.data && ev.data.__poSelftest) {{ emit(ev.data); f.remove(); }}
    }});
    f.srcdoc = {iframe_doc_js};
    document.body.appendChild(f);
  }}, 2500);
}})();"#
        )
    }

    struct State {
        results: Mutex<Vec<Value>>,
        done: AtomicBool,
        /// true if an event arrived from a context that should NOT have been able to emit it.
        leak: AtomicBool,
        /// true if the nested iframe managed to navigate away from itself.
        nav_leak: AtomicBool,
        /// true if navigation went through in the control page (expected).
        nav_control: AtomicBool,
    }

    fn out_path() -> PathBuf {
        std::env::var_os("PROMPTOPS_SECURITY_SELFTEST_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("promptops-security-selftest.json"))
    }

    fn b(v: &Value, path: &[&str]) -> Option<bool> {
        path.iter()
            .try_fold(v, |acc, k| acc.get(k))
            .and_then(Value::as_bool)
    }

    fn checks(
        results: &[Value],
        leak: bool,
        nav_leak: bool,
        nav_control: bool,
    ) -> Vec<(String, bool)> {
        let find = |ctx: &str| results.iter().find(|r| r["ctx"] == ctx);
        let mut out = Vec::new();
        if let Some(m) = find("main") {
            out.push((
                "main: app commands still invocable".into(),
                b(m, &["appCommand", "allowed"]) == Some(true),
            ));
        }
        if let Some(s) = find("secondary-webview") {
            out.push((
                "secondary: app command denied".into(),
                b(s, &["appCommand", "allowed"]) != Some(true),
            ));
            out.push((
                "secondary: event system denied".into(),
                b(s, &["coreEvent", "allowed"]) != Some(true),
            ));
            out.push((
                "secondary: promptops bridge absent".into(),
                b(s, &["hasBridge"]) == Some(false),
            ));
            out.push((
                "secondary: network blocked by CSP".into(),
                b(s, &["network", "reached"]) == Some(false),
            ));
            out.push((
                "host: nested iframe starts with frame-src 'none'".into(),
                b(s, &["nestedIframeAlive"]) == Some(true),
            ));
            out.push(("host: nested iframe navigation blocked".into(), !nav_leak));
            out.push((
                "counter-test: with permissive frame-src navigation goes through".into(),
                nav_control,
            ));
        }
        if let Some(i) = find("sandboxed-iframe") {
            out.push((
                "iframe: no __TAURI_INTERNALS__".into(),
                b(i, &["hasInternals"]) == Some(false),
            ));
            out.push((
                "iframe: no global __TAURI__".into(),
                b(i, &["hasGlobalTauri"]) == Some(false),
            ));
            out.push((
                "iframe: promptops bridge absent".into(),
                b(i, &["hasBridge"]) == Some(false),
            ));
            out.push((
                "iframe: parent not accessible".into(),
                b(i, &["parentAccess"]) == Some(false),
            ));
            out.push((
                "iframe: storage denied".into(),
                b(i, &["storage"]) == Some(false),
            ));
            out.push((
                "iframe: network blocked by CSP".into(),
                b(i, &["network", "reached"]) == Some(false),
            ));
            out.push((
                "iframe: invoke key not visible".into(),
                b(i, &["invokeKeyVisible"]) == Some(false),
            ));
            // The raw handle may exist (WebKit exposes it to all frames): what matters
            // is that a send without the key is rejected by Rust.
            out.push(("iframe/secondary: no event leaked to Rust".into(), !leak));
        }
        out
    }

    fn record(app: &AppHandle, state: &State, value: Value) {
        eprintln!("[security-selftest] result: {value}");
        let mut results = state.results.lock().unwrap();
        results.retain(|r| r["ctx"] != value["ctx"]);
        results.push(value);
        let complete = ["main", "secondary-webview", "sandboxed-iframe", "control"]
            .iter()
            .all(|c| results.iter().any(|r| r["ctx"] == *c));
        let verdicts = checks(
            &results,
            state.leak.load(Ordering::SeqCst),
            state.nav_leak.load(Ordering::SeqCst),
            state.nav_control.load(Ordering::SeqCst),
        );
        let report = json!({
            "platform": std::env::consts::OS,
            "tauri": tauri::VERSION,
            "complete": complete,
            "pass": complete && verdicts.iter().all(|(_, ok)| *ok),
            "notes": {
                "iframeRawIpcHandleExposed": results.iter().find(|r| r["ctx"] == "sandboxed-iframe").and_then(|r| r["hasRawIpcHandle"].as_bool()),
            },
            "checks": verdicts.iter().map(|(n, ok)| json!({ "check": n, "ok": ok })).collect::<Vec<_>>(),
            "raw": *results,
        });
        let _ = std::fs::write(
            out_path(),
            serde_json::to_vec_pretty(&report).unwrap_or_default(),
        );
        if complete && !state.done.swap(true, Ordering::SeqCst) {
            for (name, ok) in &verdicts {
                eprintln!(
                    "[security-selftest] {} {name}",
                    if *ok { "PASS" } else { "FAIL" }
                );
            }
            eprintln!("[security-selftest] report: {}", out_path().display());
            for label in [SECONDARY_LABEL, CONTROL_LABEL] {
                if let Some(w) = app.get_webview_window(label) {
                    let _ = w.close();
                }
            }
        }
    }

    pub fn plugin() -> TauriPlugin<Wry> {
        let state = Arc::new(State {
            results: Mutex::new(Vec::new()),
            done: AtomicBool::new(false),
            leak: AtomicBool::new(false),
            nav_leak: AtomicBool::new(false),
            nav_control: AtomicBool::new(false),
        });
        let started = Arc::new(AtomicBool::new(false));
        let proto_state = state.clone();
        let setup_state = state.clone();

        PluginBuilder::new("security-selftest")
            .register_uri_scheme_protocol(SCHEME, move |ctx, request| {
                let csp = if request.uri().path() == "/control.html" { CONTROL_CSP } else { SECONDARY_CSP };
                let respond = |status: StatusCode, ctype: &str, body: Vec<u8>| {
                    Response::builder()
                        .status(status)
                        .header("Content-Type", ctype)
                        .header("Content-Security-Policy", csp)
                        .body(Cow::Owned(body))
                        .unwrap()
                };
                match request.uri().path() {
                    "/report" => {
                        if let Ok(v) = serde_json::from_slice::<Value>(request.body()) {
                            record(ctx.app_handle(), &proto_state, v);
                        }
                        respond(StatusCode::OK, "text/plain", b"ok".to_vec())
                    }
                    "/nav-leak" => {
                        eprintln!("[security-selftest] NAV-LEAK: the nested iframe navigated away from itself");
                        proto_state.nav_leak.store(true, Ordering::SeqCst);
                        respond(StatusCode::OK, "text/plain", b"leak".to_vec())
                    }
                    "/nav-control" => {
                        proto_state.nav_control.store(true, Ordering::SeqCst);
                        respond(StatusCode::OK, "text/plain", b"control".to_vec())
                    }
                    "/control.html" => respond(StatusCode::OK, "text/html", CONTROL_PAGE.as_bytes().to_vec()),
                    "/index.html" => respond(StatusCode::OK, "text/html", secondary_page().into_bytes()),
                    _ => respond(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
                }
            })
            .setup(move |app, _api| {
                let leak_state = setup_state.clone();
                app.listen_any(LEAK_EVENT, move |ev| {
                    eprintln!("[security-selftest] LEAK: event from unauthorized context: {}", ev.payload());
                    leak_state.leak.store(true, Ordering::SeqCst);
                });
                let handle = app.clone();
                app.listen_any(EVENT, move |ev| {
                    if let Ok(v) = serde_json::from_str::<Value>(ev.payload()) {
                        record(&handle, &setup_state, v);
                    }
                });
                Ok(())
            })
            .on_page_load(move |webview, payload| {
                if webview.label() != "main" || payload.event() != PageLoadEvent::Finished {
                    return;
                }
                let _ = webview.eval(main_probe());
                if started.swap(true, Ordering::SeqCst) {
                    return;
                }
                let app = webview.app_handle().clone();
                std::thread::spawn(move || {
                    let url = format!("{SCHEME}://localhost/index.html").parse().unwrap();
                    let built = tauri::WebviewWindowBuilder::new(
                        &app,
                        SECONDARY_LABEL,
                        tauri::WebviewUrl::CustomProtocol(url),
                    )
                    .title("security selftest")
                    .visible(false)
                    .build();
                    if let Err(e) = built {
                        eprintln!("[security-selftest] secondary webview not created: {e}");
                    }
                    let control_url = format!("{SCHEME}://localhost/control.html").parse().unwrap();
                    if let Err(e) = tauri::WebviewWindowBuilder::new(
                        &app,
                        CONTROL_LABEL,
                        tauri::WebviewUrl::CustomProtocol(control_url),
                    )
                    .title("security selftest control")
                    .visible(false)
                    .build()
                    {
                        eprintln!("[security-selftest] control webview not created: {e}");
                    }
                });
            })
            .build()
    }
}
