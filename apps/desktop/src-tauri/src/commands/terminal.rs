//! Native terminal.
//!
//! Uses `portable-pty` for robust cross-platform PTY spawning and streams
//! the output as binary over a Tauri `Channel`, avoiding JSON event overhead.
//! A `TerminalManager` holds the pool of live PTYs.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
use portable_pty::{
    ChildKiller, CommandBuilder, MasterPty, NativePtySystem, PtyPair, PtySize, PtySystem,
};
use tauri::ipc::{Channel, InvokeResponseBody};
use uuid::Uuid;

/// Threshold above which the reader blocks until the flusher drains: the PTY's kernel
/// buffer fills up and the child process stops on write (end-to-end flow
/// control with no ACK from the renderer).
const HIGH_WATER: usize = 1024 * 1024;
/// Maximum size of a single raw message on the Channel.
const CHUNK: usize = 128 * 1024;
/// Coalescing window between one send and the next.
#[cfg(not(target_os = "linux"))]
pub(crate) const COALESCE: Duration = Duration::from_millis(4);
/// On WebKitGTK every Channel send is an IPC message to the WebProcess
/// (more expensive than on WKWebView/WebView2): with several terminals printing at 4 ms
/// it reached hundreds of messages/s and the JS main thread couldn't breathe.
/// 10 ms = below one frame (16 ms), key echo unchanged to the eye.
#[cfg(target_os = "linux")]
pub(crate) const COALESCE: Duration = Duration::from_millis(10);

/// Shared reader→flusher buffer. The channel is per-terminal, so the
/// chunks travel as `InvokeResponseBody::Raw` without an id or JSON envelope.
#[derive(Default)]
struct PumpBuf {
    data: Vec<u8>,
    eof: bool,
    dead: bool,
}

/// Reusable reader→flusher pump: coalesces the PTY's micro-reads into bigger
/// chunks so the renderer receives whole TUI frames instead of fragments
/// (partial redraws on xterm are the cause of the graphical glitches).
#[derive(Default)]
pub(crate) struct PumpState {
    buf: Mutex<PumpBuf>,
    cond: Condvar,
}

impl PumpState {
    /// Queues bytes from the reader. Blocks above HIGH_WATER until the flusher
    /// drains (end-to-end backpressure). Returns false if the flusher is
    /// dead: the caller can keep reading and dropping towards the channel.
    pub(crate) fn push(&self, bytes: &[u8]) -> bool {
        let mut g = self.buf.lock();
        while g.data.len() >= HIGH_WATER && !g.dead {
            self.cond.wait(&mut g);
        }
        if g.dead {
            return false;
        }
        g.data.extend_from_slice(bytes);
        self.cond.notify_all();
        true
    }

    /// Signals EOF from the reader: the flusher drains the remainder and exits.
    pub(crate) fn mark_eof(&self) {
        let mut g = self.buf.lock();
        g.eof = true;
        self.cond.notify_all();
    }

    /// Signals that the flusher has exited (channel closed): unblocks the reader.
    pub(crate) fn mark_dead(&self) {
        let mut g = self.buf.lock();
        g.dead = true;
        self.cond.notify_all();
    }

    /// Blocks until there's a chunk to drain; None at EOF with an empty buffer.
    pub(crate) fn next_chunk(&self) -> Option<Vec<u8>> {
        let mut g = self.buf.lock();
        while g.data.is_empty() && !g.eof {
            self.cond.wait(&mut g);
        }
        if g.data.is_empty() {
            return None;
        }
        let take = g.data.len().min(CHUNK);
        let chunk: Vec<u8> = g.data.drain(..take).collect();
        self.cond.notify_all();
        Some(chunk)
    }
}

/// Per-terminal replay buffer cap (terminal:buffer). Beyond the cap the oldest
/// bytes are dropped; `total` stays the absolute cursor for dedup
/// against the live stream on the renderer side.
const REPLAY_CAP: usize = 2 * 1024 * 1024;

/// Grace period between the polite SIGHUP and the SIGKILL on terminal:close.
const KILL_GRACE: Duration = Duration::from_secs(2);

#[derive(Default)]
struct ReplayBuf {
    data: Vec<u8>,
    /// Total bytes seen since the PTY started (= `endOffset` sent to the renderer).
    total: usize,
}

