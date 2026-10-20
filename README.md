<h1 align="center">
  <img src="docs/assets/logo.png" alt="PromptOps Manager" width="64" valign="middle" /> PromptOps Manager
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&label=%E2%98%85&color=6366f1" alt="GitHub stars" /></a>
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/github/downloads/shellonback/promptops/total?color=6366f1" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-6366f1?style=flat" alt="License: Apache-2.0" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-6366f1?style=flat-square" alt="macOS, Windows, Linux" />
</p>

<p align="center">
  <strong>The best way to run CLI AI coding agents.</strong><br/>
  Launch, orchestrate and monitor Claude Code, OpenAI Codex, Gemini CLI and every other CLI coding agent in parallel — from one native app, with your own subscriptions.
</p>

<h3 align="center"><a href="https://www.promptoperations.ai/download/"><ins>Download PromptOps Manager</ins></a></h3>

---

## Why PromptOps Manager

- **Bring your own agents.** PromptOps launches the official CLIs with the accounts you already pay for. No proxy, no token resale.
- **Runs on your machine.** Agents, terminals and your code stay local; the app drives the CLIs you already have installed.
- **Native and light.** Rust + Tauri 2 with a native PTY — no bundled Chromium.
- **Agents that run agents.** A built-in MCP server lets your lead agent spawn, prompt and read sibling agents, inside guardrails you control.

## Features

### Multi-agent sessions
Run multiple AI coding agents in parallel, each in its own managed terminal, organized by project and workspace. Switch provider per session or per sub-agent.

### Sub-agent orchestration
Spawn specialized sub-agent teams — Security, Test, Review, Docs, Refactor, Performance — and give each one a working mode (Sprint, Architect, Detective, Refactor, Paranoid, Minimal) mapped to the native flags of its provider.

### Agents that run agents (MCP + `promptops ctl`)
A local control plane exposed as an MCP server: agents can spawn siblings, send prompts, wait for results, open task boards and move work to new sessions. Without auto-approve, risky actions are refused.

### Prompt library
Versioned, forkable prompts with variables, tags and categories — prompts managed as assets.

### Built-in dev tools
Git (stage, commit, push, branch, diff, AI commit messages), database explorer, knowledge base, Docker status and on-device speech-to-text for voice prompts.

### Token efficiency
Smart Context reduces token usage across sessions.

### Plugins
A sandboxed plugin host with an SDK and Plugin Studio to scaffold your own pages, sidebar zones and terminal actions.

### Mobile remote
Monitor and control your sessions from the PromptOps Remote companion app for iOS and Android.

## Supported agents

Claude Code · OpenAI Codex · Gemini CLI · GitHub Copilot · Cursor CLI · Grok CLI · OpenCode · Antigravity · Hermes · Z.AI (GLM) · Kimi (Moonshot) · PromptOps CLI — plus any custom shell CLI.

Missing one? Adding a provider is a well-defined change — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Install

Download the signed build for macOS, Windows or Linux from [promptoperations.ai/download](https://www.promptoperations.ai/download/) or from [Releases](https://github.com/shellonback/promptops/releases). It installs in about 30 seconds and updates itself.

## Source code

The source code of the desktop client is being prepared for publication in this repository under the Apache-2.0 license. Watch the repository to be notified when it lands.

The [Releases](https://github.com/shellonback/promptops/releases) page also keeps every binary release published since the first version.

## PromptOps Cloud (optional)

Teams can connect **PromptOps Cloud** for shared sessions, team prompt library, chat and boards, sync across devices, and enterprise features (SSO, SCIM, policies, self-hosting). Cloud services are not part of this repository.

## Privacy

Your code stays on your machine. The agent CLIs run locally and talk directly to their own providers, with your own accounts.

## Contributing

Issues and pull requests are welcome — start from [CONTRIBUTING.md](CONTRIBUTING.md). Commits must be signed off ([DCO](https://developercertificate.org/)).

Found a security issue? Follow [SECURITY.md](SECURITY.md) and please do not open a public issue.

## Links

[Website](https://www.promptoperations.ai) · [Docs](https://www.promptoperations.ai/docs/) · [Guides](https://www.promptoperations.ai/guide/) · [Changelog](https://www.promptoperations.ai/changelog/) · [Contributors program](https://www.promptoperations.ai/contributors/)

## License

[Apache-2.0](LICENSE). "PromptOps" and the PromptOps logo are trademarks of Shellonback S.r.l. — see [TRADEMARK.md](TRADEMARK.md).

<p align="center"><sub>Made in Turin, Italy by <a href="https://www.shellonback.com">Shellonback</a>.</sub></p>
