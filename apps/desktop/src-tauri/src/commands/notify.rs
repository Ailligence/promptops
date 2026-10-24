//! System notifications + Dock badge (phase 1.4 of the native chrome).
//!
//! There is a single use case: the user launches an agent, switches window, and the
//! provider stops to ask something. Today that moment is invisible until
//! you come back to the app. Here the pending request becomes a system
//! notification (only when the window is NOT focused, otherwise it is noise: the request is
//! already on screen) and a Dock badge with the number of pending requests.
//!
//! `tauri-plugin-notification` is already initialized in lib.rs; the macOS badge
//! goes through AppKit because Tauri doesn't expose the dock tile.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::OnceLock;

use parking_lot::Mutex;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// The window starts focused: nothing must be notified at startup.
static WINDOW_FOCUSED: AtomicBool = AtomicBool::new(true);
/// Last value written to the badge — avoids crossing into AppKit for nothing.
static LAST_BADGE: AtomicUsize = AtomicUsize::new(0);

/// Titles of automatic notifications. As for the native menu, the default is
/// English (the project fallback) and the webapp sends them back translated at bootstrap.
struct NotifyLabels {
    input: String,
    action: String,
}

impl Default for NotifyLabels {
    fn default() -> Self {
        Self {
            input: "Input requested".to_string(),
            action: "Action requested".to_string(),
        }
    }
}

static LABELS: OnceLock<Mutex<NotifyLabels>> = OnceLock::new();

fn label_store() -> &'static Mutex<NotifyLabels> {
    LABELS.get_or_init(|| Mutex::new(NotifyLabels::default()))
}

/// Title for an input request.
pub fn input_title() -> String {
    label_store().lock().input.clone()
}

/// Title for a human action request.
pub fn action_title() -> String {
    label_store().lock().action.clone()
}

/// Updated by `on_window_event` in lib.rs.
pub fn set_window_focused(focused: bool) {
    WINDOW_FOCUSED.store(focused, Ordering::Relaxed);
}

pub fn is_window_focused() -> bool {
    WINDOW_FOCUSED.load(Ordering::Relaxed)
}

/// System notification, shown only if the window is not focused.
///
/// Silent on error: an undelivered notification (permission denied,
/// unsigned app in dev) must never propagate to the caller, which is
/// dealing with something else entirely.
pub fn notify_if_unfocused(app: &AppHandle, title: &str, body: &str, session_id: Option<&str>) {
    if is_window_focused() {
        return;
    }
    show(app, title, body, session_id);
}

/// Once in `setup`: on macOS installs the click→navigate delegate and asks for
/// the notification permission (system prompt on first launch). No-op elsewhere.
pub fn bootstrap(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    crate::commands::notify_macos::bootstrap(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Native notification, without focus guard. `session_id` = session to open on
/// click (macOS only via UserNotifications; the plugin doesn't expose the click).
///
/// On macOS the plugin (`NSUserNotificationCenter`, deprecated) no longer delivers
/// anything on macOS 26: we go through `notify_macos` and fall back to the plugin only
/// outside the bundle (`tauri dev`).
pub fn show(app: &AppHandle, title: &str, body: &str, session_id: Option<&str>) {
    #[cfg(target_os = "macos")]
    if crate::commands::notify_macos::show(app, title, body, session_id) {
        return;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = session_id;
    if let Err(err) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[notify] notification failed: {err}");
    }
}

/// Dock badge with the number of pending requests (0 = badge removed).
///
/// macOS only: on Windows/Linux the equivalent is the taskbar overlay icon / count,
/// which will come with the tray (phase 1.5).
pub fn set_pending_badge(app: &AppHandle, count: usize) {
    if LAST_BADGE.swap(count, Ordering::Relaxed) == count {
        return;
    }
    let _ = app;
    #[cfg(target_os = "macos")]
    {
        let label = if count == 0 {
            None
        } else if count > 99 {
            Some("99+".to_string())
        } else {
            Some(count.to_string())
        };
        // dockTile is AppKit: main thread required.
        let _ = app.run_on_main_thread(move || {
            let Some(mtm) = objc2_foundation::MainThreadMarker::new() else {
                return;
            };
            let ns_app = objc2_app_kit::NSApplication::sharedApplication(mtm);
            let tile = ns_app.dockTile();
            match &label {
                Some(text) => {
                    let ns_text = objc2_foundation::NSString::from_str(text);
                    tile.setBadgeLabel(Some(&ns_text));
                }
                None => tile.setBadgeLabel(None),
            }
        });
    }
}

/// Called by the InteractionManager as soon as it creates a pending request.
///
/// `pending` is the total of pending requests AFTER this one: the badge must
/// reflect the real state, not increment blindly.
pub fn on_interaction_created(
    app: &AppHandle,
    title: &str,
    prompt: &str,
    pending: usize,
    session_id: &str,
) {
    set_pending_badge(app, pending);
    crate::commands::tray::refresh(app);
    notify_if_unfocused(app, title, &truncate(prompt, 140), Some(session_id));
}

/// Call when a request is resolved or expires.
pub fn on_pending_changed(app: &AppHandle, pending: usize) {
    set_pending_badge(app, pending);
    crate::commands::tray::refresh(app);
}

/// A notification body is not a terminal: we truncate, without splitting
/// multibyte characters.
fn truncate(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(max).collect();
    format!("{cut}…")
}

/// notify:native — explicit notification requested by the renderer.
///
/// `force` shows it even when the window is focused (default: only when unfocused).
/// Optional `session_id` = session to open on click.
#[tauri::command]
pub fn notify_native(
    app: AppHandle,
    title: String,
    body: String,
    force: Option<bool>,
    session_id: Option<String>,
) {
    if force.unwrap_or(false) {
        show(&app, &title, &body, session_id.as_deref());
    } else {
        notify_if_unfocused(&app, &title, &body, session_id.as_deref());
    }
}

/// notify:set-badge — the renderer can force the badge (e.g. after a full
/// refresh of the interaction list done on the webapp side).
#[tauri::command]
pub fn notify_set_badge(app: AppHandle, count: usize) {
    set_pending_badge(&app, count);
}

/// notify:set-labels — translated titles of automatic notifications.
#[tauri::command]
pub fn notify_set_labels(input: Option<String>, action: Option<String>) {
    let mut labels = label_store().lock();
    if let Some(text) = input
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        labels.input = text;
    }
    if let Some(text) = action
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        labels.action = text;
    }
}

#[cfg(test)]
mod tests {
    use super::truncate;

    #[test]
    fn truncate_keeps_short_text() {
        assert_eq!(truncate("  hello  ", 10), "hello");
    }

    #[test]
    fn truncate_cuts_on_char_boundary() {
        // 'à' is multibyte: cutting at a byte boundary would split the string.
        let text = "à".repeat(200);
        let out = truncate(&text, 5);
        assert_eq!(out.chars().count(), 6); // 5 + ellipsis
        assert!(out.ends_with('…'));
    }
}
