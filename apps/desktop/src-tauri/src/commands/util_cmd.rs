//! Cross-platform spawn helper: on Windows EVERY child process of a GUI app
//! opens a console window unless CREATE_NO_WINDOW is passed — with the periodic
//! git/provider probes the user saw terminals flashing "over and
//! over". Every spawn in the code must go through here
//! (exception: portable_pty PTYs, which use ConPTY and are already hidden).

use std::ffi::OsStr;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Replacement for `std::process::Command::new`.
pub fn cmd(program: impl AsRef<OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    // AppImage: the bundle's PATH/LD_LIBRARY_PATH/GTK variables must not
    // reach xdg-open, editors or the provider CLIs (they would load the
    // bundle's libraries). Nothing to do outside an AppImage.
    #[cfg(target_os = "linux")]
    for (k, v) in crate::linux_env::child_env_overrides() {
        match v {
            Some(v) => {
                c.env(k, v);
            }
            None => {
                c.env_remove(k);
            }
        }
    }
    c
}

/// Replacement for `tokio::process::Command::new`.
pub fn tokio_cmd(program: impl AsRef<OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut c = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        c.creation_flags(CREATE_NO_WINDOW);
    }
    // Same AppImage clean-up as [`cmd`].
    #[cfg(target_os = "linux")]
    for (k, v) in crate::linux_env::child_env_overrides() {
        match v {
            Some(v) => {
                c.env(k, v);
            }
            None => {
                c.env_remove(k);
            }
        }
    }
    c
}

/// Statement prepended to every `powershell -Command` script the app builds.
/// Windows PowerShell 5.1 reads and writes the OEM/ANSI code page by default:
/// non-ASCII prompts piped into a CLI, or CLI output read back, came out
/// corrupted (and AI conflict resolution wrote that text into the user's file).
/// The console encodings are set inside `try` because a console-less host can
/// refuse them; `$OutputEncoding` governs what is piped into native programs.
pub const PS_UTF8_PREAMBLE: &str = "try{[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)}catch{};$OutputEncoding=[Text.UTF8Encoding]::new($false);";

/// Arguments that run `script` in Windows PowerShell / pwsh: no profile, no
/// prompts, and `-ExecutionPolicy Bypass` for this process only (npm installs
/// `.ps1` shims for `claude`, `codex`, … that the default Restricted policy
/// refuses to run), with UTF-8 in and out ([`PS_UTF8_PREAMBLE`]).
pub fn powershell_args(script: &str) -> Vec<String> {
    vec![
        "-NoLogo".into(),
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-Command".into(),
        format!("{PS_UTF8_PREAMBLE}{script}"),
    ]
}

/// Starts a fire-and-forget helper (`open`, `xdg-open`, `explorer`, a new
/// terminal window) and reaps it in the background: a `Child` that is dropped
/// without `wait()` stays a zombie until the app exits.
pub fn spawn_detached(command: &mut std::process::Command) -> std::io::Result<()> {
    let mut child = command.spawn()?;
    let _ = std::thread::Builder::new()
        .name("reap-child".into())
        .spawn(move || {
            let _ = child.wait();
        });
    Ok(())
}

/// Looks `program` up in `path` (a PATH-style list) the way the OS would,
/// without spawning `which`/`where` (missing on Windows, and one process per
/// probe). On Windows it tries the PATHEXT extensions (`.exe`, `.cmd`, …).
pub fn find_in_path(program: &str, path: &std::ffi::OsStr) -> Option<std::path::PathBuf> {
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| e.to_ascii_lowercase())
            .collect()
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for ext in &exts {
            let candidate = dir.join(format!("{program}{ext}"));
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn is_executable(path: &std::path::Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// `extra` directories first, then the current PATH, without duplicates,
/// joined with the platform separator (`:` or `;`).
pub fn path_with(extra: &[std::path::PathBuf]) -> std::ffi::OsString {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    for dir in extra.iter().cloned().chain(std::env::split_paths(&current)) {
        if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    std::env::join_paths(dirs).unwrap_or(current)
}

/// A private temporary directory for one provider call: random name, mode
/// 0700 on unix, created with `create_dir` (fails if the path already
/// exists, so a pre-planted file or symlink cannot be reused). Removed with
/// its contents on drop. Files that carry prompts or model output (e.g.
/// Codex `--output-last-message`) go inside it instead of the shared
/// system temp directory under a guessable name.
pub struct PrivateTempDir {
    path: std::path::PathBuf,
}

impl PrivateTempDir {
    pub fn new(prefix: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4().simple()));
        #[allow(unused_mut)]
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&path)
            .map_err(|e| format!("Failed to create private temp dir: {e}"))?;
        Ok(Self { path })
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for PrivateTempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod spawn_helper_tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn finds_programs_on_a_path_list_and_skips_non_executables() {
        use std::os::unix::fs::PermissionsExt;
        let dir = PrivateTempDir::new("promptops-path").unwrap();
        let tool = dir.path().join("tool");
        std::fs::write(&tool, "#!/bin/sh\n").unwrap();
        std::fs::write(dir.path().join("plain"), "x").unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = std::env::join_paths(["/nonexistent", dir.path().to_str().unwrap()]).unwrap();
        assert_eq!(find_in_path("tool", &path), Some(tool));
        assert_eq!(find_in_path("plain", &path), None);
        assert_eq!(find_in_path("missing", &path), None);
    }

    #[test]
    fn powershell_args_bypass_policy_and_force_utf8() {
        let args = powershell_args("Write-Output 1");
        assert_eq!(
            &args[..6],
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command"
            ]
        );
        assert!(args[6].starts_with(PS_UTF8_PREAMBLE));
        assert!(args[6].ends_with("Write-Output 1"));
        assert!(args[6].contains("$OutputEncoding=[Text.UTF8Encoding]::new($false)"));
    }

    #[test]
    fn path_with_puts_extras_first_once() {
        let extra = std::env::temp_dir();
        let joined = path_with(&[extra.clone(), extra.clone()]);
        let dirs: Vec<_> = std::env::split_paths(&joined).collect();
        assert_eq!(dirs[0], extra);
        assert_eq!(dirs.iter().filter(|d| **d == extra).count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn detached_children_are_reaped() {
        let mut cmd = std::process::Command::new("true");
        spawn_detached(&mut cmd).unwrap();
    }
}

#[cfg(test)]
mod private_temp_dir_tests {
    use super::PrivateTempDir;

    #[test]
    fn creates_unique_private_dir_and_removes_it() {
        let a = PrivateTempDir::new("promptops-test").unwrap();
        let b = PrivateTempDir::new("promptops-test").unwrap();
        assert_ne!(a.path(), b.path());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(a.path()).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        std::fs::write(a.path().join("out.txt"), b"x").unwrap();
        let p = a.path().to_path_buf();
        drop(a);
        assert!(!p.exists());
    }
}
