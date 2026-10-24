//! Interaction domain: IPC handlers and the interaction manager.
//!
//! An `Interaction` is a request the agent makes to the user in the terminal:
//!  - `InputRequest` — the agent asks for text/confirmation/choice;
//!  - `HumanActionRequest` — the agent asks for a human action (edit file, command…).
//!
//! The `InteractionManager` (here a Rust `InteractionManager`, Arc + parking_lot::
//! Mutex) holds:
//!  - an `id → Interaction` map with state (pending/responded/approved/denied/
//!    expired);
//!  - per-session dedup within `DEDUP_WINDOW_MS`;
//!  - `createInputRequest` / `createActionRequest` (expire the previous pending ones
//!    of the same session and emit `interaction:created`);
//!  - `respond` (translates the action into input to inject into the terminal and emits
//!    `interaction:resolved`);
//!  - `listPending` / `get` / `clearSession` / `expireSessionPending`.
//!
//! Exposed IPC commands:
//!  - `interaction_list`        ← INTERACTION_LIST
//!  - `interaction_respond`     ← INTERACTION_RESPOND
//!  - `auto_approve_get/set`    ← AUTO_APPROVE_GET / AUTO_APPROVE_SET
//!  - `tailer_inject`           ← TAILER_INJECT
//!
//! The push events to the renderer (`interaction:created/resolved`,
//! `auto-approve:changed`, `tailer:response-ready/auto-approved/thinking`)
//! are emitted directly with `AppHandle::emit` from where the
//! action happens (created/resolved by the manager) — see the TODO for the
//! tailer events, which depend on SessionTailer wiring that is not done yet.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

// ── Push channels ─────────────────────────────────────────────────────
const INTERACTION_CREATED: &str = "interaction:created";
const INTERACTION_RESOLVED: &str = "interaction:resolved";
const AUTO_APPROVE_CHANGED: &str = "auto-approve:changed";
const TAILER_AUTO_APPROVED: &str = "tailer:auto-approved";

/// `InteractionManager.DEDUP_WINDOW_MS`.
const DEDUP_WINDOW_MS: u128 = 500;

// ── Domain types (shared with the web UI) ──────────────────────────────

/// `InteractionStatus`.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InteractionStatus {
    Pending,
    Responded,
    Approved,
    Denied,
    Expired,
}

/// `InputRequest['inputType']`.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputType {
    Text,
    Confirmation,
    FileSelection,
    Choice,
}

/// `HumanActionRequest['actionType']`.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    FileEdit,
    CommandExecution,
    Deployment,
    Other,
}

/// `Interaction` = `InputRequest | HumanActionRequest`.
///
/// Modeled as a single struct with a discriminating `type` field (serde
/// `tag = "type"` on an enum would be more idiomatic, but the renderer expects
/// a flat object with optional fields; we keep the fields flat to match that
/// shape — `prompt/inputType` for input_request, `description/actionType/
/// details` for human_action_request).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Interaction {
    pub id: String,
    pub session_id: String,
    #[serde(rename = "type")]
    pub kind: InteractionKind,
    pub status: InteractionStatus,

    // ── InputRequest ──
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_type: Option<InputType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,

    // ── HumanActionRequest ──
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_type: Option<ActionType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Vec<String>>,
    pub created_at: String,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionKind {
    InputRequest,
    HumanActionRequest,
}

/// `ParsedInteraction` — result of the pattern matcher (terminal-engine).
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedInteraction {
    pub prompt: String,
    pub input_type: InputType,
    #[serde(default)]
    pub action_type: Option<ActionType>,
    #[serde(default)]
    pub details: Option<Value>,
}

