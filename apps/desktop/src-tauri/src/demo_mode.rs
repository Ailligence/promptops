//! Demo mode for recording videos: same app, isolated data.
//!
//! Turns on ONLY in debug builds (`tauri dev`) with `PROMPTOPS_DEMO=1`
//! set in the environment; in release it is always off, whatever the env.
//!
//! What it does:
//! - `PROMPTOPS_DEMO_HOME` becomes the process `HOME`, before any
//!   thread: `hook_data_dir` (workspaces.json, parked buffers…), `app_data_dir`
//!   (ctl.json, plugins, provider accounts), `~/.claude.json`, `~/.gemini`,
//!   `~/.gitconfig` and the agent shells all end up in the sandbox.
//!   The agent CLIs inherit the launch PATH, so they find the real binaries.
//! - exposes `window.__PROMPTOPS_DEMO__ = true` to the webapp;
//! - with `PROMPTOPS_QA_PLAN`, runs a QA plan in the window (`qa_autopilot.js`);
//! - on macOS the webview uses its own WebKit data store: localStorage and
//!   cookies do not mix with those of the installed app.
//!
//! The bundle identifier stays `it.promptops.oss`: the isolation comes from
//! the separate HOME and WebKit data store above, not from another app id.

use std::env;

pub fn enabled() -> bool {
    cfg!(debug_assertions) && env::var("PROMPTOPS_DEMO").as_deref() == Ok("1")
}

/// Call this first thing in `run()`: `set_var` is not thread-safe.
pub fn apply() {
    if !enabled() {
        return;
    }
    match env::var("PROMPTOPS_DEMO_HOME") {
        Ok(home) if !home.trim().is_empty() => {
            if let Err(e) = std::fs::create_dir_all(&home) {
                eprintln!("[demo] cannot create the demo HOME {home}: {e}");
                std::process::exit(1);
            }
            env::set_var("HOME", &home);
            eprintln!("[demo] demo mode active, HOME={home}");
        }
        _ => {
            // Without a sandbox the demo would write into real data: better not to start.
            eprintln!("[demo] PROMPTOPS_DEMO=1 requires PROMPTOPS_DEMO_HOME");
            std::process::exit(1);
        }
    }
}

/// Script for the webview. In demo mode it can also carry a QA plan
/// (`PROMPTOPS_QA_PLAN=<plan.json>`), run by `qa_autopilot.js`: a fixed set of
/// DOM steps for end-to-end checks. Debug builds only, like the rest of this module.
pub fn init_script() -> String {
    if !enabled() {
        return String::new();
    }
    let mut script = String::from("window.__PROMPTOPS_DEMO__ = true;\n");
    if let Ok(path) = env::var("PROMPTOPS_QA_PLAN") {
        // Parsed and serialized again: only JSON data reaches the page.
        match std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).map_err(|e| e.to_string()))
        {
            Ok(plan) => {
                script.push_str(&format!("window.__PROMPTOPS_QA_PLAN__ = {plan};\n"));
                script.push_str(include_str!("qa_autopilot.js"));
                eprintln!("[qa] plan loaded from {path}");
            }
            Err(e) => eprintln!("[qa] cannot read the plan {path}: {e}"),
        }
    }
    script
}

/// Dedicated WebKit data store (macOS 14+): 16 fixed bytes so the demo login persists across launches.
pub const DATA_STORE_ID: [u8; 16] = *b"promptops-demo-1";
