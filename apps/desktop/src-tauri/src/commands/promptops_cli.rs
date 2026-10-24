//! The standalone CLI is embedded in the desktop binary.
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static ENTRY: OnceLock<PathBuf> = OnceLock::new();
const FILES: &[(&str, &str)] = &[
    ("main.mjs", include_str!("../../../cli/main.mjs")),
    ("config.mjs", include_str!("../../../cli/config.mjs")),
    ("transport.mjs", include_str!("../../../cli/transport.mjs")),
    ("tools.mjs", include_str!("../../../cli/tools.mjs")),
    ("agent.mjs", include_str!("../../../cli/agent.mjs")),
    ("ui.mjs", include_str!("../../../cli/ui.mjs")),
    ("input.mjs", include_str!("../../../cli/input.mjs")),
    ("ctl.mjs", include_str!("../../../cli/ctl.mjs")),
    ("mcp.mjs", include_str!("../../../cli/mcp.mjs")),
    ("skill.md", include_str!("../../../cli/skill.md")),
];
// Shim in the PTYs' PATH: `launch_line` only rewrites the typed line, while an
// agent's Bash tool must be able to run `promptops ctl …` on its own.
const SHIMS: &[(&str, &str)] = &[
    (
        "promptops",
        "#!/bin/sh\nexec node \"$PROMPTOPS_CLI_ENTRY\" \"$@\"\n",
    ),
    (
        "promptops-cli",
        "#!/bin/sh\nexec node \"$PROMPTOPS_CLI_ENTRY\" \"$@\"\n",
    ),
    ("promptops.cmd", "@node \"%PROMPTOPS_CLI_ENTRY%\" %*\r\n"),
    (
        "promptops-cli.cmd",
        "@node \"%PROMPTOPS_CLI_ENTRY%\" %*\r\n",
    ),
];

// `promptops mcp` MCP server: config for Claude Code (`--mcp-config`) and a
// port+token file for clients that start MCP servers with a cleared env (Codex).
const MCP_CONFIG_FILE: &str = "promptops.mcp.json";
const CTL_FILE: &str = "ctl.json";

