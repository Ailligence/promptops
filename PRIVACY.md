# Privacy

The open-source edition of PromptOps runs on your computer. It has no
account, no sign-in and no PromptOps server behind it. This page lists
everything it stores and every network connection it can make, so you can
check it against the code. The last section covers PromptOps Desktop, the
ready-to-run app you download from the releases of this repository, which
works differently.

## What stays on your device

Everything you create in the app:

- sessions, workspaces, session profiles and sidebar folders;
- your prompt library, with versions, categories and tags;
- notes, to-dos, shortcuts and action buttons;
- saved SSH connections and database connections, with their passwords and keys;
- the API keys you save in the app (Groq for voice input, the model provider
  key of the PromptOps CLI);
- agent profiles, the list of recent workspace folders and the name of the
  last active session;
- your display name and UI preferences.

These live in one file, `local-store.json`, in the app data folder
(`~/Library/Application Support/promptops-oss` on macOS, `%APPDATA%\promptops-oss`
on Windows, `~/.local/share/promptops-oss` on Linux).

Each record in that file is encrypted on its own with **AES-256-GCM** (the
Session Vault). The key is created on your device and kept in the OS
keychain. When no keychain is available (some Linux setups), the key is
stored in `vault.key` next to the store, readable only by your user account,
and the app says so in its log. Development builds always use `vault.key`.
A store file that cannot be read is never overwritten: it is set aside as
`local-store.json.corrupt-<time>` and the app starts empty and tells you.

