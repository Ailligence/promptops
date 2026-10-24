//! Plugin Studio — prepares the folder of a new plugin and keeps an eye on it.
//!
//! The folder is a normal project (git, readable files, `node --test`): the Studio
//! hides nothing, it just puts everything in the right place before the agent starts.
//!  - `plugin_studio_prepare` copies the template for the chosen zone, sets id and name,
//!    writes the instructions for the agent (`CLAUDE.md`, `AGENTS.md`, `PLUGIN_GUIDE.md`),
//!    runs `git init` and marks the folder as trusted for Claude Code;
//!  - `plugin_studio_changes` lists the changed files (git status);
//!  - `plugin_studio_run_tests` runs `node --test` with a time limit.
//! The connection to the runtime stays the developer-mode one (`link_local`).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{slug_ok, write_atomic};

/// Templates bundled in the app: a copy of `promptops-plugin-templates` (alignment test below).
struct Template {
    manifest: &'static str,
    code: &'static str,
    fixtures: Option<&'static str>,
    test: Option<&'static str>,
}

fn template(zone: &str) -> Option<Template> {
    Some(match zone {
        "page" | "sidebar" => Template {
            manifest: include_str!("studio_templates/pages/promptops-plugin.json"),
            code: include_str!("studio_templates/pages/plugin.js"),
            fixtures: Some(include_str!("studio_templates/pages/fixtures.json")),
            test: None,
        },
        "tasks" => Template {
            manifest: include_str!("studio_templates/tasks/promptops-plugin.json"),
            code: include_str!("studio_templates/tasks/plugin.js"),
            fixtures: Some(include_str!("studio_templates/tasks/fixtures.json")),
            test: None,
        },
        "session-buttons" | "header-buttons" | "composer-buttons" | "runtime-buttons" => Template {
            manifest: include_str!("studio_templates/session/promptops-plugin.json"),
            code: include_str!("studio_templates/session/plugin.js"),
            fixtures: None,
            test: Some(include_str!("studio_templates/session/plugin.test.mjs")),
        },
        _ => return None,
    })
}

const CONTRACTS: &str = include_str!("studio_templates/CONTRACTS.md");

