//! Native application menu (phase 1.1 of the "native chrome" plan).
//!
//! The menu is a native surface: besides the predefined items — which on
//! macOS are mandatory, because a custom menu REPLACES the default one
//! and without `copy/paste/cut/select_all` Cmd+C/V stop working across
//! the whole webview — it exposes the app actions (sessions, workspace, sub-agent).
//!
//! The menu is deliberately "dumb": app items do not touch state,
//! they emit `native:menu` to the webview and Angular routes them to the methods that
//! already exist in session-view. Only the actions the webview cannot
//! do on its own stay in Rust (zoom, reload, devtools, window).
//!
//! Labels: the webapp is translated into 15 languages, the native menu is not. It starts in
//! English (the project fallback) and Angular calls `menu_apply_labels` with the
//! translated dictionary after bootstrap and on every language change.
//!
//! id → event mapping:
//!   `app:*`      -> emit `native:menu` { action, payload: None }
//!   `recent::<path>` -> emit `native:menu` { action: "workspace:open-recent", payload: path }
//!   `native:*`   -> handled here (zoom/reload/devtools)

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};

/// Payload of `native:menu` — contract with NativeMenuService (Angular).
#[derive(Clone, Serialize)]
pub struct NativeMenuPayload {
    pub action: String,
    pub payload: Option<String>,
}

/// Id prefix of the "recent workspaces" items: the path travels in the id.
const RECENT_ID_PREFIX: &str = "recent::";
/// Beyond this threshold the recents menu becomes a scrolling list: the others
/// remain reachable from the picker anyway.
const MAX_RECENT_IN_MENU: usize = 8;

/// Webview zoom in percent (100 = 1.0). It lives here and not in the webview
/// because the window owns it: a reload must not reset it.
static ZOOM_PERCENT: AtomicU32 = AtomicU32::new(100);
const ZOOM_MIN: u32 = 50;
const ZOOM_MAX: u32 = 200;
const ZOOM_STEP: u32 = 10;

/// Translated labels sent by Angular (key = item id).
static LABELS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn label_store() -> &'static Mutex<HashMap<String, String>> {
    LABELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Translated label if Angular already sent it, otherwise the base English one.
fn t(key: &str, fallback: &str) -> String {
    label_store()
        .lock()
        .get(key)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

/// App shortcuts: macOS only.
///
/// On macOS Cmd never reaches the PTY, so Cmd+<letter> is safe. On
/// Windows/Linux a Ctrl+<letter> accelerator would STEAL a legitimate control key
/// from the terminal (Ctrl+R = reverse-search, Ctrl+N/Ctrl+O = movement and
/// saving in nano/emacs): there the items stay clickable but without a key.
#[cfg(target_os = "macos")]
fn app_accel(accel: &str) -> Option<String> {
    Some(accel.to_string())
}
#[cfg(not(target_os = "macos"))]
fn app_accel(_accel: &str) -> Option<String> {
    None
}

/// App item: stable id, translatable label, optional accelerator.
fn item(
    app: &AppHandle,
    id: &str,
    fallback: &str,
    accel: Option<String>,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    let mut builder = MenuItemBuilder::with_id(id, t(id, fallback));
    if let Some(accel) = accel {
        builder = builder.accelerator(accel);
    }
    builder.build(app)
}

fn about_metadata(app: &AppHandle) -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some("PromptOps".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("© PromptOps".into()),
        ..Default::default()
    }
}

