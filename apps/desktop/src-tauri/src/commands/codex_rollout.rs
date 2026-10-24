//! codex_rollout — Codex quota/rate-limit usage.
//!
//! Reads Codex quota/rate limits directly from the rollouts the CLI writes in
//! `<CODEX_HOME>/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<id>.jsonl`. Every turn
//! appends an `event_msg` line with a `token_count` payload that carries
//! `rate_limits.{primary,secondary}` (used_percent / window_minutes /
//! resets_at): the same numbers the TUI shows on `/status`, without a PTY.
//! Since codex-cli 0.153 `/status` replies "Limits: refresh requested; run
//! /status again shortly" → the TUI probe timed out and the Usage panel
//! stayed empty for GPT sessions.
//!
//! Pure module (fs + serde_json), testable without Tauri.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use chrono::{Datelike, Local, TimeZone, Timelike};
use serde_json::Value;

pub const DEFAULT_MAX_FILES: usize = 20;
pub const DEFAULT_MAX_DAYS: usize = 30;
pub const DEFAULT_TAIL_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RateLimitWindow {
    pub used_percent: Option<f64>,
    pub window_minutes: Option<i64>,
    /// Epoch seconds in current CLIs; a value > 1e12 is treated as ms.
    pub resets_at: Option<f64>,
}

#[derive(Clone, Debug, Default)]
pub struct IndividualRateLimit {
    pub limit_id: Option<String>,
    pub limit_name: Option<String>,
    pub primary: Option<RateLimitWindow>,
    pub secondary: Option<RateLimitWindow>,
}

#[derive(Clone, Debug, Default)]
pub struct CodexRolloutUsage {
    /// Last `turn_context.payload.model` seen in the tail of the file.
    pub model: Option<String>,
    pub primary: Option<RateLimitWindow>,
    pub secondary: Option<RateLimitWindow>,
    pub individual_limit: Option<IndividualRateLimit>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexSection {
    pub label: String,
    pub percent_used: i64,
    pub resets_label: String,
}

/// `<CODEX_HOME>/sessions`, with CODEX_HOME from the env if not empty.
pub fn resolve_sessions_root(home_dir: &str) -> PathBuf {
    let codex_home = std::env::var("CODEX_HOME")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(home_dir).join(".codex"));
    codex_home.join("sessions")
}

/// Last `tail_bytes` of the file split into complete lines (the first partial
/// line is dropped when the window starts mid-file).
pub fn read_tail_lines(path: &Path, tail_bytes: u64) -> std::io::Result<Vec<String>> {
    let mut f = fs::File::open(path)?;
    let size = f.metadata()?.len();
    let offset = size.saturating_sub(tail_bytes);
    let len = (size - offset) as usize;
    if len == 0 {
        return Ok(Vec::new());
    }
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0u8; len];
    f.read_exact(&mut buf)?;
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<String> = text
        .split('\n')
        .map(|l| l.trim_end_matches('\r').to_string())
        .collect();
    if offset > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    Ok(lines.into_iter().filter(|l| !l.trim().is_empty()).collect())
}

fn parse_window(v: &Value) -> Option<RateLimitWindow> {
    let obj = v.as_object()?;
    Some(RateLimitWindow {
        used_percent: obj.get("used_percent").and_then(Value::as_f64),
        window_minutes: obj.get("window_minutes").and_then(Value::as_i64),
        resets_at: obj.get("resets_at").and_then(Value::as_f64),
    })
}

