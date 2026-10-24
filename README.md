<h1 align="center">
  <img src="docs/assets/logo.png" alt="PromptOps" width="64" valign="middle" /> PromptOps
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&amp;label=%E2%98%85&amp;color=4F41FA" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-4F41FA?style=flat" alt="License: Apache-2.0" />
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshellonback%2Fpromptops%2Fbadges%2Fdownloads.json" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4F41FA?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
  <a href="https://t.me/promptoperations"><img src="https://img.shields.io/badge/Telegram-promptoperations-26A5E4?style=flat&amp;logo=telegram&amp;logoColor=white" alt="Telegram channel" /></a>
</p>

<p align="center">
  <b>English</b> · <a href="docs/i18n/README.it.md">Italiano</a> · <a href="docs/i18n/README.fr.md">Français</a> · <a href="docs/i18n/README.es.md">Español</a> · <a href="docs/i18n/README.de.md">Deutsch</a> · <a href="docs/i18n/README.pt.md">Português</a> · <a href="docs/i18n/README.zh.md">中文</a> · <a href="docs/i18n/README.ja.md">日本語</a> · <a href="docs/i18n/README.ru.md">Русский</a> · <a href="docs/i18n/README.ar.md">العربية</a> · <a href="docs/i18n/README.hi.md">हिन्दी</a> · <a href="docs/i18n/README.pl.md">Polski</a> · <a href="docs/i18n/README.nl.md">Nederlands</a> · <a href="docs/i18n/README.sv.md">Svenska</a> · <a href="docs/i18n/README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>The multi-project, multi-session ADE for CLI AI coding agents.</strong><br/>
  Run Claude Code, Codex, Gemini CLI and every other CLI agent side by side — organized by client, project and session, on your machine, with your own subscriptions.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>Download PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/seven-agents.jpg"><img src="docs/assets/readme/seven-agents.gif" alt="Seven agents working side by side in one PromptOps session: one opened from the prompt box, five opened by the lead through MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>This repository is home to the PromptOps Desktop releases and to the open-source edition: no account, no sign-in, no PromptOps server, and you <a href="#open-source-edition--build-it-yourself">build it yourself</a>. PromptOps Desktop is the ready-to-run app, with Teams, sync and the mobile app. <a href="PRIVACY.md">What leaves your machine →</a></sub>
</p>

## Quick Start

