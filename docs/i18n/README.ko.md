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
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <b>한국어</b>
</p>

<p align="center">
  <strong>CLI AI 코딩 에이전트를 위한 멀티 프로젝트, 멀티 세션 ADE.</strong><br/>
  Claude Code, Codex, Gemini CLI와 모든 CLI 에이전트를 나란히 실행하세요. 클라이언트, 프로젝트, 세션별로 정리되고, 내 컴퓨터에서 내 구독 그대로 사용합니다.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>PromptOps Desktop 다운로드</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="하나의 PromptOps 세션에서 일곱 에이전트가 나란히 작업: 하나는 프롬프트 박스에서, 다섯은 리드가 MCP로 실행" width="960" /></picture>
</p>

<p align="center">
  <sub>이 저장소에는 PromptOps Desktop 릴리스와 오픈 소스 에디션이 있습니다. 계정도, 로그인도, PromptOps 서버도 필요 없으며 <a href="../../README.md#open-source-edition--build-it-yourself">직접 빌드</a>해서 사용합니다. PromptOps Desktop은 바로 실행할 수 있는 앱으로, Teams, 동기화, 모바일 앱을 제공합니다. <a href="../../PRIVACY.md">내 컴퓨터 밖으로 나가는 데이터 →</a></sub>
</p>

## 빠른 시작

