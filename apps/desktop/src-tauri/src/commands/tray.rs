//! System tray icon (phase 1.5 of the native chrome).
//!
//! It serves one purpose only: when the app is in the background and an agent stops to
//! ask something, there must be an always-visible place that says so. The
//! Dock badge (see `notify.rs`) covers macOS; the tray covers all three
//! platforms and adds the two actions that are really needed from outside: bringing
//! the window up and quitting the app.
//!
//! The menu is rebuilt when the counts change: `muda` does not expose a
//! reliable update of a single item on all platforms.
//!
//! Tolerated failure: on Linux the tray depends on libayatana-appindicator,
//! which may be missing (a raw binary run outside the .deb/AppImage). The
//! appindicator crate PANICS when it cannot load the library, so `setup`
//! checks that the library loads first and also turns any panic of the
//! tray build into an error: the app starts anyway, just without the icon.

use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuEvent};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::interaction::InteractionManager;
use crate::commands::session::SessionManager;

const TRAY_ID: &str = "promptops-tray";

/// Tray menu items. Prefix distinct from the application menu ones: the
/// two hierarchies share the global `on_menu_event` handler.
const ID_SHOW: &str = "tray:show";
const ID_NEW_SESSION: &str = "tray:new-session";
const ID_QUIT: &str = "tray:quit";

/// Creates the icon. Non-fatal errors: see the Linux note at the top of the module.
pub fn setup(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if !indicator_library_loads() {
        return Err(
            "libayatana-appindicator3 (or libappindicator3) is not installed: no tray icon".into(),
        );
    }
    guarded(|| build_tray(app).map_err(|e| e.to_string()))
}

/// Runs `f`, turning a panic into an error (the panic message is still
/// printed by the panic hook).
fn guarded<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
        .unwrap_or_else(|_| Err("the system tray could not be created".into()))
}

/// The same libraries, in the same order, that libappindicator-sys loads.
#[cfg(target_os = "linux")]
fn indicator_library_loads() -> bool {
    [
        c"libayatana-appindicator3.so.1",
        c"libappindicator3.so.1",
        c"libayatana-appindicator3.so",
        c"libappindicator3.so",
    ]
    .iter()
    .any(|name| {
        // SAFETY: a NUL-terminated name; the handle is closed right away.
        let handle = unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_LAZY | libc::RTLD_LOCAL) };
        if handle.is_null() {
            return false;
        }
        unsafe { libc::dlclose(handle) };
        true
    })
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("PromptOps")
        .on_tray_icon_event(|tray, event| {
            // Left click on the icon = bring the window up, as one
            // expects from an app with a tray. The menu stays on right click.
            if let TrayIconEvent::Click { button, .. } = event {
                if button == tauri::tray::MouseButton::Left {
                    focus_main_window(tray.app_handle());
                }
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    // macOS: monochrome icon that follows the menu bar theme.
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    builder.build(app)?;
    Ok(())
}

/// Rebuilds the menu with the updated counts. Called when the pending
/// requests change (see `notify::on_pending_changed`).
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    let _ = tray.set_tooltip(Some(tooltip_text(app)));
}

fn counts(app: &AppHandle) -> (usize, usize) {
    let sessions = app
        .try_state::<Arc<SessionManager>>()
        .map(|m| m.list().len())
        .unwrap_or(0);
    let pending = app
        .try_state::<Arc<InteractionManager>>()
        .map(|m| m.list_pending(None).len())
        .unwrap_or(0);
    (sessions, pending)
}

fn tooltip_text(app: &AppHandle) -> String {
    let (sessions, pending) = counts(app);
    if pending > 0 {
        format!("PromptOps — {sessions} sessions · {pending} waiting")
    } else {
        format!("PromptOps — {sessions} sessions")
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let (sessions, pending) = counts(app);
    let summary = if pending > 0 {
        format!("{sessions} sessions · {pending} waiting")
    } else {
        format!("{sessions} active sessions")
    };

    // The first item is informational: disabled, not clickable.
    let info = tauri::menu::MenuItemBuilder::with_id("tray:info", summary)
        .enabled(false)
        .build(app)?;

    MenuBuilder::new(app)
        .item(&info)
        .separator()
        .text(ID_SHOW, "Show PromptOps")
        .text(ID_NEW_SESSION, "New session")
        .separator()
        .text(ID_QUIT, "Quit")
        .build()
}

/// Handles the tray items. Returns true if the event was its own, so the
/// application menu handler can ignore it.
pub fn handle_menu_event(app: &AppHandle, event: &MenuEvent) -> bool {
    match event.id().0.as_str() {
        ID_SHOW => {
            focus_main_window(app);
            true
        }
        ID_NEW_SESSION => {
            focus_main_window(app);
            // Same path as the application menu: the webapp already knows what to do.
            let _ = app.emit(
                "native:menu",
                crate::commands::menu::NativeMenuPayload {
                    action: "session-new".to_string(),
                    payload: None,
                },
            );
            true
        }
        ID_QUIT => {
            // exit() goes through RunEvent::ExitRequested: the flush of sessions and
            // prompt-count in lib.rs keeps running.
            app.exit(0);
            true
        }
        "tray:info" => true,
        _ => false,
    }
}

fn focus_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::guarded;

    #[test]
    fn a_panicking_tray_build_becomes_an_error() {
        let out: Result<(), String> = guarded(|| panic!("Failed to load ayatana-appindicator3"));
        assert!(out.is_err());
        assert_eq!(guarded(|| Ok::<_, String>(7)), Ok(7));
        assert_eq!(guarded(|| Err::<(), _>("x".to_string())), Err("x".into()));
    }
}