/// Builds the whole application menu. Called at setup and on every
/// `menu_apply_labels` / `menu_refresh_recents` (the menu is not mutated in place:
/// muda does not reliably expose replacing a single item on all
/// platforms, rebuilding it is simpler and just as fast).
pub fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let mut builder = MenuBuilder::new(app);

    // ── App menu (macOS only) ────────────────────────────────────────────
    // It must remain the FIRST submenu: AppKit gives it the bundle name.
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "PromptOps")
            .about(Some(about_metadata(app)))
            .separator()
            .item(&item(
                app,
                "app:settings",
                "Settings…",
                app_accel("Cmd+Comma"),
            )?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        builder = builder.item(&app_menu);
    }

    // ── File ─────────────────────────────────────────────────────────────
    let recent_menu = build_recent_submenu(app)?;
    let file_menu = SubmenuBuilder::new(app, t("menu:file", "File"))
        .item(&item(
            app,
            "app:session-new",
            "New Session…",
            app_accel("Cmd+N"),
        )?)
        .item(&item(
            app,
            "app:session-new-tab",
            "New Session Tab",
            app_accel("Cmd+T"),
        )?)
        .separator()
        .item(&item(
            app,
            "app:workspace-open",
            "Open Workspace…",
            app_accel("Cmd+O"),
        )?)
        .item(&recent_menu)
        .separator()
        .item(&item(
            app,
            "app:session-close",
            "Close Session",
            app_accel("Cmd+Shift+W"),
        )?)
        .build()?;
    builder = builder.item(&file_menu);

    // ── Edit ─────────────────────────────────────────────────────────────
    // Mandatory predefined items: without them, on macOS Cmd+C/V/X/A die
    // everywhere in the webview (xterm included).
    let edit_menu = SubmenuBuilder::new(app, t("menu:edit", "Edit"))
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    builder = builder.item(&edit_menu);

    // ── Session ──────────────────────────────────────────────────────────
    let session_menu = SubmenuBuilder::new(app, t("menu:session", "Session"))
        .item(&item(
            app,
            "app:subagent-spawn",
            "Spawn Sub-agent…",
            app_accel("Cmd+Shift+A"),
        )?)
        .item(&item(app, "app:session-rename", "Rename Session…", None)?)
        .item(&item(
            app,
            "app:session-standby",
            "Put on Standby",
            app_accel("Cmd+Shift+S"),
        )?)
        .separator()
        .item(&item(
            app,
            "app:session-prev",
            "Previous Session",
            app_accel("Cmd+Alt+Left"),
        )?)
        .item(&item(
            app,
            "app:session-next",
            "Next Session",
            app_accel("Cmd+Alt+Right"),
        )?)
        .separator()
        .item(&item(app, "app:git-explorer", "Git Explorer", None)?)
        .item(&item(app, "app:db-explorer", "Database Explorer", None)?)
        .item(&item(app, "app:terminals", "Terminals", None)?)
        .build()?;
    builder = builder.item(&session_menu);

    // ── View ─────────────────────────────────────────────────────────────
    let mut view_builder = SubmenuBuilder::new(app, t("menu:view", "View")).item(&item(
        app,
        "native:reload",
        "Reload",
        app_accel("Cmd+R"),
    )?);
    // Developer Tools only in debug builds: release builds ship without the
    // tauri `devtools` feature, so the item would do nothing there.
    if cfg!(debug_assertions) {
        let devtools_accel = if cfg!(target_os = "macos") {
            "Cmd+Alt+I"
        } else {
            "Ctrl+Shift+I"
        };
        view_builder = view_builder.item(&item(
            app,
            "native:devtools",
            "Developer Tools",
            Some(devtools_accel.to_string()),
        )?);
    }
    let view_menu = view_builder
        .separator()
        .item(&item(
            app,
            "native:zoom-in",
            "Zoom In",
            app_accel("Cmd+Equal"),
        )?)
        .item(&item(
            app,
            "native:zoom-out",
            "Zoom Out",
            app_accel("Cmd+Minus"),
        )?)
        .item(&item(
            app,
            "native:zoom-reset",
            "Actual Size",
            app_accel("Cmd+0"),
        )?)
        .separator()
        .fullscreen()
        .build()?;
    builder = builder.item(&view_menu);

    // ── Window ───────────────────────────────────────────────────────────
    #[allow(unused_mut)]
    let mut window_builder = SubmenuBuilder::new(app, t("menu:window", "Window"))
        .minimize()
        .maximize()
        .separator()
        .close_window();
    #[cfg(target_os = "macos")]
    {
        window_builder = window_builder.separator().bring_all_to_front();
    }
    let window_menu = window_builder.build()?;
    builder = builder.item(&window_menu);

    // ── Help ─────────────────────────────────────────────────────────────
    // All items are internal to the app: no hard-coded external URL here.
    let help_menu = SubmenuBuilder::new(app, t("menu:help", "Help"))
        .item(&item(app, "app:docs", "Documentation", None)?)
        .item(&item(app, "app:feedback", "Send Feedback…", None)?)
        .item(&item(app, "app:release-notes", "Release Notes", None)?)
        .separator()
        .item(&item(app, "app:check-updates", "Check for Updates…", None)?)
        .build()?;
    builder = builder.item(&help_menu);

    builder.build()
}

