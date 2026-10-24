//! Event-driven git status instead of clock-driven (phase 4).
//!
//! The git panel called `git status` every 15 seconds while it was open:
//! expensive on big repos, and almost always just to find out that nothing
//! had changed (so much so that on Windows there's a switch that suspends it entirely).
//! Here a native watcher emits `git:changed` **only** when something that
//! actually affects the status moves, and the webapp just reacts.
//!
//! The editor watcher (`fs_watch_start`) didn't serve the purpose: it ignores
//! `.git/` by construction, so commits, stages and checkouts slip right past
//! it.
//!
//! Filters, in order of noisiness:
//!   - `.git/objects/**`, `.lock` and temporary files → dropped: they are the bulk
//!     of git's traffic and don't change what the user sees;
//!   - rest of `.git/` (index, HEAD, refs, MERGE_HEAD) → relevant;
//!   - working tree → same ignores as the file watcher (node_modules, dist, …).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Coalescing window: a `git add -A` produces hundreds of events, and the
/// status only cares about the final state.
const DEBOUNCE: Duration = Duration::from_millis(700);

#[derive(Clone, Serialize)]
pub struct GitChangedEvent {
    pub cwd: String,
}

struct ActiveWatch {
    /// Dropping it stops the notify backend thread.
    _watcher: RecommendedWatcher,
}

#[derive(Default)]
pub struct GitWatchManager {
    watchers: Mutex<HashMap<String, ActiveWatch>>,
}

