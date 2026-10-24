//! Per-provider TUI-injection profiles (measured with a PTY
//! probe on 2026-06-12 + burst/minBoot hardening of the Claude profile).
//!
//! Three guards the old "quiet buffer" heuristic did not have:
//!   min_boot_ms      — floor: boot silence is never "ready".
//!   burst_bytes      — a single growth this large proves that a TUI frame
//!                      has rendered (shell prompt/echo grow in small
//!                      steps).
//!   fallback_ready_ms — for TUIs that animate forever (copilot, grok,
//!                      hermes): ready after the burst + this time even if
//!                      the buffer never goes quiet.

pub struct TuiInjectionProfile {
    pub min_boot_ms: u128,
    pub min_bytes: usize,
    pub quiet_ms: u128,
    pub max_wait_ms: u128,
    pub burst_bytes: usize,
    pub fallback_ready_ms: u128,
    pub enter_delay_ms: u64,
    pub submit_retry: bool,
}

/// Claude Code (also used by zai/kimi, which spawn the same CLI).
const CLAUDE_PROFILE: TuiInjectionProfile = TuiInjectionProfile {
    min_boot_ms: 500,
    min_bytes: 60,
    quiet_ms: 600,
    max_wait_ms: 20_000,
    burst_bytes: 600,
    fallback_ready_ms: 0,
    enter_delay_ms: 500,
    submit_retry: false,
};

/// Conservative default for unknown/unmeasured providers.
const GENERIC_PROFILE: TuiInjectionProfile = TuiInjectionProfile {
    min_boot_ms: 2_500,
    min_bytes: 800,
    quiet_ms: 800,
    max_wait_ms: 25_000,
    burst_bytes: 600,
    fallback_ready_ms: 8_000,
    enter_delay_ms: 700,
    submit_retry: false,
};

pub fn injection_profile(provider: &str) -> &'static TuiInjectionProfile {
    match provider {
        "claude-code-cli" | "zai" | "kimi" => &CLAUDE_PROFILE,
        "gemini-cli" => &TuiInjectionProfile {
            min_boot_ms: 4_000,
            min_bytes: 1_000,
            quiet_ms: 1_000,
            max_wait_ms: 30_000,
            burst_bytes: 600,
            fallback_ready_ms: 0,
            enter_delay_ms: 800,
            submit_retry: true,
        },
        "antigravity" => &TuiInjectionProfile {
            min_boot_ms: 2_500,
            min_bytes: 800,
            quiet_ms: 800,
            max_wait_ms: 25_000,
            burst_bytes: 600,
            fallback_ready_ms: 0,
            enter_delay_ms: 800,
            submit_retry: true,
        },
        "codex" => &TuiInjectionProfile {
            min_boot_ms: 1_000,
            min_bytes: 800,
            quiet_ms: 600,
            max_wait_ms: 20_000,
            burst_bytes: 600,
            fallback_ready_ms: 0,
            enter_delay_ms: 600,
            submit_retry: false,
        },
        "copilot" => &TuiInjectionProfile {
            min_boot_ms: 3_000,
            min_bytes: 1_500,
            quiet_ms: 800,
            max_wait_ms: 20_000,
            burst_bytes: 600,
            fallback_ready_ms: 6_000,
            enter_delay_ms: 700,
            submit_retry: false,
        },
        "grok" | "hermes" | "muse" => &TuiInjectionProfile {
            min_boot_ms: 2_500,
            min_bytes: 1_500,
            quiet_ms: 800,
            max_wait_ms: 20_000,
            burst_bytes: 600,
            fallback_ready_ms: 6_000,
            enter_delay_ms: 600,
            submit_retry: false,
        },
        "opencode" => &TuiInjectionProfile {
            min_boot_ms: 2_800,
            min_bytes: 1_500,
            quiet_ms: 800,
            max_wait_ms: 20_000,
            burst_bytes: 600,
            fallback_ready_ms: 7_000,
            enter_delay_ms: 600,
            submit_retry: false,
        },
        _ => &GENERIC_PROFILE,
    }
}

/// Outcome of one tracker sample.
pub enum TuiReadiness {
    NotReady,
    Ready(&'static str), // 'quiet' | 'fallback'
}

/// Incremental detector (pure state machine):
/// fed with (elapsed_ms, buffer_len) by the poll loop.
pub struct TuiReadinessTracker {
    profile: &'static TuiInjectionProfile,
    last_len: isize,
    last_change_at_ms: u128,
    burst_seen: bool,
}

impl TuiReadinessTracker {
    pub fn new(profile: &'static TuiInjectionProfile) -> Self {
        Self {
            profile,
            last_len: -1,
            last_change_at_ms: 0,
            burst_seen: profile.burst_bytes == 0,
        }
    }

    pub fn sample(&mut self, elapsed_ms: u128, buffer_len: usize) -> TuiReadiness {
        let len = buffer_len as isize;
        if len != self.last_len {
            let delta = len - self.last_len.max(0);
            if self.profile.burst_bytes > 0 && delta >= self.profile.burst_bytes as isize {
                self.burst_seen = true;
            }
            self.last_len = len;
            self.last_change_at_ms = elapsed_ms;
        }

        if elapsed_ms < self.profile.min_boot_ms {
            return TuiReadiness::NotReady;
        }
        if buffer_len < self.profile.min_bytes {
            return TuiReadiness::NotReady;
        }
        if !self.burst_seen {
            return TuiReadiness::NotReady;
        }

        let quiet_for = elapsed_ms - self.last_change_at_ms;
        if quiet_for >= self.profile.quiet_ms {
            return TuiReadiness::Ready("quiet");
        }
        if self.profile.fallback_ready_ms > 0 && elapsed_ms >= self.profile.fallback_ready_ms {
            return TuiReadiness::Ready("fallback");
        }
        TuiReadiness::NotReady
    }
}
