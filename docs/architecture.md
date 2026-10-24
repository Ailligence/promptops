# Architecture

A map of the code for people who want to change it. PromptOps is one desktop
app built from two halves: a native shell in Rust (Tauri 2) and a web UI in
Angular that runs inside the shell's webview. There is no server.

```
┌──────────────────────────── PromptOps (one process, every window) ─────────────────────────┐
│                                                                                            │
│  apps/web  (Angular, in the webview)                                                       │
│    views, sessions grid, xterm.js terminals                                                │
│    core/data/DataBackend ──┐          window.promptops.* ──┐                               │
│                            │ local_call                    │ Tauri commands / Channels     │
│  ──────────────────────────┼───────────────────────────────┼───────────────────────────────│
│  apps/desktop/src-tauri  (Rust)                            │                               │
│    local_data.rs ─ local_store.rs ─ vault.rs               commands/*  (terminal, session,  │
│    encrypted local-store.json, key in OS keychain          subagent, git, db, ssh, voice…) │
│                                                                                            │
│    hook server 127.0.0.1:<random port> ◄── agent CLI hooks, `promptops ctl`, MCP server    │
│    plugin host webview (sandboxed iframe) ◄─► plugins/broker.rs                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
          │ PTY                                     ▲ hooks / ctl over HTTP on loopback
          ▼                                         │
   claude, codex, gemini, … (the agent CLIs you already have installed)
```

## Repository layout

| Path | What lives there |
| --- | --- |
| `apps/web` | Angular UI. Built with `ng build --configuration=desktop` and loaded by the shell. |
| `apps/desktop/src-tauri` | Rust crate `promptops-oss`: windows, terminals, data, hooks, plugins. |
| `apps/desktop/src-tauri/src/promptops_bridge.js` | Script injected in every app window (main and detached, not the plugin host) before Angular starts; exposes `window.promptops`. |
| `apps/desktop/cli` | `promptops` CLI embedded in the binary: `promptops ctl`, the MCP server, a small coding agent. |
| `apps/desktop/bridge` | Typed reference for the terminal commands (TypeScript). The app does not import it; the live bridge is `promptops_bridge.js`. |
| `apps/npm` | `npx @shellonback/promptops`: installs PromptOps Desktop, verifying its signature. |
| `scripts` | Notices generation and repository tooling. |
| `docs` | This file, the [Session Vault](session-vault.md), [plugins](plugins/plugin-guidelines.md), [dependencies](supply-chain.md), [releasing](releasing.md). |

## The web UI talks to Rust in two ways

1. **`window.promptops`** — the API the UI was written against. The bridge
   script maps each IPC channel name to a Rust `#[tauri::command]`
   (`terminal:open` → `terminal_open`) and turns Tauri events back into
   callbacks. Commands are registered in `lib.rs` (`generate_handler!`); the
   window permissions are in `src-tauri/permissions` and `capabilities`.
2. **`DataBackend`** (`apps/web/src/app/core/data`) — every read or write of
   app data: sessions, workspaces, profiles, folders, prompts, shortcuts,
   notes, preferences. Services inject the `DataBackend` token; the desktop
   implementation calls the single `local_call` command with a method name
   such as `sessions.list`. The method list is `DATA_METHODS`
   (`data-methods.ts`) on the web side and `local_data::call` on the Rust side.

## Data and encryption

- `local_data.rs` / `local_data_more.rs` implement the data methods. They
  never open a network connection.
- `local_store.rs` keeps everything in one file, `local-store.json`, in the
  app data folder. Each record is a separate AES-256-GCM envelope.
- `vault.rs` is the Session Vault: key generation, OS keychain storage,
  envelope format and authenticated data. The format and threat model are in
  [session-vault.md](session-vault.md).
- Saved SSH and database connections, with their credentials, are records
  of the store like everything else. Terminal history kept to restore a
  session is sealed with the same key into its own file per session.
- `local_backup.rs` writes and restores passphrase-encrypted backups
  (Argon2id and AES-256-GCM), described in
  [session-vault.md](session-vault.md#backups).

## Terminals and agents

- `commands/terminal.rs` owns the PTYs (`portable-pty`). Output is streamed as
  binary over a Tauri `Channel`, coalesced every few milliseconds, with flow
  control so a fast process cannot flood the UI.
- `commands/session.rs` creates and restores sessions; `commands/subagent.rs`
  spawns the extra agents of a session, with provider, model, effort and mode
  (`subagent_modes.rs`).
- `commands/session.rs` (`build_launch_command_inner`) builds the launch and
  resume command of each agent CLI for a session's main agent, and
  `commands/subagent.rs` (`build_subagent_launch`) for sub-agents;
  `commands/providers.rs` lists the providers and detects which CLIs are
  installed. CONTRIBUTING explains [how to add one](../CONTRIBUTING.md#adding-a-provider).

## Hooks, `promptops ctl` and MCP

`commands/hook.rs` runs a tiny HTTP/1.1 server on `127.0.0.1` at a random
port. The agent CLIs reach it in three ways:

- **Hooks** — PromptOps installs hooks in the CLIs that support them (for
  example Claude Code, through a settings file passed with `--settings`, and
  Gemini CLI). They report tool use, turn ends and
  permission prompts, which drive the status dots, notifications and metrics.
- **`promptops ctl`** (`cli/ctl.mjs` → `commands/agent_ctl.rs`) — lets an
  agent list, open, prompt, wait for and read its sibling agents.
- **MCP server** (`cli/mcp.mjs`) — the same operations as MCP tools, added
  automatically to Claude Code and Codex.

Every endpoint that controls agents requires a per-run token passed to the
terminals in an environment variable, and requests sent by a browser are
refused. A caller id that is neither a live session nor one of its
sub-agents gets `403 unknown_caller`. `ctl` and MCP calls only reach the agents of the caller's session;
that scoping prevents mistakes, it is not a security boundary (the token is
shared by every PromptOps terminal, see the threat model in
[SECURITY.md](../SECURITY.md#threat-model)). The same token lets the bundled
`promptops` CLI read the model API key saved in the app
(`/ctl/cli/llm-key`), so the key is never written to a file. The MCP server
under Codex reads a second token from `ctl.json` that drives agents but gets
`403` on that endpoint.

## Plugins

`src-tauri/src/plugins` hosts third-party plugins: JavaScript in a sandboxed
iframe inside a webview with no Tauri capability. Everything a plugin does
goes through `broker.rs`, which enforces the permissions of the installed
manifest and keeps secrets in Rust. See the
[plugin guide](plugins/plugin-guidelines.md).

## What is not here

PromptOps Desktop, the hosted edition, adds an account, Teams, sync and the
mobile app. That code is not in this repository: the routes for those
features show a lock (`CloudFeatureModalComponent`) and run nothing. See
`apps/web/src/app/core/local-mode.ts`.

## Where to start

- A UI change: find the component under `apps/web/src/app/views` and run
  `npm run dev` from `apps/desktop` (it starts `ng serve` and the shell).
- A native change: find the command name the UI calls (`terminal:open`),
  replace `:` and `-` with `_` and search the Rust crate for it.
- Before opening a pull request: `scripts/check.sh` runs the Rust, CLI and web
  checks of the CI; [CONTRIBUTING](../CONTRIBUTING.md#running-the-checks) lists the rest.