impl GitWatchManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// True if the path (relative to the repo root) can change the output of
/// `git status`.
pub(crate) fn affects_git_status(rel: &str) -> bool {
    if rel.is_empty() {
        return false;
    }
    let normalized = rel.replace('\\', "/");

    if let Some(inner) = normalized.strip_prefix(".git/") {
        // The object database changes on every git write without the
        // status being affected: it's the main source of noise.
        if inner.starts_with("objects/") || inner.starts_with("logs/") {
            return false;
        }
        if inner.ends_with(".lock") || inner.ends_with('~') {
            return false;
        }
        return true;
    }
    if normalized == ".git" {
        return false;
    }
    !crate::commands::fs::should_ignore_watch_path(&normalized)
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Where a repository keeps its state. For a plain clone that is `<root>/.git`;
/// for a linked worktree or a submodule `.git` is a FILE pointing elsewhere
/// (`…/.git/worktrees/<name>`, `…/.git/modules/<name>`), and the refs live in
/// the common dir: the working-tree watch alone never saw commits there.
struct RepoDirs {
    roots: Vec<PathBuf>,
    git_dirs: Vec<PathBuf>,
}

fn with_canonical(p: &Path) -> Vec<PathBuf> {
    let mut v = vec![p.to_path_buf()];
    if let Ok(c) = std::fs::canonicalize(p) {
        if c != p {
            v.push(c);
        }
    }
    v
}

fn repo_dirs(root: &Path) -> Option<RepoDirs> {
    let out = crate::commands::util_cmd::cmd("git")
        .args(["rev-parse", "--absolute-git-dir", "--git-common-dir"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let mut lines = text.lines();
    let git_dir = PathBuf::from(lines.next()?.trim());
    let common = lines.next().map(|c| {
        let c = PathBuf::from(c.trim());
        if c.is_absolute() {
            c
        } else {
            root.join(c)
        }
    });
    let mut git_dirs = with_canonical(&git_dir);
    if let Some(common) = common {
        for c in with_canonical(&common) {
            if !git_dirs.contains(&c) {
                git_dirs.push(c);
            }
        }
    }
    Some(RepoDirs {
        roots: with_canonical(root),
        git_dirs,
    })
}

/// True if an absolute event path can change `git status`, for a repository
/// whose git dirs may live outside the working tree.
fn event_is_relevant(path: &Path, dirs: &RepoDirs) -> bool {
    for g in &dirs.git_dirs {
        if let Ok(inner) = path.strip_prefix(g) {
            let inner = inner.to_string_lossy().replace('\\', "/");
            return affects_git_status(&format!(".git/{inner}"));
        }
    }
    for r in &dirs.roots {
        if path.starts_with(r) {
            return affects_git_status(&relative(r, path));
        }
    }
    false
}

/// Folders to watch: the working tree, plus each git dir that is not inside it.
fn watch_targets(dirs: &RepoDirs) -> Vec<PathBuf> {
    let mut out = vec![dirs.roots[0].clone()];
    for g in &dirs.git_dirs {
        let inside = dirs.roots.iter().any(|r| g.starts_with(r));
        let covered = out.iter().any(|o| g.starts_with(o));
        if !inside && !covered && g.is_dir() {
            out.push(g.clone());
        }
    }
    out
}

/// Trailing-edge coalescer: the first trigger of a burst schedules one call
/// `delay` later; triggers while it is pending are folded into it. Every
/// trigger is therefore followed by a call that happens after it.
#[derive(Clone)]
struct Trailing {
    scheduled: Arc<Mutex<bool>>,
    delay: Duration,
}

impl Trailing {
    fn new(delay: Duration) -> Self {
        Self {
            scheduled: Arc::new(Mutex::new(false)),
            delay,
        }
    }

    fn trigger(&self, f: impl FnOnce() + Send + 'static) {
        {
            let mut pending = self.scheduled.lock();
            if *pending {
                return;
            }
            *pending = true;
        }
        let flag = self.scheduled.clone();
        let delay = self.delay;
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            *flag.lock() = false;
            f();
        });
    }
}

/// git-watch:start — starts watching a workspace. Idempotent: a
/// second start on the same cwd replaces the previous watcher.
#[tauri::command]
pub fn git_watch_start(
    app: AppHandle,
    manager: tauri::State<'_, Arc<GitWatchManager>>,
    cwd: String,
) -> Result<(), String> {
    let root = PathBuf::from(&cwd);
    if !root.is_dir() {
        return Err("not a directory".to_string());
    }
    // No repo: no watcher, the caller is left without events (and without
    // a git panel to update).
    if !root.join(".git").exists() {
        return Err("not a git repository".to_string());
    }
    let dirs = repo_dirs(&root).ok_or_else(|| "not a git repository".to_string())?;

    stop(&manager, &cwd);

    let key = cwd.clone();
    let targets = watch_targets(&dirs);
    let app_for_cb = app.clone();
    // Trailing-edge debounce: the event that starts a burst schedules ONE emit
    // DEBOUNCE later, covering everything that lands meanwhile. The old
    // leading-edge version emitted on the first event and dropped the rest of
    // the window, so `git add` + `git commit` in quick succession left the
    // panel showing the intermediate state.
    let trailing = Trailing::new(DEBOUNCE);

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !event.paths.iter().any(|p| event_is_relevant(p, &dirs)) {
            return;
        }
        let app = app_for_cb.clone();
        let key = key.clone();
        trailing.trigger(move || {
            let _ = app.emit("git:changed", GitChangedEvent { cwd: key });
        });
    })
    .map_err(|e| e.to_string())?;

    for target in &targets {
        watcher
            .watch(target, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
    }

    manager
        .watchers
        .lock()
        .insert(cwd, ActiveWatch { _watcher: watcher });
    Ok(())
}

/// git-watch:stop — stops watching (idempotent).
#[tauri::command]
pub fn git_watch_stop(manager: tauri::State<'_, Arc<GitWatchManager>>, cwd: String) {
    stop(&manager, &cwd);
}

fn stop(manager: &GitWatchManager, cwd: &str) {
    manager.watchers.lock().remove(cwd);
}

#[cfg(test)]
mod tests {
    use super::affects_git_status;

