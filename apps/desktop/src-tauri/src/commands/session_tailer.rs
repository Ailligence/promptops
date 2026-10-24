//! SessionTailer — the heart of auto-approve.
//!
//! No .tail files and no fs polling: the PTY output arrives in-process via the output tap
//! (`SessionManager::set_output_tap`), so the tailer consumes the chunks
//! directly: `on_output` does strip-ANSI and updates context/delta, and a
//! single 500ms thread does the idle/fast-path evaluation. By construction
//! there are no Defender scans on .tail reads on Windows.
//!
//! Implemented: fast-path confirmation patterns (including codex's delta widget),
//! hook-backed (3s) vs no-hook (30s + prompt indicator) idle thresholds, cooldown,
//! y-streak (same-key 5 / hard 20) with auto-disable + the
//! `tailer:aa-auto-disabled` event, Claude banner mirror (falling-edge only),
//! heuristic fallback, modal preview (`tailer:response-ready`) and direct
//! inject (`tailer:auto-approved`).
//!
//! AutoResponder (`ai` flag): the session's provider CLI writes the answer from
//! the last 30 lines; the heuristic fallback is used when it fails or replies
//! nothing. Flag propagation to sub-agents: the flags live in the
//! InteractionManager (single store).

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use regex::Regex;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::commands::interaction::AutoApproveFlags;

const CONTEXT_LINES: usize = 50;
/// Tick cadence (the thread in lib.rs sleeps this interval).
pub const POLL_MS: u64 = 500;
const IDLE_THRESHOLD_MS: i64 = 3000;
const IDLE_THRESHOLD_NO_HOOKS_MS: i64 = 30_000;
const RESPONSE_COOLDOWN_MS: i64 = 8000;
const FAST_PATH_COOLDOWN_MS: i64 = 2000;
const Y_STREAK_LIMIT: u32 = 5;
const Y_STREAK_HARD_LIMIT: u32 = 20;
const HOOK_ALIVE_WINDOW_MS: i64 = 10 * 60_000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Providers that emit Claude-style hooks (tight 3s idle).
fn has_hook_support(provider: &str) -> bool {
    provider == "claude-code-cli"
}

// ── Fast-path confirmation patterns (CONFIRMATION_PATTERNS) ────────────────

struct ConfirmationPattern {
    regex: Regex,
    multi_line: bool,
    delta: bool,
    require: Option<Regex>,
    providers: Option<&'static [&'static str]>,
    response: &'static str,
}

fn confirmation_patterns() -> &'static Vec<ConfirmationPattern> {
    static PATTERNS: std::sync::OnceLock<Vec<ConfirmationPattern>> = std::sync::OnceLock::new();
    PATTERNS.get_or_init(|| {
        let p = |re: &str, multi: bool, resp: &'static str| ConfirmationPattern {
            regex: Regex::new(re).unwrap(),
            multi_line: multi,
            delta: false,
            require: None,
            providers: None,
            response: resp,
        };
        vec![
            // Claude Code numbered TUI menu
            p(r"(?m)^\s*[❯>]?\s*1\.\s*Yes", true, "\r"),
            // Standard (Y/n) / [Y/n]
            p(r"(?i)\(Y/n\)", false, "\r"),
            p(r"(?i)\[Y/n\]", false, "\r"),
            // (y/N) / [y/N] — default No, but we want yes
            p(r"(?i)\(y/N\)", false, "y\r"),
            p(r"(?i)\[y/N\]", false, "y\r"),
            // Codex legacy: Apply diff/patch
            p(r"(?i)Apply\s+(?:this\s+)?(?:diff|patch|change)", false, "y\r"),
            // Codex legacy: ❯ Yes preselected
            p(r"(?m)^\s*❯\s+Yes\b", true, "\r"),
            // Codex legacy: [Y]es / [N]o
            p(r"(?i)\[Y\]es\s*/\s*\[N\]o", false, "y\r"),
            // Codex >= 0.14: approval widget (alternate-screen frame →
            // delta match, question AND "Yes…" label must co-occur).
            ConfirmationPattern {
                regex: Regex::new(
                    r"Would you like to (?:run the following command|make the following edits|grant these permissions)\?",
                )
                .unwrap(),
                multi_line: false,
                delta: true,
                require: Some(
                    Regex::new(r"Yes, (?:proceed|just this once|and don['’]t ask again)").unwrap(),
                ),
                providers: Some(&["codex"]),
                response: "\r",
            },
        ]
    })
}