fn zone_label(zone: &str) -> &'static str {
    match zone {
        "page" => "a menu entry with its own page",
        "sidebar" => "an entry at the top of the session sidebar (above folders and workspaces) that opens its own page",
        "tasks" => "a task source for the Teams sprint board",
        "header-buttons" => "buttons in the session header, next to SSH, Database and Docker",
        "composer-buttons" => "buttons in the tools of the spawn composer (where you write the prompt for a new agent)",
        "runtime-buttons" => "chips in the row of AI Squad, Goal and Worker, under the spawn composer",
        _ => "buttons in the toolbar of each agent terminal",
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRequest {
    pub zone: String,
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub goal: String,
    /// New draft: if the folder already exists, `<slug>-2`, `<slug>-3`… is used instead of reopening it.
    #[serde(default)]
    pub unique: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedPlugin {
    pub path: String,
    pub plugin_id: String,
    pub name: String,
    pub zone: String,
    /// The folder already existed: nothing was overwritten.
    pub reused: bool,
}

fn studio_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or("home folder not found")?;
    Ok(PathBuf::from(home).join("promptops-plugins"))
}

/// Instructions for the agent, read automatically by Claude Code (`CLAUDE.md`) and by Codex/OpenCode (`AGENTS.md`).
fn agent_instructions(plugin_id: &str, name: &str, zone: &str, goal: &str) -> String {
    let goal = if goal.trim().is_empty() {
        "(ask the person what the plugin should do)".to_string()
    } else {
        goal.trim().to_string()
    };
    format!(
        "# {name} — a PromptOps plugin\n\n\
Plugin id: `{plugin_id}`. Where it acts: {zone_label}.\n\
Goal, in the words of the person: {goal}\n\n\
## How this folder works\n\
- `promptops-plugin.json` is the manifest: id, name, permissions, hosts, settings (`config.fields`), contributions.\n\
- `src/plugin.js` is the code. It is plain JavaScript that runs in a sandbox, with no build step: what you write is what runs and what the reviewer reads.\n\
- `fixtures.json` holds sample answers for HTTP calls, so the plugin can be tried offline.\n\
- `test/*.test.mjs` runs the plugin with a fake `promptops` global: `node --test`.\n\
- `PLUGIN_GUIDE.md` is the full reference of every section contract and of the `sdk` object. Read the part for this zone before changing code.\n\n\
## Rules that cannot be bent\n\
- The plugin only talks to PromptOps through the `sdk` passed to its functions. No DOM, no `fetch`, no `localStorage`, no `eval`, no remote scripts.\n\
- Network: `sdk.http.fetch` only, HTTPS only, and only to hosts declared as `net:<host>` in `permissions`. Secrets are written as `{{{{secret:key}}}}` and filled by PromptOps.\n\
- The plugin proposes, PromptOps executes: prompts to agents, file writes and AI calls always go through a confirmation of the person.\n\
- Terminal output of sessions is never available to plugins.\n\
- Keep the code readable: no minification, no obfuscation.\n\n\
## Your loop\n\
1. Change `src/plugin.js` (and the manifest if permissions or contributions change).\n\
2. Run `node --test` and fix what fails. Add a test for every behavior you add.\n\
3. Tell the person to press **Reload** in the PromptOps Plugin Studio to see the change live. Errors and denials appear in its **Checks** tab.\n\
4. When it works, the person publishes from the Studio: the folder must be a public GitHub repository.\n",
        zone_label = zone_label(zone),
    )
}

/// Creates (or reopens) the plugin folder inside the Studio folder.
#[tauri::command]
pub fn plugin_studio_prepare(request: PrepareRequest) -> Result<PreparedPlugin, String> {
    if !slug_ok(&request.slug) || request.slug.len() > 60 {
        return Err("the short name must be lowercase, with digits and hyphens".into());
    }
    let name = request.name.trim();
    if name.chars().count() < 2 || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("the name must be 2 to 80 characters".into());
    }
    let tpl = template(&request.zone).ok_or("unknown zone")?;
    let mut slug = request.slug.clone();
    if request.unique {
        let root = studio_root()?;
        let mut n = 2;
        while root.join(&slug).exists() {
            slug = format!("{}-{n}", request.slug);
            n += 1;
        }
    }
    let plugin_id = format!("local.{slug}");
    let dir = studio_root()?.join(&slug);

    if dir.join(super::MANIFEST_FILE).is_file() {
        return Ok(PreparedPlugin {
            path: dir.to_string_lossy().into(),
            plugin_id: read_id(&dir).unwrap_or(plugin_id),
            name: name.into(),
            zone: request.zone,
            reused: true,
        });
    }
    if dir.exists()
        && fs::read_dir(&dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
    {
        return Err(format!(
            "{} already exists and is not a plugin: choose another name",
            dir.display()
        ));
    }

    let mut manifest: Value = serde_json::from_str(tpl.manifest).map_err(|e| e.to_string())?;
    manifest["id"] = Value::String(plugin_id.clone());
    manifest["name"] = Value::String(name.to_string());
    manifest["version"] = Value::String("0.1.0".into());
    manifest["entry"] = Value::String("src/plugin.js".into());
    if !request.goal.trim().is_empty() {
        manifest["description"] = Value::String(request.goal.trim().chars().take(300).collect());
    }
    if let Some(obj) = manifest.as_object_mut() {
        obj.remove("repository");
    }
    // The template's button takes the plugin's name and the chosen zone's slot.
    if let Some(first) = manifest["contributes"]["sessionButtons"].get_mut(0) {
        first["title"] = Value::String(name.chars().take(40).collect());
        let place = match request.zone.as_str() {
            "header-buttons" => "header",
            "composer-buttons" => "composer",
            "runtime-buttons" => "runtime",
            _ => "terminal",
        };
        if place != "terminal" {
            first["place"] = Value::String(place.into());
        }
    }
    // Sidebar zone: same page as the `pages` template, but the entry goes at the top of the session sidebar.
    if request.zone == "sidebar" {
        if let Some(first) = manifest["contributes"]["pages"].get_mut(0) {
            first["title"] = Value::String(name.chars().take(40).collect());
            first["place"] = Value::String("sidebar".into());
        }
    }
    let pretty = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())? + "\n";

    write_atomic(&dir.join(super::MANIFEST_FILE), pretty.as_bytes(), false)?;
    write_atomic(&dir.join("src/plugin.js"), tpl.code.as_bytes(), false)?;
    if let Some(f) = tpl.fixtures {
        write_atomic(&dir.join("fixtures.json"), f.as_bytes(), false)?;
    }
    if let Some(t) = tpl.test {
        write_atomic(&dir.join("test/plugin.test.mjs"), t.as_bytes(), false)?;
    }
    let instructions = agent_instructions(&plugin_id, name, &request.zone, &request.goal);
    write_atomic(&dir.join("CLAUDE.md"), instructions.as_bytes(), false)?;
    write_atomic(&dir.join("AGENTS.md"), instructions.as_bytes(), false)?;
    write_atomic(&dir.join("GEMINI.md"), instructions.as_bytes(), false)?;
    write_atomic(&dir.join("PLUGIN_GUIDE.md"), CONTRACTS.as_bytes(), false)?;
    write_atomic(
        &dir.join(".gitignore"),
        b"node_modules/\n.DS_Store\n",
        false,
    )?;
    let _ = Command::new("git")
        .arg("init")
        .arg("-q")
        .current_dir(&dir)
        .status();
    crate::commands::browser::trust_claude_project(&dir.to_string_lossy());

    Ok(PreparedPlugin {
        path: dir.to_string_lossy().into(),
        plugin_id,
        name: name.into(),
        zone: request.zone,
        reused: false,
    })
}

