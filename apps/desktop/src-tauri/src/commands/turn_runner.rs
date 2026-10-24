//! TurnRunner — port of providers/turn/* (turn-runner, turn-events,
//! turn-parsers, anthropic-envelope-parser, codex-parser, gemini-parser).
//!
//! One-shot headless execution of a provider CLI with structured output:
//! no PTY/TUI, only stdio pipes. Every stdout line is normalized into a
//! `TurnEvent` by the per-provider parsers, so consumers (sub-agent worker,
//! reviewer, token tracker) never see vendor formats.
//!
//! Spawn mechanics (flag order, env hygiene, stderr drain) faithful
//! to the original:
//!  - for Claude `--resume <id>` MUST precede `-p`, otherwise the session
//!    is not resumed;
//!  - CLAUDECODE / CLAUDE_CODE_ENTRYPOINT / CLAUDE_AGENT_SDK_VERSION are
//!    removed from the child's env (nested session loop);
//!  - stderr drained on a dedicated thread: a verbose process must never
//!    deadlock on a full pipe.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};

const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const STDERR_CAP_BYTES: usize = 16 * 1024;

/// Providers whose CLI supports a machine-readable one-shot mode.
pub fn is_stream_capable(provider: &str) -> bool {
    matches!(
        provider,
        "claude-code-cli" | "cursor" | "codex" | "gemini-cli"
    )
}

fn default_binary(provider: &str) -> &'static str {
    match provider {
        "cursor" => "cursor-agent",
        "codex" => "codex",
        "gemini-cli" => "gemini",
        _ => "claude",
    }
}

// ── TurnEvent (turn-events.ts) ───────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
}