fn idle_prompt_indicator() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[›>❯]\s*$").unwrap())
}

fn claude_aa_mode_rx() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)⏵\s*⏵?\s*(?:auto-)?accept edits on\b|⏵\s*⏵?\s*bypass permissions on\b")
            .unwrap()
    })
}

fn prompt_key_noise_rx() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^[✻✢·✳✶*●○◐◑⏵]|esc to interrupt|tokens").unwrap())
}

// ── Watcher ──────────────────────────────────────────────────────────────

struct TailWatcher {
    provider: String,
    cwd: String,
    context: Vec<String>,
    last_delta: Vec<String>,
    prev_delta: Vec<String>,
    last_content_at: i64,
    responded_since_last_output: bool,
    /// New lines arrived since the previous tick (replaces hadNewContent).
    fresh_lines: bool,
    y_streak: u32,
    any_y_streak: u32,
    last_injection_key: Option<String>,
    claude_banner_seen: bool,
    user_override_mirror: bool,
    last_hook_event_at: i64,
    /// True while the AI response is in flight (prevents double-fire).
    responding: bool,
}

// ── DI toward the other managers ───────────────────────────────────────────

/// Current session flags (InteractionManager, single store).
pub type FlagsFn = Arc<dyn Fn(&str) -> AutoApproveFlags + Send + Sync>;
/// Flag auto-disable (y-streak, banner mirror) — emits auto-approve:changed.
pub type DisableFlagsFn = Arc<dyn Fn(&AppHandle, &str) + Send + Sync>;
/// Write to the session PTY (SessionManager.write).
pub type InjectFn = Arc<dyn Fn(&str, &str) + Send + Sync>;

#[derive(Default)]
pub struct SessionTailer {
    watchers: Mutex<HashMap<String, TailWatcher>>,
    last_response_time: Mutex<HashMap<String, i64>>,
    flags_fn: Mutex<Option<FlagsFn>>,
    disable_fn: Mutex<Option<DisableFlagsFn>>,
    inject_fn: Mutex<Option<InjectFn>>,
}

static GLOBAL: std::sync::OnceLock<Arc<SessionTailer>> = std::sync::OnceLock::new();

pub fn set_global(tailer: Arc<SessionTailer>) {
    let _ = GLOBAL.set(tailer);
}

pub fn global_tailer() -> Option<&'static Arc<SessionTailer>> {
    GLOBAL.get()
}

