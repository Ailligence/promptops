//! Sub-agent mode presets (MODE_PRESETS, resolveConfig, buildModePreamble,
//! ECO_INSTRUCTIONS, ROLE_MODE_MAP).
//!
//! The native mode flags (build_native_mode_flags) are passed to the launch command of claude-code-cli
//! sub-agents; the preamble still stays as reinforcement, and as the only
//! enforcement for providers without native flags.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Resolved config: [reasoning_depth, verbosity, exploration, speed_priority, risk_tolerance].
pub type ModeConfig = [String; 5];

// ── Soft skill (SoftSkillSpec) ───────────────────────────────────────────────
//
// Free-form behavioral instructions (written by the user or taken from a catalog
// skill) that travel ON TOP of the mode preamble: prompt-side, so they
// apply to every provider and to both runtimes (PTY and worker). The mode
// remains the basis for config and native flags.

pub const MAX_SOFT_SKILL_NAME: usize = 120;
pub const MAX_SOFT_SKILL_INSTRUCTIONS: usize = 4000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftSkill {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub instructions: String,
}

/// Trim + cap: untrusted IPC input. `None` if name or instructions are empty.
pub fn sanitize_soft_skill(skill: Option<SoftSkill>) -> Option<SoftSkill> {
    let skill = skill?;
    let name: String = skill
        .name
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_SOFT_SKILL_NAME)
        .collect();
    let instructions: String = skill
        .instructions
        .trim()
        .chars()
        .take(MAX_SOFT_SKILL_INSTRUCTIONS)
        .collect::<String>()
        .trim_end()
        .to_string();
    if name.is_empty() || instructions.is_empty() {
        return None;
    }
    Some(SoftSkill {
        id: skill
            .id
            .filter(|i| !i.is_empty())
            .map(|i| i.chars().take(MAX_STASH_ID).collect()),
        name,
        instructions,
    })
}

const MAX_STASH_ID: usize = 200;

/// ACTIVE SOFT SKILL block — after the mode config, before the output economy.
fn soft_skill_lines(skill: &SoftSkill) -> Vec<String> {
    vec![
        String::new(),
        format!("ACTIVE SOFT SKILL: {}", skill.name),
        "Apply these instructions on top of the configuration above, for the whole task:"
            .to_string(),
        skill.instructions.clone(),
    ]
}

const CONFIG_KEYS: [&str; 5] = [
    "reasoning_depth",
    "verbosity",
    "exploration",
    "speed_priority",
    "risk_tolerance",
];

struct Preset {
    icon: &'static str,
    label: &'static str,
    cfg: [&'static str; 5],
}

fn preset(mode: &str) -> Preset {
    match mode {
        "clean" => Preset {
            icon: "\u{2728}",
            label: "Clean",
            cfg: ["MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM"],
        },
        "plan_only" => Preset {
            icon: "\u{1F4CB}",
            label: "Plan Only",
            cfg: ["HIGH", "STRUCTURED", "HIGH", "LOW", "ZERO"],
        },
        "architect" => Preset {
            icon: "\u{1F9E0}",
            label: "Architect",
            cfg: ["MAX", "STRUCTURED", "HIGH", "LOW", "LOW"],
        },
        "detective" => Preset {
            icon: "\u{1F41B}",
            label: "Detective",
            cfg: ["HIGH", "MEDIUM", "FOCUSED", "LOW", "LOW"],
        },
        "refactor" => Preset {
            icon: "\u{1F6E0}",
            label: "Refactor",
            cfg: ["MEDIUM", "STRUCTURED", "LOW", "MEDIUM", "LOW"],
        },
        "paranoid" => Preset {
            icon: "\u{1F9EA}",
            label: "Paranoid",
            cfg: ["HIGH", "MEDIUM", "EXTREME", "LOW", "ZERO"],
        },
        "minimal" => Preset {
            icon: "\u{1F3AF}",
            label: "Minimal",
            cfg: ["LOW", "ZERO", "NONE", "MAX", "MEDIUM"],
        },
        // sprint = also the fallback for unknown modes (MODE_PRESETS[baseMode] with default 'sprint')
        _ => Preset {
            icon: "\u{26A1}",
            label: "Sprint",
            cfg: ["LOW", "MINIMAL", "NONE", "MAX", "MEDIUM"],
        },
    }
}

/// getDefaultModeForRole — fallback 'sprint'.
pub fn default_mode_for_role(role: &str) -> &'static str {
    match role {
        "test-sync" | "ci-validator" => "sprint",
        "test-bootstrap" => "architect",
        "reviewer" => "detective",
        "security-auditor" | "migration-checker" => "paranoid",
        "docs-sync" => "refactor",
        _ => "sprint",
    }
}