/// Normalized union of the events of a headless turn. Serializes with
/// `kind` as discriminant, like the original.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TurnEvent {
    #[serde(rename_all = "camelCase")]
    AssistantText { run_id: String, delta: String },
    #[serde(rename_all = "camelCase")]
    ToolCallStart {
        run_id: String,
        tool_use_id: String,
        tool_name: String,
        input: Value,
    },
    #[serde(rename_all = "camelCase")]
    ToolCallEnd {
        run_id: String,
        tool_use_id: String,
        output: Value,
        is_error: bool,
    },
    #[serde(rename_all = "camelCase")]
    FileEdit {
        run_id: String,
        path: String,
        /// "create" | "modify" | "delete"
        edit_type: String,
    },
    #[serde(rename_all = "camelCase")]
    Usage { run_id: String, usage: TurnUsage },
    #[serde(rename_all = "camelCase")]
    Error { run_id: String, message: String },
    #[serde(rename_all = "camelCase")]
    Done { run_id: String },
    #[serde(rename_all = "camelCase")]
    ProviderSessionInit {
        run_id: String,
        provider_session_id: String,
    },
    #[serde(rename_all = "camelCase")]
    UnknownPayload {
        run_id: String,
        adapter: String,
        payload_type: String,
        raw: Value,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnExitResult {
    pub exit_code: Option<i32>,
    pub stderr: String,
    pub timed_out: bool,
    pub canceled: bool,
}

/// Spawn options of a turn (TurnSpawnOptions).
#[derive(Clone, Default)]
pub struct TurnSpawnOptions {
    pub run_id: String,
    pub provider: String,
    pub cwd: String,
    pub prompt: String,
    pub binary: Option<String>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub effort: Option<String>,
    /// None (the CLI default) | "plan" | "acceptEdits" | "bypassPermissions".
    /// "bypassPermissions" only for a session in auto-approve.
    pub permission_mode: Option<String>,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub resume_session_id: Option<String>,
    pub no_session_persistence: bool,
    pub env: HashMap<String, String>,
    pub timeout_ms: Option<u64>,
}

pub struct BuiltTurnCommand {
    pub binary: String,
    pub argv: Vec<String>,
    /// If true the prompt goes to stdin instead of argv.
    pub prompt_via_stdin: bool,
}

/// buildTurnCommand — the flag shape is contract-level (Claude silently
/// ignores `--resume` if it comes after `-p`).
pub fn build_turn_command(opts: &TurnSpawnOptions) -> BuiltTurnCommand {
    let binary = opts
        .binary
        .clone()
        .unwrap_or_else(|| default_binary(&opts.provider).to_string());
    let mut argv: Vec<String> = Vec::new();
    let s = |v: &str| v.to_string();

    match opts.provider.as_str() {
        "cursor" => {
            argv.extend([s("-p"), opts.prompt.clone()]);
            argv.extend([s("--output-format"), s("stream-json")]);
            argv.extend([s("--workspace"), opts.cwd.clone()]);
            if let Some(model) = &opts.model {
                argv.extend([s("--model"), model.clone()]);
            }
            // cursor-agent has no granular permission flags: --force is its
            // non-interactive mode (otherwise it waits for a TTY). It also
            // approves every write and command, so only a turn that may
            // bypass permissions (auto-approve on) gets here
            // (`check_turn_supported`).
            argv.push(s("--force"));
            BuiltTurnCommand {
                binary,
                argv,
                prompt_via_stdin: false,
            }
        }
        "codex" => {
            // `codex exec resume <id>` continues the captured thread. The
            // resume subcommand does NOT accept --cd or -s (verified on
            // codex-cli 0.144.4): the cwd comes from the spawn, the sandbox from -c.
            let resume = opts.resume_session_id.clone();
            argv.push(s("exec"));
            if let Some(id) = &resume {
                argv.extend([s("resume"), id.clone()]);
            }
            argv.extend([s("--json"), s("--skip-git-repo-check")]);
            if let Some(model) = &opts.model {
                argv.extend([s("--model"), model.clone()]);
            }
            if resume.is_none() {
                argv.extend([s("--cd"), opts.cwd.clone()]);
            }
            let mode = opts.permission_mode.as_deref().unwrap_or("default");
            if mode == "bypassPermissions" {
                argv.push(s("--dangerously-bypass-approvals-and-sandbox"));
            } else if resume.is_some() {
                argv.push(s("-c"));
                argv.push(if mode == "plan" {
                    s("sandbox_mode=\"read-only\"")
                } else {
                    s("sandbox_mode=\"workspace-write\"")
                });
            } else if mode == "plan" {
                argv.extend([s("-s"), s("read-only")]);
            } else {
                argv.extend([s("-s"), s("workspace-write")]);
            }
            // The value is pasted into TOML: only a plain level name.
            if let Some(effort) = opts.effort.as_deref().filter(|e| is_plain_level(e)) {
                argv.extend([s("-c"), format!("model_reasoning_effort=\"{effort}\"")]);
            }
            argv.extend([s("--"), opts.prompt.clone()]);
            BuiltTurnCommand {
                binary,
                argv,
                prompt_via_stdin: false,
            }
        }
        "gemini-cli" => {
            if let Some(model) = &opts.model {
                argv.extend([s("-m"), model.clone()]);
            }
            // gemini's approval modes: plan = read-only (background reviews),
            // auto_edit = edits approved, other tools that would ask are not
            // run (headless has nobody to ask), yolo = everything approved,
            // only when the session is in auto-approve.
            let approval = match opts.permission_mode.as_deref() {
                Some("plan") => Some("plan"),
                Some("acceptEdits") => Some("auto_edit"),
                Some("bypassPermissions") => Some("yolo"),
                _ => None,
            };
            if let Some(mode) = approval {
                argv.extend([s("--approval-mode"), s(mode)]);
            }
            argv.extend([s("-p"), opts.prompt.clone()]);
            // The working dir comes from the spawn cwd; gemini has no flag for it.
            BuiltTurnCommand {
                binary,
                argv,
                prompt_via_stdin: false,
            }
        }
        // claude-code-cli (default)
        _ => {
            if let Some(id) = &opts.resume_session_id {
                argv.extend([s("--resume"), id.clone()]);
            }
            // The prompt goes to stdin (print mode reads it when -p has no
            // inline argument) — avoids argv size limits.
            argv.extend([
                s("-p"),
                s("--output-format"),
                s("stream-json"),
                s("--verbose"),
            ]);
            if let Some(model) = &opts.model {
                argv.extend([s("--model"), model.clone()]);
            }
            // No mode = the CLI's own default (asks, so headless denies).
            if let Some(mode) = &opts.permission_mode {
                argv.extend([s("--permission-mode"), mode.clone()]);
            }
            if let Some(sp) = &opts.system_prompt {
                argv.extend([s("--append-system-prompt"), sp.clone()]);
            }
            if let Some(effort) = &opts.effort {
                argv.extend([s("--effort"), effort.clone()]);
            }
            if !opts.allowed_tools.is_empty() {
                argv.extend([s("--allowedTools"), opts.allowed_tools.join(",")]);
            }
            if !opts.disallowed_tools.is_empty() {
                argv.extend([s("--disallowedTools"), opts.disallowed_tools.join(",")]);
            }
            if opts.no_session_persistence {
                argv.push(s("--no-session-persistence"));
            }
            BuiltTurnCommand {
                binary,
                argv,
                prompt_via_stdin: true,
            }
        }
    }
}

/// `low`, `high`, `xhigh`, …: letters only, short.
fn is_plain_level(value: &str) -> bool {
    !value.is_empty() && value.len() <= 16 && value.bytes().all(|b| b.is_ascii_lowercase())
}

/// Turns the provider cannot run as asked. cursor-agent's headless mode needs
/// `--force`, which approves every write and command: it cannot honor a
/// read-only turn, and it runs a writing turn only when the session is in
/// auto-approve (the turn then asks for "bypassPermissions").
pub fn check_turn_supported(opts: &TurnSpawnOptions) -> Result<(), String> {
    if opts.provider != "cursor" {
        return Ok(());
    }
    match opts.permission_mode.as_deref() {
        Some("bypassPermissions") => Ok(()),
        Some("plan") => Err(
            "Cursor cannot run a read-only (plan) turn: its headless mode approves every change."
                .into(),
        ),
        _ => Err(
            "Cursor runs in the background only with auto-approve: its headless mode \
             approves every change and command. Turn on Auto Approve for this session, \
             or use Claude Code, Codex or Gemini CLI for this agent."
                .into(),
        ),
    }
}

/// Windows: `Command::new("claude")` looks only for `claude.exe`, while npm
/// installs `claude.cmd` / `claude.ps1` shims. A bare program name is looked up
/// on PATH with the PATHEXT extensions first (Rust quotes arguments for a
/// `.cmd` safely, or refuses them).
fn resolve_turn_binary(binary: &str) -> std::ffi::OsString {
    if cfg!(windows) && !binary.contains(['/', '\\']) {
        if let Some(found) = std::env::var_os("PATH")
            .and_then(|path| crate::commands::util_cmd::find_in_path(binary, &path))
        {
            return found.into_os_string();
        }
    }
    binary.into()
}

// Load the user's shell profile so existing aliases/functions are available.
fn alias_turn_command(alias: &str, argv: &[String]) -> Command {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        alias_unix_command(alias, argv, &shell)
    }
    #[cfg(windows)]
    {
        alias_powershell_command(alias, argv)
    }
}