/// `InteractionResponse` (payload of the `interaction_respond` command).
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionResponse {
    pub interaction_id: String,
    pub action: InteractionAction,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InteractionAction {
    Respond,
    Approve,
    Deny,
}

/// Per-session auto-approve flags (`{ modal, quick, ai }`).
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct AutoApproveFlags {
    #[serde(default)]
    pub modal: bool,
    #[serde(default)]
    pub quick: bool,
    #[serde(default)]
    pub ai: bool,
}

/// Did the user hand this session over to unattended execution? That is what
/// "auto-approve" means in the UI: the switch in the create-session form
/// (`config.autoApprove`) or the Quick / AI mode of the Auto Approve bar.
/// The preview mode alone (`modal`) asks the user before anything is sent,
/// so it does not count. Headless workers skip permission checks and the
/// agent control plane allows unattended actions only when this is true.
pub(crate) fn auto_approve_granted(config_auto_approve: bool, flags: AutoApproveFlags) -> bool {
    config_auto_approve || flags.quick || flags.ai
}

/// [`auto_approve_granted`] for a live session, read fresh on every call
/// (the user can flip the bar at any time).
pub(crate) fn session_auto_approve(app: &AppHandle, session_id: &str) -> bool {
    use tauri::Manager;
    let config = app
        .try_state::<Arc<crate::commands::session::SessionManager>>()
        .and_then(|m| m.parent_info(session_id))
        .is_some_and(|info| info.auto_approve);
    let flags = app
        .try_state::<Arc<InteractionManager>>()
        .map(|m| m.get_flags(session_id))
        .unwrap_or_default();
    auto_approve_granted(config, flags)
}

// ── InteractionManager — managed state (Arc + parking_lot::Mutex) ────

#[derive(Default)]
struct ManagerState {
    /// `interactions: Map<string, Interaction>`.
    interactions: HashMap<String, Interaction>,
    /// `lastInteractionTime: Map<string, number>` (epoch ms for dedup).
    last_interaction_time: HashMap<String, u128>,
    /// Per-session auto-approve flags, kept in the manager until the tailer
    /// owns them.
    /// TODO: move into the native SessionTailer when available.
    auto_approve_flags: HashMap<String, AutoApproveFlags>,
}

#[derive(Default)]
pub struct InteractionManager {
    state: Mutex<ManagerState>,
}

impl InteractionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// `isDuplicate` — ignores matches within DEDUP_WINDOW_MS of the last one.
    fn is_duplicate(state: &ManagerState, session_id: &str) -> bool {
        match state.last_interaction_time.get(session_id) {
            Some(&last) => now_ms().saturating_sub(last) < DEDUP_WINDOW_MS,
            None => false,
        }
    }

    /// `createInputRequest` — creates an InputRequest from a parsed match.
    /// Returns `None` if duplicate. Emits `interaction:created`.
    pub fn create_input_request(
        &self,
        app: &AppHandle,
        session_id: &str,
        parsed: ParsedInteraction,
        buffer_context: Option<Vec<String>>,
    ) -> Option<Interaction> {
        let mut state = self.state.lock();
        if Self::is_duplicate(&state, session_id) {
            return None;
        }
        // Expire the previous pending ones (superseded).
        Self::expire_session_pending_locked(app, &mut state, session_id);

        let interaction = Interaction {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            kind: InteractionKind::InputRequest,
            status: InteractionStatus::Pending,
            prompt: Some(parsed.prompt),
            input_type: Some(parsed.input_type),
            choices: None,
            default_value: None,
            description: None,
            action_type: None,
            details: None,
            context: buffer_context,
            created_at: now_iso(),
        };

        state
            .interactions
            .insert(interaction.id.clone(), interaction.clone());
        state
            .last_interaction_time
            .insert(session_id.to_string(), now_ms());
        drop(state);

        let _ = app.emit(INTERACTION_CREATED, json!({ "interaction": interaction }));
        // Native chrome: system notification (only when the window is not focused) +
        // dock badge. The lock is already released, list_pending can take it again.
        crate::commands::notify::on_interaction_created(
            app,
            &crate::commands::notify::input_title(),
            interaction.prompt.as_deref().unwrap_or_default(),
            self.list_pending(None).len(),
            &interaction.session_id,
        );
        Some(interaction)
    }

    /// `createActionRequest` — creates a HumanActionRequest from a parsed match.
    pub fn create_action_request(
        &self,
        app: &AppHandle,
        session_id: &str,
        parsed: ParsedInteraction,
        buffer_context: Option<Vec<String>>,
    ) -> Option<Interaction> {
        let mut state = self.state.lock();
        if Self::is_duplicate(&state, session_id) {
            return None;
        }
        Self::expire_session_pending_locked(app, &mut state, session_id);

        let interaction = Interaction {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            kind: InteractionKind::HumanActionRequest,
            status: InteractionStatus::Pending,
            prompt: None,
            input_type: None,
            choices: None,
            default_value: None,
            description: Some(parsed.prompt),
            action_type: Some(parsed.action_type.unwrap_or(ActionType::Other)),
            details: Some(parsed.details.unwrap_or_else(|| json!({}))),
            context: buffer_context,
            created_at: now_iso(),
        };

        state
            .interactions
            .insert(interaction.id.clone(), interaction.clone());
        state
            .last_interaction_time
            .insert(session_id.to_string(), now_ms());
        drop(state);

        let _ = app.emit(INTERACTION_CREATED, json!({ "interaction": interaction }));
        crate::commands::notify::on_interaction_created(
            app,
            &crate::commands::notify::action_title(),
            interaction.description.as_deref().unwrap_or_default(),
            self.list_pending(None).len(),
            &interaction.session_id,
        );
        Some(interaction)
    }

    /// `expireSessionPending` — marks all of the session's pending ones as expired,
    /// emitting `interaction:resolved` with action="expired".
    fn expire_session_pending_locked(app: &AppHandle, state: &mut ManagerState, session_id: &str) {
        let ids: Vec<String> = state
            .interactions
            .iter()
            .filter(|(_, i)| i.session_id == session_id && i.status == InteractionStatus::Pending)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(i) = state.interactions.get_mut(&id) {
                i.status = InteractionStatus::Expired;
            }
            let _ = app.emit(
                INTERACTION_RESOLVED,
                json!({ "interactionId": id, "sessionId": session_id, "action": "expired" }),
            );
        }
    }

    /// `listPending` — the pending ones, optionally filtered by session.
    pub fn list_pending(&self, session_id: Option<&str>) -> Vec<Interaction> {
        let state = self.state.lock();
        state
            .interactions
            .values()
            .filter(|i| i.status == InteractionStatus::Pending)
            .filter(|i| session_id.map(|sid| i.session_id == sid).unwrap_or(true))
            .cloned()
            .collect()
    }

    /// `get` — interaction by id.
    pub fn get(&self, interaction_id: &str) -> Option<Interaction> {
        self.state.lock().interactions.get(interaction_id).cloned()
    }

    /// `clearSession` — removes all interactions of a session (cleanup).
    pub fn clear_session(&self, session_id: &str) {
        let mut state = self.state.lock();
        let ids: Vec<String> = state
            .interactions
            .iter()
            .filter(|(_, i)| i.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            state.interactions.remove(&id);
        }
        state.last_interaction_time.remove(session_id);
    }

    /// `respond` — translates the action into terminal input and marks it resolved.
    ///
    /// Returns the string to inject into the terminal (the actual injection is done by the
    /// caller via TerminalManager). Emits `interaction:resolved`.
    fn respond_locked(
        &self,
        app: &AppHandle,
        response: &InteractionResponse,
    ) -> Result<String, String> {
        let mut state = self.state.lock();
        let interaction = state
            .interactions
            .get(&response.interaction_id)
            .ok_or_else(|| format!("Interaction not found: {}", response.interaction_id))?;

        if interaction.status != InteractionStatus::Pending {
            return Err(format!(
                "Interaction {} is already {}",
                response.interaction_id,
                status_label(interaction.status)
            ));
        }

        // Action → terminal input translation.
        let terminal_input = match response.action {
            InteractionAction::Respond => {
                format!("{}\r", response.value.clone().unwrap_or_default())
            }
            InteractionAction::Approve => "\r".to_string(),
            InteractionAction::Deny => {
                // Numbered menu (context contains "1. Yes" lines) → down arrow
                // ×2 + Enter; classic Y/n → 'n' + Enter.
                let ctx = interaction.context.clone().unwrap_or_default();
                let is_numbered_menu = ctx.iter().any(|l| is_numbered_yes(l));
                if is_numbered_menu {
                    "\x1b[B\x1b[B\r".to_string()
                } else {
                    "n\r".to_string()
                }
            }
        };

        let session_id = interaction.session_id.clone();
        let new_status = match response.action {
            InteractionAction::Deny => InteractionStatus::Denied,
            InteractionAction::Approve => InteractionStatus::Approved,
            InteractionAction::Respond => InteractionStatus::Responded,
        };
        let action_str = match response.action {
            InteractionAction::Respond => "respond",
            InteractionAction::Approve => "approve",
            InteractionAction::Deny => "deny",
        };

        if let Some(i) = state.interactions.get_mut(&response.interaction_id) {
            i.status = new_status;
        }
        drop(state);

        let _ = app.emit(
            INTERACTION_RESOLVED,
            json!({ "interactionId": response.interaction_id, "sessionId": session_id, "action": action_str }),
        );
        // One request fewer: the Dock badge must go down immediately.
        crate::commands::notify::on_pending_changed(app, self.list_pending(None).len());

        Ok(terminal_input)
    }

    // ── Auto-approve flags (held here until the SessionTailer owns them) ──

    /// Is AA active for the session? (the hook server's `AutoApproveCheckFn` —
    /// PreToolUse). Any active flag counts as auto-approve.
    pub fn auto_approve_enabled(&self, session_id: &str) -> bool {
        let f = self.get_flags(session_id);
        f.modal || f.quick || f.ai
    }

    pub(crate) fn get_flags(&self, session_id: &str) -> AutoApproveFlags {
        self.state
            .lock()
            .auto_approve_flags
            .get(session_id)
            .copied()
            .unwrap_or_default()
    }

    fn get_all_flags(&self) -> HashMap<String, AutoApproveFlags> {
        self.state.lock().auto_approve_flags.clone()
    }

    pub(crate) fn set_flags(&self, app: &AppHandle, session_id: &str, flags: AutoApproveFlags) {
        self.state
            .lock()
            .auto_approve_flags
            .insert(session_id.to_string(), flags);
        // Push `auto-approve:changed`.
        let _ = app.emit(
            AUTO_APPROVE_CHANGED,
            json!({
                "sessionId": session_id,
                "flags": { "modal": flags.modal, "quick": flags.quick, "ai": flags.ai },
            }),
        );
    }
}