/// resolveConfig — mode preset + individual overrides from customConfig.
pub fn resolve_config(mode: &str, custom: Option<&HashMap<String, String>>) -> ModeConfig {
    let base = preset(mode).cfg;
    let mut out: ModeConfig = std::array::from_fn(|i| base[i].to_string());
    if let Some(c) = custom {
        for (i, key) in CONFIG_KEYS.iter().enumerate() {
            if let Some(v) = c.get(*key).filter(|v| !v.is_empty()) {
                out[i] = v.clone();
            }
        }
    }
    out
}

/// Eco Mode wording adapted from caveman (https://github.com/JuliusBrussee/caveman),
/// Copyright 2026 Julius Brussee, Apache-2.0. See THIRD-PARTY-NOTICES.txt.
fn eco_instructions(level: &str) -> &'static str {
    match level {
        "lite" => "Be concise. Remove filler words (just/really/basically), hedging, and pleasantries. Keep grammar intact. Shorter sentences preferred. Code unchanged.",
        "ultra" => "MAXIMUM compression. Telegraphic style. No articles, no filler, no hedging, no pleasantries. Single words where possible. Code unchanged. Pattern: [thing] [verb]. [next]. Absolute minimum tokens.",
        // 'full' and default
        _ => "Respond terse like caveman. Technical substance exact. Only fluff die. Drop: articles, filler (just/really/basically), pleasantries, hedging. Fragments OK. Short synonyms. Code unchanged. Pattern: [thing] [action] [reason]. [next step].",
    }
}

fn config_instructions(cfg: &ModeConfig, skip_verbosity: bool) -> Vec<String> {
    let mut out = Vec::new();
    out.push(match cfg[0].as_str() {
        "LOW" => "- Keep reasoning minimal. Act fast, skip deep analysis.",
        "HIGH" => "- Reason thoroughly. Consider edge cases and implications.",
        "MAX" => "- Use maximum reasoning depth. Explore all angles, consider trade-offs, think step-by-step.",
        _ => "- Use moderate reasoning. Analyze enough to avoid mistakes.",
    }.to_string());
    if !skip_verbosity {
        out.push(
            match cfg[1].as_str() {
                "ZERO" => "- Output ONLY code/results. No explanations, no commentary.",
                "MINIMAL" => "- Be extremely concise. One-line status updates only.",
                "STRUCTURED" => {
                    "- Use structured output with headers, bullets, and clear sections."
                }
                _ => "- Provide brief explanations where helpful. Keep it focused.",
            }
            .to_string(),
        );
    }
    out.push(
        match cfg[2].as_str() {
            "NONE" => {
                "- Do NOT explore beyond what is explicitly needed. Zero unnecessary file reads."
            }
            "LOW" => "- Explore only directly related files. Minimize tool calls.",
            "FOCUSED" => {
                "- Explore deeply but only within the specific problem area. Follow the trail."
            }
            "HIGH" => "- Explore broadly. Check patterns, related modules, and architecture.",
            "EXTREME" => {
                "- Explore exhaustively. Leave no stone unturned. Check every relevant path."
            }
            _ => "- Explore moderately. Check related files and dependencies.",
        }
        .to_string(),
    );
    out.push(
        match cfg[3].as_str() {
            "LOW" => "- Speed is NOT a priority. Take time to be thorough and correct.",
            "HIGH" => "- Prioritize speed. Get results quickly, optimize later.",
            "MAX" => "- Maximum speed. Fastest path to results. Skip optional steps.",
            _ => "- Balance speed and thoroughness. Be efficient but not rushed.",
        }
        .to_string(),
    );
    out.push(match cfg[4].as_str() {
        "ZERO" => "- ZERO risk tolerance. Verify everything. Never assume. Always confirm before destructive actions.",
        "LOW" => "- Low risk tolerance. Be cautious with changes. Prefer safe, reversible actions.",
        "HIGH" => "- High risk tolerance. Move fast, fix issues if they arise.",
        _ => "- Moderate risk tolerance. Take reasonable risks for faster progress.",
    }.to_string());
    out
}

