# PromptOps CLI

Standalone coding assistant that runs inside PromptOps terminals. No npm runtime dependencies. Licensed under the Apache License 2.0, like the rest of the repository.

The Tauri binary embeds nine `.mjs` modules plus the agent skill (`skill.md`) and extracts them into its app-data directory at startup, together with `bin/promptops` and `bin/promptops-cli` shims that are prepended to the `PATH` of every PromptOps terminal. Main sessions and sub-agents launch those modules using the same `fcc-config.json` as AI Accounts → PromptOps CLI. Node.js **18.17+** must be on the terminal PATH; file search requires **ripgrep**. Node itself is not bundled.

## Run

From `apps/desktop`:

```sh
npm run cli -- --help
npm run cli -- --model my-model --base-url http://127.0.0.1:11434/v1
npm run cli -- --model my-model --base-url http://127.0.0.1:11434/v1 --models
npm run cli -- --model my-model --base-url http://127.0.0.1:11434/v1 --prompt 'Explain this project'
npm run test:cli
```

Configure through AI Accounts or `--config FILE`. Environment overrides: `PROMPTOPS_LLM_PROVIDER`, `PROMPTOPS_LLM_MODEL`, `PROMPTOPS_LLM_BASE_URL`, `PROMPTOPS_LLM_API_KEY`. `PROMPTOPS_CLI_CONFIG` selects the config file. Do not pass API keys as command arguments.

## Agent control (`promptops ctl`)

`ctl.mjs` is a zero-dependency client for the desktop app's local control plane (`/ctl/*` on the hook server, `src-tauri/src/commands/agent_ctl.rs`). From any PromptOps terminal — whatever provider runs in it — an agent can list, spawn, prompt, wait for and read the sibling sub-agents of its session:

```sh
promptops ctl --help
promptops ctl agent spawn --name reviewer --prompt 'Review the current diff' --wait --timeout 600000
promptops ctl agent read reviewer --source last-message
promptops ctl skill install   # opt-in Claude Code skill
```

Requests carry the per-launch `PROMPTOPS_CTL_TOKEN` and the caller's `PROMPTOPS_SESSION_ID`; scope is the caller's parent session. A `blocked` agent (permission dialog) never receives input from ctl. `wait` is a sliced long-poll (45 s per request) so it stays below Node's fetch header timeout.

## MCP server (`promptops mcp`)