// ── IPC commands ───────────────────────────────────────────────────────

/// `INTERACTION_LIST` → `interactionManager.listPending(sessionId)`.
#[tauri::command]
pub fn interaction_list(
    manager: tauri::State<'_, Arc<InteractionManager>>,
    session_id: Option<String>,
) -> Vec<Interaction> {
    manager.list_pending(session_id.as_deref())
}

/// Result of `interaction_respond` (`{ ok, error? }`).
#[derive(Serialize)]
pub struct OkResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl OkResult {
    fn ok() -> Self {
        Self {
            ok: true,
            error: None,
        }
    }
    fn err(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(msg.into()),
        }
    }
}

/// `INTERACTION_RESPOND`.
///
/// Finds the interaction, resolves the session and its
/// `terminalId`, then injects the computed input into the terminal.
///
/// NOTE: the input is computed in the manager and injected via `inject_fn` — the concrete wiring to the native SessionManager+
/// TerminalManager is left to the caller.
///
/// TODO: wire to the native SessionManager (lookup `session.terminalId`) and
/// TerminalManager (`writer.write_all`); for now if `inject_fn` is
/// registered we use it, otherwise we return the input to the renderer.
#[tauri::command]
pub fn interaction_respond(
    app: AppHandle,
    manager: tauri::State<'_, Arc<InteractionManager>>,
    sessions: tauri::State<'_, Arc<crate::commands::session::SessionManager>>,
    subagents: tauri::State<'_, Arc<crate::commands::subagent::SubAgentManager>>,
    response: InteractionResponse,
) -> OkResult {
    // Parity: 'Interaction not found' if missing.
    let Some(interaction) = manager.get(&response.interaction_id) else {
        return OkResult::err("Interaction not found");
    };
    let session_id = interaction.session_id.clone();

    match manager.respond_locked(&app, &response) {
        Ok(terminal_input) => {
            // Native injection (the equivalent of terminalEngine.inject):
            // main session or sub-agent PTY, without counting — the click on
            // Approve/Deny/Respond is a real turn and is credited
            // below (only 'expired' resolutions are excluded).
            if sessions.has_session(&session_id) {
                let _ = sessions.write(&session_id, &terminal_input, false);
            } else {
                let _ = subagents.write_to(&session_id, &terminal_input, false);
            }
            crate::commands::session::credit_prompt_for(&app, &session_id, 1);
            OkResult::ok()
        }
        Err(e) => OkResult::err(e),
    }
}

