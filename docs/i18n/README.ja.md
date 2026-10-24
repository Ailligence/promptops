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
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <b>日本語</b> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>CLI AI コーディングエージェントのための、マルチプロジェクト・マルチセッション対応 ADE。</strong><br/>
  Claude Code、Codex、Gemini CLI をはじめ、あらゆる CLI エージェントを並べて実行。クライアント、プロジェクト、セッションごとに整理し、自分のマシンで、自分のサブスクリプションのまま使えます。
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>PromptOps Desktop をダウンロード</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="1 つの PromptOps セッションで 7 つのエージェントが並んで作業：1 つはプロンプトボックスから、5 つはリードが MCP 経由で起動" width="960" /></picture>
</p>

<p align="center">
  <sub>このリポジトリには PromptOps Desktop のリリースとオープンソース版があります。アカウント不要、サインイン不要、PromptOps サーバー不要で、<a href="../../README.md#open-source-edition--build-it-yourself">自分でビルド</a>して使います。PromptOps Desktop はすぐに使えるアプリで、Teams、同期、モバイルアプリを備えています。<a href="../../PRIVACY.md">マシンの外に送られるデータ →</a></sub>
</p>

## クイックスタート

1. **[PromptOps Desktop をダウンロード](https://github.com/shellonback/promptops/releases/latest)** するか、`npx @shellonback/promptops` を実行します。
2. **ワークスペースを追加**：エージェントに作業させるプロジェクトフォルダを選びます。
3. **セッションを開始**：普段使っているエージェント CLI（Claude Code、Codex、Gemini CLI…）で始めます。インストール済みの CLI は PromptOps が自動で検出します。
4. **エージェントを増やしてもらう**：リードに *「ここに PromptOps エージェントを 3 つ開いて。テスト担当、README 担当、レビュー担当」* と頼むと、隣に現れてそれぞれの担当部分を進めます。Claude Code と Codex には PromptOps MCP サーバーが自動で接続されます。その他のエージェントも、ターミナルで `promptops ctl` コマンドを使えば同じことができます。

## 機能

<table>
<tr>
<td width="50%" valign="middle">

### エージェントがエージェントを動かす

リードエージェントに作業の分担を頼みましょう。内蔵の MCP サーバーを通じて担当ごとにエージェントを開き、レポートを集め、作業を新しいセッションへ移します。リスクのある操作は、常にあなたの承認待ちになります。

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="リードエージェントが PromptOps MCP サーバー経由で並列エージェントを開く" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="異なるプロバイダーとモデルでサブエージェントを起動" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### タスクごとに最適なエージェントを

サブエージェントごとにプロバイダー、モデル、推論レベルを選べます。リファクタリングは Claude、バンドル分析は Gemini、レビューは Codex——すべて 1 つのセッションで。作業モード（Sprint、Architect、Detective、Paranoid…）は各 CLI のネイティブフラグに対応しています。

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### ワンクリックでコマンド実行、セッションは消えない

Claude がコマンドを提案したら、横の再生ボタンを押すだけ。ターミナルで実行され、エージェントが結果を読み取ります。アプリを終了して開き直しても、同じセッション、同じエージェント、同じ配置のままです。

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="提案されたコマンドをワンクリックで実行し、セッションを復元" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="クライアントごとにエージェントをまとめて表示する Floor Plan" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

すべてのクライアント、すべてのセッションを 1 つのフロアに。エージェントが作業を終えたり、あなたの対応が必要になったりするとデスクが光ります。フロアは 3D でも 2D でも、作業中ずっと手元に表示しておけます。

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

サブエージェントへのプロンプトが単なるコマンドなら、PromptOps はターミナルで直接実行することを提案します。速く、トークンも消費しません。各セッションでは、エージェント自身の記録から読み取った実際のトークン使用量、キャッシュヒット、コストを表示します。

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="トークンを消費する代わりに、コマンドをターミナルで直接実行するよう PromptOps が提案している画面" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="PromptOps Desktop の Teams：バーチャルオフィス、チャット、ボード" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

エージェントのすぐ隣にチームを：バーチャルオフィス、チャット、プロジェクトボード、スプリント。タスクの再生ボタンを押せばエージェントがあなたのセッションで取りかかり、テストが通ったら「完了」へドラッグするだけです。

Teams にはサーバーが必要なため、ホスト版の [PromptOps Desktop](https://www.promptoperations.ai/) で提供しています。オープンソース版ではロック表示となり、コードは一切実行されません。

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### PromptOps Remote <sub><kbd>PromptOps Desktop</kbd></sub>

**セッションをスマホからも。** PromptOps Remote アプリで、デスクトップのセッションとエージェントをリアルタイムで確認し、エージェントが入力待ちになったら返信できます。許可すればスマホからプロンプトの入力や音声入力も可能。デスクトップの QR でペアリングし、ポート開放は不要です。

<a href="https://apps.apple.com/app/id6766861427"><img src="https://img.shields.io/badge/App%20Store-iOS-0D96F6?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="Download on the App Store" /></a>
<a href="https://github.com/shellonback/promptops/releases/latest/download/promptops-remote.apk"><img src="https://img.shields.io/badge/Android-APK-3DDC84?style=for-the-badge&amp;logo=android&amp;logoColor=white" alt="Download the Android APK" /></a>

</td>
<td width="50%" align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/remote.jpg"><img src="../../docs/assets/readme/remote.gif" alt="PromptOps Remote on a phone: live sessions, an agent waiting for input, prompts from the phone" width="240" /></picture>
</td>
</tr>
</table>

**その他の機能：**

- **Session Vault** — セッション、プロンプト、メモ、設定をレコード単位で AES-256-GCM により暗号化。鍵は OS のキーチェーンに保存されます。
- **プロンプトライブラリ** — 変数、カテゴリ、タグに対応したバージョン管理付きプロンプトを、どのエージェントからでもワンクリックで。
- **ローカルで作るプラグイン** — サンドボックス化されたプラグインホストと Plugin Studio：フォルダにプラグインの雛形を作り、エージェントに書かせて、ライブでリロード。公式カタログへの pull request で共有できます。
- **内蔵の開発ツール** — Git エクスプローラーと AI によるコミットメッセージ、データベースエクスプローラー、コードエディタ、Docker とポートのパネル、SSH ターミナル。
- **プロバイダーの上限にも対応** — エージェントがプランの上限に達すると、引き継げるインストール済みの CLI を PromptOps が表示し、ワンクリックで切り替えます。
- **デバイス上で動く音声プロンプト** — ローカルの Whisper で文字起こし。Groq や OpenAI のキーは、ご自身で追加した場合にのみフォールバックとして使います。
- **使用量と速度** — セッションごとのトークン使用量と、利用可能なモデルの速度を並べて比較するテスト。
- **ネイティブで軽量** — Rust と Tauri 2、ネイティブ PTY を採用。Chromium は同梱していません。

---

## 対応エージェント

**あらゆる CLI エージェント**に対応——ターミナルで動くなら、PromptOps でも動きます。

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
  <kbd>+ あらゆる CLI エージェント</kbd>
</p>

PromptOps は、すでに契約しているアカウントで公式 CLI を起動します。プロキシもトークンの転売もありません。各エージェントはそれぞれの規約のもと、自身のプロバイダーと直接通信します。

<sub>製品名およびロゴは各所有者に帰属します。PromptOps は独立したプロジェクトであり、これらの所有者と提携しておらず、承認も受けていません。</sub>

欲しいものがない？プロバイダーの追加は手順の明確な変更です——[CONTRIBUTING.md](../../CONTRIBUTING.md) を参照してください。

---

## インストール

### PromptOps Desktop — すぐに使える

macOS、Windows、Linux に対応。Teams、デバイス間の同期、モバイルアプリ、SSO を含み、アカウントが必要です。

- **[GitHub Releases からダウンロード](https://github.com/shellonback/promptops/releases/latest)**（macOS 版は公証済み）。
- または Node.js 18 以降で：`npx @shellonback/promptops`。PromptOps Desktop をインストールして起動し、PromptOps のリリース鍵で署名されていないダウンロードはすべて拒否します。

セッションデータはオープンソース版と同じアルゴリズムで暗号化されます。違いは鍵を当社のサーバーが保持する点で、そのためセッションをどこからでも利用できます。[PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition) を参照してください。

### オープンソース版

アカウントもサーバーも不要で、すべてがあなたのコンピューターに残ります。コードはこのリポジトリにあります。この版のビルド済みバイナリはありません。macOS、Windows、Linux でのビルド手順は[英語の README](../../README.md#open-source-edition--build-it-yourself)にあります。

---

## コミュニティ &amp; サポート

- **フィードバック &amp; アイデア：** 足りないものがありますか？[issue を作成](https://github.com/shellonback/promptops/issues)してください。
- **Telegram：** リリース情報、実験的な機能、先行アクセスは [t.me/promptoperations](https://t.me/promptoperations) で。
- **プライバシー：** オープンソース版にはテレメトリー、アナリティクス、更新チェックが一切ありません。PromptOps Desktop はアカウントが必要で、PromptOps のサーバーと通信します。各エディションが何をどこへ送信するかは [PRIVACY.md](../../PRIVACY.md) で説明しています。
- **セキュリティ：** 脆弱性は [SECURITY.md](../../SECURITY.md) に記載の方法で非公開にご報告ください。
- **オープンソースとホスト版：** ここに含まれるもの、PromptOps Desktop が必要なもの、そして誰が決めるのか：[GOVERNANCE.md](../../GOVERNANCE.md)。
- **応援する：** リポジトリに [Star](https://github.com/shellonback/promptops) を付けて、最新情報をフォローしてください。

---

## 開発に参加する

コントリビュートしたい方は [CONTRIBUTING.md](../../CONTRIBUTING.md) をご覧ください。コミットには署名（[DCO](https://developercertificate.org/)）が必要です。

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="PromptOps のコントリビューター" />
</a>

## 言語

[English](../../README.md)、[Italiano](README.it.md)、[Français](README.fr.md)、[Español](README.es.md)、[Deutsch](README.de.md)、[Português](README.pt.md)、[中文](README.zh.md)、**日本語**、[Русский](README.ru.md)、[العربية](README.ar.md)、[हिन्दी](README.hi.md)、[Polski](README.pl.md)、[Nederlands](README.nl.md)、[Svenska](README.sv.md)、[한국어](README.ko.md)。下部バーから切り替えられます。

## ライセンス

PromptOps は [Apache License 2.0](../../LICENSE) のもとで提供される、無料のオープンソースソフトウェアです。

「PromptOps」および PromptOps のロゴは Shellonback S.r.l. の商標です——[TRADEMARK.md](../../TRADEMARK.md) を参照してください。