/// Windows: the arguments (the prompt among them for codex, gemini and
/// cursor) never become PowerShell text. Each one travels in its own
/// environment variable and the script only names `$env:PO_TURN_ARG_<i>`, so
/// no quote of any kind (PowerShell also closes '…' on U+2018–U+201B) can turn
/// prompt text into code. `alias` is validated (letters, digits, `_-.`).
#[cfg_attr(not(windows), allow(dead_code))]
fn alias_powershell_command(alias: &str, argv: &[String]) -> Command {
    let refs = (0..argv.len())
        .map(|i| format!("$env:PO_TURN_ARG_{i}"))
        .collect::<Vec<_>>()
        .join(" ");
    let mut cmd = crate::commands::util_cmd::cmd("powershell.exe");
    cmd.args(crate::commands::util_cmd::powershell_args(&format!(
        "& {alias} {refs}"
    )));
    for (i, arg) in argv.iter().enumerate() {
        cmd.env(format!("PO_TURN_ARG_{i}"), arg);
    }
    cmd
}

#[cfg(unix)]
fn alias_unix_command(alias: &str, argv: &[String], shell: &str) -> Command {
    let fish = std::path::Path::new(shell)
        .file_name()
        .is_some_and(|s| s == "fish");
    let args = argv
        .iter()
        .map(|arg| {
            let arg = if fish {
                arg.replace('\\', "\\\\")
            } else {
                arg.clone()
            };
            format!("'{}'", arg.replace('\'', "'\\''"))
        })
        .collect::<Vec<_>>()
        .join(" ");
    let mut cmd = crate::commands::util_cmd::cmd(shell);
    cmd.args(["-lic", &format!("{alias} {args}")]);
    cmd
}

/// buildTurnEnv — augmented PATH, nested session variables removed.
fn apply_turn_env(cmd: &mut Command, extra: &HashMap<String, String>) {
    let home = std::env::var("HOME").unwrap_or_default();
    // /opt/homebrew before /usr/local: on Apple Silicon the live CLI is in
    // homebrew, while /usr/local may have a stale npm shim.
    let extra_paths = [
        format!("{home}/.local/bin"),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
    ];
    // Unix only: these are Unix folders, and on Windows the ':' join would
    // glue them onto the first real PATH entry and break it.
    if cfg!(unix) {
        let current = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into());
        let path = format!("{}:{}", extra_paths.join(":"), current);
        cmd.env("PATH", path);
    }
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");
    cmd.env_remove("CLAUDE_AGENT_SDK_VERSION");
    if extra.contains_key("PROMPTOPS_PROVIDER_ACCOUNT_ID")
        && extra.contains_key("CLAUDE_SECURESTORAGE_CONFIG_DIR")
    {
        for key in crate::commands::provider_account::CLAUDE_AUTH_OVERRIDES {
            cmd.env_remove(key);
        }
    }
    for (k, v) in extra {
        cmd.env(k, v);
    }
}

// ── Parser (turn-parsers.ts + the three per-provider parsers) ────────────────

/// parseTurnLine — dispatch per provider.
pub fn parse_turn_line(provider: &str, line: &str, run_id: &str) -> Vec<TurnEvent> {
    match provider {
        // cursor-agent emits the same stream-json envelope as Claude Code.
        "claude-code-cli" => parse_anthropic_line(line, run_id, "claude-code-cli"),
        "cursor" => parse_anthropic_line(line, run_id, "cursor"),
        "codex" => parse_codex_line(line, run_id),
        "gemini-cli" => parse_gemini_line(line, run_id),
        _ => Vec::new(),
    }
}

/// Claude tools whose input carries a file_path to expose as file_edit.
fn file_edit_from_input(tool_name: &str, input: &Value) -> Option<(String, String)> {
    if !matches!(tool_name, "Edit" | "MultiEdit" | "Write" | "NotebookEdit") {
        return None;
    }
    let path = input.get("file_path")?.as_str()?.to_string();
    let edit_type = if tool_name == "Write" {
        "create"
    } else {
        "modify"
    };
    Some((path, edit_type.to_string()))
}

