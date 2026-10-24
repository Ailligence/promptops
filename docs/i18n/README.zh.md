<h1 align="center">
  <img src="../../docs/assets/logo.png" alt="PromptOps" width="64" valign="middle" /> PromptOps
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&amp;label=%E2%98%85&amp;color=4F41FA" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-4F41FA?style=flat" alt="License: Apache-2.0" />
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshellonback%2Fpromptops%2Fbadges%2Fdownloads.json" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4F41FA?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
  <a href="https://t.me/promptoperations"><img src="https://img.shields.io/badge/Telegram-promptoperations-26A5E4?style=flat&amp;logo=telegram&amp;logoColor=white" alt="Telegram channel" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <b>中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>面向 CLI AI 编程智能体的多项目、多会话 ADE。</strong><br/>
  并排运行 Claude Code、Codex、Gemini CLI 以及任何其他 CLI 智能体，按客户、项目和会话整理，在你自己的电脑上，使用你自己的订阅。
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>下载 PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="一个 PromptOps 会话中七个智能体并排工作：一个从提示框打开，五个由主智能体通过 MCP 打开" width="960" /></picture>
</p>

<p align="center">
  <sub>开源版的源代码即将发布到本仓库，无需账号、无需登录，也不依赖 PromptOps 服务器。PromptOps Desktop 是开箱即用的应用，包含 Teams、同步和移动应用。<a href="../../PRIVACY.md">哪些数据会离开你的电脑 →</a></sub>
</p>

## 快速开始

1. **[下载 PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)**，或运行 `npx @shellonback/promptops`。
2. **添加工作区**：选择智能体要处理的项目文件夹。
3. **启动会话**，使用你已经在用的智能体 CLI（Claude Code、Codex、Gemini CLI…）。PromptOps 会自动检测已安装的 CLI。
4. **让它打开更多智能体**：对主智能体说 *“在这里打开 3 个 PromptOps 智能体：一个写测试，一个写 README，一个做代码审查”*，它们就会出现在旁边，各自负责一部分。Claude Code 和 Codex 会自动接入 PromptOps MCP 服务器；其他智能体也可以在自己的终端里通过 `promptops ctl` 命令做到同样的事。

## 功能

<table>
<tr>
<td width="50%" valign="middle">

### 智能体调度智能体

让主智能体拆分任务：它通过内置的 MCP 服务器为每个部分打开一个智能体，汇总它们的报告，并把工作迁移到新会话。高风险操作始终需要你的批准。

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="主智能体通过 PromptOps MCP 服务器打开同级智能体" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="使用不同提供商和模型启动子智能体" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### 为每项任务选对智能体

为每个子智能体选择提供商、模型和推理强度：Claude 负责重构，Gemini 负责包体分析，Codex 负责审查——全部在同一个会话中。工作模式（Sprint、Architect、Detective、Paranoid…）会映射到各个 CLI 的原生参数。

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 一键运行命令，会话持久保留

Claude 建议命令时，点击旁边的播放按钮：命令在终端中执行，智能体会读取结果。退出并重新打开应用——会话、智能体、位置都和原来一样。

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="一键运行建议的命令，然后恢复会话" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan 按客户分组显示智能体" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

所有客户、所有会话，尽在一层楼。智能体完成任务或需要你介入时，对应的工位会亮起；你工作时，楼层视图以 3D 或 2D 形式一直陪在身边。

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

当子智能体的提示只是一条命令时，PromptOps 会建议直接在终端中运行：更快，而且不消耗 token。每个会话都会显示真实的 token 用量、缓存命中和费用，数据读取自智能体自己的会话记录。

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps 建议直接在终端中运行命令，而不是消耗 token" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="PromptOps Desktop 中的 Teams：虚拟办公室、聊天和看板" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

团队就在智能体旁边：虚拟办公室、聊天、项目看板和迭代。在任务上点击播放，智能体就会在你的会话中接手；测试通过后，把它拖到“完成”即可。