Plugin secrets (the tokens you enter in a plugin's settings) are kept in each
plugin's own `secrets.json`, encrypted with AES-256-GCM under a key in the OS
keychain. Without a keychain (and in development builds) that file stays in
clear text, readable only by your user account, and the plugin's settings say
so. Code: [`plugins/secrets.rs`](apps/desktop/src-tauri/src/plugins/secrets.rs).

A backup (Settings → Backup & restore) is a file you choose where to save.
It holds the records above, including saved passwords and API keys, all
encrypted with AES-256-GCM under a key derived from your passphrase
(Argon2id). The app never uploads it anywhere, and nobody can open it
without the passphrase. Format: [Session Vault](docs/session-vault.md#backups).

Terminal history that PromptOps keeps to restore a session after a restart is
encrypted with the same key, in separate files. Prompts handed to an agent CLI
for a one-off task, and the agent's answer file, go through a temporary folder
with a random name readable only by your user account, deleted right after.

The PromptOps CLI settings (provider, model, endpoint) are in
`fcc-config.json` in the same folder, without the API key: the key is in the
encrypted store, and the `promptops` CLI asks the app for it when it runs in a
PromptOps terminal. A key that an earlier version left in that file in clear
text is moved to the encrypted store the first time the settings are read.
`ctl.json`, read by the PromptOps MCP server when an agent CLI clears the
environment, holds a token that can drive agents but cannot fetch that key.

The app data folder and every file PromptOps writes in it are readable only
by your user account (0700 and 0600 on macOS and Linux).

A second folder, named after the app identifier
(`~/Library/Application Support/it.promptops.oss` on macOS,
`%APPDATA%\it.promptops.oss` on Windows, `~/.local/share/it.promptops.oss` on
Linux), holds files that are not in the encrypted store: the bundled
`promptops` CLI, the downloaded voice model, installed plugins, the SSH
`known_hosts` file, the Chrome profile of the Browser page, and small JSON
settings files in clear text: the list of provider accounts
(`provider-accounts.json`), the voice shortcut and `desktop-state.json`, which
now holds only the context-transfer preferences per workspace folder. Agent
profiles, recent workspaces and the last active session name used to be in
clear-text files there; they are moved into the encrypted store the first time
the app starts, and the old files are removed.

Also in clear text, in the app data folder: usage statistics
(`promptops/usage.json` and the token history: session names, workspace
folders, models and token counts, never prompt text), the order of the agents
of each session (`agents-meta.json`) and a few switches (auto-standby, active
session profile). Error reports go to the app log folder.

Code: [`local_store.rs`](apps/desktop/src-tauri/src/local_store.rs),
[`vault.rs`](apps/desktop/src-tauri/src/vault.rs).

PromptOps never sends terminal output, agent conversations or your prompts
anywhere by itself. The agents you run send what you give them to their own
providers, and the AI helper features listed below do the same through one of
your agent CLIs, only when you use them.

## Files PromptOps writes outside its own folders

- **Claude Code hooks**: one file, `hooks/claude-settings.json` in the app
  data folder, passed to `claude` with `--settings`; your repository is not
  touched. With a Claude Code too old for `--settings`, and for sessions
  inside WSL, the hooks are merged into `<workspace>/.claude/settings.local.json`
  instead.
- **Gemini CLI and Antigravity hooks**: added to `~/.gemini/settings.json`
  and `~/.gemini/config/hooks.json`, after a copy of the original is saved in
  `config-backups` in the app data folder. The hook does nothing outside
  PromptOps. System cleanup removes the hooks PromptOps installed.
- **Claude Code folder trust**: Plugin Studio and the Browser page mark the
  folder they open as trusted in `~/.claude.json`, the same as answering
  "Yes" to Claude Code's trust question.
- **`<workspace>/.promptops/`**, only when you use the feature: the code graph
  and semantic search index (Knowledge panel), the shared context between
  agents, and the answer you give when PromptOps asks whether it may add
  context to your `CLAUDE.md`-style files (`context-policy.json`).
- **`~/.promptops/`**: Git Setup remembers which SSH key you picked per
  folder (`git-setup.json`), and managed provider accounts live under
  `~/.promptops/provider-accounts/`.

## How the interface reads your data

The interface never uses the network for your data. It reads and writes
through one interface, `DataBackend`
([`data-backend.ts`](apps/web/src/app/core/data/data-backend.ts)), with a
fixed list of methods
([`data-methods.ts`](apps/web/src/app/core/data/data-methods.ts)). In this
edition that interface calls a single desktop command, `local_call`, which
reads and writes the encrypted local store
([`local_data.rs`](apps/desktop/src-tauri/src/local_data.rs) and
[`local_data_more.rs`](apps/desktop/src-tauri/src/local_data_more.rs)).

Environment variables in session settings and the text of prompts sent to
agents are removed before a session is stored.

## Network connections

PromptOps itself contacts the network only in these cases:

| When | Where | What is sent |
|---|---|---|
| You open the plugin catalog | `raw.githubusercontent.com` (public index of official plugins) and `github.com` / `avatars.githubusercontent.com` (avatars of plugin authors) | Plain downloads, with no credentials or identifiers |
| You have plugins installed from the catalog: at start and every 6 hours | Same public index | Same download, to see updates and revoked plugins |
| You install or update a plugin | `raw.githubusercontent.com`, pinned to a commit | A plain download; the bundle hash is verified |
| A plugin you installed uses a host it declares in its manifest (`net:` permission) | That host only | What the plugin sends, inside its sandbox |
| First use of voice input | `huggingface.co` | Download of the local Whisper model, checked against a SHA-256 pinned in the app before it is used; after that, audio is transcribed on your device |
| Voice input while the local model is not ready (or fails), if you saved a Groq key in the app | `api.groq.com` | The recorded audio, under your account. Keys in environment variables (`GROQ_API_KEY`, `OPENAI_API_KEY`) are ignored: audio goes to a cloud service only after you choose it in the app |
| Same case on macOS with no key, in a language without an on-device model | Apple's speech service, through macOS | The recorded audio; with an on-device model it stays on the Mac |
| Same case, as a last resort, if you installed OpenAI's `whisper` command yourself | Nothing from PromptOps: the `whisper` program runs on your device (it may download its own model the first time) | Audio stays on your device |
| You open the Browser page | Google Chrome, started by PromptOps with its own profile, opens the address you type (the start page is google.com) | What any browser sends to the sites you visit |
| You import an asset from a URL | The address you paste | A plain download of that file |
| You save or test a Groq key in Settings | `api.groq.com` (list of models) | Your key, to check it |
| You set up and test a custom model endpoint for the PromptOps CLI (OpenRouter, Ollama, LM Studio, another OpenAI-compatible server) | The endpoint you entered | A short test request, with the key you entered |
| You connect, test or browse a saved SSH connection, or open a remote session | The SSH server you saved | An SSH login with the password or key you saved. Host keys are trusted on first use, see [SECURITY.md](SECURITY.md#accepted-risks) |
| You open a database in the database explorer | The database server you configured (MongoDB through your own `mongosh`) | The queries you run, with the credentials you saved |
| You use a feature that asks an AI for help: commit messages, conflict resolution, prompt enhancement and generation, plain-language database queries, AI Git Writer, smart context, project brief, dev links and ports scan | One of your agent CLIs, run in the background; it talks to its own provider | The text the feature needs (for example the diff or your prompt), under your account with that provider. The dev links scan sends lines of your `.env` files that name URLs, hosts and ports, with passwords in URLs replaced by `***` |
| Database auto-detection, when the `.env` files do not give a working connection | One of your agent CLIs | Up to 15,000 bytes of your workspace's `.env*`, `docker-compose.yml`, `config/database.*` and similar configuration files (ORM configs, `settings.py`, `application.*`, `appsettings*.json`, `package.json`), so the AI can find the connection settings. Secret values are replaced by markers such as `[redacted:1]` before anything is sent: values of keys that name a password, secret, token, API or access key, salt or credential, the password part of URLs and of `password=` parameters, PEM private keys and well-known token formats. Hosts, ports, database and user names are sent as they are. The real values stay on your computer and are put back into the connection the AI suggests |
| AI auto-approve is on and an agent stops to ask something | One of your agent CLIs | The last 30 lines of that agent's terminal, so the AI can write the answer |
| You run AI Agent Evals (speed test) | Each agent CLI you pick | A fixed test prompt, in an empty folder |
| You click Refresh or Retry in the Usage panel, or a Claude Code or Gemini CLI session you started reports its start (after 20 seconds) or a finished turn; a result is reused for 5 minutes (10 on Windows) | That CLI, started once in a hidden terminal; it contacts its provider with your account | The `/usage` (Claude Code), `/status` (Codex) or `/stats` (Gemini CLI) command. Codex usage is read from its session files on disk (`~/.codex/sessions`) whenever they exist. A Plain Shell or a session of another provider never starts one |
| Semantic search, only if you made `@xenova/transformers` available to the app (`PROMPTOPS_SIDECAR_NODE_MODULES`; it is not shipped) | `huggingface.co` | First run only: download of the `Xenova/all-MiniLM-L6-v2` model (about 80 MB). Your code is embedded on your device |
| You click a link | Your browser opens it | Nothing from the app |

The interface cannot load images from other sites: its content security
policy allows remote images only from `github.com`,
`avatars.githubusercontent.com` and `raw.githubusercontent.com`.

Not listed because PromptOps does not do it: telemetry, analytics, crash
uploads, update checks, ads, tracking pixels. Crash reports are written to
the app log folder without any message content and deleted after 7 days.

The AI agents you run (Claude Code, Codex, Gemini CLI and others) are separate
programs. They connect to their own providers under their own terms;
PromptOps does not proxy or read that traffic.

## PromptOps Desktop, the hosted edition

Teams, the ranking, community prompts, news, mobile access and sync across
devices need a server, so they are part of PromptOps Desktop, which you can
download from [promptoperations.ai](https://www.promptoperations.ai/). In this
edition they are shown with a lock and run no code.

PromptOps Desktop encrypts session names, paths and settings in its database
with the same algorithm (AES-256-GCM). The difference is where the key lives:
here it is on your device; in the hosted edition it is held by our servers,
so your sessions can follow you across devices.

Unlike the open-source edition, PromptOps Desktop:

- needs an account and signs in to PromptOps servers;
- checks GitHub Releases for updates and installs only builds signed with
  the PromptOps release key;
- sends your sessions' state to PromptOps servers so it can follow you
  across devices;
- records your active time and online presence, used by Teams and the
  ranking;
- sends usage signals for in-app announcements, interface experiments and
  plugin statistics.

The [PromptOps privacy policy](https://www.promptoperations.ai/legal/privacy/)
covers this data in full.

## Check it yourself

- Block the app's network access: everything listed under "What stays on your
  device" keeps working.
- Search the code: `data-backend.ts` is the only way the interface reaches
  your data, and `local_data.rs` is where it is stored.
- Questions or findings: open an issue, or follow [SECURITY.md](SECURITY.md)
  for anything sensitive.
