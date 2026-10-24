//! Docker domain: `docker:ps` is exposed as the `docker_ps` Tauri command.
//!
//! We shell out to the system `docker` binary
//! (`docker version --format ...`, `docker ps -a --format "{{json .}}"`) and
//! parse stdout as JSON per line. The return shapes
//! (`ok`, `containers`, `allContainers`, `projectName`, `error`) and the container
//! shape (`id`, `name`, `image`, `status`, `state`, `ports`, `created`)
//! match exactly those expected by the renderer.
//!
//! The TS uses `exec`/`execSync` with an enriched PATH (`getDockerPath`) and a
//! binary lookup over known paths + PATH (`findDockerBinary`).
//! Below they are replicated faithfully, including the per-command timeouts
//! (8s for the version check, 15s for `ps -a`) implemented natively with a
//! thread + `recv_timeout` (no `wait-timeout` crate: outside the allowed
//! set). On timeout the child process is killed and the
//! "Docker command timed out" error is propagated, as in the TS.
//!
//! Standalone file: does NOT touch mod.rs / lib.rs / Cargo.toml.

use std::path::Path;
use std::process::{Child, Stdio};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;

// ─────────────────────────────────────────────────────────────────────────────
// Return DTOs — field names match exactly the shapes expected by the
// renderer. `DockerContainer` corresponds to the TS interface of the same name.
// Optional response fields use `skip_serializing_if = Option::is_none`
// so the JSON object contains ONLY the keys the TS would have included (the
// same object, depending on the branch, has `{ ok, error }` or
// `{ ok, containers, allContainers, projectName }`).
// ─────────────────────────────────────────────────────────────────────────────

/// The TS `interface DockerContainer` — fields and names 1:1.
#[derive(Clone, Serialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub created: String,
}