impl ReplayBuf {
    fn push(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
        self.total += bytes.len();
        if self.data.len() > REPLAY_CAP {
            let cut = self.data.len() - REPLAY_CAP;
            self.data.drain(..cut);
        }
    }
}

/// Text of the replay for terminal:buffer, cut on UTF-8 character boundaries.
///
/// The cap can drop the head in the middle of a character, and the tail can
/// end in the middle of one because chunks are cut by size. A lossy decode
/// would print U+FFFD for both; instead the leading continuation bytes are
/// skipped and an incomplete trailing sequence is left out. The renderer's
/// stream decoder has already seen those trailing bytes on the live channel,
/// so the character comes out whole with the next live chunk.
fn replay_text(data: &[u8]) -> String {
    let mut start = 0;
    while start < data.len().min(3) && (data[start] & 0xC0) == 0x80 {
        start += 1;
    }
    let data = &data[start..];
    let end = match std::str::from_utf8(data) {
        Ok(_) => data.len(),
        // error_len() None = the input ended in the middle of a character.
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => data.len(),
    };
    String::from_utf8_lossy(&data[..end]).into_owned()
}

/// Where the flusher delivers each coalesced chunk; false = receiver gone.
type OutputSink = Box<dyn FnMut(Vec<u8>) -> bool + Send>;

struct Terminal {
    /// Master side only: the slave is closed in this process right after the
    /// spawn, so the reader sees EOF as soon as the shell (and whatever it
    /// left on the tty) is gone.
    master: Box<dyn MasterPty + Send>,
    /// Writer behind its own mutex: writes happen OUTSIDE the `terminals` lock
    /// (a blocked write must not freeze the other commands/terminals).
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    replay: Arc<Mutex<ReplayBuf>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    /// Set by the waiter thread once the shell has been reaped.
    exited: Arc<AtomicBool>,
}

impl Terminal {
    /// Ends the terminal without leaving zombies or orphans: SIGHUP to the
    /// foreground job and to the shell, then the PTY is closed, and after
    /// KILL_GRACE a shell that is still alive gets SIGKILL. The kernel hangs up
    /// the foreground job when the shell dies; the waiter thread reaps the
    /// shell. Runs off the caller's thread: closing the writer writes EOF to the
    /// tty, which may block on a child that stopped reading.
    fn shutdown(mut self) {
        std::thread::spawn(move || {
            #[cfg(unix)]
            if let Some(pgrp) = self.master.process_group_leader() {
                if Some(pgrp as u32) != self.pid && pgrp > 0 {
                    // SAFETY: plain signal to a process group read from our own PTY.
                    unsafe { libc::killpg(pgrp, libc::SIGHUP) };
                }
            }
            let _ = self.killer.kill();
            let Terminal {
                master,
                writer,
                replay,
                pid,
                exited,
                ..
            } = self;
            drop(writer);
            drop(master);
            drop(replay);
            let deadline = std::time::Instant::now() + KILL_GRACE;
            while !exited.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(25));
            }
            if !exited.load(Ordering::Acquire) {
                #[cfg(unix)]
                if let Some(pid) = pid {
                    // SAFETY: the waiter has not reaped this pid yet (exited is
                    // false), so it still names our child.
                    unsafe { libc::kill(pid as i32, libc::SIGKILL) };
                }
                #[cfg(not(unix))]
                let _ = pid;
            }
        });
    }
}

#[derive(Default)]
pub struct TerminalManager {
    terminals: Mutex<HashMap<String, Terminal>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Opens a PTY running `shell args` in `cwd` and starts its three threads:
/// the reader (PTY → pump), the flusher (pump → `sink`, coalesced) and the
/// waiter (reaps the shell, so it never lingers as a zombie).
///
/// The replay buffer is fed by the flusher, one chunk per channel message:
/// `total` always falls on a message boundary, so the renderer's byte-offset
/// dedup never has to cut a message (it only receives decoded text).
fn spawn_terminal(
    shell: &str,
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    mut sink: OutputSink,
) -> Result<Terminal, String> {
    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(shell);
    for arg in args {
        cmd.arg(arg);
    }
    if let Some(cwd) = cwd {
        cmd.cwd(cwd);
    }
    crate::commands::session::apply_terminal_env(&mut cmd);

    let PtyPair { slave, master } = pair;
    let mut child = slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Keeping the slave open here would hide the EOF from the reader forever.
    drop(slave);
    let killer = child.clone_killer();
    let pid = child.process_id();

    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(master.take_writer().map_err(|e| e.to_string())?));