/// `INTERACTION_RESPOND` variant with a test/direct-exposure value:
/// creates an InputRequest (used by the terminal's pattern matcher).
#[tauri::command]
pub fn interaction_create_input(
    app: AppHandle,
    manager: tauri::State<'_, Arc<InteractionManager>>,
    session_id: String,
    parsed: ParsedInteraction,
    buffer_context: Option<Vec<String>>,
) -> Option<Interaction> {
    manager.create_input_request(&app, &session_id, parsed, buffer_context)
}

/// Creates a HumanActionRequest (used by the terminal's pattern matcher).
#[tauri::command]
pub fn interaction_create_action(
    app: AppHandle,
    manager: tauri::State<'_, Arc<InteractionManager>>,
    session_id: String,
    parsed: ParsedInteraction,
    buffer_context: Option<Vec<String>>,
) -> Option<Interaction> {
    manager.create_action_request(&app, &session_id, parsed, buffer_context)
}

/// `AUTO_APPROVE_GET` — flags of one session, or all if `session_id` is None.
/// TODO: wire the tailer.
#[tauri::command]
pub fn auto_approve_get(
    manager: tauri::State<'_, Arc<InteractionManager>>,
    session_id: Option<String>,
) -> Value {
    match session_id {
        Some(sid) => json!(manager.get_flags(&sid)),
        None => json!(manager.get_all_flags()),
    }
}