1. **[Download PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** or run `npx @shellonback/promptops`. Or [build the open-source edition](#open-source-edition--build-it-yourself) yourself.
2. **Add a workspace**: pick the project folder your agents will work on.
3. **Start a session** with an agent CLI you already use (Claude Code, Codex, Gemini CLI…). PromptOps detects the installed ones.
4. **Let it open more agents**: ask the lead *"Open 3 PromptOps agents here: one for the tests, one for the README, one for a review"*, and they appear next to it, each on its own part. Claude Code and Codex get the PromptOps MCP server automatically; every other agent can do the same through the `promptops ctl` command in its terminal.

## Features

<table>
<tr>
<td width="50%" valign="middle">

### Agents That Run Agents

Ask your lead agent to split the work: through the built-in MCP server it opens one agent per part, collects their reports and moves work to a new session. Risky actions stay behind your approval.

[MCP server →](apps/desktop/cli/README.md)

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/agents-organize.jpg"><img src="docs/assets/readme/agents-organize.gif" alt="A lead agent opens sibling agents through the PromptOps MCP server" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/right-agent.jpg"><img src="docs/assets/readme/right-agent.gif" alt="Spawning sub-agents with different providers and models" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### The Right Agent for Every Task

Pick the provider, model and effort per sub-agent: Claude on the refactor, Gemini on the bundle analysis, Codex on the review — all in one session. Working modes (Sprint, Architect, Detective, Paranoid…) map to each CLI's native flags.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### One-Click Commands, Sessions That Survive

When Claude suggests a command, hit play next to it: it runs in the terminal and the agent reads the result. Quit and reopen the app — same sessions, same agents, same place.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/one-click-run.jpg"><img src="docs/assets/readme/one-click-run.gif" alt="Running a suggested command with one click, then restoring the session" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/floor-plan.jpg"><img src="docs/assets/readme/floor-plan.gif" alt="Floor Plan showing agents grouped by client" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

Every client, every session, one floor. Desks light up when an agent finishes or needs you, and the floor stays at your side, in 3D or 2D, while you work.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

When a sub-agent prompt is just a command, PromptOps offers to run it straight in the terminal: faster, and no tokens spent. Every session shows its real token usage, cache hits and cost, read from the agent's own transcript.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/token-efficiency.jpg"><img src="docs/assets/readme/token-efficiency.gif" alt="PromptOps suggests running a command directly in the terminal instead of spending tokens" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/teams.jpg"><img src="docs/assets/readme/teams.gif" alt="Teams in PromptOps Desktop: virtual office, chat and boards" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

Your team right next to your agents: a virtual office, chat, project boards and sprints. Hit play on a task and an agent picks it up in your session; drag it to Done when the tests pass.

Teams needs a server, so it lives in [PromptOps Desktop](https://www.promptoperations.ai/), the hosted edition. In the open-source edition it shows a lock and runs no code.

</td>
</tr>
</table>

**Also in the box:**

- **Session Vault** — Sessions, prompts, notes and settings encrypted record by record with AES-256-GCM, key in your OS keychain. Passphrase-encrypted backups to move to another computer or recover lost data. [Format and threat model →](docs/session-vault.md)
- **Prompt library** — Versioned prompts with variables, categories, tags and stars, one click away from any agent.
- **Plugins you build locally** — A sandboxed plugin host and Plugin Studio: scaffold a plugin in a folder, let an agent write it, reload it live. Share it with a pull request to the official catalog. [Plugin guide →](docs/plugins/plugin-guidelines.md)
- **Built-in dev tools** — Git explorer and AI commit messages, database explorer, code editor, Docker and ports panels, SSH terminals.
- **Provider limits, handled** — When an agent hits its plan limit, PromptOps shows which other installed CLIs can take over and switches with one click.
- **Voice prompts on your device** — Local Whisper transcription; your own Groq key only as a fallback, if you save one in Settings.
- **Usage and speed** — Token usage per session and a side-by-side speed test of the models you have access to.
- **Native and light** — Rust and Tauri 2 with a native PTY. No bundled Chromium.

---

## Supported Agents

Works with **any CLI agent** — if it runs in a terminal, it runs in PromptOps.

<p>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><kbd><img src="docs/assets/providers/claude.svg" alt="" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="docs/assets/providers/openai.svg" alt="" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://github.com/google-gemini/gemini-cli"><kbd><img src="docs/assets/providers/gemini.svg" alt="" width="16" valign="middle" /> Gemini CLI</kbd></a> &nbsp;
  <a href="https://antigravity.google"><kbd><img src="docs/assets/providers/antigravity.svg" alt="" width="16" valign="middle" /> Antigravity</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="docs/assets/providers/copilot.svg" alt="" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://cursor.com/cli"><kbd><img src="docs/assets/providers/cursor.svg" alt="" width="16" valign="middle" /> Cursor</kbd></a> &nbsp;
  <a href="https://x.ai/cli"><kbd><img src="docs/assets/providers/grok.svg" alt="" width="16" valign="middle" /> Grok</kbd></a> &nbsp;
  <a href="https://dev.meta.ai/docs/muse-code"><kbd><img src="docs/assets/providers/muse.svg" alt="" width="16" valign="middle" /> Muse</kbd></a> &nbsp;
  <a href="https://hermes-agent.nousresearch.com/docs/"><kbd><img src="docs/assets/providers/hermes.svg" alt="" width="16" valign="middle" /> Hermes</kbd></a> &nbsp;
  <a href="https://docs.z.ai"><kbd><img src="docs/assets/providers/zai.svg" alt="" width="16" valign="middle" /> Z.AI</kbd></a> &nbsp;
  <a href="https://www.kimi.com/code"><kbd><img src="docs/assets/providers/kimi.svg" alt="" width="16" valign="middle" /> Kimi</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="docs/assets/providers/terminal.svg" alt="" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="apps/desktop/cli/README.md"><kbd><img src="docs/assets/providers/terminal.svg" alt="" width="16" valign="middle" /> PromptOps CLI</kbd></a> &nbsp;
  <kbd>+ any CLI agent</kbd>
</p>

PromptOps launches the official CLIs with the accounts you already pay for. No proxy, no token resale: each agent talks to its own provider, under its own terms.

<sub>Product names and logos belong to their owners. PromptOps is an independent project, not affiliated with or endorsed by them.</sub>

Missing one? Adding a provider is a well-defined change — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Install

### PromptOps Desktop — ready to run

macOS, Windows and Linux. Includes Teams, sync across devices, the mobile app and SSO, and needs an account.

- **[Download from GitHub Releases](https://github.com/shellonback/promptops/releases/latest)**, notarized on macOS.
- Or, with Node.js 18 or newer: `npx @shellonback/promptops`. It installs and opens PromptOps Desktop, and refuses any download that is not signed with the PromptOps release key.

It encrypts your session data with the same algorithm as the open-source edition; the difference is that the key is held by our servers, so your sessions can follow you. See [PRIVACY.md](PRIVACY.md#promptops-desktop-the-hosted-edition).

### Open-source edition — build it yourself

No account and no server: everything stays on your computer. There are no prebuilt binaries of this edition; build it with the commands below.

These are the exact commands our [CI](.github/workflows/build.yml) runs on a clean macOS, Windows and Linux machine for every change.

**1. Install the tools** — [Node.js](https://nodejs.org) 24.15 or newer (22.22.3 or a newer 22.x also works: Angular requires it), [Rust](https://rustup.rs) (stable), Git and CMake.

<details>
<summary><b>macOS</b></summary>

```bash
xcode-select --install
brew install node cmake
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

</details>

<details>
<summary><b>Windows</b></summary>

Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload, then in PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS Rustlang.Rustup Git.Git Kitware.CMake LLVM.LLVM
```

Open a new terminal afterwards so the new tools are on your `PATH`. WebView2 is already part of Windows 10 and 11.

</details>

<details>
<summary><b>Linux</b> (Debian, Ubuntu)</summary>

```bash
sudo apt-get update
sudo apt-get install -y build-essential curl wget file git cmake clang \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libxdo-dev
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

On Fedora, Arch and others, install the same libraries from the [Tauri prerequisites](https://tauri.app/start/prerequisites/#linux) page.

</details>

**2. Get the code and its dependencies** (same on every platform):

```bash
git clone https://github.com/shellonback/promptops.git
cd promptops/apps/web
npm ci
cd ../desktop
npm ci
```

**3. Run it** with hot reload:

```bash
npm run dev
```

The first build compiles the Rust side and takes a few minutes; later starts are fast.

**4. Or build the installer** for your platform:

```bash
npm run build
```

On macOS the DMG step opens a Finder window for a moment to lay out the disk image (set `CI=true` to skip it). You will find it in `apps/desktop/src-tauri/target/release/bundle/` (`.dmg` on macOS, `.exe` on Windows, `.deb` and `.AppImage` on Linux). These builds are not code-signed. On macOS, the first time you open the app, go to **System Settings → Privacy & Security** and choose **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/PromptOps.app`. On Windows, SmartScreen asks you to confirm with **More info → Run anyway**.

---

## Community &amp; Support

- **Feedback &amp; ideas:** Missing something? [Open an issue](https://github.com/shellonback/promptops/issues).
- **Telegram:** releases, experiments and early access on [t.me/promptoperations](https://t.me/promptoperations).
- **Privacy:** The open-source edition has no telemetry, no analytics and no update checks. PromptOps Desktop needs an account and talks to PromptOps servers. [PRIVACY.md](PRIVACY.md) explains what each edition sends and where.
- **Security:** Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
- **Open source and hosted:** what lives here and what needs PromptOps Desktop, and who decides: [GOVERNANCE.md](GOVERNANCE.md).
- **Show support:** [Star](https://github.com/shellonback/promptops) the repo to follow along.

---

## Developing

Want to contribute or run locally? See [CONTRIBUTING.md](CONTRIBUTING.md). Commits are signed off ([DCO](https://developercertificate.org/)).

| Path | What it is |
|---|---|
| [`apps/desktop`](apps/desktop) | Tauri 2 shell in Rust: terminals, agents, local data store, Session Vault, MCP server and CLI |
| [`apps/web`](apps/web) | Angular interface |
| [`apps/npm`](apps/npm) | `npx @shellonback/promptops`: installs PromptOps Desktop, verifying the release signature |
| [`docs`](docs) | Design notes: the [architecture](docs/architecture.md), the [Session Vault](docs/session-vault.md), the [plugin guide](docs/plugins/plugin-guidelines.md), [dependencies](docs/supply-chain.md) and [how releases are made](docs/releasing.md) |

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="PromptOps contributors" />
</a>

## Languages

PromptOps speaks 15 languages: **English**, [Italiano](docs/i18n/README.it.md), [Français](docs/i18n/README.fr.md), [Español](docs/i18n/README.es.md), [Deutsch](docs/i18n/README.de.md), [Português](docs/i18n/README.pt.md), [中文](docs/i18n/README.zh.md), [日本語](docs/i18n/README.ja.md), [Русский](docs/i18n/README.ru.md), [العربية](docs/i18n/README.ar.md), [हिन्दी](docs/i18n/README.hi.md), [Polski](docs/i18n/README.pl.md), [Nederlands](docs/i18n/README.nl.md), [Svenska](docs/i18n/README.sv.md) and [한국어](docs/i18n/README.ko.md). Switch from the bottom bar.

## License

PromptOps is free and open source under the [Apache License 2.0](LICENSE). Third-party licenses are listed in [THIRD-PARTY-NOTICES.txt](apps/web/public/THIRD-PARTY-NOTICES.txt).

"PromptOps" and the PromptOps logo are trademarks of Shellonback S.r.l. — see [TRADEMARK.md](TRADEMARK.md).
