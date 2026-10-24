//! System dialogs (phase 1.6 of the native chrome).
//!
//! Only for the cases that *are* system-level: destructive confirmations and fatal
//! errors. The rest of the webapp's hundred-plus Swal dialogs stay as they are — they are
//! in-app UI, and replacing them with system windows would only make things worse.
//!
//! Goes through a Rust command instead of the JS-side plugin because the latter
//! would require widening the webview's capabilities; here the surface
//! stays limited and the text is decided by the webapp anyway (already translated).
//!
//! Note on the main thread: `blocking_show` from a synchronous command deadlocks with the
//! main loop that must draw the dialog — the same snag already solved for the
//! folder picker in `workspace.rs`. Here the command is async and the reply arrives
//! through a channel.

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Default)]
pub struct CloseConfirmationState {
    pending: AtomicBool,
    labels: parking_lot::Mutex<CloseConfirmationLabels>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseConfirmationLabels {
    message: String,
    confirm_label: String,
    cancel_label: String,
}

impl Default for CloseConfirmationLabels {
    fn default() -> Self {
        Self {
            message: "Are you sure you want to close PromptOps?".into(),
            confirm_label: "Close".into(),
            cancel_label: "Cancel".into(),
        }
    }
}

/// Updated at webapp bootstrap and on every language change.
#[tauri::command]
pub fn dialog_set_close_labels(app: AppHandle, labels: CloseConfirmationLabels) {
    *app.state::<CloseConfirmationState>().labels.lock() = labels;
}

/// The caller must prevent the native close right away; the dialog is asynchronous.
pub fn confirm_app_close(window: &tauri::Window) {
    let app = window.app_handle();
    if app
        .state::<CloseConfirmationState>()
        .pending
        .swap(true, Ordering::SeqCst)
    {
        return;
    }

    let labels = app.state::<CloseConfirmationState>().labels.lock().clone();
    let app = app.clone();
    let dialog = app
        .dialog()
        .message(labels.message)
        .title("PromptOps")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            labels.confirm_label,
            labels.cancel_label,
        ));
    #[cfg(desktop)]
    let dialog = dialog.parent(window);
    dialog.show(move |confirmed| {
        if confirmed {
            // Goes through ExitRequested to complete the existing saves.
            app.exit(0);
        } else {
            app.state::<CloseConfirmationState>()
                .pending
                .store(false, Ordering::SeqCst);
        }
    });
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmRequest {
    pub title: String,
    pub message: String,
    /// Labels already translated by the webapp; missing = system texts.
    #[serde(default)]
    pub confirm_label: Option<String>,
    #[serde(default)]
    pub cancel_label: Option<String>,
    /// true for destructive actions (warning icon).
    #[serde(default)]
    pub danger: bool,
}

/// dialog:confirm — system modal confirmation. `true` = the user confirmed.
#[tauri::command]
pub async fn dialog_confirm(app: AppHandle, request: ConfirmRequest) -> Result<bool, String> {
    let buttons = match (request.confirm_label, request.cancel_label) {
        (Some(ok), Some(cancel)) => MessageDialogButtons::OkCancelCustom(ok, cancel),
        _ => MessageDialogButtons::OkCancel,
    };
    let kind = if request.danger {
        MessageDialogKind::Warning
    } else {
        MessageDialogKind::Info
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(request.message)
        .title(request.title)
        .kind(kind)
        .buttons(buttons)
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });

    rx.await.map_err(|_| "dialog closed".to_string())
}

/// dialog:error — system error box. Doesn't wait: it is a notice, not a question.
#[tauri::command]
pub fn dialog_error(app: AppHandle, title: String, message: String) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}