`node main.mjs mcp [--session ID]` runs a Model Context Protocol server on stdio (JSON-RPC 2.0, newline-delimited, no dependencies) that exposes the ctl control plane as tools: `promptops_agent_list`, `promptops_agent_spawn` (opens a new agent terminal in the caller's session), `promptops_agent_get`, `promptops_agent_prompt`, `promptops_agent_wait`, `promptops_agent_read`, `promptops_agent_keys`, `promptops_agent_bench` (hide an agent from the grid while it keeps working) and `promptops_agent_move_to_session` (move an agent to a new session; the user names it). Every tool works on this computer only: there is no tool that needs an account or a server.

PromptOps registers it automatically:

- Claude Code (and zai/kimi): `--mcp-config <app_data>/cli/promptops.mcp.json`; the server inherits `PROMPTOPS_HOOK_PORT`, `PROMPTOPS_CTL_TOKEN` and `PROMPTOPS_SESSION_ID` from the terminal.
- Codex: `-c mcp_servers.promptops.command/args/tool_timeout_sec`; Codex starts MCP servers with a clean environment, so the session id travels as `--session ID` and port + token are read from `<app_data>/cli/ctl.json` (0600, rewritten at every app start). That file holds a second token which drives agents but cannot read the saved PromptOps CLI API key: only the token in a PromptOps terminal's environment can.

Remote (SSH) sessions are not registered: the desktop app is not reachable from the remote host. Waits default to 5 minutes and are capped at 25 (`timeout_ms`); Codex gets `tool_timeout_sec=900`.

Manual registration for other clients: command `node`, args `["<app_data>/cli/main.mjs", "mcp"]`, run inside a PromptOps terminal.

### Security model

The caller is an LLM agent, so every input is untrusted. The MCP server has no credentials of any service and makes no network call: it only reaches the desktop app on `127.0.0.1`.

- Transport: per-launch 244-bit token, checked in constant time before the request body is read; requests carrying `Origin` (a browser) or a non-local `Host` (DNS rebinding) are refused; header, body, time and concurrency limits on every connection; the token is never sent anywhere but loopback and never follows a redirect. The legacy `/subagent/*` routes need the same token.
- Scope: the tools act on the caller's session only; a caller id that is not a live session or agent is refused. No closing agents, no answering permission dialogs. This keeps agents from wandering across sessions; it is not a wall against code you run yourself: anything running as your OS user can read the app's control token, as it can read the rest of your files.
- No authority gain: unless the session is in auto-approve, the app refuses raw shells, providers not known to ask before running tools, modes that auto-accept edits, a `cwd` outside the workspace, prompts to agents that are not hook-certified `idle`, text that the target CLI would run as a command (`!…`, `/…`), literal text and submit/approve keys through `keys`.
- Injection: `provider` is an allowlist (it becomes part of a shell line), `mode`/`role` are identifiers, `model` is a model id that cannot start with `-`, `effort` is a fixed list, text is stripped of control characters (an `ESC[201~` would end the bracketed paste and type the rest as keys).
- Abuse: at most 12 live agents, 20 spawns, 60 prompts, 600 key calls and 60 bench calls per session per 10 minutes.
- Input to the MCP server itself: only known fields of the expected type are forwarded, lines are capped at 2 MiB, at most 16 tool calls in flight, JSON-RPC batches are refused.

## Compatibility

The integration contract is OpenAI-compatible **Chat Completions**, with optional `/models` discovery. Model IDs are unrestricted; a custom base URL supports servers outside the desktop catalog. Root URLs receive `/v1`, while custom paths are preserved. Defaults match the existing desktop provider catalog.

- Streaming UTF-8, fragmented native tool calls, usage-only chunks and normal JSON responses.
- `--tool-mode auto` remembers explicit tool-support rejection and falls back to strict whole-response tool JSON; `native`, `text` and `off` are also available.
- Explicit unsupported streaming/system-role responses receive compatibility fallbacks.
- Native reasoning and fragmented inline `<think>` tags are separated from the displayed answer.
- Bounded overload retries; no authentication retries; timeout and Ctrl+C cancellation.
- Asynchronous tools, complete-turn context eviction, 12 agent steps and at most 16 native calls per step.

This is protocol compatibility, **not certification of every model**. Tool accuracy/chat templates remain model-dependent. Models without useful tool abilities may need `--tool-mode off`. Vision, audio, embeddings and providers exposing only non-compatible protocols are not implemented.

Protocol references: [Ollama](https://docs.ollama.com/api/openai-compatibility), [LM Studio tool use](https://lmstudio.ai/docs/developer/openai-compat/tools).

## Terminal and tools

Compact banner, incremental output, activity indicator, elapsed time and provider-reported token counts. Redirected output is plain text; `NO_COLOR` disables styling. Input and approvals are serialized. Bracketed multiline paste is submitted as one prompt on Enter.

Commands: `/help`, `/models`, `/clear`, `/tokens`, `/exit`, `/read`, `/ls`, `/search`, `/run`, `/git`, `/diff`, `/status`.

Model-requested writes, edits, shell commands and Git commands require approval. Non-interactive requests deny them unless `--yes` is explicit. Desktop Auto-approve maps to `--yes`. Manually typed slash commands are explicit user actions.

File tools reject paths/symlinks outside the workspace, and never reinterpret invented absolute paths as other files. Edits require a unique exact match. Search passes arguments directly to `rg`. Shell commands are not filesystem-sandboxed. Interrupted turns keep completed tool results, since approved changes may already have happened.

## QA

`npm run test:cli`: deterministic transport/tool tests plus real Node subprocesses against mocked providers. No production credentials are used.

`cargo test --lib --offline promptops_cli`: embedded files, launch commands and endpoint normalization. Session regression tests also run with `cargo test --lib --offline commands::session::tests`.

Interactive PTY QA covers approval, execution, denial, request cancellation and cancellation while awaiting approval, using a temporary workspace and mock model. Windows and WSL support has not been certified on real machines yet.