/// Response of the `docker:ps` handler. Depending on the branch taken it serializes
/// `{ ok: false, error }` or `{ ok: true, containers, allContainers,
/// projectName }`, exactly like the objects returned by the TS.
#[derive(Serialize, Default)]
pub struct DockerPsResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub containers: Option<Vec<DockerContainer>>,
    #[serde(rename = "allContainers", skip_serializing_if = "Option::is_none")]
    pub all_containers: Option<Vec<DockerContainer>>,
    #[serde(rename = "projectName", skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl DockerPsResult {
    fn error<S: Into<String>>(msg: S) -> Self {
        Self {
            ok: false,
            error: Some(msg.into()),
            ..Default::default()
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC command
// ─────────────────────────────────────────────────────────────────────────────

/// docker:ps — lists the containers (running + stopped), filtering those tied
/// to the project in `cwd`. 1:1 port of the `IpcChannels.DOCKER_PS` handler.
/// spawn_blocking: `docker version` + `docker ps` may take seconds
/// (cold daemon) — on the main thread (sync command) they froze the UI.
#[tauri::command]
pub async fn docker_ps(cwd: String) -> Result<DockerPsResult, String> {
    tauri::async_runtime::spawn_blocking(move || docker_ps_impl(cwd))
        .await
        .map_err(|e| e.to_string())?
}

fn docker_ps_impl(cwd: String) -> Result<DockerPsResult, String> {
    // 1. Check if docker binary exists
    if !Path::new(&cwd).is_dir() {
        return Ok(DockerPsResult::error("invalid cwd"));
    }
    let docker_bin = match find_docker_binary() {
        Some(b) => b,
        None => {
            return Ok(DockerPsResult::error(
                "Docker CLI not found. Make sure Docker Desktop is installed.",
            ));
        }
    };

    // 2. Light check: is the daemon responding? (docker version is much lighter
    //    than docker info). The TS does `.catch(() => null)` so any error
    //    becomes "daemon not running".
    let version_ok = run_cmd(
        &docker_bin,
        &["version", "--format", "{{.Server.Version}}"],
        &cwd,
        8000,
    )
    .ok()
    .filter(|r| !r.stdout.trim().is_empty());

    if version_ok.is_none() {
        return Ok(DockerPsResult::error(
            "Docker daemon is not running. Start Docker Desktop and try again.",
        ));
    }

    // Get all containers (running + stopped) with JSON format
    let raw_output = match run_cmd(
        &docker_bin,
        &["ps", "-a", "--format", "{{json .}}"],
        &cwd,
        15000,
    ) {
        Ok(r) => r,
        // The TS try/catch around the whole handler returns `{ ok: false,
        // error: err.message }` on exception (e.g. `ps` timeout).
        Err(e) => return Ok(DockerPsResult::error(e)),
    };

    let mut containers: Vec<DockerContainer> = Vec::new();
    let lines = raw_output
        .stdout
        .trim()
        .split('\n')
        .filter(|l| !l.is_empty());

    for line in lines {
        // `JSON.parse(line)`; malformed lines are skipped (empty catch).
        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // c.Ports || '' and c.CreatedAt || c.RunningFor || ''
        let created = {
            let created_at = str_field(&parsed, "CreatedAt");
            if !created_at.is_empty() {
                created_at
            } else {
                str_field(&parsed, "RunningFor")
            }
        };
        containers.push(DockerContainer {
            id: str_field(&parsed, "ID"),
            name: str_field(&parsed, "Names"),
            image: str_field(&parsed, "Image"),
            status: str_field(&parsed, "Status"),
            state: str_field(&parsed, "State"),
            ports: str_field(&parsed, "Ports"),
            created,
        });
    }

    // Try to detect compose project name from workspace
    let project_name = extract_project_name(&cwd);

    // Filter containers related to the project
    let related = filter_related_containers(&containers, &project_name);

    Ok(DockerPsResult {
        ok: true,
        containers: Some(related),
        all_containers: Some(containers),
        project_name: Some(project_name),
        error: None,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers — equivalents of the TS functions of the same name
// ─────────────────────────────────────────────────────────────────────────────

/// Extracts a string field from the `docker ps` JSON. Replicates JS access
/// `c.Field` on a string value, returning "" if missing/not a string
/// (so `c.Ports || ''` and the other defaults match).
fn str_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// `extractProjectName(cwd)` — likely compose project name from the
/// workspace path (Docker Compose uses the directory name as the default).
fn extract_project_name(cwd: &str) -> String {
    let normalized = cwd.replace('\\', "/");
    let last = normalized.split('/').next_back().unwrap_or("");
    last.to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_' || *c == '-')
        .collect()
}

/// `filterRelatedContainers(containers, cwd, projectName)` — filters the containers
/// likely tied to the project. Same matching logic as the TS.
fn filter_related_containers(
    containers: &[DockerContainer],
    project_name: &str,
) -> Vec<DockerContainer> {
    if project_name.is_empty() {
        return containers.to_vec();
    }

    containers
        .iter()
        .filter(|c| {
            let name = c.name.to_lowercase();
            let image = c.image.to_lowercase();

            // Match by compose project name (docker-compose prefixes names)
            if name.contains(project_name) {
                return true;
            }
            // Match by common substrings of the directory name
            // e.g., project "my-app" → container "my-app-db-1"
            if name.starts_with(&format!("{project_name}-"))
                || name.starts_with(&format!("{project_name}_"))
            {
                return true;
            }
            // Match image name containing project name
            if image.contains(project_name) {
                return true;
            }
            false
        })
        .cloned()
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// docker binary + PATH resolution — port of getDockerPath/findDockerBinary
// ─────────────────────────────────────────────────────────────────────────────

/// Known Docker CLI folders, searched before the current PATH (an app opened
/// from Finder/Dock does not get the login shell's PATH).
fn docker_dirs() -> Vec<std::path::PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    if cfg!(windows) {
        let program_files = std::env::var_os("ProgramFiles")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| "C:\\Program Files".into());
        vec![program_files
            .join("Docker")
            .join("Docker")
            .join("resources")
            .join("bin")]
    } else {
        vec![
            "/usr/local/bin".into(),
            "/opt/homebrew/bin".into(),
            "/Applications/Docker.app/Contents/Resources/bin".into(),
            home.join(".docker/bin"),
            "/usr/bin".into(),
            "/bin".into(),
        ]
    }
}

/// `getDockerPath()` — the known Docker folders ahead of the current PATH,
/// without duplicates, joined with the platform separator.
fn get_docker_path() -> std::ffi::OsString {
    crate::commands::util_cmd::path_with(&docker_dirs())
}

/// `findDockerBinary()` — full path of the `docker` CLI, looked up directly
/// in the known folders + PATH (no `which`, which Windows does not have).
fn find_docker_binary() -> Option<String> {
    crate::commands::util_cmd::find_in_path("docker", &get_docker_path())
        .map(|p| p.to_string_lossy().into_owned())
}

// ─────────────────────────────────────────────────────────────────────────────
// Command runner with timeout — equivalent of runCmd(cmd, cwd, timeout)
// ─────────────────────────────────────────────────────────────────────────────

struct CmdOutput {
    stdout: String,
    #[allow(dead_code)]
    stderr: String,
}

/// `runCmd(cmd, cwd, timeout)` — launches the docker binary with the given flags in
/// `cwd`, PATH enriched by `getDockerPath()` and the given timeout (ms).
///
/// Replicates the TS behavior:
/// - `error && error.killed` (timeout) -> reject("Docker command timed out")
/// - `error && !stdout` -> reject(stderr || error.message)
/// - otherwise resolve({ stdout, stderr }) (docker commands may exit
///   with code != 0 but still produce useful output).
fn run_cmd(bin: &str, args: &[&str], cwd: &str, timeout_ms: u64) -> Result<CmdOutput, String> {
    let spawn_result = crate::commands::util_cmd::cmd(bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", get_docker_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let child = match spawn_result {
        Ok(c) => c,
        // exec error without stdout -> reject(stderr || error.message)
        Err(e) => return Err(e.to_string()),
    };

    match wait_with_timeout(child, timeout_ms) {
        Ok(output) => {
            let stdout = output.stdout;
            let stderr = output.stderr;
            if !output.success && stdout.is_empty() {
                // error && !stdout -> reject(stderr || error.message)
                let err = if !stderr.is_empty() {
                    stderr
                } else {
                    "Command failed".to_string()
                };
                Err(err)
            } else {
                // resolve({ stdout, stderr })
                Ok(CmdOutput { stdout, stderr })
            }
        }
        // error.killed -> reject("Docker command timed out")
        Err(TimedOut) => Err("Docker command timed out".to_string()),
    }
}

struct WaitOutput {
    stdout: String,
    stderr: String,
    success: bool,
}

struct TimedOut;

/// Waits for the child up to `timeout_ms`. If it expires, kills the process and returns
/// `Err(TimedOut)` (equivalent to Node child_process's `error.killed`, which with
/// the `timeout` option sends SIGTERM to the process).
///
/// Implemented with a thread that drains stdout/stderr and waits for exit, plus
/// `recv_timeout` on the caller side so as not to introduce crates outside the allowed
/// set. The `Child` is shared via `Arc<Mutex<_>>` so, on timeout, the
/// caller can actually kill the process.
fn wait_with_timeout(mut child: Child, timeout_ms: u64) -> Result<WaitOutput, TimedOut> {
    // Captured streams: we take the handles before sharing `child`.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let child = Arc::new(Mutex::new(child));
    let (tx, rx) = mpsc::channel();

    // Read/wait thread: reads stdout/stderr fully (avoids deadlocks
    // on large output) then waits for the process to exit.
    let thread_child = Arc::clone(&child);
    std::thread::spawn(move || {
        use std::io::Read;
        let mut out = String::new();
        let mut err = String::new();
        if let Some(mut p) = stdout_pipe {
            let _ = p.read_to_string(&mut out);
        }
        if let Some(mut p) = stderr_pipe {
            let _ = p.read_to_string(&mut err);
        }
        // Poll with `try_wait()` releasing the lock between attempts,
        // so the kill-on-timeout path does not deadlock contending for the
        // mutex. The pipes are already drained: once closed, the process exits
        // shortly (by itself or due to the caller's kill).
        let status = loop {
            match thread_child.lock().try_wait() {
                Ok(Some(s)) => break Ok(s),
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(e) => break Err(e),
            }
        };
        let _ = tx.send((out, err, status));
    });

    match rx.recv_timeout(Duration::from_millis(timeout_ms)) {
        Ok((out, err, status)) => {
            let success = status.map(|s| s.success()).unwrap_or(false);
            Ok(WaitOutput {
                stdout: out,
                stderr: err,
                success,
            })
        }
        Err(_) => {
            // Timeout: kill the process (as Node does with the `timeout` option).
            // The read thread will finish when the process dies.
            child.lock().kill().ok();
            Err(TimedOut)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docker_path_keeps_every_known_folder_as_its_own_entry() {
        let dirs: Vec<_> = std::env::split_paths(&get_docker_path()).collect();
        for known in docker_dirs() {
            assert!(dirs.contains(&known), "{known:?}");
        }
    }

    #[test]
    fn a_missing_folder_is_refused_before_running_docker() {
        let res = docker_ps_impl("/definitely/not/here".into()).unwrap();
        assert!(!res.ok);
        assert_eq!(res.error.as_deref(), Some("invalid cwd"));
    }

    #[test]
    fn project_filter_matches_compose_names() {
        let c = |name: &str| DockerContainer {
            id: "1".into(),
            name: name.into(),
            image: "img".into(),
            status: String::new(),
            state: String::new(),
            ports: String::new(),
            created: String::new(),
        };
        assert_eq!(extract_project_name("/Users/me/My App"), "myapp");
        let related = filter_related_containers(&[c("myapp-db-1"), c("other")], "myapp");
        assert_eq!(related.len(), 1);
    }
}