1. **[PromptOps Desktop 다운로드](https://github.com/shellonback/promptops/releases/latest)** 또는 `npx @shellonback/promptops` 실행.
2. **워크스페이스 추가**: 에이전트가 작업할 프로젝트 폴더를 선택합니다.
3. **세션 시작**: 이미 쓰고 있는 에이전트 CLI(Claude Code, Codex, Gemini CLI…)로 시작하세요. 설치된 CLI는 PromptOps가 자동으로 감지합니다.
4. **에이전트를 더 열게 하기**: 리드에게 *"여기에 PromptOps 에이전트 3개를 열어줘: 하나는 테스트, 하나는 README, 하나는 리뷰"* 라고 요청하면, 옆에 나타나 각자 맡은 부분을 처리합니다. Claude Code와 Codex에는 PromptOps MCP 서버가 자동으로 연결되고, 다른 에이전트도 터미널에서 `promptops ctl` 명령으로 같은 일을 할 수 있습니다.

## 기능

<table>
<tr>
<td width="50%" valign="middle">

### 에이전트를 실행하는 에이전트

리드 에이전트에게 작업 분담을 맡기세요. 내장 MCP 서버를 통해 파트마다 에이전트를 하나씩 열고, 보고서를 모으고, 작업을 새 세션으로 옮깁니다. 위험한 작업은 항상 사용자의 승인을 거칩니다.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="리드 에이전트가 PromptOps MCP 서버를 통해 동료 에이전트를 여는 모습" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="서로 다른 프로바이더와 모델로 서브 에이전트 실행" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### 작업마다 알맞은 에이전트

서브 에이전트마다 프로바이더, 모델, 추론 강도를 고르세요. 리팩터링은 Claude, 번들 분석은 Gemini, 리뷰는 Codex — 모두 하나의 세션에서. 작업 모드(Sprint, Architect, Detective, Paranoid…)는 각 CLI의 네이티브 플래그에 매핑됩니다.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 원클릭 명령, 사라지지 않는 세션

Claude가 명령을 제안하면 옆의 재생 버튼을 누르세요. 터미널에서 실행되고 에이전트가 결과를 읽습니다. 앱을 종료했다가 다시 열어도 세션, 에이전트, 위치가 그대로입니다.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="제안된 명령을 원클릭으로 실행한 뒤 세션 복원" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="클라이언트별로 에이전트를 묶어 보여주는 Floor Plan" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

모든 클라이언트, 모든 세션을 한 층에. 에이전트가 작업을 마치거나 도움이 필요하면 책상에 불이 켜지고, 작업하는 동안 플로어가 3D 또는 2D로 곁에 머뭅니다.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

서브 에이전트에 보낼 프롬프트가 단순한 명령이면 PromptOps가 터미널에서 바로 실행하도록 제안합니다. 더 빠르고 토큰도 쓰지 않습니다. 모든 세션은 에이전트 자체 기록에서 읽은 실제 토큰 사용량, 캐시 적중, 비용을 보여 줍니다.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="토큰을 쓰는 대신 터미널에서 명령을 바로 실행하도록 PromptOps가 제안하는 화면" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="PromptOps Desktop의 Teams: 가상 오피스, 채팅, 보드" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

에이전트 바로 옆에 팀을: 가상 오피스, 채팅, 프로젝트 보드와 스프린트. 태스크에서 재생 버튼을 누르면 에이전트가 내 세션에서 작업을 맡고, 테스트가 통과하면 완료로 드래그하면 됩니다.

Teams는 서버가 필요하므로 호스팅 에디션인 [PromptOps Desktop](https://www.promptoperations.ai/)에서 제공됩니다. 오픈소스 에디션에서는 잠금으로 표시되며 어떤 코드도 실행하지 않습니다.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### PromptOps Remote <sub><kbd>PromptOps Desktop</kbd></sub>

**세션을 휴대폰에서도.** PromptOps Remote 앱으로 데스크톱의 세션과 에이전트를 실시간으로 보고, 에이전트가 입력을 기다리면 답하고, 허용하면 휴대폰에서 프롬프트를 입력하거나 받아쓰기할 수 있습니다. 데스크톱 QR로 페어링하며 포트를 열 필요가 없습니다.

<a href="https://apps.apple.com/app/id6766861427"><img src="https://img.shields.io/badge/App%20Store-iOS-0D96F6?style=for-the-badge&amp;logo=apple&amp;logoColor=white" alt="Download on the App Store" /></a>
<a href="https://github.com/shellonback/promptops/releases/latest/download/promptops-remote.apk"><img src="https://img.shields.io/badge/Android-APK-3DDC84?style=for-the-badge&amp;logo=android&amp;logoColor=white" alt="Download the Android APK" /></a>

</td>
<td width="50%" align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/remote.jpg"><img src="../../docs/assets/readme/remote.gif" alt="PromptOps Remote on a phone: live sessions, an agent waiting for input, prompts from the phone" width="240" /></picture>
</td>
</tr>
</table>

**그 밖의 기능:**

- **Session Vault** — 세션, 프롬프트, 메모, 설정을 레코드 단위로 AES-256-GCM 암호화하고, 키는 OS 키체인에 보관합니다.
- **프롬프트 라이브러리** — 변수, 카테고리, 태그를 지원하는 버전 관리 프롬프트를 어떤 에이전트에서든 클릭 한 번으로.
- **로컬에서 만드는 플러그인** — 샌드박스 플러그인 호스트와 Plugin Studio: 폴더에 플러그인 뼈대를 만들고, 에이전트가 작성하게 한 뒤, 실시간으로 다시 로드하세요. 공식 카탈로그에 pull request를 보내 공유할 수 있습니다.
- **내장 개발 도구** — Git 탐색기와 AI 커밋 메시지, 데이터베이스 탐색기, 코드 편집기, Docker 및 포트 패널, SSH 터미널.
- **프로바이더 한도도 문제없이** — 에이전트가 요금제 한도에 도달하면, 이어받을 수 있는 설치된 CLI를 PromptOps가 보여주고 클릭 한 번으로 전환합니다.
- **기기에서 처리하는 음성 프롬프트** — 로컬 Whisper 전사. 직접 추가한 경우에만 Groq 또는 OpenAI 키를 대체 수단으로 사용합니다.
- **사용량과 속도** — 세션별 토큰 사용량과, 사용 가능한 모델들의 속도를 나란히 비교하는 테스트.
- **네이티브하고 가볍게** — Rust와 Tauri 2, 네이티브 PTY 기반. Chromium을 번들하지 않습니다.

---

## 지원 에이전트

**모든 CLI 에이전트**와 함께 동작합니다 — 터미널에서 실행된다면 PromptOps에서도 실행됩니다.

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
  <kbd>+ 모든 CLI 에이전트</kbd>
</p>

PromptOps는 이미 비용을 내고 있는 계정으로 공식 CLI를 실행합니다. 프록시도, 토큰 재판매도 없습니다. 각 에이전트는 자체 약관에 따라 자신의 프로바이더와 직접 통신합니다.

<sub>제품명과 로고는 각 소유자에게 있습니다. PromptOps는 독립 프로젝트이며, 이들과 제휴하거나 이들의 보증을 받지 않았습니다.</sub>

원하는 에이전트가 없나요? 프로바이더 추가는 범위가 명확한 변경입니다 — [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고하세요.

---

## 설치

### PromptOps Desktop — 바로 실행

macOS, Windows, Linux 지원. Teams, 기기 간 동기화, 모바일 앱, SSO를 포함하며 계정이 필요합니다.

- **[GitHub Releases에서 다운로드](https://github.com/shellonback/promptops/releases/latest)** (macOS 버전은 공증 완료).
- 또는 Node.js 18 이상에서: `npx @shellonback/promptops`. PromptOps Desktop을 설치하고 실행하며, PromptOps 릴리스 키로 서명되지 않은 다운로드는 모두 거부합니다.

세션 데이터는 오픈소스 에디션과 같은 알고리즘으로 암호화됩니다. 차이점은 키를 저희 서버가 보관한다는 것으로, 덕분에 어느 기기에서든 세션을 이어갈 수 있습니다. [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition)를 참고하세요.

### 오픈소스 에디션

계정도 서버도 필요 없습니다. 모든 것이 내 컴퓨터에 남습니다. 코드는 이 저장소에 있으며, 이 에디션의 미리 빌드된 바이너리는 없습니다. macOS, Windows, Linux에서 빌드하는 명령은 [영어 README](../../README.md#open-source-edition--build-it-yourself)에 있습니다.

---

## 커뮤니티 &amp; 지원

- **피드백 &amp; 아이디어:** 필요한 게 없나요? [issue를 열어주세요](https://github.com/shellonback/promptops/issues).
- **Telegram:** 릴리스, 실험 기능, 얼리 액세스 소식은 [t.me/promptoperations](https://t.me/promptoperations)에서.
- **개인정보:** 오픈소스 에디션에는 텔레메트리, 분석, 업데이트 확인이 전혀 없습니다. PromptOps Desktop은 계정이 필요하며 PromptOps 서버와 통신합니다. 각 에디션이 무엇을 어디로 보내는지는 [PRIVACY.md](../../PRIVACY.md)에서 설명합니다.
- **보안:** 취약점은 [SECURITY.md](../../SECURITY.md)에 안내된 대로 비공개로 신고해 주세요.
- **오픈소스와 호스팅:** 여기에 무엇이 있고 무엇에 PromptOps Desktop이 필요한지, 그리고 누가 결정하는지: [GOVERNANCE.md](../../GOVERNANCE.md).
- **응원하기:** 저장소에 [Star](https://github.com/shellonback/promptops)를 눌러 소식을 받아보세요.

---

## 개발 참여

기여하고 싶으신가요? [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고하세요. 커밋에는 서명([DCO](https://developercertificate.org/))이 필요합니다.

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="PromptOps 기여자" />
</a>

## 언어

[English](../../README.md), [Italiano](README.it.md), [Français](README.fr.md), [Español](README.es.md), [Deutsch](README.de.md), [Português](README.pt.md), [中文](README.zh.md), [日本語](README.ja.md), [Русский](README.ru.md), [العربية](README.ar.md), [हिन्दी](README.hi.md), [Polski](README.pl.md), [Nederlands](README.nl.md), [Svenska](README.sv.md), **한국어**. 하단 바에서 전환할 수 있습니다.

## 라이선스

PromptOps는 [Apache License 2.0](../../LICENSE)에 따른 무료 오픈소스 소프트웨어입니다.

"PromptOps"와 PromptOps 로고는 Shellonback S.r.l.의 상표입니다 — [TRADEMARK.md](../../TRADEMARK.md)를 참고하세요.