/// `AUTO_APPROVE_SET` — sets the flags and pushes `auto-approve:changed`.
#[tauri::command]
pub fn auto_approve_set(
    app: AppHandle,
    manager: tauri::State<'_, Arc<InteractionManager>>,
    session_id: String,
    flags: AutoApproveFlags,
) -> OkResult {
    manager.set_flags(&app, &session_id, flags);
    OkResult::ok()
}

/// `TAILER_INJECT` — the user clicked "Inject" in the preview modal;
/// injects `response` into the session's terminal.
///
/// TODO: route through the SessionTailer, which should resolve the session's
/// terminal, write `response` to the PTY and emit `tailer:auto-approved`.
/// Until that wiring exists, we emit `tailer:auto-approved` and the inject event for the native wiring.
#[tauri::command]
pub fn tailer_inject(app: AppHandle, session_id: String, response: String) -> OkResult {
    // Native SessionTailer: real injection on the PTY + y-streak + event.
    if let Some(tailer) = crate::commands::session_tailer::global_tailer() {
        tailer.inject_response(&app, &session_id, &response);
        return OkResult::ok();
    }
    // Fallback (tailer not initialized): previous behavior.
    let _ = app.emit(
        TAILER_AUTO_APPROVED,
        json!({ "sessionId": session_id, "type": "manual-inject", "prompt": "", "response": response }),
    );
    OkResult::ok()
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Line "❯ 1. Yes" / "1. Yes, and…" → numbered menu (regex `^\s*\d+\.\s*Yes`).
fn is_numbered_yes(line: &str) -> bool {
    let t = line.trim_start();
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return false;
    }
    let rest = &t[digits.len()..];
    let Some(rest) = rest.strip_prefix('.') else {
        return false;
    };
    let rest = rest.trim_start();
    rest.len() >= 3 && rest[..3].eq_ignore_ascii_case("yes")
}

fn status_label(s: InteractionStatus) -> &'static str {
    match s {
        InteractionStatus::Pending => "pending",
        InteractionStatus::Responded => "responded",
        InteractionStatus::Approved => "approved",
        InteractionStatus::Denied => "denied",
        InteractionStatus::Expired => "expired",
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// ISO-ish UTC without extra dependencies (same as the other modules'
/// `now_iso`).
/// TODO: an exact RFC3339 format with `Z` would require `chrono`/`time`.
fn now_iso() -> String {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:020}.{:03}", dur.as_secs(), dur.subsec_millis())
}

#[cfg(test)]
mod auto_approve_tests {
    use super::*;

    #[test]
    fn only_the_create_switch_or_quick_ai_modes_grant_auto_approve() {
        let off = AutoApproveFlags::default();
        assert!(!auto_approve_granted(false, off));
        assert!(auto_approve_granted(true, off));
        let quick = AutoApproveFlags { quick: true, ..off };
        let ai = AutoApproveFlags { ai: true, ..off };
        assert!(auto_approve_granted(false, quick));
        assert!(auto_approve_granted(false, ai));
        // The preview mode waits for the user's click: not unattended.
        let modal = AutoApproveFlags { modal: true, ..off };
        assert!(!auto_approve_granted(false, modal));
    }
}
