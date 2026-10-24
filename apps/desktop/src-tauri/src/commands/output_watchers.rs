//! Child windows that watch terminal output (a session opened in its own window).
//!
//! The main window channel stays the usual one (per-PTY for the session, global for
//! sub-agents): children receive a COPY. A failed send removes only that child, never the
//! main one, and closing the window forgets them all. Only `detached-*` windows.
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri::ipc::{Channel, InvokeResponseBody};

type Watchers = Vec<(String, Channel<InvokeResponseBody>)>;

#[derive(Default)]
struct Registry {
    /// session_id → windows watching that session's main PTY.
    sessions: Mutex<HashMap<String, Watchers>>,
    /// Windows receiving the frames of all sub-agents (same format as the global channel).
    subagents: Mutex<Watchers>,
}

fn registry() -> &'static Registry {
    static R: OnceLock<Registry> = OnceLock::new();
    R.get_or_init(Registry::default)
}

fn is_child_window(label: &str) -> bool {
    label.starts_with("detached-")
}

/// Copies a session PTY chunk to the child windows watching it.
pub fn send_session(session_id: &str, chunk: &[u8]) {
    let mut map = registry().sessions.lock();
    let Some(list) = map.get_mut(session_id) else {
        return;
    };
    list.retain(|(_, ch)| ch.send(InvokeResponseBody::Raw(chunk.to_vec())).is_ok());
    if list.is_empty() {
        map.remove(session_id);
    }
}

/// Are there children watching sub-agents? (avoids building the frame for nobody)
pub fn has_subagent_watchers() -> bool {
    !registry().subagents.lock().is_empty()
}

/// Copies a sub-agent frame ([idLen][id][parentLen][parent][offset u64][data]) to the children.
pub fn send_subagent(frame: &[u8]) {
    registry()
        .subagents
        .lock()
        .retain(|(_, ch)| ch.send(InvokeResponseBody::Raw(frame.to_vec())).is_ok());
}

/// The window closed: no more copies for it.
pub fn forget_window(label: &str) {
    let r = registry();
    r.sessions.lock().retain(|_, list| {
        list.retain(|(l, _)| l != label);
        !list.is_empty()
    });
    r.subagents.lock().retain(|(l, _)| l != label);
}

/// A child window starts watching a session's main PTY (replaces its previous channel).
#[tauri::command]
pub fn session_output_watch(
    window: tauri::WebviewWindow,
    session_id: String,
    on_output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let label = window.label().to_string();
    if !is_child_window(&label) {
        return Err("only child windows watch output".into());
    }
    let mut map = registry().sessions.lock();
    let list = map.entry(session_id).or_default();
    list.retain(|(l, _)| *l != label);
    list.push((label, on_output));
    Ok(())
}

/// A child window receives the sub-agent frames (it filters the ones of its own session).
#[tauri::command]
pub fn subagent_output_watch(
    window: tauri::WebviewWindow,
    on_output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let label = window.label().to_string();
    if !is_child_window(&label) {
        return Err("only child windows watch output".into());
    }
    let mut list = registry().subagents.lock();
    list.retain(|(l, _)| *l != label);
    list.push((label, on_output));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_child_windows_can_watch() {
        assert!(is_child_window("detached-session-abc"));
        assert!(!is_child_window("main"));
        assert!(!is_child_window("plugin-host"));
    }

    #[test]
    fn sending_without_watchers_is_a_no_op() {
        send_session("nobody-watches", b"hello");
        forget_window("detached-session-x");
        assert!(registry().sessions.lock().get("nobody-watches").is_none());
    }
}