fn read_id(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join(super::MANIFEST_FILE)).ok()?;
    serde_json::from_str::<Value>(&text).ok()?["id"]
        .as_str()
        .map(str::to_string)
}

/// The folder must be inside the Studio folder: these commands don't run anywhere else.
fn studio_dir(path: &str) -> Result<PathBuf, String> {
    let root = studio_root()?
        .canonicalize()
        .map_err(|_| "Studio folder missing".to_string())?;
    let dir = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("{path}: {e}"))?;
    if !dir.starts_with(&root) || dir == root {
        return Err("folder outside the Studio".into());
    }
    Ok(dir)
}

#[derive(Serialize)]
pub struct Change {
    pub status: String,
    pub path: String,
}

/// Files changed since the last commit: what the agent touched.
#[tauri::command]
pub fn plugin_studio_changes(path: String) -> Result<Vec<Change>, String> {
    let dir = studio_dir(&path)?;
    let out = Command::new("git")
        .args(["status", "--porcelain", "--untracked-files=all"])
        .current_dir(&dir)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| l.len() > 3)
        .take(200)
        .map(|l| Change {
            status: l[..2].trim().to_string(),
            path: l[3..].to_string(),
        })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    pub ok: bool,
    pub output: String,
    pub timed_out: bool,
}

/// `node --test` in the plugin folder, 60 seconds max. Only the plugin's tests:
/// they run on the person's computer like any `npm test` in their project.
#[tauri::command]
pub async fn plugin_studio_run_tests(path: String) -> Result<TestRun, String> {
    let dir = studio_dir(&path)?;
    if !dir.join("test").is_dir() {
        return Ok(TestRun {
            ok: true,
            output: "No test/ folder yet: ask the agent to add tests.".into(),
            timed_out: false,
        });
    }
    tauri::async_runtime::spawn_blocking(move || run_node_tests(&dir, Duration::from_secs(60)))
        .await
        .map_err(|e| e.to_string())?
}

/// Runs `node --test` in `dir`. Output is drained by two threads while the process runs: a
/// test that prints more than a pipe buffer (64 KB) would otherwise block forever and be
/// reported as "stopped after 60 seconds". On timeout the process is killed.
fn run_node_tests(dir: &Path, limit: Duration) -> Result<TestRun, String> {
    run_tests_with("node", &["--test"], dir, limit)
}