fn mode_config_lines(mode: &str, cfg: &ModeConfig, eco_active: bool) -> Vec<String> {
    let p = preset(mode);
    let mut lines = vec![
        format!("ACTIVE MODE: {} {}", p.icon, p.label),
        "ACTIVE CONFIG:".to_string(),
        format!("  reasoning_depth: {}", cfg[0]),
        format!(
            "  verbosity: {}{}",
            cfg[1],
            if eco_active {
                "  \u{2190} SUPERSEDED BY ECO"
            } else {
                ""
            }
        ),
        format!("  exploration: {}", cfg[2]),
        format!("  speed_priority: {}", cfg[3]),
        format!("  risk_tolerance: {}", cfg[4]),
        String::new(),
        if eco_active {
            "You MUST strictly follow this configuration (verbosity excluded \u{2014} ECO wins):"
                .to_string()
        } else {
            "You MUST strictly follow this configuration:".to_string()
        },
    ];
    lines.extend(config_instructions(cfg, eco_active));
    lines
}

/// buildModePreamble — empty string for 'clean' (without soft skill), otherwise
/// header + ACTIVE MODE/CONFIG (+ ECO at the top, + SOFT SKILL, + strict PLAN MODE,
/// + final separator). With a soft skill even 'clean' emits
/// the header + only the skill block (no ACTIVE MODE).
pub fn build_mode_preamble(
    mode: &str,
    cfg: &ModeConfig,
    eco_level: Option<&str>,
    provider: &str,
    soft_skill: Option<&SoftSkill>,
) -> String {
    if mode == "clean" && soft_skill.is_none() {
        return String::new();
    }
    let eco_active = eco_level.is_some();

    // Only Claude Code (and the endpoints that run on its CLI) is "Claude Code":
    // telling Codex or Gemini otherwise is a false statement about its own tools.
    let intro = if matches!(provider, "claude-code-cli" | "zai" | "kimi") {
        "You are a specialized sub-agent running inside PromptOps and executed via Claude Code."
    } else {
        "You are a specialized sub-agent running inside PromptOps."
    };
    let mut lines: Vec<String> = vec![intro.to_string(), String::new()];

    if let Some(level) = eco_level {
        lines.push(format!(
            "\u{1F50B} ECO MODE [{}] \u{2014} PRIMARY DIRECTIVE (OVERRIDES ALL VERBOSITY/EXPLANATION RULES BELOW):",
            level.to_uppercase()
        ));
        lines.push(eco_instructions(level).to_string());
        lines.push(
            "Applies to EVERY response. Output token count is the hard optimization target."
                .to_string(),
        );
        lines.push("Ignore any instruction below that would increase verbosity, add explanations, or produce structured sections \u{2014} ECO supersedes them.".to_string());
        lines.push(String::new());
        lines.push("---".to_string());
        lines.push(String::new());
    }

    if mode != "clean" {
        lines.extend(mode_config_lines(mode, cfg, eco_active));
    }

    if let Some(skill) = soft_skill {
        lines.extend(soft_skill_lines(skill));
    }

    if !eco_active {
        lines.push(String::new());
        lines.push("OUTPUT ECONOMY (always active, all verbosity levels):".to_string());
        lines.push("- Never re-print code you just wrote or file content you just read \u{2014} reference the file path (and line) instead.".to_string());
        lines.push("- No ceremony: skip \"Here is...\", restating the task, or closing recaps of an unchanged plan.".to_string());
        lines.push("- Final report: outcome first, then only load-bearing details.".to_string());
    }

    if mode == "plan_only" {
        lines.push(String::new());
        lines.push("\u{1F6D1} PLAN MODE \u{2014} STRICT (PLUGIN SKILL):".to_string());
        lines.push("- You are operating in PLAN ONLY mode. Do NOT call Write, Edit, NotebookEdit, or any tool that mutates files, processes, or remote state.".to_string());
        lines.push("- Read-only exploration is allowed (Read, Grep, Glob, search) to ground the plan in real code.".to_string());
        lines.push("- Deliverable: a clear, actionable plan with concrete file paths, line numbers where relevant, and step-by-step ordering.".to_string());
        lines.push("- If you are running inside Claude Code with the EnterPlanMode tool available, enter plan mode at the start and present the plan via ExitPlanMode at the end. Do not exit plan mode by executing changes.".to_string());
        lines.push("- If a step would require execution to verify, mark it as \"verify after approval\" instead of running it.".to_string());
        lines.push("- End the response with the plan ready for user approval. Do not ask the user to run anything yet.".to_string());
    }

    if let Some(level) = eco_level {
        lines.push(String::new());
        lines.push(format!(
            "REMINDER: respond in ECO [{}] style regardless of mode guidance above.",
            level.to_uppercase()
        ));
    }

    lines.push(String::new());
    lines.push("---".to_string());
    lines.push(String::new());

    lines.join("\n")
}

