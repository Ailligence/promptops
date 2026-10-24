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
  <strong>The control room for your coding agents.</strong><br/>
  Run Claude Code, Codex, Gemini CLI and every other CLI agent side by side — organized by client and project, on your machine, with your own subscriptions.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>Download PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/seven-agents.jpg"><img src="docs/assets/readme/seven-agents.gif" alt="Seven agents working side by side in one PromptOps session: one opened from the prompt box, five opened by the lead through MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>The source code of the open-source edition, with no account, no sign-in and no PromptOps server, is coming to this repository. PromptOps Desktop is the ready-to-run app, with Teams, sync and the mobile app. <a href="PRIVACY.md">What leaves your machine →</a></sub>
</p>

## Quick Start

1. **[Download PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** or run `npx @shellonback/promptops`.
2. **Add a workspace**: pick the project folder your agents will work on.
3. **Start a session** with an agent CLI you already use (Claude Code, Codex, Gemini CLI…). PromptOps detects the installed ones.
4. **Let it open more agents**: ask the lead *"Open 3 PromptOps agents here: one for the tests, one for the README, one for a review"*, and they appear next to it, each on its own part. Claude Code and Codex get the PromptOps MCP server automatically; every other agent can do the same through the `promptops ctl` command in its terminal.

## Features

<table>
<tr>
<td width="50%" valign="middle">

### Agents That Run Agents

Ask your lead agent to split the work: through the built-in MCP server it opens one agent per part, collects their reports and moves work to a new session. Risky actions stay behind your approval.

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

- **Session Vault** — Sessions, prompts, notes and settings encrypted record by record with AES-256-GCM, key in your OS keychain.
- **Prompt library** — Versioned prompts with variables, categories and tags, one click away from any agent.
- **Plugins you build locally** — A sandboxed plugin host and Plugin Studio: scaffold a plugin in a folder, let an agent write it, reload it live. Share it with a pull request to the official catalog.
- **Built-in dev tools** — Git explorer and AI commit messages, database explorer, code editor, Docker and ports panels, SSH terminals.
- **Provider limits, handled** — When an agent hits its plan limit, PromptOps shows which other installed CLIs can take over and switches with one click.
- **Voice prompts on your device** — Local Whisper transcription; your own Groq or OpenAI key only as a fallback, if you add one.
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
  <kbd><img src="docs/assets/providers/terminal.svg" alt="" width="16" valign="middle" /> PromptOps CLI</kbd> &nbsp;
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

### Open-source edition

No account and no server: everything stays on your computer. Its source code is coming to this repository, with the commands to build it yourself on macOS, Windows and Linux. [Star](https://github.com/shellonback/promptops) the repo to know when it lands.

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

Want to contribute? See [CONTRIBUTING.md](CONTRIBUTING.md). Commits are signed off ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="PromptOps contributors" />
</a>

## Languages

PromptOps speaks 15 languages: **English**, [Italiano](docs/i18n/README.it.md), [Français](docs/i18n/README.fr.md), [Español](docs/i18n/README.es.md), [Deutsch](docs/i18n/README.de.md), [Português](docs/i18n/README.pt.md), [中文](docs/i18n/README.zh.md), [日本語](docs/i18n/README.ja.md), [Русский](docs/i18n/README.ru.md), [العربية](docs/i18n/README.ar.md), [हिन्दी](docs/i18n/README.hi.md), [Polski](docs/i18n/README.pl.md), [Nederlands](docs/i18n/README.nl.md), [Svenska](docs/i18n/README.sv.md) and [한국어](docs/i18n/README.ko.md). Switch from the bottom bar.

## License

PromptOps is free and open source under the [Apache License 2.0](LICENSE).

"PromptOps" and the PromptOps logo are trademarks of Shellonback S.r.l. — see [TRADEMARK.md](TRADEMARK.md).