fn parse_anthropic_line(line: &str, run_id: &str, adapter: &str) -> Vec<TurnEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(payload) = serde_json::from_str::<Value>(trimmed) else {
        return Vec::new();
    };
    let ptype = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let mut events = Vec::new();

    match ptype {
        "assistant" => {
            let blocks = payload
                .pointer("/message/content")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            for block in blocks {
                match block.get("type").and_then(|v| v.as_str()) {
                    Some("text") => {
                        let text = block.get("text").and_then(|v| v.as_str()).unwrap_or("");
                        if !text.is_empty() {
                            events.push(TurnEvent::AssistantText {
                                run_id: run_id.into(),
                                delta: text.into(),
                            });
                        }
                    }
                    Some("tool_use") => {
                        let tool_name = block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let input = block.get("input").cloned().unwrap_or(Value::Null);
                        events.push(TurnEvent::ToolCallStart {
                            run_id: run_id.into(),
                            tool_use_id: block
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            tool_name: tool_name.clone(),
                            input: input.clone(),
                        });
                        if let Some((path, edit_type)) = file_edit_from_input(&tool_name, &input) {
                            events.push(TurnEvent::FileEdit {
                                run_id: run_id.into(),
                                path,
                                edit_type,
                            });
                        }
                    }
                    _ => {}
                }
            }
        }
        "user" => {
            let blocks = payload
                .pointer("/message/content")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            for block in blocks {
                let Some(tool_use_id) = block.get("tool_use_id").and_then(|v| v.as_str()) else {
                    continue;
                };
                events.push(TurnEvent::ToolCallEnd {
                    run_id: run_id.into(),
                    tool_use_id: tool_use_id.to_string(),
                    output: block.get("content").cloned().unwrap_or(Value::Null),
                    is_error: block.get("is_error").and_then(|v| v.as_bool()) == Some(true),
                });
            }
        }
        "result" => {
            let usage = payload.get("usage");
            let input_tokens = usage
                .and_then(|u| u.get("input_tokens"))
                .and_then(|v| v.as_i64());
            let output_tokens = usage
                .and_then(|u| u.get("output_tokens"))
                .and_then(|v| v.as_i64());
            if input_tokens.is_some() || output_tokens.is_some() {
                events.push(TurnEvent::Usage {
                    run_id: run_id.into(),
                    usage: TurnUsage {
                        input_tokens: input_tokens.unwrap_or(0),
                        output_tokens: output_tokens.unwrap_or(0),
                        cached_input_tokens: usage
                            .and_then(|u| u.get("cache_read_input_tokens"))
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0),
                    },
                });
            }
            let subtype = payload.get("subtype").and_then(|v| v.as_str());
            let error = payload.get("error").and_then(|v| v.as_str());
            match (subtype, error) {
                (st, Some(msg)) if st != Some("success") => events.push(TurnEvent::Error {
                    run_id: run_id.into(),
                    message: msg.to_string(),
                }),
                _ => events.push(TurnEvent::Done {
                    run_id: run_id.into(),
                }),
            }
        }
        "system" => {
            if payload.get("subtype").and_then(|v| v.as_str()) == Some("init") {
                if let Some(sid) = payload.get("session_id").and_then(|v| v.as_str()) {
                    if !sid.is_empty() {
                        events.push(TurnEvent::ProviderSessionInit {
                            run_id: run_id.into(),
                            provider_session_id: sid.to_string(),
                        });
                    }
                }
            }
        }
        other if !other.is_empty() => {
            events.push(TurnEvent::UnknownPayload {
                run_id: run_id.into(),
                adapter: adapter.to_string(),
                payload_type: other.to_string(),
                raw: payload,
            });
        }
        _ => {}
    }
    events
}

fn codex_usage(raw: Option<&Value>) -> TurnUsage {
    let get = |k: &str| {
        raw.and_then(|u| u.get(k))
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
    };
    TurnUsage {
        input_tokens: get("input_tokens"),
        // Codex reports reasoning tokens separately; they are billed as output.
        output_tokens: get("output_tokens") + get("reasoning_output_tokens"),
        cached_input_tokens: get("cached_input_tokens"),
    }
}