fn parse_individual_limit(v: &Value) -> Option<IndividualRateLimit> {
    let obj = v.as_object()?;
    let direct_window = (obj.contains_key("used_percent")
        || obj.contains_key("window_minutes")
        || obj.contains_key("resets_at"))
    .then(|| parse_window(v))
    .flatten();
    Some(IndividualRateLimit {
        limit_id: obj
            .get("limit_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        limit_name: obj
            .get("limit_name")
            .and_then(Value::as_str)
            .map(str::to_string),
        primary: obj.get("primary").and_then(parse_window).or(direct_window),
        secondary: obj.get("secondary").and_then(parse_window),
    })
}

/// Walks the lines in reverse and takes the LAST rate_limits and the last
/// `turn_context` model (they can be on different lines). Without
/// rate_limits there is nothing to draw → None.
pub fn extract_usage_from_lines(lines: &[String]) -> Option<CodexRolloutUsage> {
    let mut rate_limits: Option<&Value> = None;
    let mut parsed: Vec<Value> = Vec::new();
    let mut model: Option<String> = None;

    // Lazy reverse parse: malformed lines (half-written) are skipped.
    for raw in lines.iter().rev() {
        let Ok(line) = serde_json::from_str::<Value>(raw) else {
            continue;
        };
        let Some(payload) = line.get("payload").filter(|p| p.is_object()) else {
            continue;
        };
        let kind = line.get("type").and_then(Value::as_str).unwrap_or("");
        let ptype = payload.get("type").and_then(Value::as_str).unwrap_or("");
        if kind == "event_msg" && ptype == "token_count" {
            if rate_limits.is_none()
                && payload
                    .get("rate_limits")
                    .map(|r| r.is_object())
                    .unwrap_or(false)
            {
                parsed.push(line.clone());
                rate_limits = parsed
                    .last()
                    .and_then(|l| l.get("payload"))
                    .and_then(|p| p.get("rate_limits"));
            }
        } else if kind == "turn_context" && model.is_none() {
            model = payload
                .get("model")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        if rate_limits.is_some() && model.is_some() {
            break;
        }
    }

    let rl = rate_limits?;
    Some(CodexRolloutUsage {
        model,
        primary: rl.get("primary").and_then(parse_window),
        secondary: rl.get("secondary").and_then(parse_window),
        individual_limit: rl.get("individual_limit").and_then(parse_individual_limit),
    })
}

fn list_dirs_desc(dir: &Path, digits: usize) -> Vec<String> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.len() == digits && n.chars().all(|c| c.is_ascii_digit()))
        .collect();
    names.sort();
    names.reverse();
    names
}

/// The most recent rollout that carries rate_limits. The layout sorts
/// chronologically by NAME, so it is enumerated in descending order without
/// stat-ing the tree; files without token_count (`codex exec`) are skipped.
pub fn read_latest_codex_usage(
    root: &Path,
    max_files: usize,
    max_days: usize,
    tail_bytes: u64,
) -> Option<CodexRolloutUsage> {
    if !root.is_dir() {
        return None;
    }
    let mut files_tried = 0usize;
    let mut days_visited = 0usize;
    for year in list_dirs_desc(root, 4) {
        for month in list_dirs_desc(&root.join(&year), 2) {
            for day in list_dirs_desc(&root.join(&year).join(&month), 2) {
                if days_visited >= max_days {
                    return None;
                }
                days_visited += 1;
                let day_dir = root.join(&year).join(&month).join(&day);
                let Ok(rd) = fs::read_dir(&day_dir) else {
                    continue;
                };
                let mut files: Vec<String> = rd
                    .filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| n.ends_with(".jsonl"))
                    .collect();
                files.sort();
                files.reverse();
                for file in files {
                    if files_tried >= max_files {
                        return None;
                    }
                    files_tried += 1;
                    let path = day_dir.join(&file);
                    if let Ok(lines) = read_tail_lines(&path, tail_bytes) {
                        if let Some(usage) = extract_usage_from_lines(&lines) {
                            return Some(usage);
                        }
                    }
                }
            }
        }
    }
    None
}

// ── UI sections ──────────────────────────────────────────────────

const MONTH_SHORT: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// resets_at normalized to epoch ms (the CLI writes seconds).
fn resets_at_ms(resets_at: f64) -> i64 {
    if resets_at > 1e12 {
        resets_at as i64
    } else {
        (resets_at * 1000.0) as i64
    }
}

/// "today at 14:30" / "tomorrow at 14:30" / "Jul 23 at 14:30" (ora locale).
pub fn format_resets_label(resets_at: f64, now_ms: i64) -> String {
    let Some(target) = Local.timestamp_millis_opt(resets_at_ms(resets_at)).single() else {
        return String::new();
    };
    let Some(now) = Local.timestamp_millis_opt(now_ms).single() else {
        return String::new();
    };
    let Some(tomorrow) = Local.timestamp_millis_opt(now_ms + 86_400_000).single() else {
        return String::new();
    };
    let hhmm = format!("{:02}:{:02}", target.hour(), target.minute());
    let key = |d: &chrono::DateTime<Local>| (d.year(), d.month(), d.day());
    if key(&target) == key(&now) {
        return format!("today at {hhmm}");
    }
    if key(&target) == key(&tomorrow) {
        return format!("tomorrow at {hhmm}");
    }
    format!(
        "{} {} at {hhmm}",
        MONTH_SHORT[(target.month0()) as usize],
        target.day()
    )
}

