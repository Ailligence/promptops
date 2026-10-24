//! Squad context
//! (context store, per-mode slot filter, slot serialization, context preamble).
//!
//! Five fixed slots per squad, injected (filtered by mode) into the prompt of
//! every spawn. The population is for now ONLY deterministic
//! (files_touched from the workers' FileEdit events) — the AI summarizer of the
//! turns (goal/decisions/open_questions/last_output_summary) is not there yet.
//! TODO: add the AI summarizer that fills those slots, with the rest of the
//! Squad Engine.

use parking_lot::Mutex;
use std::collections::HashMap;

pub const SLOT_KEYS: [&str; 5] = [
    "goal",
    "files_touched",
    "decisions",
    "open_questions",
    "last_output_summary",
];

/// Which slots each mode receives at spawn — context is a resource, not a
/// dump (unknown modes = sprint filter).
fn slots_for_mode(mode: &str) -> &'static [&'static str] {
    match mode {
        "clean" | "minimal" => &["goal", "last_output_summary"],
        "plan_only" | "architect" => {
            &["goal", "open_questions", "decisions", "last_output_summary"]
        }
        "detective" => &["goal", "files_touched", "last_output_summary"],
        "refactor" => &["goal", "decisions", "files_touched", "last_output_summary"],
        "paranoid" => &["goal", "files_touched", "decisions", "last_output_summary"],
        _ => &["goal", "decisions", "files_touched", "last_output_summary"], // sprint
    }
}

pub type SquadSlots = HashMap<String, String>;

/// In-memory: parentSessionId → slots.
#[derive(Default)]
pub struct SquadContextStore {
    slots: Mutex<HashMap<String, SquadSlots>>,
}

impl SquadContextStore {
    pub fn get(&self, parent_session_id: &str) -> SquadSlots {
        self.slots
            .lock()
            .get(parent_session_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Unique, deterministic append of the touched files — no LLM in the loop.
    pub fn append_files(&self, parent_session_id: &str, files: &[String]) {
        if files.is_empty() {
            return;
        }
        let mut guard = self.slots.lock();
        let current = guard.entry(parent_session_id.to_string()).or_default();
        let mut existing: Vec<String> = current
            .get("files_touched")
            .map(|s| {
                s.split('\n')
                    .map(str::trim)
                    .filter(|l| !l.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        for f in files {
            if !existing.iter().any(|e| e == f) {
                existing.push(f.clone());
            }
        }
        current.insert("files_touched".into(), existing.join("\n"));
    }

    /// Applies the summarizer upserts (only known keys, non-empty values)
    /// and returns the updated slot state.
    pub fn apply_upserts(
        &self,
        parent_session_id: &str,
        upserts: &[(String, String)],
    ) -> SquadSlots {
        let mut guard = self.slots.lock();
        let current = guard.entry(parent_session_id.to_string()).or_default();
        for (key, value) in upserts {
            if !SLOT_KEYS.contains(&key.as_str()) {
                continue;
            }
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            current.insert(key.clone(), value.to_string());
        }
        current.clone()
    }

    pub fn clear(&self, parent_session_id: &str) {
        self.slots.lock().remove(parent_session_id);
    }

    pub fn clear_all(&self) {
        self.slots.lock().clear();
    }
}

/// serializeSlots — only the requested, non-empty slots.
fn serialize_slots(slots: &SquadSlots, keys: &[&str]) -> String {
    let mut lines: Vec<String> = Vec::new();
    for key in keys {
        if let Some(value) = slots.get(*key) {
            let value = value.trim();
            if !value.is_empty() {
                lines.push(format!("{key}:\n{value}"));
            }
        }
    }
    lines.join("\n\n")
}

/// buildContextPreamble — empty string until the squad has produced anything.
pub fn build_context_preamble(slots: &SquadSlots, mode: &str) -> String {
    let body = serialize_slots(slots, slots_for_mode(mode));
    if body.is_empty() {
        return String::new();
    }
    format!(
        "SHARED SQUAD CONTEXT (maintained automatically across agents — treat as ground truth):\n{body}\n---\n\n"
    )
}

// ── Summarizer (port of the merge rules from goodboy, MIT) ───────────

pub const SUMMARIZER_SYSTEM_PROMPT: &str = r#"You maintain a small structured summary for an AI coding squad (multiple agents working on the same goal).

CONTEXT PRESERVATION (critical):
- goal: the stable intent. Update ONLY if the user explicitly redirected the work; never use it to log progress.
- decisions: append new accepted choices; NEVER remove or rewrite previous ones.
- open_questions: add new unresolved questions; drop one ONLY when this turn explicitly resolves it.
- files_touched: append unique file paths; never duplicate, never remove.
- last_output_summary: REPLACE entirely; 2-4 sentences describing ONLY the latest turn's outcome.

OUTPUT — a single JSON object, nothing else (no prose, no code fences):
{"upserts": [{"key": "<slot key>", "value": "<full merged value, markdown allowed>"}]}
Only include slots whose value actually changes. An empty upserts array is valid."#;

/// Safe char cap (never split a code point).
fn cap_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

pub fn build_summarizer_user_prompt(
    prev_slots: &SquadSlots,
    turn_input: &str,
    turn_output: &str,
) -> String {
    let all_keys: Vec<&str> = SLOT_KEYS.to_vec();
    let prev = serialize_slots(prev_slots, &all_keys);
    let prev = if prev.is_empty() {
        "(empty — first turn)".to_string()
    } else {
        prev
    };
    [
        "CURRENT SLOTS:",
        &prev,
        "",
        "LATEST TURN — USER INPUT:",
        &cap_chars(turn_input, 4_000),
        "",
        "LATEST TURN — AGENT OUTPUT:",
        &cap_chars(turn_output, 12_000),
        "",
        "Update the slots per the rules. JSON only.",
    ]
    .join("\n")
}

/// Extracts the upserts from the summarizer's raw text (first `{` … last `}`).
pub fn parse_summarizer_response(raw: &str) -> Vec<(String, String)> {
    let Some(start) = raw.find('{') else {
        return Vec::new();
    };
    let Some(end) = raw.rfind('}') else {
        return Vec::new();
    };
    if end <= start {
        return Vec::new();
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw[start..=end]) else {
        return Vec::new();
    };
    let Some(upserts) = parsed.get("upserts").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    upserts
        .iter()
        .filter_map(|u| {
            let key = u.get("key")?.as_str()?;
            let value = u.get("value")?.as_str()?;
            if !SLOT_KEYS.contains(&key) {
                return None;
            }
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}