impl SessionTailer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_deps(&self, flags: FlagsFn, disable: DisableFlagsFn, inject: InjectFn) {
        *self.flags_fn.lock() = Some(flags);
        *self.disable_fn.lock() = Some(disable);
        *self.inject_fn.lock() = Some(inject);
    }

    /// startTailing — idempotent. Called on PTY spawn (wake too).
    pub fn start_tailing(&self, session_id: &str, provider: &str, cwd: &str) {
        let mut watchers = self.watchers.lock();
        if watchers.contains_key(session_id) {
            return;
        }
        watchers.insert(
            session_id.to_string(),
            TailWatcher {
                provider: provider.to_string(),
                cwd: cwd.to_string(),
                context: Vec::new(),
                last_delta: Vec::new(),
                prev_delta: Vec::new(),
                last_content_at: now_ms(),
                responded_since_last_output: false,
                fresh_lines: false,
                y_streak: 0,
                any_y_streak: 0,
                last_injection_key: None,
                claude_banner_seen: false,
                user_override_mirror: false,
                last_hook_event_at: 0,
                responding: false,
            },
        );
    }

    /// stopTailing — session destroy/standby.
    pub fn stop_tailing(&self, session_id: &str) {
        self.watchers.lock().remove(session_id);
        self.last_response_time.lock().remove(session_id);
    }

    /// PTY output (from the tap): strip-ANSI, split into lines, update windows.
    pub fn on_output(&self, session_id: &str, chunk: &[u8]) {
        let text = crate::commands::session::strip_ansi(&String::from_utf8_lossy(chunk));
        let new_lines: Vec<String> = text
            .split('\n')
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect();
        if new_lines.is_empty() {
            return;
        }
        let mut watchers = self.watchers.lock();
        let Some(w) = watchers.get_mut(session_id) else {
            return;
        };
        w.prev_delta = std::mem::take(&mut w.last_delta);
        w.last_delta = new_lines.clone();
        w.context.extend(new_lines);
        if w.context.len() > CONTEXT_LINES {
            let excess = w.context.len() - CONTEXT_LINES;
            w.context.drain(0..excess);
        }
        w.last_content_at = now_ms();
        w.responded_since_last_output = false;
        w.fresh_lines = true;
    }

    /// Keep-alive from hooks (tool-use/session-start/stop): the provider is
    /// working, not idle.
    pub fn on_hook_event(&self, session_id: &str, keep_alive_content: bool) {
        let mut watchers = self.watchers.lock();
        if let Some(w) = watchers.get_mut(session_id) {
            w.last_hook_event_at = now_ms();
            if keep_alive_content {
                w.last_content_at = now_ms();
            }
        }
    }

    /// injectResponse — manual inject (modal "Inject" / mobile).
    pub fn inject_response(&self, app: &AppHandle, session_id: &str, response: &str) {
        let inject = self.inject_fn.lock().clone();
        let Some(inject) = inject else { return };
        inject(session_id, &format!("{response}\r"));
        let key = self.build_prompt_key(session_id);
        self.bump_y_streak(app, session_id, response, &key);
        self.last_response_time
            .lock()
            .insert(session_id.to_string(), now_ms());
        let prompt = {
            let watchers = self.watchers.lock();
            watchers
                .get(session_id)
                .and_then(|w| w.context.last())
                .map(|l| l.trim().to_string())
                .unwrap_or_default()
        };
        if let Some(w) = self.watchers.lock().get_mut(session_id) {
            w.responded_since_last_output = true;
        }
        let _ = app.emit(
            "tailer:auto-approved",
            json!({ "sessionId": session_id, "type": "injected", "prompt": prompt, "response": response }),
        );
        // Every auto-approve submits a turn to the model → count it as a
        // prompt.
        crate::commands::session::credit_prompt_for(app, session_id, 1);
    }

    /// The 500ms tick for all sessions (thread started by lib.rs).
    pub fn tick_all(&self, app: &AppHandle) {
        let ids: Vec<String> = self.watchers.lock().keys().cloned().collect();
        for id in ids {
            self.tick(app, &id);
        }
    }

    fn flags(&self, session_id: &str) -> AutoApproveFlags {
        match &*self.flags_fn.lock() {
            Some(f) => f(session_id),
            None => AutoApproveFlags::default(),
        }
    }

    fn tick(&self, app: &AppHandle, session_id: &str) {
        let flags = self.flags(session_id);
        let is_active = flags.quick || flags.ai;

        let (is_claude, fresh, idle_ms, hook_backed, last_line, empty_context) = {
            let mut watchers = self.watchers.lock();
            let Some(w) = watchers.get_mut(session_id) else {
                return;
            };
            let is_claude = w.provider == "claude-code-cli";
            if !is_active && !is_claude {
                return;
            }
            let fresh = std::mem::take(&mut w.fresh_lines);
            let hook_backed = has_hook_support(&w.provider)
                && w.last_hook_event_at > 0
                && now_ms() - w.last_hook_event_at < HOOK_ALIVE_WINDOW_MS;
            (
                is_claude,
                fresh,
                now_ms() - w.last_content_at,
                hook_backed,
                w.context
                    .last()
                    .map(|l| l.trim().to_string())
                    .unwrap_or_default(),
                w.context.is_empty(),
            )
        };

        // Passive Claude banner detector (even with AA off).
        if fresh && is_claude {
            self.detect_claude_auto_mode(app, session_id);
        }
        if !is_active {
            return;
        }

        if fresh {
            // New output → fast-path on the known confirmations.
            if flags.quick {
                self.try_fast_confirmation(app, session_id, &flags);
            }
            return;
        }

        // No new output: evaluate idle.
        {
            let watchers = self.watchers.lock();
            let Some(w) = watchers.get(session_id) else {
                return;
            };
            if w.responding || w.responded_since_last_output || empty_context {
                return;
            }
        }
        let idle_threshold = if hook_backed {
            IDLE_THRESHOLD_MS
        } else {
            IDLE_THRESHOLD_NO_HOOKS_MS
        };
        if idle_ms < idle_threshold {
            return;
        }
        // Without hooks: only if the CLI is visibly parked at the prompt.
        if !hook_backed && !idle_prompt_indicator().is_match(&last_line) {
            return;
        }
        // Cooldown.
        {
            let last = self.last_response_time.lock();
            if now_ms() - last.get(session_id).copied().unwrap_or(0) < RESPONSE_COOLDOWN_MS {
                return;
            }
        }
        self.respond_positively(app, session_id, &flags);
    }

    fn try_fast_confirmation(&self, app: &AppHandle, session_id: &str, flags: &AutoApproveFlags) {
        let (provider, last_line, last5, delta_window) = {
            let watchers = self.watchers.lock();
            let Some(w) = watchers.get(session_id) else {
                return;
            };
            let last_line = w
                .context
                .last()
                .map(|l| l.trim().to_string())
                .unwrap_or_default();
            let last5 = w
                .context
                .iter()
                .rev()
                .take(5)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            let delta_window = w
                .prev_delta
                .iter()
                .chain(w.last_delta.iter())
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            (w.provider.clone(), last_line, last5, delta_window)
        };

        for pattern in confirmation_patterns() {
            if let Some(providers) = pattern.providers {
                if !providers.contains(&provider.as_str()) {
                    continue;
                }
            }
            let text = if pattern.delta {
                &delta_window
            } else if pattern.multi_line {
                &last5
            } else {
                &last_line
            };
            if text.is_empty() || !pattern.regex.is_match(text) {
                continue;
            }
            if let Some(require) = &pattern.require {
                if !require.is_match(text) {
                    continue;
                }
            }
            // Cooldown fast-path (2s).
            {
                let mut last = self.last_response_time.lock();
                if now_ms() - last.get(session_id).copied().unwrap_or(0) < FAST_PATH_COOLDOWN_MS {
                    return;
                }
                last.insert(session_id.to_string(), now_ms());
            }
            let prompt_label = if pattern.delta {
                pattern
                    .regex
                    .find(text)
                    .map(|m| m.as_str().chars().take(200).collect::<String>())
                    .unwrap_or_default()
            } else {
                last_line.clone()
            };
            {
                let mut watchers = self.watchers.lock();
                if let Some(w) = watchers.get_mut(session_id) {
                    w.responded_since_last_output = true;
                    // The widget has been handled: drop the frames that
                    // matched so a slow post-approval redraw does not fire again.
                    if pattern.delta {
                        w.prev_delta.clear();
                        w.last_delta.clear();
                    }
                }
            }

            if flags.modal {
                let _ = app.emit(
                    "tailer:response-ready",
                    json!({
                        "sessionId": session_id,
                        "terminalId": session_id,
                        "type": "fast-path",
                        "prompt": prompt_label,
                        "response": pattern.response,
                    }),
                );
            } else {
                if let Some(inject) = self.inject_fn.lock().clone() {
                    inject(session_id, pattern.response);
                }
                let key = self.build_prompt_key(session_id);
                self.bump_y_streak(app, session_id, pattern.response, &key);
                let _ = app.emit(
                    "tailer:auto-approved",
                    json!({
                        "sessionId": session_id,
                        "type": "fast-path",
                        "prompt": prompt_label,
                        "response": pattern.response,
                    }),
                );
                crate::commands::session::credit_prompt_for(app, session_id, 1);
            }
            return;
        }
    }

    /// respondPositively — idle: `ai` flag → AutoResponder (headless provider
    /// CLI, ~30s timeout, on a thread); otherwise instant heuristic.
    fn respond_positively(&self, app: &AppHandle, session_id: &str, flags: &AutoApproveFlags) {
        {
            let mut watchers = self.watchers.lock();
            if let Some(w) = watchers.get_mut(session_id) {
                w.responded_since_last_output = true;
            }
        }
        self.last_response_time
            .lock()
            .insert(session_id.to_string(), now_ms());

        let (provider, cwd, last_line, context30, context_tail) = {
            let watchers = self.watchers.lock();
            let Some(w) = watchers.get(session_id) else {
                return;
            };
            (
                w.provider.clone(),
                w.cwd.clone(),
                w.context
                    .last()
                    .map(|l| l.trim().to_string())
                    .unwrap_or_default(),
                w.context
                    .iter()
                    .rev()
                    .take(30)
                    .rev()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n"),
                w.context
                    .iter()
                    .rev()
                    .take(10)
                    .rev()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n")
                    .to_lowercase(),
            )
        };

        if flags.ai && !cwd.is_empty() {
            // ── AI path: provider CLI on a thread. Re-reads the flags on return:
            // if the user turned AA off in the meantime, the answer is discarded.
            {
                let mut watchers = self.watchers.lock();
                if let Some(w) = watchers.get_mut(session_id) {
                    w.responding = true;
                }
            }
            let _ = app.emit(
                "tailer:thinking",
                json!({ "sessionId": session_id, "thinking": true }),
            );
            let tailer = match global_tailer() {
                Some(t) => t.clone(),
                None => return,
            };
            let app = app.clone();
            let sid = session_id.to_string();
            std::thread::spawn(move || {
                let ai_reply = crate::commands::providers::spawn_provider(
                    &provider,
                    &build_responder_prompt(&context30),
                    &cwd,
                )
                .ok()
                .map(|r| {
                    r.trim()
                        .lines()
                        .next()
                        .unwrap_or("")
                        .chars()
                        .take(500)
                        .collect::<String>()
                })
                .filter(|r| !r.is_empty());

                {
                    let mut watchers = tailer.watchers.lock();
                    if let Some(w) = watchers.get_mut(&sid) {
                        w.responding = false;
                    }
                }
                let _ = app.emit(
                    "tailer:thinking",
                    json!({ "sessionId": sid, "thinking": false }),
                );

                let current = tailer.flags(&sid);
                if !current.quick && !current.ai {
                    return; // AA turned off mid-flight → discard.
                }
                let (kind, reply) = match ai_reply {
                    Some(r) => ("ai", r),
                    None => (
                        "heuristic",
                        build_fallback_response(&last_line, &context_tail),
                    ),
                };
                tailer.deliver(&app, &sid, &current, kind, &last_line, &reply);
            });
            return;
        }

        let reply = build_fallback_response(&last_line, &context_tail);
        let kind = if flags.ai { "heuristic" } else { "quick" };

        if flags.modal {
            let _ = app.emit(
                "tailer:response-ready",
                json!({
                    "sessionId": session_id,
                    "terminalId": session_id,
                    "type": kind,
                    "prompt": last_line,
                    "response": reply,
                }),
            );
        } else {
            if let Some(inject) = self.inject_fn.lock().clone() {
                inject(session_id, &format!("{reply}\r"));
            }
            let key = self.build_prompt_key(session_id);
            self.bump_y_streak(app, session_id, &reply, &key);
            let _ = app.emit(
                "tailer:auto-approved",
                json!({ "sessionId": session_id, "type": kind, "prompt": last_line, "response": reply }),
            );
            crate::commands::session::credit_prompt_for(app, session_id, 1);
        }
    }

    /// deliverResponse — modal preview or direct inject (shared by the AI path
    /// and the fallback).
    fn deliver(
        &self,
        app: &AppHandle,
        session_id: &str,
        flags: &AutoApproveFlags,
        kind: &str,
        prompt: &str,
        response: &str,
    ) {
        if flags.modal {
            let _ = app.emit(
                "tailer:response-ready",
                json!({
                    "sessionId": session_id,
                    "terminalId": session_id,
                    "type": kind,
                    "prompt": prompt,
                    "response": response,
                }),
            );
        } else {
            if let Some(inject) = self.inject_fn.lock().clone() {
                inject(session_id, &format!("{response}\r"));
            }
            let key = self.build_prompt_key(session_id);
            self.bump_y_streak(app, session_id, response, &key);
            let _ = app.emit(
                "tailer:auto-approved",
                json!({ "sessionId": session_id, "type": kind, "prompt": prompt, "response": response }),
            );
            crate::commands::session::credit_prompt_for(app, session_id, 1);
        }
    }

    /// Claude banner mirror (falling-edge only, never auto-enable).
    fn detect_claude_auto_mode(&self, app: &AppHandle, session_id: &str) {
        let (was_visible, visible_now, was_overridden) = {
            let mut watchers = self.watchers.lock();
            let Some(w) = watchers.get_mut(session_id) else {
                return;
            };
            let tail = w
                .context
                .iter()
                .rev()
                .take(5)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            let visible_now = claude_aa_mode_rx().is_match(&tail);
            let was_visible = w.claude_banner_seen;
            w.claude_banner_seen = visible_now;
            let mut was_overridden = false;
            if was_visible && !visible_now {
                was_overridden = w.user_override_mirror;
                w.user_override_mirror = false;
            }
            (was_visible, visible_now, was_overridden)
        };
        // Falling edge on sessions set by the detector → auto-disable.
        // NOTE: the flag source is not tracked (InteractionManager);
        // so as not to override the user's intent we NEVER auto-disable
        // (conservative behavior — TODO: track the flag source so
        // detector-set flags can be auto-disabled).
        let _ = (was_visible, visible_now, was_overridden, app);
    }

    /// buildPromptKey — identity of the on-screen prompt (djb2 over the last 8 lines
    /// without noise/digits).
    fn build_prompt_key(&self, session_id: &str) -> String {
        let watchers = self.watchers.lock();
        let Some(w) = watchers.get(session_id) else {
            return String::new();
        };
        let mut lines: Vec<String> = Vec::new();
        for raw in w.context.iter().rev().take(8).rev() {
            let line = raw.trim();
            if line.is_empty() || prompt_key_noise_rx().is_match(line) {
                continue;
            }
            let cleaned: String = line
                .chars()
                .filter(|c| !c.is_ascii_digit())
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            lines.push(cleaned);
        }
        let text = if lines.is_empty() {
            w.context
                .last()
                .map(|l| l.trim().to_string())
                .unwrap_or_default()
        } else {
            lines.join("\n")
        };
        // djb2
        let mut h: u32 = 5381;
        for b in text.bytes() {
            h = h.wrapping_shl(5).wrapping_add(h).wrapping_add(b as u32);
        }
        format!("{h:x}")
    }

    /// bumpYStreak — anti-loop trip-wire: 5 consecutive y on the SAME prompt
    /// or 20 overall → auto-disable + `tailer:aa-auto-disabled`.
    fn bump_y_streak(&self, app: &AppHandle, session_id: &str, response: &str, prompt_key: &str) {
        let trimmed = response.replace(['\r', '\n'], "").trim().to_lowercase();
        let is_just_y = trimmed.is_empty() || trimmed == "y" || trimmed == "yes";

        let tripped = {
            let mut watchers = self.watchers.lock();
            let Some(w) = watchers.get_mut(session_id) else {
                return;
            };
            if !is_just_y {
                w.y_streak = 0;
                w.any_y_streak = 0;
                w.last_injection_key = None;
                return;
            }
            w.any_y_streak += 1;
            w.y_streak = if w.last_injection_key.as_deref() == Some(prompt_key) {
                w.y_streak + 1
            } else {
                1
            };
            w.last_injection_key = Some(prompt_key.to_string());

            let hard = w.any_y_streak >= Y_STREAK_HARD_LIMIT;
            if w.y_streak >= Y_STREAK_LIMIT || hard {
                let count = if hard { w.any_y_streak } else { w.y_streak };
                let reason = if hard { "y-streak-hard" } else { "y-streak" };
                w.y_streak = 0;
                w.any_y_streak = 0;
                w.last_injection_key = None;
                Some((count, reason))
            } else {
                None
            }
        };

        if let Some((count, reason)) = tripped {
            eprintln!(
                "[Tailer] {count} consecutive \"y\" responses ({reason}) — disabling auto-approve for {session_id}"
            );
            if let Some(disable) = self.disable_fn.lock().clone() {
                disable(app, session_id);
            }
            let _ = app.emit(
                "tailer:aa-auto-disabled",
                json!({
                    "sessionId": session_id,
                    "matchedLine": format!("y x{count}"),
                    "reason": reason,
                }),
            );
        }
    }
}