/// Window label, same wording as the Codex TUI.
pub fn window_label(window_minutes: Option<i64>, position: usize) -> String {
    match window_minutes {
        None | Some(i64::MIN..=0) => {
            if position == 0 {
                "Session limit".into()
            } else {
                "Weekly limit".into()
            }
        }
        Some(300) => "5h limit".into(),
        Some(10080) => "Weekly limit".into(),
        Some(m) if m % 10080 == 0 => format!("{}w limit", m / 10080),
        Some(m) if m % 1440 == 0 => format!("{}d limit", m / 1440),
        Some(m) if m % 60 == 0 => format!("{}h limit", m / 60),
        Some(m) => format!("{m}m limit"),
    }
}

/// primary → sections[0] (sessionPercent), secondary → sections[1]
/// (weeklyPercent). Staleness: rollouts are "as of the last Codex turn"; if
/// resets_at has already passed the window has reset → 0% with no label. It
/// self-heals on the next turn, which appends a fresh token_count.
pub fn build_codex_sections(usage: &CodexRolloutUsage, now_ms: i64) -> Vec<CodexSection> {
    let astra_limit = usage.individual_limit.as_ref().filter(|limit| {
        limit
            .limit_name
            .as_deref()
            .or(limit.limit_id.as_deref())
            .map(|name| name.to_ascii_lowercase().contains("astra"))
            .unwrap_or_else(|| {
                usage
                    .model
                    .as_deref()
                    .map(|model| model.eq_ignore_ascii_case("gpt-6-astra"))
                    .unwrap_or(false)
            })
    });
    let windows = astra_limit
        .map(|limit| [limit.primary.as_ref(), limit.secondary.as_ref()])
        .unwrap_or([usage.primary.as_ref(), usage.secondary.as_ref()]);
    let mut sections = Vec::new();
    for (position, win) in windows.into_iter().enumerate() {
        let Some(win) = win else { continue };
        let Some(pct) = win.used_percent.filter(|p| p.is_finite()) else {
            continue;
        };
        let mut percent_used = pct.round().clamp(0.0, 100.0) as i64;
        let mut resets_label = String::new();
        if let Some(resets_at) = win.resets_at.filter(|r| r.is_finite()) {
            if resets_at_ms(resets_at) <= now_ms {
                percent_used = 0;
            } else {
                resets_label = format_resets_label(resets_at, now_ms);
            }
        }
        let label = window_label(win.window_minutes, position);
        let label = if astra_limit.is_some() {
            format!("Astra · {label}")
        } else {
            label
        };
        sections.push(CodexSection {
            label,
            percent_used,
            resets_label,
        });
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real line (rollout 2026-08-30), envelope {timestamp,type,payload}.
    const REAL_LINE: &str = r#"{"timestamp":"2026-08-29T23:48:59.795Z","ordinal":12,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":17098,"cached_input_tokens":11008,"output_tokens":13,"total_tokens":17111},"last_token_usage":{"input_tokens":17098,"output_tokens":13,"total_tokens":17111},"model_context_window":258400},"rate_limits":{"limit_id":"codex","primary":{"used_percent":12.4,"window_minutes":300,"resets_at":1788065338},"secondary":{"used_percent":37.0,"window_minutes":10080,"resets_at":1788652138},"plan_type":"plus"}}}"#;

    fn lines(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn extracts_latest_rate_limits_model_and_skips_garbage() {
        let l = lines(&[
            r#"{"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}"#,
            r#"{"type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":1.0,"window_minutes":300}}}}"#,
            REAL_LINE,
            "{not json",
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":5}},"rate_limits":null}}"#,
        ]);
        let u = extract_usage_from_lines(&l).expect("usage");
        assert_eq!(u.model.as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(u.primary.as_ref().unwrap().used_percent, Some(12.4));
        assert_eq!(u.secondary.as_ref().unwrap().window_minutes, Some(10080));
    }

    #[test]
    fn no_rate_limits_means_none() {
        let l = lines(&[
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":5}}}}"#,
        ]);
        assert!(extract_usage_from_lines(&l).is_none());
    }

    #[test]
    fn sections_follow_primary_secondary_and_stale_windows_reset() {
        let u = extract_usage_from_lines(&lines(&[REAL_LINE])).unwrap();
        // Before the reset: percentages intact + label.
        let before = 1788065338_i64 * 1000 - 3_600_000;
        let s = build_codex_sections(&u, before);
        assert_eq!(s.len(), 2);
        assert_eq!((s[0].label.as_str(), s[0].percent_used), ("5h limit", 12));
        assert_eq!(
            (s[1].label.as_str(), s[1].percent_used),
            ("Weekly limit", 37)
        );
        assert!(!s[0].resets_label.is_empty());
        // After the reset of the primary but not of the secondary.
        let between = 1788065338_i64 * 1000 + 60_000;
        let s = build_codex_sections(&u, between);
        assert_eq!(s[0].percent_used, 0);
        assert!(s[0].resets_label.is_empty());
        assert_eq!(s[1].percent_used, 37);
    }

    #[test]
    fn astra_individual_limit_replaces_generic_sections() {
        let input = r#"{"type":"turn_context","payload":{"model":"gpt-6-astra"}}
{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":70,"window_minutes":300},"secondary":{"used_percent":40,"window_minutes":10080},"individual_limit":{"limit_id":"gpt-6-astra","limit_name":"GPT-6 Astra","primary":{"used_percent":12,"window_minutes":10080}}}}}"#;
        let l: Vec<String> = input.lines().map(str::to_string).collect();
        let usage = extract_usage_from_lines(&l).expect("usage");
        let sections = build_codex_sections(&usage, 0);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].label, "Astra · Weekly limit");
        assert_eq!(sections[0].percent_used, 12);
    }

    #[test]
    fn astra_direct_individual_window_is_supported() {
        let input = r#"{"type":"turn_context","payload":{"model":"gpt-6-astra"}}
{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":70,"window_minutes":300},"individual_limit":{"used_percent":9,"window_minutes":10080}}}}"#;
        let l: Vec<String> = input.lines().map(str::to_string).collect();
        let usage = extract_usage_from_lines(&l).expect("usage");
        let sections = build_codex_sections(&usage, 0);
        assert_eq!(
            (sections[0].label.as_str(), sections[0].percent_used),
            ("Astra · Weekly limit", 9)
        );
    }

    #[test]
    fn window_labels() {
        assert_eq!(window_label(Some(300), 0), "5h limit");
        assert_eq!(window_label(Some(10080), 1), "Weekly limit");
        assert_eq!(window_label(Some(20160), 1), "2w limit");
        assert_eq!(window_label(Some(2880), 1), "2d limit");
        assert_eq!(window_label(Some(120), 0), "2h limit");
        assert_eq!(window_label(Some(45), 0), "45m limit");
        assert_eq!(window_label(None, 0), "Session limit");
        assert_eq!(window_label(Some(0), 1), "Weekly limit");
    }

    #[test]
    fn read_latest_walks_tree_desc_and_skips_files_without_limits() {
        let root = std::env::temp_dir().join(format!("codex-rollout-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let old = root.join("2026/08/30");
        let new = root.join("2026/09/05");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(
            old.join("rollout-2026-08-30T01-00-00-a.jsonl"),
            format!("{REAL_LINE}\n"),
        )
        .unwrap();
        // Newer file but without token_count (codex exec) → skipped.
        fs::write(
            new.join("rollout-2026-09-05T16-00-00-b.jsonl"),
            "{\"type\":\"session_meta\",\"payload\":{}}\n",
        )
        .unwrap();
        let u = read_latest_codex_usage(
            &root,
            DEFAULT_MAX_FILES,
            DEFAULT_MAX_DAYS,
            DEFAULT_TAIL_BYTES,
        )
        .expect("usage");
        // Only the older file carries rate_limits: its values prove it was picked.
        assert_eq!(u.primary.as_ref().unwrap().used_percent, Some(12.4));
        assert!(read_latest_codex_usage(&root.join("missing"), 5, 5, 1024).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn tail_read_drops_partial_first_line() {
        let p = std::env::temp_dir().join(format!("codex-tail-{}.jsonl", std::process::id()));
        fs::write(&p, "first-line-long\nsecond\nthird\n").unwrap();
        let l = read_tail_lines(&p, 20).unwrap(); // window starts inside "first-line-long" ("e-long\n…")
        assert_eq!(l, vec!["second".to_string(), "third".to_string()]);
        let all = read_tail_lines(&p, 1024).unwrap();
        assert_eq!(all.len(), 3);
        let _ = fs::remove_file(&p);
    }

    /// LIVE read of the real ~/.codex: `cargo test --lib live_codex_rollout -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_codex_rollout() {
        let home = std::env::var("HOME").unwrap_or_default();
        let root = resolve_sessions_root(&home);
        match read_latest_codex_usage(
            &root,
            DEFAULT_MAX_FILES,
            DEFAULT_MAX_DAYS,
            DEFAULT_TAIL_BYTES,
        ) {
            Some(u) => {
                let now = chrono::Utc::now().timestamp_millis();
                eprintln!(
                    "LIVE ROLLOUT model={:?}\n  {:?}",
                    u.model,
                    build_codex_sections(&u, now)
                );
            }
            None => eprintln!("LIVE ROLLOUT: no rollout with rate_limits under {root:?}"),
        }
    }
}