fn run_tests_with(
    program: &str,
    args: &[&str],
    dir: &Path,
    limit: Duration,
) -> Result<TestRun, String> {
    use std::io::Read;
    let mut child = Command::new(program)
        .args(args)
        .current_dir(dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("{program}: {e}"))?;
    // A process the tests leave behind can keep the pipes open: the output is collected with
    // a deadline after the exit instead of waiting for an EOF that may never come.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            let _ = tx.send(buf);
        });
        rx
    };
    let out = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(status);
        }
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let Some(status) = status else {
        return Ok(TestRun {
            ok: false,
            output: format!("Tests stopped after {} seconds.", limit.as_secs()),
            timed_out: true,
        });
    };
    let collect = |rx: std::sync::mpsc::Receiver<Vec<u8>>| {
        rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default()
    };
    let mut text = String::from_utf8_lossy(&collect(out)).to_string();
    text.push_str(&String::from_utf8_lossy(&collect(err)));
    let tail: String = text
        .chars()
        .rev()
        .take(20_000)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    Ok(TestRun {
        ok: status.success(),
        output: tail,
        timed_out: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 300 KB of output, far more than a pipe buffer: the run finishes and keeps the tail.
    #[cfg(unix)]
    #[test]
    fn a_verbose_test_run_does_not_hang() {
        let dir = std::env::temp_dir();
        let run = run_tests_with(
            "sh",
            &["-c", "i=0; while [ $i -lt 3000 ]; do printf '%0100d\\n' $i; i=$((i+1)); done; echo done-marker"],
            &dir,
            Duration::from_secs(20),
        )
        .unwrap();
        assert!(!run.timed_out, "{}", run.output.len());
        assert!(run.ok);
        assert!(run.output.trim_end().ends_with("done-marker"));
        let slow =
            run_tests_with("sh", &["-c", "sleep 5"], &dir, Duration::from_millis(300)).unwrap();
        assert!(slow.timed_out && !slow.ok);
    }

    #[test]
    fn every_zone_has_a_valid_template() {
        for zone in [
            "page",
            "sidebar",
            "tasks",
            "session-buttons",
            "header-buttons",
            "composer-buttons",
            "runtime-buttons",
        ] {
            let tpl = template(zone).unwrap();
            let m: Value = serde_json::from_str(tpl.manifest).unwrap();
            let perms = super::super::manifest_permissions(&m).unwrap();
            super::super::validate_permissions(&perms).unwrap();
            let category = m["category"].as_str().unwrap();
            super::super::validate_category_permissions(category, &perms).unwrap();
            super::super::manifest_pages(&m, category).unwrap();
            super::super::manifest_session_buttons(&m, &perms).unwrap();
        }
        assert!(template("terminal").is_none());
    }

    #[test]
    fn instructions_name_the_plugin_and_the_rules() {
        let text = agent_instructions("local.demo", "Demo", "session-buttons", "review my diff");
        assert!(
            text.contains("`local.demo`")
                && text.contains("review my diff")
                && text.contains("{{secret:key}}")
        );
        assert!(text.contains("node --test"));
    }

    /// The bundled copies must stay identical to the templates repo, when it's present alongside.
    #[test]
    fn embedded_templates_match_the_templates_repo() {
        let root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../promptops-plugin-templates");
        if !root.is_dir() {
            return;
        }
        let pairs = [
            (
                "templates/pages/src/plugin.js",
                include_str!("studio_templates/pages/plugin.js"),
            ),
            (
                "templates/tasks/src/plugin.js",
                include_str!("studio_templates/tasks/plugin.js"),
            ),
            ("docs/CONTRACTS.md", CONTRACTS),
        ];
        for (rel, embedded) in pairs {
            let on_disk = fs::read_to_string(root.join(rel)).unwrap();
            assert_eq!(
                on_disk, embedded,
                "{rel} differs from the copy in studio_templates/"
            );
        }
    }
}