// ── Native mode flags ─────────────────────────────────────────────

/// The enforceable half of the config becomes real CLI flags (only
/// claude-code-cli; the other providers stay on the preamble):
///   risk_tolerance ZERO → --permission-mode plan
///   risk_tolerance HIGH → --permission-mode acceptEdits
///   exploration NONE    → --disallowedTools WebSearch,WebFetch
/// Pre-quoted fragment to append to the launch command in the shell.
pub fn build_native_mode_flags(cfg: &ModeConfig, provider: &str) -> String {
    if provider != "claude-code-cli" {
        return String::new();
    }
    let mut parts: Vec<&str> = Vec::new();
    match cfg[4].as_str() {
        "ZERO" => {
            parts.push("--permission-mode");
            parts.push("plan");
        }
        "HIGH" => {
            parts.push("--permission-mode");
            parts.push("acceptEdits");
        }
        _ => {}
    }
    if cfg[2] == "NONE" {
        parts.push("--disallowedTools");
        parts.push("'WebSearch,WebFetch'");
    }
    parts.join(" ")
}

/// buildWorkerTurnOptions — mapping headless (TurnRunner via argv, no shell):
/// full preamble as native system prompt, reasoning_depth → --effort,
/// ZERO risk → "plan" (read-only), otherwise "acceptEdits" (edits inside the
/// workspace, anything that would need a prompt is refused: a headless run
/// has no approval channel). The turn upgrades "acceptEdits" to
/// "bypassPermissions" only while the user has auto-approve on for the
/// session (`worker_turn_permission`).
pub struct WorkerTurnOptions {
    pub system_prompt: String,
    pub effort: &'static str,
    pub permission_mode: &'static str,
    pub disallowed_tools: Vec<String>,
}

pub fn build_worker_turn_options(
    mode: &str,
    cfg: &ModeConfig,
    eco_level: Option<&str>,
    soft_skill: Option<&SoftSkill>,
) -> WorkerTurnOptions {
    let effort = match cfg[0].as_str() {
        "LOW" => "low",
        "MEDIUM" => "medium",
        _ => "high", // HIGH e MAX
    };
    WorkerTurnOptions {
        system_prompt: build_mode_preamble(mode, cfg, eco_level, "claude-code-cli", soft_skill),
        effort,
        permission_mode: if cfg[4] == "ZERO" {
            "plan"
        } else {
            "acceptEdits"
        },
        disallowed_tools: if cfg[2] == "NONE" {
            vec!["WebSearch".into(), "WebFetch".into()]
        } else {
            Vec::new()
        },
    }
}

/// Permission mode of one worker turn: a writing worker skips the checks
/// only while the session is in auto-approve; read-only stays read-only.
pub fn worker_turn_permission(base: &str, auto_approve: bool) -> &'static str {
    match base {
        "plan" => "plan",
        _ if auto_approve => "bypassPermissions",
        _ => "acceptEdits",
    }
}