    #[test]
    fn git_internals_are_filtered() {
        assert!(!affects_git_status(".git/objects/ab/cdef"));
        assert!(!affects_git_status(".git/index.lock"));
        assert!(!affects_git_status(".git/logs/HEAD"));
        assert!(!affects_git_status(".git"));
        // These, on the other hand, really change the status.
        assert!(affects_git_status(".git/index"));
        assert!(affects_git_status(".git/HEAD"));
        assert!(affects_git_status(".git/refs/heads/main"));
        assert!(affects_git_status(".git/MERGE_HEAD"));
    }

    #[test]
    fn working_tree_uses_the_shared_ignore_list() {
        assert!(affects_git_status("src/main.rs"));
        assert!(!affects_git_status("node_modules/left-pad/index.js"));
        assert!(!affects_git_status("dist/bundle.js"));
        assert!(!affects_git_status(""));
    }

    #[test]
    fn linked_worktree_git_dir_outside_the_tree_is_relevant() {
        use super::{event_is_relevant, watch_targets, RepoDirs};
        use std::path::PathBuf;
        let dirs = RepoDirs {
            roots: vec![PathBuf::from("/w/linked")],
            git_dirs: vec![
                PathBuf::from("/w/main/.git/worktrees/linked"),
                PathBuf::from("/w/main/.git"),
            ],
        };
        assert!(event_is_relevant(
            &PathBuf::from("/w/main/.git/worktrees/linked/index"),
            &dirs
        ));
        assert!(event_is_relevant(
            &PathBuf::from("/w/main/.git/refs/heads/x"),
            &dirs
        ));
        assert!(!event_is_relevant(
            &PathBuf::from("/w/main/.git/objects/ab/cd"),
            &dirs
        ));
        assert!(!event_is_relevant(
            &PathBuf::from("/w/main/.git/worktrees/linked/index.lock"),
            &dirs
        ));
        assert!(event_is_relevant(
            &PathBuf::from("/w/linked/src/a.rs"),
            &dirs
        ));
        assert!(!event_is_relevant(
            &PathBuf::from("/w/linked/node_modules/x.js"),
            &dirs
        ));
        assert!(!event_is_relevant(&PathBuf::from("/elsewhere/a"), &dirs));
        let targets = watch_targets(&dirs);
        assert_eq!(
            targets.len(),
            1,
            "non-existent dirs are not watched: {targets:?}"
        );
    }

    #[test]
    fn bursts_are_coalesced_and_the_last_change_is_never_dropped() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::time::Duration;
        let calls = std::sync::Arc::new(AtomicUsize::new(0));
        let t = super::Trailing::new(Duration::from_millis(80));
        for _ in 0..5 {
            let c = calls.clone();
            t.trigger(move || {
                c.fetch_add(1, Ordering::SeqCst);
            });
            std::thread::sleep(Duration::from_millis(10));
        }
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // A change right after the previous emit gets its own emit (the old
        // leading-edge debounce dropped it for the whole window).
        let c = calls.clone();
        t.trigger(move || {
            c.fetch_add(1, Ordering::SeqCst);
        });
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn real_worktree_dirs_are_resolved() {
        let base = std::env::temp_dir().join(format!("po-gw-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let git = |dir: &std::path::Path, args: &[&str]| {
            let o = crate::commands::util_cmd::cmd("git")
                .current_dir(dir)
                .args([
                    "-c",
                    "user.name=T",
                    "-c",
                    "user.email=t@e.invalid",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .output()
                .unwrap();
            assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
        };
        let main = base.join("main");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["commit", "-q", "--allow-empty", "-m", "x"]);
        git(&main, &["worktree", "add", "-q", "../linked", "-b", "wt"]);
        let dirs = super::repo_dirs(&base.join("linked")).unwrap();
        let targets = super::watch_targets(&dirs);
        assert!(targets.len() >= 2, "{targets:?}");
        let index = dirs.git_dirs[0].join("index");
        assert!(super::event_is_relevant(&index, &dirs));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn windows_separators_are_normalized() {
        assert!(!affects_git_status(".git\\objects\\ab\\cdef"));
        assert!(affects_git_status(".git\\index"));
    }
}