/// The AutoResponder prompt.
fn build_responder_prompt(context_block: &str) -> String {
    format!(
        "You are an automated response assistant. An AI coding agent is working in a terminal and has paused — it is either asking a question, requesting confirmation, or waiting for input.\n\n\
         Read the terminal output carefully, understand what the agent needs, and provide the most useful response to keep it productive.\n\n\
         Guidelines:\n\
         - Yes/no confirmations → approve (y, yes)\n\
         - Questions about what to do → give a clear, contextual directive based on what the agent was working on\n\
         - Choice/option selection → pick the most appropriate option based on context\n\
         - File/path/name requests → derive the answer from the terminal context\n\
         - Agent finished/idle at prompt → instruct it to continue with the next logical step\n\
         - Error reported → tell it to fix the issue and continue\n\
         - Always be positive and keep the agent moving forward\n\n\
         Reply with ONLY the exact text to type into the terminal. No quotes, no markdown, no explanation. Max 2 sentences.\n\n\
         --- Terminal output (last 30 lines) ---\n{context_block}\n--- End of terminal output ---\n\n\
         The agent is waiting. What should be typed?"
    )
}

/// buildFallbackResponse — simple heuristic when AI is not available.
fn build_fallback_response(last_line: &str, recent_context_lower: &str) -> String {
    if idle_prompt_indicator().is_match(last_line) {
        return "continue with the next step".into();
    }
    static YN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let yn = YN.get_or_init(|| Regex::new(r"(?i)\by/n\b|\byes.*no\b|\(y/n\)").unwrap());
    if yn.is_match(last_line) {
        return "y".into();
    }
    static DONE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let done = DONE.get_or_init(|| {
        Regex::new(r"\b(done|finished|completed|complete|terminato|fatto|finito)\b").unwrap()
    });
    if done.is_match(recent_context_lower) {
        return "continue".into();
    }
    static ERR: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let err = ERR.get_or_init(|| Regex::new(r"\b(error|failed|fail|errore)\b").unwrap());
    if err.is_match(recent_context_lower) {
        return "yes, try to fix it and continue".into();
    }
    "y".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Finds the first matching pattern, replicating the selection of
    /// `try_fast_confirmation` (delta → delta window, multiLine → last5).
    fn match_response(
        provider: &str,
        last_line: &str,
        last5: &str,
        delta: &str,
    ) -> Option<&'static str> {
        for p in confirmation_patterns() {
            if let Some(providers) = p.providers {
                if !providers.contains(&provider) {
                    continue;
                }
            }
            let text = if p.delta {
                delta
            } else if p.multi_line {
                last5
            } else {
                last_line
            };
            if text.is_empty() || !p.regex.is_match(text) {
                continue;
            }
            if let Some(require) = &p.require {
                if !require.is_match(text) {
                    continue;
                }
            }
            return Some(p.response);
        }
        None
    }

    #[test]
    fn yn_prompt_answers_with_enter() {
        assert_eq!(
            match_response("claude-code-cli", "Proceed? (Y/n)", "", ""),
            Some("\r")
        );
    }

    /// KNOWN QUIRK, kept on purpose:
    /// the `(Y/n)` pattern is case-INSENSITIVE and precedes `(y/N)` in the list,
    /// so it also catches default-No prompts and answers Enter — which on
    /// a `(y/N)` means **No**. The two patterns `(y/N)`/`[y/N]` → "y\r"
    /// are effectively unreachable.
    /// The test locks in the CURRENT behavior: if one day we decide to
    /// fix it, this test must be updated.
    #[test]
    fn default_no_prompt_is_intercepted_by_case_insensitive_yn() {
        assert_eq!(
            match_response("claude-code-cli", "Delete file? (y/N)", "", ""),
            Some("\r")
        );
    }

    #[test]
    fn claude_numbered_menu_matches_multiline() {
        let last5 = "Do you want to proceed?\n❯ 1. Yes\n  2. No";
        assert_eq!(
            match_response("claude-code-cli", "  2. No", last5, ""),
            Some("\r")
        );
    }

    #[test]
    fn codex_widget_requires_both_question_and_option() {
        let question = "Would you like to run the following command?";
        // Only the question (output quoting it) → no match: the option is missing.
        assert_eq!(match_response("codex", "", "", question), None);
        // Question + option label in the same frame → Enter.
        let frame = format!("{question}  Yes, proceed  No, stop");
        assert_eq!(match_response("codex", "", "", &frame), Some("\r"));
    }

    #[test]
    fn codex_widget_is_provider_scoped() {
        let frame = "Would you like to make the following edits?  Yes, just this once";
        assert_eq!(match_response("claude-code-cli", "", "", frame), None);
        assert_eq!(match_response("codex", "", "", frame), Some("\r"));
    }

    #[test]
    fn fallback_reacts_to_context() {
        assert_eq!(
            build_fallback_response("›", ""),
            "continue with the next step"
        );
        assert_eq!(build_fallback_response("Continue? y/n", ""), "y");
        assert_eq!(
            build_fallback_response("...", "build failed"),
            "yes, try to fix it and continue"
        );
        assert_eq!(build_fallback_response("...", "all done"), "continue");
        assert_eq!(build_fallback_response("...", ""), "y");
    }

    #[test]
    fn claude_banner_regex_needs_the_glyph() {
        assert!(claude_aa_mode_rx().is_match("⏵⏵ accept edits on (shift+tab)"));
        assert!(claude_aa_mode_rx().is_match("⏵ bypass permissions on"));
        // Prose talking about the feature without the glyph must not match.
        assert!(!claude_aa_mode_rx().is_match("the banner reads accept edits on"));
    }

    #[test]
    fn idle_prompt_indicator_matches_bare_prompts_only() {
        assert!(idle_prompt_indicator().is_match("›"));
        assert!(idle_prompt_indicator().is_match("❯ "));
        assert!(!idle_prompt_indicator().is_match("› npm test"));
    }
}
