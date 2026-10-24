//! macOS cursor fallback.
//!
//! WKWebView doesn't draw the cursor itself like Chromium does: it delegates to AppKit
//! via cursor rects, which are recomputed only while the view receives
//! `mouseMoved`. Inside wry that chain breaks (wry#175/#1333) and the
//! CSS cursor is never applied — fixed arrow on links, buttons and
//! splitters.
//!
//! `ensure_webview_first_responder` (lib.rs) covers the "the webview has
//! lost first responder" case. When even that isn't enough, this
//! fallback remains: the bridge watches the computed cursor under the pointer and
//! calls `set_native_cursor` ONLY when it changes (not on every mousemove).
//!
//! It's applied through Tauri's `set_cursor_icon`, not through a direct
//! `NSCursor::set()`: tao keeps the chosen cursor in its own
//! `cursorUpdate:` handler, while an isolated `set()` gets overwritten
//! by the first relevant AppKit event.

use tauri::CursorIcon;
use tauri::Manager;

/// Translates a CSS `cursor` value into the corresponding Tauri icon.
/// Unmapped values fall back to `Default`, which is also the right
/// behavior for `default`/`auto`.
fn css_to_icon(name: &str) -> CursorIcon {
    match name {
        "pointer" => CursorIcon::Hand,
        "text" => CursorIcon::Text,
        "vertical-text" => CursorIcon::VerticalText,
        "col-resize" => CursorIcon::ColResize,
        "row-resize" => CursorIcon::RowResize,
        "ew-resize" => CursorIcon::EwResize,
        "ns-resize" => CursorIcon::NsResize,
        "e-resize" => CursorIcon::EResize,
        "w-resize" => CursorIcon::WResize,
        "n-resize" => CursorIcon::NResize,
        "s-resize" => CursorIcon::SResize,
        "nesw-resize" => CursorIcon::NeswResize,
        "nwse-resize" => CursorIcon::NwseResize,
        "grab" => CursorIcon::Grab,
        "grabbing" => CursorIcon::Grabbing,
        "move" => CursorIcon::Move,
        "all-scroll" => CursorIcon::AllScroll,
        "not-allowed" => CursorIcon::NotAllowed,
        "no-drop" => CursorIcon::NoDrop,
        "crosshair" => CursorIcon::Crosshair,
        "help" => CursorIcon::Help,
        "wait" => CursorIcon::Wait,
        "progress" => CursorIcon::Progress,
        "context-menu" => CursorIcon::ContextMenu,
        "copy" => CursorIcon::Copy,
        "alias" => CursorIcon::Alias,
        "cell" => CursorIcon::Cell,
        "zoom-in" => CursorIcon::ZoomIn,
        "zoom-out" => CursorIcon::ZoomOut,
        _ => CursorIcon::Default,
    }
}

/// Applies the native cursor matching a CSS `cursor` value.
#[tauri::command]
pub async fn set_native_cursor(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let Some(win) = app.get_webview_window("main") else {
        return Ok(());
    };
    win.set_cursor_icon(css_to_icon(&name))
        .map_err(|e| e.to_string())
}