    let exited = Arc::new(AtomicBool::new(false));
    let wt_exited = exited.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        wt_exited.store(true, Ordering::Release);
    });

    // Output pump: the reader accumulates, the flusher coalesces and ships raw on the
    // Channel at the COALESCE/CHUNK pace; above HIGH_WATER the reader stops.
    let state = Arc::new(PumpState::default());
    let replay = Arc::new(Mutex::new(ReplayBuf::default()));

    let rd_state = state.clone();
    let rd_replay = replay.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 65536];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // Flusher gone (renderer closed the channel): keep draining
                    // so the child never blocks on a full tty, and keep the
                    // replay current.
                    if !rd_state.push(&buf[..n]) {
                        rd_replay.lock().push(&buf[..n]);
                    }
                }
            }
        }
        rd_state.mark_eof();
    });

    let fl_state = state.clone();
    let fl_replay = replay.clone();
    std::thread::spawn(move || {
        while let Some(chunk) = fl_state.next_chunk() {
            fl_replay.lock().push(&chunk);
            if !sink(chunk) {
                break;
            }
            std::thread::sleep(COALESCE);
        }
        // Whatever is still queued goes to the replay before the reader is
        // told to write there directly, so the replay keeps its byte order.
        let mut g = fl_state.buf.lock();
        g.dead = true;
        let rest = std::mem::take(&mut g.data);
        fl_replay.lock().push(&rest);
        fl_state.cond.notify_all();
    });

    Ok(Terminal {
        master,
        writer,
        replay,
        killer,
        pid,
        exited,
    })
}

/// terminal:open — opens a PTY, returns the id, starts the output pump.
/// `session_id` (raw terminal of the install/verify wizard): respects the session's
/// shell on Windows — a WSL session installs and verifies the CLI
/// INSIDE the distro, not on the host.
#[tauri::command]
pub async fn terminal_open(
    manager: tauri::State<'_, Arc<TerminalManager>>,
    sessions: tauri::State<'_, Arc<crate::commands::session::SessionManager>>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    session_id: Option<String>,
    on_output: Channel<InvokeResponseBody>,
) -> Result<String, String> {
    // Remote sessions (cwd `ssh://…`, beta): this is a local PTY — opening it
    // on a remote cwd would give a shell in the wrong folder.
    if crate::commands::remote::is_remote_path(cwd.as_deref()) {
        return Err(
            "This session runs on a remote host — the local terminal panel is not available for remote sessions yet.".into(),
        );
    }
    let id = Uuid::new_v4().to_string();

    // Session shell (Windows: powershell/pwsh/cmd/gitbash/wsl:*) when
    // the caller doesn't force one: WSL → `wsl.exe -d <distro> --cd <cwd>`
    // with the PTY on the Windows home (a \\wsl$ cwd would break ConPTY).
    let session_spawn = match (&shell, session_id.as_deref()) {
        (None, Some(id)) => {
            let shell_id = sessions.effective_shell_of(id);
            let wsl_cwd = cwd.clone().or_else(|| sessions.cwd_of(id));
            crate::commands::windows_shells::resolve_shell_spawn(
                shell_id.as_deref(),
                wsl_cwd.as_deref(),
            )
        }
        _ => None,
    };
    let (shell, shell_args, cwd) = match session_spawn {
        Some(r) => (r.file, r.args, r.cwd.or(cwd)),
        None => {
            let shell = shell.unwrap_or_else(default_shell);
            // PowerShell PTY (including the wizard's install terminal): execution
            // policy Bypass so the npm .ps1 shims (claude.ps1…)
            // always run. (resolve_shell_spawn already includes them.)
            let lower = shell.to_lowercase();
            let args = if lower.contains("powershell") || lower.contains("pwsh") {
                crate::commands::windows_shells::ps_bypass_args()
            } else {
                Vec::new()
            };
            (shell, args, cwd)
        }
    };

    let sink: OutputSink =
        Box::new(move |chunk| on_output.send(InvokeResponseBody::Raw(chunk)).is_ok());
    let term = spawn_terminal(
        &shell,
        shell_args,
        cwd,
        cols.unwrap_or(80),
        rows.unwrap_or(24),
        sink,
    )?;
    manager.terminals.lock().insert(id.clone(), term);

    Ok(id)
}