fn parse_codex_line(line: &str, run_id: &str) -> Vec<TurnEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(payload) = serde_json::from_str::<Value>(trimmed) else {
        return Vec::new();
    };
    let ptype = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let item = payload.get("item");
    let item_id = item
        .and_then(|i| i.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let item_type = item
        .and_then(|i| i.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match ptype {
        "thread.started" => match payload.get("thread_id").and_then(|v| v.as_str()) {
            Some(id) if !id.is_empty() => vec![TurnEvent::ProviderSessionInit {
                run_id: run_id.into(),
                provider_session_id: id.to_string(),
            }],
            _ => Vec::new(),
        },
        "turn.started" => Vec::new(),
        "item.started" => {
            if item_id.is_empty() || item_type != "command_execution" {
                return Vec::new();
            }
            vec![TurnEvent::ToolCallStart {
                run_id: run_id.into(),
                tool_use_id: item_id,
                tool_name: "shell".into(),
                input: json!({
                    "command": item.and_then(|i| i.get("command")).and_then(|v| v.as_str()).unwrap_or("")
                }),
            }]
        }
        "item.completed" => {
            if item_id.is_empty() {
                return Vec::new();
            }
            match item_type {
                "command_execution" => {
                    let exit_code = item
                        .and_then(|i| i.get("exit_code"))
                        .and_then(|v| v.as_i64());
                    vec![TurnEvent::ToolCallEnd {
                        run_id: run_id.into(),
                        tool_use_id: item_id,
                        output: json!({
                            "aggregated_output": item
                                .and_then(|i| i.get("aggregated_output"))
                                .and_then(|v| v.as_str())
                                .unwrap_or(""),
                            "exit_code": exit_code,
                        }),
                        is_error: exit_code.map(|c| c != 0).unwrap_or(false),
                    }]
                }
                "agent_message" => {
                    let text = item
                        .and_then(|i| i.get("text"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if text.is_empty() {
                        Vec::new()
                    } else {
                        vec![TurnEvent::AssistantText {
                            run_id: run_id.into(),
                            delta: text.to_string(),
                        }]
                    }
                }
                "apply_patch" | "file_change" => {
                    let changes = item
                        .and_then(|i| i.get("changes"))
                        .cloned()
                        .unwrap_or(Value::Null);
                    let mut events = vec![TurnEvent::ToolCallEnd {
                        run_id: run_id.into(),
                        tool_use_id: item_id,
                        output: changes.clone(),
                        is_error: false,
                    }];
                    for change in changes.as_array().cloned().unwrap_or_default() {
                        let Some(path) = change.get("path").and_then(|v| v.as_str()) else {
                            continue;
                        };
                        let kind = change.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                        let edit_type = if kind == "create" || kind == "delete" {
                            kind
                        } else {
                            "modify"
                        };
                        events.push(TurnEvent::FileEdit {
                            run_id: run_id.into(),
                            path: path.to_string(),
                            edit_type: edit_type.to_string(),
                        });
                    }
                    events
                }
                _ => Vec::new(),
            }
        }
        "turn.completed" => vec![TurnEvent::Usage {
            run_id: run_id.into(),
            usage: codex_usage(payload.get("usage")),
        }],
        "error" => vec![TurnEvent::Error {
            run_id: run_id.into(),
            message: payload
                .get("message")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| payload.to_string()),
        }],
        other if !other.is_empty() => vec![TurnEvent::UnknownPayload {
            run_id: run_id.into(),
            adapter: "codex".into(),
            payload_type: other.to_string(),
            raw: payload,
        }],
        _ => Vec::new(),
    }
}

fn parse_gemini_line(line: &str, run_id: &str) -> Vec<TurnEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let is_jsonish = trimmed.starts_with('{') || trimmed.starts_with('[');
    let payload = if is_jsonish {
        serde_json::from_str::<Value>(trimmed).ok()
    } else {
        None
    };
    let Some(payload) = payload else {
        // Plain text line from the CLI → assistant prose.
        return vec![TurnEvent::AssistantText {
            run_id: run_id.into(),
            delta: format!("{trimmed}\n"),
        }];
    };

    match payload.get("type").and_then(|v| v.as_str()).unwrap_or("") {
        "response.delta" => {
            let delta = payload.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if delta.is_empty() {
                Vec::new()
            } else {
                vec![TurnEvent::AssistantText {
                    run_id: run_id.into(),
                    delta: delta.to_string(),
                }]
            }
        }
        "response.completed" => Vec::new(),
        "usage" => vec![TurnEvent::Usage {
            run_id: run_id.into(),
            usage: TurnUsage {
                input_tokens: payload
                    .pointer("/usage/input_tokens")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0),
                output_tokens: payload
                    .pointer("/usage/output_tokens")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0),
                cached_input_tokens: payload
                    .pointer("/usage/cached_input_tokens")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0),
            },
        }],
        "error" => vec![TurnEvent::Error {
            run_id: run_id.into(),
            message: payload
                .get("message")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| payload.to_string()),
        }],
        other if !other.is_empty() => vec![TurnEvent::UnknownPayload {
            run_id: run_id.into(),
            adapter: "gemini-cli".into(),
            payload_type: other.to_string(),
            raw: payload,
        }],
        _ => Vec::new(),
    }
}

// ── Runner ───────────────────────────────────────────────────────────────

struct ActiveTurn {
    child: Child,
    timed_out: bool,
    canceled: bool,
}