/// Entrypoint for `Builder::menu`. If building fails (unparsable accelerator,
/// item that cannot be created) the app must NOT refuse to start: it
/// falls back to Tauri's standard menu, which guarantees at least Edit and Window.
pub fn build_app_menu_or_default(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    match build_app_menu(app) {
        Ok(menu) => Ok(menu),
        Err(err) => {
            eprintln!("[menu] build failed, falling back to the default menu: {err}");
            Menu::default(app)
        }
    }
}

/// Menu label of a recent workspace. `&` marks a mnemonic in menu labels (muda
/// strips it on macOS, underlines the next letter on Windows/Linux): a folder
/// called `R&D` showed as `RD`. Doubled, it renders as a literal `&`.
fn recent_label(name: &str, path: &str) -> String {
    let label = if name.trim().is_empty() {
        path.to_string()
    } else {
        format!("{name}  —  {path}")
    };
    label.replace('&', "&&").replace(['\n', '\r'], " ")
}

/// "Recent Workspaces" submenu built from the already persisted recents
/// (`workspace::workspace_recent`).
fn build_recent_submenu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let recents = crate::commands::workspace::workspace_recent(app.clone());
    let mut builder = SubmenuBuilder::new(app, t("menu:recent", "Recent Workspaces"));

    if recents.is_empty() {
        let empty =
            MenuItemBuilder::with_id("app:noop", t("menu:recent-empty", "No recent workspaces"))
                .enabled(false)
                .build(app)?;
        builder = builder.item(&empty);
    } else {
        for workspace in recents.iter().take(MAX_RECENT_IN_MENU) {
            let label = recent_label(&workspace.name, &workspace.path);
            let entry =
                MenuItemBuilder::with_id(format!("{RECENT_ID_PREFIX}{}", workspace.path), label)
                    .build(app)?;
            builder = builder.item(&entry);
        }
    }

    builder.build()
}

// ═════════════════════════════════════════════════════════════════════════
//  Context menu (phase 1.2)
// ═════════════════════════════════════════════════════════════════════════

/// menu:popup — native context menu.
///
/// Right-clicking on a text field or on a selection should open the system
/// menu, but in wry it opens nothing. The bridge invokes it only when NO
/// component has already handled the event, so custom menus (xterm,
/// sidebar, git explorer) stay as they are.
///
/// `kind`:
///   - `edit`     editable field: cut/copy/paste/select all
///   - `selection` read-only with selected text: copy
///
/// The items are `PredefinedMenuItem`s: they act on the webview at the system
/// level, without going through JS (which in WKWebView cannot paste on its own).
#[tauri::command]
pub fn menu_popup(app: AppHandle, kind: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main window not found".to_string());
    };

    let menu = match kind.as_str() {
        "edit" => MenuBuilder::new(&app)
            .cut()
            .copy()
            .paste()
            .separator()
            .select_all()
            .build(),
        "selection" => MenuBuilder::new(&app).copy().build(),
        other => return Err(format!("unknown context menu kind: {other}")),
    }
    .map_err(|e| format!("context menu build failed: {e}"))?;

    // popup_menu opens at the current cursor position. On macOS it must run
    // on the main thread like any other AppKit menu operation.
    let win = window.clone();
    app.run_on_main_thread(move || {
        let _ = win.popup_menu(&menu);
    })
    .map_err(|e| format!("context menu popup failed: {e}"))
}