pub fn install(root: &Path) -> Result<(), String> {
    write_runtime(root)?;
    let _ = ENTRY.set(root.join("main.mjs"));
    Ok(())
}
fn write_if_changed(target: &Path, source: &str) -> Result<(), String> {
    if std::fs::read_to_string(target).ok().as_deref() != Some(source) {
        std::fs::write(target, source).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn mcp_config(entry: &Path) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "mcpServers": { "promptops": { "command": "node", "args": [entry.to_string_lossy(), "mcp"] } }
    }))
    .unwrap_or_default()
}
fn write_runtime(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    for (name, source) in FILES {
        write_if_changed(&root.join(name), source)?;
    }
    write_if_changed(
        &root.join(MCP_CONFIG_FILE),
        &mcp_config(&root.join("main.mjs")),
    )?;
    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    for (name, source) in SHIMS {
        let target = bin.join(name);
        if std::fs::read_to_string(&target).ok().as_deref() != Some(*source) {
            std::fs::write(&target, source).map_err(|e| e.to_string())?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
pub fn available() -> bool {
    ENTRY.get().is_some_and(|path| path.is_file())
}
/// `ctl.json` next to the runtime: hook server port + per-launch token, user-only
/// (0600). Read by `promptops mcp --session ID` when the MCP client
/// does not pass the terminal env (Codex does `env_clear`). It holds the
/// FILE token: any process of the user can read a file, so this one drives
/// agents but never reads the saved API key (see `agent_ctl::file_token`).
pub fn write_ctl_file(port: u16) {
    let Some(root) = ENTRY.get().and_then(|entry| entry.parent()) else {
        return;
    };
    let body = ctl_file_body(port);
    if let Err(e) = write_private(&root.join(CTL_FILE), &body) {
        eprintln!("[promptops-cli] ctl.json not written: {e}");
    }
}
fn ctl_file_body(port: u16) -> String {
    serde_json::json!({ "port": port, "token": super::agent_ctl::file_token() }).to_string()
}
fn write_private(target: &Path, body: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(target)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(body.as_bytes())
}
/// Launch line fragment that registers the `promptops` MCP server in the
/// provider CLI (`claude-code-cli` or `codex` family). Claude inherits
/// the PTY env (port, token, session): the config file is enough. Codex starts
/// MCP servers with a cleared env: the session travels in the args, port and token
/// from ctl.json. `None` = runtime not installed or unsafe id.
pub fn mcp_launch_fragment(family: &str, session_id: &str) -> Option<String> {
    let entry = ENTRY.get().filter(|path| path.is_file())?;
    mcp_fragment_for(entry, family, session_id)
}
fn mcp_fragment_for(entry: &Path, family: &str, session_id: &str) -> Option<String> {
    let safe_id = !session_id.is_empty()
        && session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !safe_id {
        return None;
    }
    let root = entry.parent()?;
    match family {
        "claude-code-cli" => Some(format!(
            "--mcp-config \"{}\"",
            root.join(MCP_CONFIG_FILE).to_string_lossy()
        )),
        // TOML literal strings ('…') inside one double-quoted shell word: no
        // inner `"` (Windows PowerShell 5.1 strips them from native arguments,
        // and cmd.exe does not treat '…' as quoting) and no backslash escapes
        // (Windows paths). A path that cannot be written that way safely in
        // sh, PowerShell and cmd alike gets no MCP rather than a broken line.
        "codex" => {
            let path = entry.to_string_lossy();
            if !codex_safe_path(&path) {
                return None;
            }
            Some(format!(
                "-c \"mcp_servers.promptops.command='node'\" -c \"mcp_servers.promptops.args=['{path}','mcp','--session','{session_id}']\" -c mcp_servers.promptops.tool_timeout_sec=900"
            ))
        }
        _ => None,
    }
}
/// Characters that keep their meaning inside "…" in sh (`$` `` ` `` `\` `"`),
/// PowerShell (`$` `` ` `` `"`) or cmd (`%` `!` `"`), plus `'` (ends a TOML
/// literal string) and control characters.
fn codex_safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.chars().any(|c| {
            c.is_control()
                || matches!(c, '"' | '\'' | '$' | '`' | '%' | '!')
                || (c == '\\' && !cfg!(windows))
        })
}
pub fn apply_env(cmd: &mut CommandBuilder) {
    if let Some(entry) = ENTRY.get() {
        cmd.env("PROMPTOPS_CLI_ENTRY", entry);
        cmd.env("PROMPTOPS_CLI_CONFIG", super::assets_ext::cli_config_path());
        cmd.env(super::agent_ctl::TOKEN_ENV, super::agent_ctl::token());
        if let Some(bin) = entry.parent().map(|root| root.join("bin")) {
            let current = cmd
                .get_env("PATH")
                .map(|s| s.to_os_string())
                .or_else(|| std::env::var_os("PATH"))
                .unwrap_or_default();
            let mut paths = vec![bin];
            paths.extend(std::env::split_paths(&current));
            if let Ok(joined) = std::env::join_paths(paths) {
                cmd.env("PATH", joined);
            }
        }
        #[cfg(windows)]
        {
            let current = cmd
                .get_env("WSLENV")
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            cmd.env(
                "WSLENV",
                format!(
                    "{current}:PROMPTOPS_CLI_ENTRY/p:PROMPTOPS_CLI_CONFIG/p:PROMPTOPS_CTL_TOKEN"
                ),
            );
        }
    }
}
// No user data is interpolated into shell syntax. File paths travel as env vars.
fn bundled_line(line: String) -> String {
    match line.strip_prefix("promptops-cli").filter(|tail| tail.is_empty() || tail.starts_with(char::is_whitespace)) {
        Some(tail) => format!("node -e \"import(require('node:url').pathToFileURL(process.env.PROMPTOPS_CLI_ENTRY).href).then(m=>m.main(process.argv.slice(1))).catch(e=>{{console.error(e.message);process.exitCode=1}})\" --{tail}"),
        None => line,
    }
}
pub fn launch_line(line: String) -> String {
    if available() {
        bundled_line(line)
    } else {
        line
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn promptops_cli_embeds_all_modules_and_preserves_aliases() {
        let root = std::env::temp_dir().join(format!("promptops-cli-{}", uuid::Uuid::new_v4()));
        write_runtime(&root).unwrap();
        for (name, source) in FILES {
            assert_eq!(std::fs::read_to_string(root.join(name)).unwrap(), *source);
        }
        let mcp: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(MCP_CONFIG_FILE)).unwrap())
                .unwrap();
        assert_eq!(
            mcp["mcpServers"]["promptops"]["args"][0].as_str().unwrap(),
            root.join("main.mjs").to_string_lossy()
        );
        assert_eq!(mcp["mcpServers"]["promptops"]["args"][1], "mcp");
        for (name, source) in SHIMS {
            assert_eq!(
                std::fs::read_to_string(root.join("bin").join(name)).unwrap(),
                *source
            );
        }
        let line = bundled_line("promptops-cli --model local/model --help\r".into());
        assert!(line.starts_with("node -e "));
        assert!(line.ends_with(" -- --model local/model --help\r"));
        assert_eq!(
            bundled_line("promptops-cli-work --help\r".into()),
            "promptops-cli-work --help\r"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    // The expected strings use Unix paths.
    #[cfg(unix)]
    #[test]
    fn mcp_fragment_registers_the_server_per_provider_family_and_rejects_unsafe_ids() {
        let entry = Path::new("/Users/me/Library/Application Support/promptops/cli/main.mjs");
        assert_eq!(
            mcp_fragment_for(entry, "claude-code-cli", "sess-1").as_deref(),
            Some("--mcp-config \"/Users/me/Library/Application Support/promptops/cli/promptops.mcp.json\"")
        );
        let codex = mcp_fragment_for(entry, "codex", "sub_9").unwrap();
        assert_eq!(
            codex,
            "-c \"mcp_servers.promptops.command='node'\" -c \"mcp_servers.promptops.args=['/Users/me/Library/Application Support/promptops/cli/main.mjs','mcp','--session','sub_9']\" -c mcp_servers.promptops.tool_timeout_sec=900"
        );
        // No `"` inside a word: Windows PowerShell 5.1 would strip it.
        let words = codex.split('"').collect::<Vec<_>>();
        assert!(words.iter().skip(1).step_by(2).all(|w| !w.contains('"')));
        assert_eq!(mcp_fragment_for(entry, "generic-shell", "sess-1"), None);
        assert_eq!(mcp_fragment_for(entry, "codex", ""), None);
        assert_eq!(mcp_fragment_for(entry, "codex", "x'; rm -rf /"), None);
        for bad in [
            "/Users/O'Brien/cli/main.mjs",
            "/Users/$HOME/main.mjs",
            "/a/%TEMP%/main.mjs",
            "/a/b\"c/main.mjs",
        ] {
            assert_eq!(
                mcp_fragment_for(Path::new(bad), "codex", "s1"),
                None,
                "{bad}"
            );
        }
        // The ctl.json token is the file token, never the terminal one.
        let file: serde_json::Value = serde_json::from_str(&ctl_file_body(4321)).unwrap();
        assert_eq!(file["port"], 4321);
        assert_eq!(file["token"], crate::commands::agent_ctl::file_token());
        assert_ne!(file["token"], crate::commands::agent_ctl::token());
        let private = std::env::temp_dir().join(format!("promptops-ctl-{}", uuid::Uuid::new_v4()));
        write_private(&private, "{}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&private).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::remove_file(private).unwrap();
    }
}