Teams 需要服务器，因此只在托管版 [PromptOps Desktop](https://www.promptoperations.ai/) 中提供。在开源版中，它显示为锁定状态，不运行任何代码。

</td>
</tr>
</table>

**此外还包括：**

- **Session Vault** — 会话、提示词、笔记和设置逐条使用 AES-256-GCM 加密，密钥保存在操作系统钥匙串中。
- **提示词库** — 带版本管理的提示词，支持变量、分类和标签，任何智能体一键可用。
- **本地构建插件** — 沙箱化的插件宿主和 Plugin Studio：在文件夹中生成插件脚手架，让智能体来编写，实时重新加载。通过向官方目录提交 pull request 来分享它。
- **内置开发工具** — Git 浏览器与 AI 提交信息、数据库浏览器、代码编辑器、Docker 和端口面板、SSH 终端。
- **自动应对提供商限额** — 当某个智能体达到套餐限额时，PromptOps 会列出其他可以接手的已安装 CLI，一键切换。
- **本地语音提示** — 本地 Whisper 转写；仅在你添加了自己的 Groq 或 OpenAI 密钥时，才将其作为备用方案。
- **用量与速度** — 每个会话的 token 用量，以及对你可用模型的并排速度测试。
- **原生且轻量** — 基于 Rust 和 Tauri 2，配备原生 PTY。不捆绑 Chromium。

---

## 支持的智能体

适用于**任何 CLI 智能体**——只要能在终端中运行，就能在 PromptOps 中运行。

<p>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><kbd><img src="../../docs/assets/providers/claude.svg" alt="" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="../../docs/assets/providers/openai.svg" alt="" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://github.com/google-gemini/gemini-cli"><kbd><img src="../../docs/assets/providers/gemini.svg" alt="" width="16" valign="middle" /> Gemini CLI</kbd></a> &nbsp;
  <a href="https://antigravity.google"><kbd><img src="../../docs/assets/providers/antigravity.svg" alt="" width="16" valign="middle" /> Antigravity</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="../../docs/assets/providers/copilot.svg" alt="" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://cursor.com/cli"><kbd><img src="../../docs/assets/providers/cursor.svg" alt="" width="16" valign="middle" /> Cursor</kbd></a> &nbsp;
  <a href="https://x.ai/cli"><kbd><img src="../../docs/assets/providers/grok.svg" alt="" width="16" valign="middle" /> Grok</kbd></a> &nbsp;
  <a href="https://dev.meta.ai/docs/muse-code"><kbd><img src="../../docs/assets/providers/muse.svg" alt="" width="16" valign="middle" /> Muse</kbd></a> &nbsp;
  <a href="https://hermes-agent.nousresearch.com/docs/"><kbd><img src="../../docs/assets/providers/hermes.svg" alt="" width="16" valign="middle" /> Hermes</kbd></a> &nbsp;
  <a href="https://docs.z.ai"><kbd><img src="../../docs/assets/providers/zai.svg" alt="" width="16" valign="middle" /> Z.AI</kbd></a> &nbsp;
  <a href="https://www.kimi.com/code"><kbd><img src="../../docs/assets/providers/kimi.svg" alt="" width="16" valign="middle" /> Kimi</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="../../docs/assets/providers/terminal.svg" alt="" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <kbd><img src="../../docs/assets/providers/terminal.svg" alt="" width="16" valign="middle" /> PromptOps CLI</kbd> &nbsp;
  <kbd>+ 任何 CLI 智能体</kbd>
</p>

PromptOps 使用你已付费的账号启动官方 CLI。没有代理，不转售 token：每个智能体都直接与其提供商通信，遵循各自的条款。

<sub>产品名称和标志归其各自所有者所有。PromptOps 是独立项目，与上述各方无关联，也未获得其认可。</sub>

缺少你需要的？添加提供商是一项定义明确的改动——参见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

---

## 安装

### PromptOps Desktop — 开箱即用

支持 macOS、Windows 和 Linux。包含 Teams、跨设备同步、移动应用和 SSO，需要账号。

- **[从 GitHub Releases 下载](https://github.com/shellonback/promptops/releases/latest)**，macOS 版本已经过公证。
- 或者，在 Node.js 18 及以上版本中运行：`npx @shellonback/promptops`。它会安装并打开 PromptOps Desktop，并拒绝任何未使用 PromptOps 发布密钥签名的下载。

它使用与开源版相同的算法加密你的会话数据；区别在于密钥由我们的服务器保管，因此你的会话可以随你在设备间同步。参见 [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition)。

### 开源版

无需账号，无需服务器：所有内容都留在你的电脑上。其源代码即将发布到本仓库，并附带在 macOS、Windows 和 Linux 上自行构建的命令。为仓库点 [Star](https://github.com/shellonback/promptops)，第一时间获知发布消息。

---

## 社区 &amp; 支持

- **反馈 &amp; 想法：** 缺少什么？[提交 issue](https://github.com/shellonback/promptops/issues)。
- **Telegram：** 在 [t.me/promptoperations](https://t.me/promptoperations) 获取版本发布、实验功能和抢先体验。
- **隐私：** 开源版没有遥测、没有数据分析，也不检查更新。PromptOps Desktop 需要账号，并会与 PromptOps 服务器通信。[PRIVACY.md](../../PRIVACY.md) 说明了每个版本发送哪些数据以及发送到哪里。
- **安全：** 请按 [SECURITY.md](../../SECURITY.md) 中的说明私下报告漏洞。
- **开源与托管：** 哪些内容在这里、哪些需要 PromptOps Desktop，以及由谁决定：[GOVERNANCE.md](../../GOVERNANCE.md)。
- **支持我们：** 为仓库点 [Star](https://github.com/shellonback/promptops)，关注项目进展。

---

## 参与开发

想要贡献代码？参见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。提交需要签署（[DCO](https://developercertificate.org/)）。

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="PromptOps 贡献者" />
</a>

## 语言

[English](../../README.md)、[Italiano](README.it.md)、[Français](README.fr.md)、[Español](README.es.md)、[Deutsch](README.de.md)、[Português](README.pt.md)、**中文**、[日本語](README.ja.md)、[Русский](README.ru.md)、[العربية](README.ar.md)、[हिन्दी](README.hi.md)、[Polski](README.pl.md)、[Nederlands](README.nl.md)、[Svenska](README.sv.md) 和 [한국어](README.ko.md)，可在底部栏切换。

## 许可证

PromptOps 是基于 [Apache License 2.0](../../LICENSE) 的免费开源软件。

“PromptOps”及 PromptOps 标志是 Shellonback S.r.l. 的商标——参见 [TRADEMARK.md](../../TRADEMARK.md)。