/// Payload of terminal:buffer: `{ data, endOffset }`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalBuffer {
    pub data: String,
    pub end_offset: usize,
}

/// terminal:buffer — backlog replay for the renderer's re-attach
/// (tab/session switch): without it, the standalone terminal reopens empty.
#[tauri::command]
pub async fn terminal_buffer(
    manager: tauri::State<'_, Arc<TerminalManager>>,
    id: String,
) -> Result<TerminalBuffer, String> {
    // spawn_blocking: up to 2MB (REPLAY_CAP) copied+serialized — jank on the
    // main thread on every re-attach of the standalone terminal.
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let replay = {
            let guard = manager.terminals.lock();
            let term = guard.get(&id).ok_or("terminal not found")?;
            term.replay.clone()
        };
        let replay = replay.lock();
        Ok(TerminalBuffer {
            data: replay_text(&replay.data),
            end_offset: replay.total,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// terminal:input — writes to the PTY's stdin.
///
/// Blocking write on a blocking thread: a long paste into a child that is not
/// reading fills the tty queue, and `write_all` then waits for it to drain.
#[tauri::command]
pub async fn terminal_input(
    manager: tauri::State<'_, Arc<TerminalManager>>,
    id: String,
    data: String,
) -> Result<(), String> {
    let writer = {
        let guard = manager.terminals.lock();
        let term = guard.get(&id).ok_or("terminal not found")?;
        term.writer.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        writer
            .lock()
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// terminal:resize — adjusts rows/columns.
#[tauri::command]
pub fn terminal_resize(
    manager: tauri::State<'_, Arc<TerminalManager>>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let guard = manager.terminals.lock();
    let term = guard.get(&id).ok_or("terminal not found")?;
    term.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// terminal:close — removes the PTY from the pool and ends its processes
/// (see `Terminal::shutdown`).
#[tauri::command]
pub async fn terminal_close(
    manager: tauri::State<'_, Arc<TerminalManager>>,
    id: String,
) -> Result<(), String> {
    let term = manager.terminals.lock().remove(&id);
    if let Some(term) = term {
        term.shutdown();
    }
    Ok(())
}

/// terminal:list — ids of the live PTYs.
#[tauri::command]
pub fn terminal_list(manager: tauri::State<'_, Arc<TerminalManager>>) -> Vec<String> {
    manager.terminals.lock().keys().cloned().collect()
}

fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Instant;

    fn wait_until(timeout: Duration, mut cond: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if cond() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        cond()
    }

    /// `ps` view of a pid: None = no such process, Some(stat) otherwise
    /// (a stat starting with 'Z' is a zombie nobody reaped).
    fn ps_stat(pid: u32) -> Option<String> {
        let out = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!s.is_empty()).then_some(s)
    }

    fn children_of(pid: u32) -> Vec<u32> {
        let out = std::process::Command::new("pgrep")
            .args(["-P", &pid.to_string()])
            .output()
            .expect("pgrep");
        String::from_utf8_lossy(&out.stdout)
            .split_whitespace()
            .filter_map(|p| p.parse().ok())
            .collect()
    }

    /// Sink that records every chunk (size and bytes).
    fn recording_sink() -> (OutputSink, Arc<Mutex<Vec<Vec<u8>>>>) {
        let chunks = Arc::new(Mutex::new(Vec::new()));
        let c = chunks.clone();
        (
            Box::new(move |chunk| {
                c.lock().push(chunk);
                true
            }),
            chunks,
        )
    }

    fn joined(chunks: &Mutex<Vec<Vec<u8>>>) -> Vec<u8> {
        chunks.lock().concat()
    }

    fn sh(script: &str, sink: OutputSink) -> Terminal {
        spawn_terminal(
            "/bin/sh",
            vec!["-c".into(), script.into()],
            None,
            80,
            24,
            sink,
        )
        .expect("spawn")
    }

    #[test]
    fn flood_of_100_mb_arrives_byte_exact_through_a_slow_receiver() {
        const LINE: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789\n";
        const TOTAL: usize = 100 * 1024 * 1024;
        let state = Arc::new(Mutex::new((0usize, true, 0usize)));
        let st = state.clone();
        let sink: OutputSink = Box::new(move |chunk| {
            let mut g = st.lock();
            g.2 = g.2.max(chunk.len());
            for b in &chunk {
                if g.0 < TOTAL && *b != LINE[g.0 % LINE.len()] {
                    g.1 = false;
                }
                g.0 += 1;
            }
            drop(g);
            // Slower than the producer: the reader must block, not drop.
            std::thread::sleep(Duration::from_millis(1));
            true
        });
        let term = sh(
            &format!("stty -opost; yes abcdefghijklmnopqrstuvwxyz0123456789 | head -c {TOTAL}"),
            sink,
        );
        assert!(
            wait_until(Duration::from_secs(120), || state.lock().0 >= TOTAL
                && term.exited.load(Ordering::Acquire)),
            "received {} of {TOTAL} bytes",
            state.lock().0
        );
        std::thread::sleep(Duration::from_millis(100));
        let g = state.lock();
        assert_eq!(g.0, TOTAL, "no byte lost, none added");
        assert!(g.1, "every byte matches the generator");
        assert!(g.2 <= CHUNK, "messages never exceed CHUNK");
        let replay = term.replay.lock();
        assert_eq!(replay.total, TOTAL);
        assert_eq!(replay.data.len(), REPLAY_CAP, "replay stays capped");
    }

    #[test]
    fn multibyte_characters_split_across_chunks_lose_no_byte() {
        // 9-byte unit (2+4+3 bytes): CHUNK is not a multiple, so chunk
        // boundaries land inside characters.
        let unit = "é😀中";
        let reps = 40_000; // 360 KB, three messages at least
        let (sink, chunks) = recording_sink();
        let term = sh(
            &format!("stty -opost; i=0; s=''; while [ $i -lt 400 ]; do s=\"${{s}}{unit}\"; i=$((i+1)); done; j=0; while [ $j -lt {} ]; do printf '%s' \"$s\"; j=$((j+1)); done", reps / 400),
            sink,
        );
        let done = wait_until(Duration::from_secs(60), || {
            joined(&chunks).len() >= unit.len() * reps && term.exited.load(Ordering::Acquire)
        });
        let all = joined(&chunks);
        assert!(
            done,
            "got {} bytes, exited {}: {:?}",
            all.len(),
            term.exited.load(Ordering::Acquire),
            String::from_utf8_lossy(&all[..all.len().min(300)])
        );
        assert_eq!(all, unit.repeat(reps).into_bytes());
        let split_inside_a_char = chunks
            .lock()
            .iter()
            .any(|c| std::str::from_utf8(c).is_err());
        assert!(
            split_inside_a_char,
            "the test must exercise a mid-character split"
        );
        // Streaming decode (what the bridge's TextDecoder {stream:true} does).
        let mut carry: Vec<u8> = Vec::new();
        let mut text = String::new();
        for c in chunks.lock().iter() {
            carry.extend_from_slice(c);
            let valid = match std::str::from_utf8(&carry) {
                Ok(_) => carry.len(),
                Err(e) => e.valid_up_to(),
            };
            text.push_str(std::str::from_utf8(&carry[..valid]).unwrap());
            carry.drain(..valid);
        }
        assert!(carry.is_empty());
        assert_eq!(text, unit.repeat(reps));
    }

    #[test]
    fn replay_text_never_shows_replacement_characters_at_its_edges() {
        let emoji = "😀".as_bytes(); // 4 bytes
        let mut data = emoji[2..].to_vec(); // head cut by the cap
        data.extend_from_slice("ok ".as_bytes());
        data.extend_from_slice(&emoji[..3]); // tail cut by the chunking
        assert_eq!(replay_text(&data), "ok ");
        assert_eq!(replay_text("plain é".as_bytes()), "plain é");
        assert_eq!(replay_text(b""), "");
        // A genuinely invalid byte in the middle is still shown as U+FFFD.
        assert_eq!(replay_text(b"a\xffb"), "a\u{fffd}b");
    }

    #[test]
    fn replay_cursor_always_falls_on_a_message_boundary() {
        // The renderer dedups by byte offset but only sees decoded text: a
        // snapshot cursor inside a message would force it to cut text by bytes.
        let (sink, chunks) = recording_sink();
        let term = sh("stty -opost; yes 0123456789 | head -c 3000000", sink);
        let mut cursors = Vec::new();
        let replay = term.replay.clone();
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline && !term.exited.load(Ordering::Acquire) {
            cursors.push(replay.lock().total);
            std::thread::sleep(Duration::from_micros(300));
        }
        wait_until(Duration::from_secs(10), || replay.lock().total == 3_000_000);
        let mut boundaries = std::collections::HashSet::from([0usize]);
        let mut acc = 0;
        for c in chunks.lock().iter() {
            acc += c.len();
            boundaries.insert(acc);
        }
        assert_eq!(acc, 3_000_000);
        assert!(cursors.len() > 3);
        for c in cursors {
            assert!(boundaries.contains(&c), "cursor {c} inside a message");
        }
    }

    #[test]
    fn resize_during_output_loses_nothing_and_reaches_the_child() {
        const TOTAL: usize = 5 * 1024 * 1024;
        let (sink, chunks) = recording_sink();
        let term = sh(
            &format!(
                "stty -opost; yes 0123456789 | head -c {TOTAL}; sleep 1; printf 'SIZE:'; stty size"
            ),
            sink,
        );
        for i in 0..200u16 {
            term.master
                .resize(PtySize {
                    rows: 20 + (i % 30),
                    cols: 60 + (i % 90),
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("resize");
        }
        term.master
            .resize(PtySize {
                rows: 33,
                cols: 111,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("resize");
        assert!(wait_until(Duration::from_secs(30), || term
            .exited
            .load(Ordering::Acquire)));
        std::thread::sleep(Duration::from_millis(100));
        let all = joined(&chunks);
        let body = &all[..TOTAL];
        assert!(body
            .iter()
            .enumerate()
            .all(|(i, b)| *b == b"0123456789\n"[i % 11]));
        assert_eq!(String::from_utf8_lossy(&all[TOTAL..]), "SIZE:33 111\n");
    }

    #[test]
    fn paste_larger_than_64_kb_reaches_the_child_intact() {
        const N: usize = 300 * 1024;
        let dir = std::env::temp_dir().join(format!("po-paste-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("pasted");
        let (sink, chunks) = recording_sink();
        // Raw mode (like every TUI and line editor): no MAX_CANON line limit.
        // Echo stays on, so the child writes back while we write: the pump has
        // to keep draining or both sides would block.
        let term = sh(
            &format!(
                "stty raw; printf READY; head -c {N} > '{}'; printf DONE",
                out.display()
            ),
            sink,
        );
        assert!(wait_until(Duration::from_secs(10), || joined(&chunks)
            .windows(5)
            .any(|w| w == b"READY")));
        let paste: Vec<u8> = (0..N).map(|i| b'a' + (i % 26) as u8).collect();
        term.writer.lock().write_all(&paste).expect("write");
        assert!(wait_until(Duration::from_secs(30), || joined(&chunks)
            .windows(4)
            .any(|w| w == b"DONE")));
        assert_eq!(std::fs::read(&out).unwrap(), paste);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn alt_screen_and_osc_sequences_pass_through_unchanged() {
        let (sink, chunks) = recording_sink();
        let term = sh(
            r"stty -opost; printf '\033[?1049h\033]0;title\007\033]8;;https://example.com\033\\link\033]8;;\033\\\033]52;c;aGk=\007\033[?1049l'",
            sink,
        );
        assert!(wait_until(Duration::from_secs(10), || term
            .exited
            .load(Ordering::Acquire)));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(
            joined(&chunks),
            b"\x1b[?1049h\x1b]0;title\x07\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\x1b]52;c;aGk=\x07\x1b[?1049l"
        );
    }

    #[test]
    fn a_shell_that_exits_by_itself_is_reaped_and_its_output_ends() {
        let (sink, chunks) = recording_sink();
        let term = sh("printf bye; exit 3", sink);
        let pid = term.pid.unwrap();
        assert!(wait_until(Duration::from_secs(10), || term
            .exited
            .load(Ordering::Acquire)));
        assert!(wait_until(Duration::from_secs(5), || ps_stat(pid).is_none()));
        assert_eq!(joined(&chunks), b"bye");
    }

    #[test]
    fn close_ends_the_foreground_job_and_the_shell_without_zombies() {
        let (sink, chunks) = recording_sink();
        let term = spawn_terminal(
            "/bin/bash",
            vec!["--norc".into(), "--noprofile".into(), "-i".into()],
            None,
            80,
            24,
            sink,
        )
        .expect("spawn");
        let shell = term.pid.unwrap();
        term.writer
            .lock()
            .write_all(b"sleep 1000; echo after\n")
            .unwrap();
        let mut job = Vec::new();
        assert!(wait_until(Duration::from_secs(10), || {
            job = children_of(shell);
            !job.is_empty()
        }));
        let exited = term.exited.clone();
        term.shutdown();
        assert!(wait_until(Duration::from_secs(5), || exited.load(Ordering::Acquire)));
        assert!(wait_until(Duration::from_secs(5), || ps_stat(shell)
            .is_none()
            && job.iter().all(|p| ps_stat(*p).is_none())));
        // The typed line is echoed, but `echo after` never ran: no line is
        // just "after".
        let out = String::from_utf8_lossy(&joined(&chunks)).into_owned();
        assert!(!out.split("\r\n").any(|l| l == "after"), "{out:?}");
    }

    #[test]
    fn close_kills_a_shell_that_ignores_sighup() {
        let (sink, chunks) = recording_sink();
        let term = sh("trap '' HUP; printf R; while :; do sleep 0.1; done", sink);
        let pid = term.pid.unwrap();
        assert!(wait_until(Duration::from_secs(5), || !joined(&chunks).is_empty()));
        let exited = term.exited.clone();
        term.shutdown();
        assert!(wait_until(KILL_GRACE + Duration::from_secs(3), || exited
            .load(Ordering::Acquire)));
        assert!(wait_until(Duration::from_secs(3), || ps_stat(pid).is_none()));
    }

    /// Child half of `killing_the_app_leaves_no_terminal_processes`: opens three
    /// terminals with a foreground job each, prints the pids, then waits to be
    /// SIGKILLed like a crashed or force-quit app.
    #[test]
    fn app_process_holding_terminals() {
        if std::env::var_os("PROMPTOPS_TERMINAL_KILL_CHILD").is_none() {
            return;
        }
        let mut terms = Vec::new();
        for _ in 0..3 {
            let (sink, _chunks) = recording_sink();
            let term = spawn_terminal(
                "/bin/bash",
                vec!["--norc".into(), "--noprofile".into(), "-i".into()],
                None,
                80,
                24,
                sink,
            )
            .expect("spawn");
            term.writer.lock().write_all(b"sleep 1000\n").unwrap();
            terms.push(term);
        }
        for t in &terms {
            let shell = t.pid.unwrap();
            let mut job = Vec::new();
            wait_until(Duration::from_secs(10), || {
                job = children_of(shell);
                !job.is_empty()
            });
            println!(
                "PIDS {shell} {}",
                job.iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<_>>()
                    .join(" ")
            );
        }
        println!("READY");
        std::thread::sleep(Duration::from_secs(60));
    }

    #[test]
    fn killing_the_app_leaves_no_terminal_processes() {
        use std::io::BufRead;
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "commands::terminal::tests::app_process_holding_terminals",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("PROMPTOPS_TERMINAL_KILL_CHILD", "1")
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut pids: Vec<u32> = Vec::new();
        let out = std::io::BufReader::new(child.stdout.take().unwrap());
        for line in out.lines().map_while(Result::ok) {
            // libtest may print the test name on the same line first.
            if let Some(rest) = line.split("PIDS ").nth(1) {
                pids.extend(
                    rest.split_whitespace()
                        .filter_map(|p| p.parse::<u32>().ok()),
                );
            }
            if line.contains("READY") {
                break;
            }
        }
        assert!(pids.len() >= 6, "3 shells and their jobs: {pids:?}");
        assert!(pids.iter().all(|p| ps_stat(*p).is_some()));
        // SIGKILL: no destructor, no terminal_close, like a crash.
        child.kill().unwrap();
        child.wait().unwrap();
        // The kernel closes the masters and hangs up every session.
        let gone = wait_until(Duration::from_secs(5), || {
            pids.iter().all(|p| ps_stat(*p).is_none())
        });
        let left: Vec<_> = pids
            .iter()
            .filter_map(|p| ps_stat(*p).map(|s| (*p, s)))
            .collect();
        for (p, _) in &left {
            // SAFETY: cleanup of our own test processes.
            unsafe { libc::kill(*p as i32, libc::SIGKILL) };
        }
        assert!(gone, "processes left after kill -9: {left:?}");
    }
}