/// Ends the turn's whole process tree. A provider launched through an alias
/// runs as a grandchild of the shell, and any process the CLI leaves behind
/// keeps stdout open: killing only the direct child left both running and the
/// run never reported its exit.
fn kill_turn_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        // SAFETY: the child leads its own process group (process_group(0) at
        // spawn) and has not been reaped yet, so the group id is still ours.
        unsafe { libc::killpg(child.id() as i32, libc::SIGKILL) };
    }
    #[cfg(windows)]
    {
        let _ = crate::commands::util_cmd::cmd("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

#[derive(Default)]
pub struct TurnRunner {
    active: Mutex<HashMap<String, Arc<Mutex<ActiveTurn>>>>,
}

static GLOBAL: std::sync::OnceLock<Arc<TurnRunner>> = std::sync::OnceLock::new();

pub fn set_global(runner: Arc<TurnRunner>) {
    let _ = GLOBAL.set(runner);
}

pub fn global_runner() -> Option<&'static Arc<TurnRunner>> {
    GLOBAL.get()
}

impl TurnRunner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self, run_id: &str) -> bool {
        self.active.lock().contains_key(run_id)
    }

    /// cancel — onExit will fire with canceled = true.
    pub fn cancel(&self, run_id: &str) {
        let turn = self.active.lock().get(run_id).cloned();
        if let Some(turn) = turn {
            let mut t = turn.lock();
            t.canceled = true;
            kill_turn_tree(&mut t.child);
        }
    }

    /// spawn — starts the headless turn. `on_event` receives the events as they
    /// arrive, `on_exit` exactly once on termination.
    /// Non-blocking: all the work runs on dedicated threads.
    pub fn spawn<E, X>(
        self: &Arc<Self>,
        opts: TurnSpawnOptions,
        on_event: E,
        on_exit: X,
    ) -> Result<String, String>
    where
        E: Fn(TurnEvent) + Send + 'static,
        X: FnOnce(TurnExitResult) + Send + 'static,
    {
        if self.is_running(&opts.run_id) {
            return Err(format!("Turn already running: {}", opts.run_id));
        }
        check_turn_supported(&opts)?;
        let built = build_turn_command(&opts);

        let mut cmd = if let Some(alias) = opts.env.get("PROMPTOPS_PROVIDER_COMMAND") {
            crate::commands::provider_account::validate_command_alias(alias)?;
            alias_turn_command(alias, &built.argv)
        } else {
            let mut cmd = crate::commands::util_cmd::cmd(resolve_turn_binary(&built.binary));
            cmd.args(&built.argv);
            cmd
        };
        // Own process group: cancel and timeout kill the CLI's whole tree.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        cmd.current_dir(&opts.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_turn_env(&mut cmd, &opts.env);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn error for {}: {e}", built.binary))?;

        // Prompt on stdin (Claude) — then close stdin anyway.
        if let Some(mut stdin) = child.stdin.take() {
            if built.prompt_via_stdin {
                let _ = stdin.write_all(opts.prompt.as_bytes());
            }
            drop(stdin);
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let turn = Arc::new(Mutex::new(ActiveTurn {
            child,
            timed_out: false,
            canceled: false,
        }));
        self.active.lock().insert(opts.run_id.clone(), turn.clone());

        // Concurrent stderr drain (capped): a verbose process must not
        // block on a full pipe; we keep the tail (the useful error is there).
        let stderr_buf = Arc::new(Mutex::new(String::new()));
        if let Some(stderr) = stderr {
            let buf = stderr_buf.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    let mut b = buf.lock();
                    b.push_str(&line);
                    b.push('\n');
                    if b.len() > STDERR_CAP_BYTES {
                        let cut = b.len() - STDERR_CAP_BYTES;
                        *b = b[cut..].to_string();
                    }
                }
            });
        }

        // Watchdog timeout.
        {
            let turn = turn.clone();
            let timeout = opts.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
            let runner = self.clone();
            let run_id = opts.run_id.clone();
            std::thread::spawn(move || {
                let deadline =
                    std::time::Instant::now() + std::time::Duration::from_millis(timeout);
                while std::time::Instant::now() < deadline {
                    if !runner.is_running(&run_id) {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                if runner.is_running(&run_id) {
                    let mut t = turn.lock();
                    t.timed_out = true;
                    kill_turn_tree(&mut t.child);
                }
            });
        }

        // Line-by-line stdout read loop + wait for exit.
        let provider = opts.provider.clone();
        let run_id = opts.run_id.clone();
        let runner = self.clone();
        std::thread::spawn(move || {
            if let Some(stdout) = stdout {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    for event in parse_turn_line(&provider, &line, &run_id) {
                        on_event(event);
                    }
                }
            }
            // Poll instead of a blocking wait() under the lock: cancel and the
            // watchdog need that lock to kill a child that closed stdout but
            // keeps running.
            let exit_code = loop {
                match turn.lock().child.try_wait() {
                    Ok(Some(status)) => break status.code(),
                    Ok(None) => {}
                    Err(_) => break None,
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            };
            runner.active.lock().remove(&run_id);
            let (timed_out, canceled) = {
                let t = turn.lock();
                (t.timed_out, t.canceled)
            };
            on_exit(TurnExitResult {
                exit_code,
                stderr: stderr_buf.lock().trim().to_string(),
                timed_out,
                canceled,
            });
        });

        Ok(opts.run_id)
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn existing_alias_loads_shell_profile_and_preserves_arguments() {
        let dir = std::env::temp_dir().join(format!("promptops-alias-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".zshrc"),
            "alias provider-work='printf \"%s\\n\"'\n",
        )
        .unwrap();
        let args = vec!["--resume".into(), "a b'c\\d$(echo BAD)`echo BAD`".into()];
        let output = super::alias_unix_command("provider-work", &args, "/bin/zsh")
            .env("ZDOTDIR", &dir)
            .env("HOME", &dir)
            .output()
            .unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            format!("{}\n", args.join("\n"))
        );
    }

    #[test]
    fn managed_account_turn_removes_inherited_auth_only_for_managed_claude() {
        use crate::commands::provider_account::{account_env_vars, CLAUDE_AUTH_OVERRIDES};
        for managed in [false, true] {
            let mut cmd = std::process::Command::new("unused-test-command");
            for key in CLAUDE_AUTH_OVERRIDES {
                cmd.env(key, "fake-personal-secret");
            }
            let extra = if managed {
                account_env_vars(Some("CLAUDE_CONFIG_DIR"), "/accounts/work", "work")
                    .into_iter()
                    .collect()
            } else {
                std::collections::HashMap::new()
            };
            super::apply_turn_env(&mut cmd, &extra);
            for key in CLAUDE_AUTH_OVERRIDES {
                let value = cmd
                    .get_envs()
                    .find(|(k, _)| *k == std::ffi::OsStr::new(key))
                    .unwrap()
                    .1;
                assert_eq!(value.is_none(), managed);
            }
        }
    }

    use super::*;

    fn opts(provider: &str) -> TurnSpawnOptions {
        TurnSpawnOptions {
            run_id: "r1".into(),
            provider: provider.into(),
            cwd: "/tmp/ws".into(),
            prompt: "do it".into(),
            ..Default::default()
        }
    }

    /// A CLI that closes nothing and leaves a background child holding stdout:
    /// cancel must still end the whole tree and report the exit.
    #[cfg(unix)]
    #[test]
    fn cancel_ends_the_whole_tree_and_reports_the_exit() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("po-turn-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("fake-cli");
        let pidfile = dir.join("bg.pid");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\n(sleep 60; echo late) &\necho $! > '{}'\nsleep 60\n",
                pidfile.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let runner = Arc::new(TurnRunner::new());
        let (tx, rx) = std::sync::mpsc::channel();
        let mut o = opts("claude-code-cli");
        o.cwd = dir.display().to_string();
        o.binary = Some(script.display().to_string());
        runner
            .spawn(o, |_| {}, move |exit| tx.send(exit).unwrap())
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !pidfile.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        let bg: i32 = std::fs::read_to_string(&pidfile)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        runner.cancel("r1");
        let exit = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("on_exit after cancel");
        assert!(exit.canceled);
        assert!(!runner.is_running("r1"));
        std::thread::sleep(std::time::Duration::from_millis(200));
        // SAFETY: signal 0 only checks whether the pid still exists.
        let alive = unsafe { libc::kill(bg, 0) } == 0;
        assert!(!alive, "the background child must not survive the cancel");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_resume_precedes_p_flag() {
        let mut o = opts("claude-code-cli");
        o.resume_session_id = Some("sess-9".into());
        let built = build_turn_command(&o);
        let resume_at = built.argv.iter().position(|a| a == "--resume").unwrap();
        let p_at = built.argv.iter().position(|a| a == "-p").unwrap();
        assert!(
            resume_at < p_at,
            "--resume must precede -p: {:?}",
            built.argv
        );
        assert!(built.prompt_via_stdin);
    }

    #[test]
    fn codex_resume_omits_cd_and_dash_s() {
        let mut o = opts("codex");
        o.resume_session_id = Some("thread-1".into());
        let built = build_turn_command(&o);
        assert!(built.argv.contains(&"resume".to_string()));
        assert!(!built.argv.contains(&"--cd".to_string()));
        assert!(!built.argv.iter().any(|a| a == "-s"));
        assert!(built
            .argv
            .contains(&"sandbox_mode=\"workspace-write\"".to_string()));
    }

    #[test]
    fn anthropic_assistant_yields_text_tool_and_file_edit() {
        let line = r#"{"type":"assistant","message":{"content":[
            {"type":"text","text":"hello"},
            {"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"/a/b.rs"}}]}}"#;
        let events = parse_anthropic_line(line, "r1", "claude-code-cli");
        assert_eq!(events.len(), 3);
        assert!(matches!(&events[0], TurnEvent::AssistantText { delta, .. } if delta == "hello"));
        assert!(
            matches!(&events[1], TurnEvent::ToolCallStart { tool_name, .. } if tool_name == "Write")
        );
        assert!(
            matches!(&events[2], TurnEvent::FileEdit { path, edit_type, .. }
                if path == "/a/b.rs" && edit_type == "create")
        );
    }

    #[test]
    fn anthropic_result_maps_usage_and_done() {
        let line = r#"{"type":"result","subtype":"success","usage":
            {"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":3}}"#;
        let events = parse_anthropic_line(line, "r1", "claude-code-cli");
        assert!(matches!(&events[0], TurnEvent::Usage { usage, .. }
            if usage.input_tokens == 10 && usage.output_tokens == 5 && usage.cached_input_tokens == 3));
        assert!(matches!(events[1], TurnEvent::Done { .. }));
    }

    #[test]
    fn anthropic_system_init_captures_session_id() {
        let line = r#"{"type":"system","subtype":"init","session_id":"abc"}"#;
        let events = parse_anthropic_line(line, "r1", "claude-code-cli");
        assert!(
            matches!(&events[0], TurnEvent::ProviderSessionInit { provider_session_id, .. }
            if provider_session_id == "abc")
        );
    }

    #[test]
    fn codex_counts_reasoning_tokens_as_output() {
        let line = r#"{"type":"turn.completed","usage":
            {"input_tokens":100,"output_tokens":20,"reasoning_output_tokens":30}}"#;
        let events = parse_codex_line(line, "r1");
        assert!(matches!(&events[0], TurnEvent::Usage { usage, .. } if usage.output_tokens == 50));
    }

    #[test]
    fn codex_apply_patch_yields_file_edits() {
        let line = r#"{"type":"item.completed","item":{"id":"i1","type":"apply_patch",
            "changes":[{"path":"/x.rs","kind":"create"},{"path":"/y.rs"}]}}"#;
        let events = parse_codex_line(line, "r1");
        assert_eq!(events.len(), 3);
        assert!(
            matches!(&events[1], TurnEvent::FileEdit { edit_type, .. } if edit_type == "create")
        );
        assert!(
            matches!(&events[2], TurnEvent::FileEdit { edit_type, .. } if edit_type == "modify")
        );
    }

    #[test]
    fn gemini_passes_plain_text_through() {
        let events = parse_gemini_line("plain text", "r1");
        assert!(
            matches!(&events[0], TurnEvent::AssistantText { delta, .. } if delta == "plain text\n")
        );
    }

    #[test]
    fn unknown_payload_is_surfaced() {
        let events = parse_anthropic_line(r#"{"type":"mystery"}"#, "r1", "cursor");
        assert!(
            matches!(&events[0], TurnEvent::UnknownPayload { payload_type, adapter, .. }
            if payload_type == "mystery" && adapter == "cursor")
        );
    }

    #[test]
    fn plan_turns_are_read_only_for_every_provider() {
        let mut g = opts("gemini-cli");
        g.permission_mode = Some("plan".into());
        let argv = build_turn_command(&g).argv;
        let at = argv.iter().position(|a| a == "--approval-mode").unwrap();
        assert_eq!(argv[at + 1], "plan");
        // Without plan, gemini keeps its default approval mode.
        assert!(!build_turn_command(&opts("gemini-cli"))
            .argv
            .contains(&"--approval-mode".to_string()));

        let mut c = opts("cursor");
        c.permission_mode = Some("plan".into());
        assert!(check_turn_supported(&c).is_err());
        let runner = Arc::new(TurnRunner::new());
        assert!(runner.spawn(c, |_| {}, |_| {}).is_err());

        let mut x = opts("codex");
        x.permission_mode = Some("plan".into());
        let argv = build_turn_command(&x).argv;
        let at = argv.iter().position(|a| a == "-s").unwrap();
        assert_eq!(argv[at + 1], "read-only");
    }

    /// Writing worker without auto-approve ("acceptEdits") vs with it
    /// ("bypassPermissions"), provider by provider.
    #[test]
    fn only_auto_approve_turns_bypass_permissions() {
        let with = |provider: &str, mode: &str| {
            let mut o = opts(provider);
            o.permission_mode = Some(mode.into());
            o
        };
        let has = |argv: &[String], flag: &str| argv.iter().any(|a| a == flag);
        let after = |argv: &[String], flag: &str| {
            let at = argv.iter().position(|a| a == flag).unwrap();
            argv[at + 1].clone()
        };

        // Claude: accept-edits, never the bypass mode.
        let argv = build_turn_command(&with("claude-code-cli", "acceptEdits")).argv;
        assert_eq!(after(&argv, "--permission-mode"), "acceptEdits");
        assert!(!argv
            .iter()
            .any(|a| a.contains("bypass") || a.contains("dangerously")));
        let argv = build_turn_command(&with("claude-code-cli", "bypassPermissions")).argv;
        assert_eq!(after(&argv, "--permission-mode"), "bypassPermissions");
        // No mode: the CLI's own default, no flag ("default" is not a value
        // every Claude Code version accepts).
        assert!(!has(
            &build_turn_command(&opts("claude-code-cli")).argv,
            "--permission-mode"
        ));

        // Codex: workspace-write sandbox unless auto-approve.
        let argv = build_turn_command(&with("codex", "acceptEdits")).argv;
        assert_eq!(after(&argv, "-s"), "workspace-write");
        assert!(!has(&argv, "--dangerously-bypass-approvals-and-sandbox"));
        let argv = build_turn_command(&with("codex", "bypassPermissions")).argv;
        assert!(has(&argv, "--dangerously-bypass-approvals-and-sandbox"));
        let mut resumed = with("codex", "acceptEdits");
        resumed.resume_session_id = Some("t1".into());
        let argv = build_turn_command(&resumed).argv;
        assert!(argv.contains(&"sandbox_mode=\"workspace-write\"".to_string()));
        assert!(!has(&argv, "--dangerously-bypass-approvals-and-sandbox"));

        // Gemini: auto_edit vs yolo.
        let argv = build_turn_command(&with("gemini-cli", "acceptEdits")).argv;
        assert_eq!(after(&argv, "--approval-mode"), "auto_edit");
        assert!(!has(&argv, "--yolo") && !has(&argv, "-y"));
        let argv = build_turn_command(&with("gemini-cli", "bypassPermissions")).argv;
        assert_eq!(after(&argv, "--approval-mode"), "yolo");

        // Cursor: its headless mode (--force) approves everything, so it
        // runs only in auto-approve and says how to enable it otherwise.
        let err = check_turn_supported(&with("cursor", "acceptEdits")).unwrap_err();
        assert!(err.contains("Auto Approve"), "{err}");
        assert!(check_turn_supported(&opts("cursor")).is_err());
        assert!(check_turn_supported(&with("cursor", "bypassPermissions")).is_ok());
        let runner = Arc::new(TurnRunner::new());
        assert!(runner
            .spawn(with("cursor", "acceptEdits"), |_| {}, |_| {})
            .is_err());
    }

    #[test]
    fn codex_effort_is_never_pasted_into_toml_unchecked() {
        let mut o = opts("codex");
        o.effort = Some("high\"\nsandbox_mode=\"danger-full-access".into());
        let argv = build_turn_command(&o).argv;
        assert!(
            !argv.iter().any(|a| a.contains("danger-full-access")),
            "{argv:?}"
        );
        o.effort = Some("xhigh".into());
        let argv = build_turn_command(&o).argv;
        assert!(argv.contains(&"model_reasoning_effort=\"xhigh\"".to_string()));
    }

    /// Windows alias launch: PowerShell sees only `$env:` references, the
    /// prompt (with every quote PowerShell honors) stays in the environment.
    #[test]
    fn powershell_alias_keeps_arguments_out_of_the_script() {
        let prompt =
            "x' ; calc ; '\u{2018}; calc; \u{2019}\u{201A}\u{201B} \"$(calc)\" `calc`".to_string();
        let argv = vec!["-p".to_string(), prompt.clone()];
        let cmd = alias_powershell_command("codex-work", &argv);
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(args.contains(&"Bypass".to_string()));
        let script = args.last().unwrap();
        assert!(script.ends_with("& codex-work $env:PO_TURN_ARG_0 $env:PO_TURN_ARG_1"));
        assert!(!script.contains("calc"), "{script}");
        let envs: Vec<(String, String)> = cmd
            .get_envs()
            .filter_map(|(k, v)| {
                Some((
                    k.to_string_lossy().into_owned(),
                    v?.to_string_lossy().into_owned(),
                ))
            })
            .collect();
        assert!(envs.contains(&("PO_TURN_ARG_1".to_string(), prompt)));
    }

    #[test]
    fn bare_binary_names_stay_as_given_off_windows() {
        if !cfg!(windows) {
            assert_eq!(
                resolve_turn_binary("claude"),
                std::ffi::OsString::from("claude")
            );
        }
        assert_eq!(
            resolve_turn_binary("/opt/x/claude"),
            std::ffi::OsString::from("/opt/x/claude")
        );
    }
}