/// Single handler registered in lib.rs via `Builder::on_menu_event`.
pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().0.clone();

    // Recent workspaces: the path is in the id.
    if let Some(path) = id.strip_prefix(RECENT_ID_PREFIX) {
        emit_menu(app, "workspace:open-recent", Some(path.to_string()));
        return;
    }

    match id.as_str() {
        "app:noop" => {}
        "native:reload" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.reload();
            }
        }
        "native:devtools" =>
        {
            #[cfg(debug_assertions)]
            if let Some(win) = app.get_webview_window("main") {
                win.open_devtools();
            }
        }
        "native:zoom-in" => apply_zoom(app, ZOOM_PERCENT.load(Ordering::Relaxed) + ZOOM_STEP),
        "native:zoom-out" => apply_zoom(
            app,
            ZOOM_PERCENT
                .load(Ordering::Relaxed)
                .saturating_sub(ZOOM_STEP),
        ),
        "native:zoom-reset" => apply_zoom(app, 100),
        other => {
            if let Some(action) = other.strip_prefix("app:") {
                emit_menu(app, action, None);
            }
        }
    }
}

fn emit_menu(app: &AppHandle, action: &str, payload: Option<String>) {
    let _ = app.emit(
        "native:menu",
        NativeMenuPayload {
            action: action.to_string(),
            payload,
        },
    );
}

fn apply_zoom(app: &AppHandle, requested: u32) {
    let clamped = requested.clamp(ZOOM_MIN, ZOOM_MAX);
    ZOOM_PERCENT.store(clamped, Ordering::Relaxed);
    if let Some(win) = app.get_webview_window("main") {
        // On macOS < 11 pageZoom does not exist and wry returns an error: the zoom stays
        // as it is, the rest of the menu keeps working.
        let _ = win.set_zoom(clamped as f64 / 100.0);
    }
}

// ═════════════════════════════════════════════════════════════════════════
//  Commands exposed to the renderer
// ═════════════════════════════════════════════════════════════════════════

/// menu:apply-labels — Angular sends the translated labels (key = item id,
/// plus `menu:*` for the submenu titles) at bootstrap and on every language change.
#[tauri::command]
pub fn menu_apply_labels(app: AppHandle, labels: HashMap<String, String>) -> Result<(), String> {
    {
        let mut guard = label_store().lock();
        guard.clear();
        guard.extend(labels);
    }
    refresh(&app)
}

/// menu:refresh-recents — to call after opening a workspace, so the
/// recents list in the menu stays aligned with the sidebar's.
#[tauri::command]
pub fn menu_refresh_recents(app: AppHandle) -> Result<(), String> {
    refresh(&app)
}

/// Rebuilds and reapplies the menu. Public because `workspace_select`
/// calls it as soon as it updates the recents: so the submenu stays aligned without
/// every Angular-side caller having to remember it.
pub fn refresh(app: &AppHandle) -> Result<(), String> {
    let menu = build_app_menu(app).map_err(|e| format!("menu build failed: {e}"))?;
    // set_menu touches the menubar: on macOS it MUST run on the main thread.
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = app_handle.set_menu(menu);
    })
    .map_err(|e| format!("menu apply failed: {e}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn recent_labels_keep_ampersands_and_stay_on_one_line() {
        assert_eq!(super::recent_label("R&D", "/w/R&D"), "R&&D  —  /w/R&&D");
        assert_eq!(super::recent_label(" ", "/a\nb"), "/a b");
    }
}