#[cfg(test)]
mod worker_turn_permission_tests {
    use super::*;

    #[test]
    fn headless_worker_bypasses_only_with_auto_approve() {
        let sprint = resolve_config("sprint", None);
        let base = build_worker_turn_options("sprint", &sprint, None, None).permission_mode;
        assert_eq!(base, "acceptEdits");
        assert_eq!(worker_turn_permission(base, false), "acceptEdits");
        assert_eq!(worker_turn_permission(base, true), "bypassPermissions");
        // A stored legacy value never bypasses without auto-approve.
        assert_eq!(
            worker_turn_permission("bypassPermissions", false),
            "acceptEdits"
        );
        // Read-only workers stay read-only even in auto-approve.
        assert_eq!(worker_turn_permission("plan", true), "plan");
        let mut zero = sprint.clone();
        zero[4] = "ZERO".into();
        assert_eq!(
            build_worker_turn_options("sprint", &zero, None, None).permission_mode,
            "plan"
        );
    }
}

#[cfg(test)]
mod soft_skill_tests {
    use super::*;

    fn skill(name: &str, instructions: &str) -> SoftSkill {
        SoftSkill {
            id: Some("custom:1".into()),
            name: name.into(),
            instructions: instructions.into(),
        }
    }

    #[test]
    fn preamble_names_claude_code_only_for_claude_code() {
        let cfg = resolve_config("sprint", None);
        assert!(build_mode_preamble("sprint", &cfg, None, "claude-code-cli", None)
            .starts_with("You are a specialized sub-agent running inside PromptOps and executed via Claude Code."));
        for provider in ["codex", "gemini-cli", "antigravity", "grok"] {
            let out = build_mode_preamble("sprint", &cfg, None, provider, None);
            assert!(!out.contains("Claude Code"), "{provider}");
            assert!(out.starts_with("You are a specialized sub-agent running inside PromptOps."));
        }
    }

    #[test]
    fn sanitize_drops_empty_and_caps() {
        assert!(sanitize_soft_skill(None).is_none());
        assert!(sanitize_soft_skill(Some(skill("  ", "x"))).is_none());
        assert!(sanitize_soft_skill(Some(skill("x", "   "))).is_none());
        let long = "a".repeat(MAX_SOFT_SKILL_INSTRUCTIONS + 50);
        let s = sanitize_soft_skill(Some(skill("  Careful   reviewer ", &long))).unwrap();
        assert_eq!(s.name, "Careful reviewer");
        assert_eq!(s.instructions.chars().count(), MAX_SOFT_SKILL_INSTRUCTIONS);
    }

    #[test]
    fn preamble_carries_the_skill_block() {
        let cfg = resolve_config("architect", None);
        let s = skill("Test-first", "Write the failing test before any change.");
        let out = build_mode_preamble("architect", &cfg, None, "codex", Some(&s));
        assert!(out.contains("ACTIVE MODE: \u{1F9E0} Architect"));
        assert!(out.contains("ACTIVE SOFT SKILL: Test-first"));
        assert!(out.contains("Write the failing test before any change."));
        // The skill sits after the mode config and before the output economy block.
        let skill_at = out.find("ACTIVE SOFT SKILL").unwrap();
        assert!(out.find("ACTIVE CONFIG").unwrap() < skill_at);
        assert!(skill_at < out.find("OUTPUT ECONOMY").unwrap());
    }

    #[test]
    fn clean_stays_empty_without_skill_but_emits_skill_alone() {
        let cfg = resolve_config("clean", None);
        assert_eq!(
            build_mode_preamble("clean", &cfg, None, "claude-code-cli", None),
            ""
        );
        let s = skill("Docs writer", "Prefer prose over bullet lists.");
        let out = build_mode_preamble("clean", &cfg, None, "claude-code-cli", Some(&s));
        assert!(!out.contains("ACTIVE MODE"));
        assert!(out.contains("ACTIVE SOFT SKILL: Docs writer"));
        // Worker system prompt goes through the same builder.
        let w = build_worker_turn_options("clean", &cfg, None, Some(&s));
        assert!(w.system_prompt.contains("ACTIVE SOFT SKILL: Docs writer"));
    }
}
