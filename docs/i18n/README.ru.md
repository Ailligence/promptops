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
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <b>Русский</b> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>Центр управления вашими агентами для программирования.</strong><br/>
  Запускайте Claude Code, Codex, Gemini CLI и любых других CLI-агентов бок о бок — по клиентам и проектам, на вашем компьютере, с вашими собственными подписками.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>Скачать PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="Семь агентов работают бок о бок в одной сессии PromptOps: один открыт из поля ввода промпта, пять открыты ведущим агентом через MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>Исходный код open-source-версии — без аккаунта, без входа и без сервера PromptOps — скоро появится в этом репозитории. PromptOps Desktop — готовое к запуску приложение с Teams, синхронизацией и мобильным приложением. <a href="../../PRIVACY.md">Что покидает ваш компьютер →</a></sub>
</p>

## Быстрый старт

1. **[Скачайте PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** или выполните `npx @shellonback/promptops`.
2. **Добавьте рабочее пространство**: выберите папку проекта, с которой будут работать ваши агенты.
3. **Начните сессию** с CLI-агентом, которым вы уже пользуетесь (Claude Code, Codex, Gemini CLI…). PromptOps сам находит установленные.
4. **Пусть он откроет ещё агентов**: попросите ведущего агента *"Открой здесь 3 агента PromptOps: одного для тестов, одного для README, одного для ревью"*, и они появятся рядом с ним, каждый со своей частью работы. Claude Code и Codex получают MCP-сервер PromptOps автоматически; любой другой агент может делать то же самое через команду `promptops ctl` в своём терминале.

## Возможности

<table>
<tr>
<td width="50%" valign="middle">

### Агенты, управляющие агентами

Попросите ведущего агента разделить работу: через встроенный MCP-сервер он открывает по агенту на каждую часть, собирает их отчёты и переносит работу в новую сессию. Рискованные действия всегда требуют вашего подтверждения.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="Ведущий агент открывает соседних агентов через MCP-сервер PromptOps" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="Запуск субагентов с разными провайдерами и моделями" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Нужный агент для каждой задачи

Выбирайте провайдера, модель и уровень усилий для каждого субагента: Claude — на рефакторинг, Gemini — на анализ бандла, Codex — на ревью, и всё в одной сессии. Режимы работы (Sprint, Architect, Detective, Paranoid…) сопоставляются с родными флагами каждого CLI.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Команды в один клик, сессии, которые не теряются

Когда Claude предлагает команду, нажмите play рядом с ней: она выполнится в терминале, а агент прочитает результат. Закройте и снова откройте приложение — те же сессии, те же агенты, на тех же местах.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="Запуск предложенной команды в один клик и восстановление сессии" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan с агентами, сгруппированными по клиентам" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

Все клиенты, все сессии — на одном этаже. Столы подсвечиваются, когда агент закончил работу или ждёт вас, а этаж всегда под рукой, в 3D или 2D, пока вы работаете.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

Если промпт субагента — просто команда, PromptOps предлагает выполнить её прямо в терминале: быстрее и без расхода токенов. Каждая сессия показывает реальный расход токенов, попадания в кэш и стоимость, взятые из транскрипта самого агента.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps предлагает выполнить команду прямо в терминале вместо расхода токенов" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="Teams в PromptOps Desktop: виртуальный офис, чат и доски" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

Ваша команда прямо рядом с вашими агентами: виртуальный офис, чат, проектные доски и спринты. Нажмите play на задаче, и агент возьмёт её в работу в вашей сессии; перетащите её в «Готово», когда тесты пройдут.

Teams нужен сервер, поэтому он доступен в [PromptOps Desktop](https://www.promptoperations.ai/), хостинговой версии. В open-source-версии на его месте замок, и никакой код не выполняется.

</td>
</tr>
</table>

**А также:**

- **Session Vault** — Сессии, промпты, заметки и настройки шифруются запись за записью с помощью AES-256-GCM, ключ хранится в системной связке ключей.
- **Библиотека промптов** — Версионируемые промпты с переменными, категориями и тегами, в одном клике от любого агента.
- **Плагины, которые вы создаёте локально** — Изолированный хост плагинов и Plugin Studio: создайте каркас плагина в папке, поручите агенту написать его и перезагружайте на лету. Поделитесь им через pull request в официальный каталог.
- **Встроенные инструменты разработчика** — Git-обозреватель и сообщения коммитов от ИИ, обозреватель баз данных, редактор кода, панели Docker и портов, SSH-терминалы.
- **Лимиты провайдеров под контролем** — Когда агент упирается в лимит своего тарифа, PromptOps показывает, какие другие установленные CLI могут подхватить работу, и переключает в один клик.
- **Голосовые промпты на вашем устройстве** — Локальная транскрипция с Whisper; ваш собственный ключ Groq или OpenAI — только как запасной вариант, если вы его добавите.
- **Расход и скорость** — Расход токенов по сессиям и сравнительный тест скорости доступных вам моделей.
- **Нативное и лёгкое** — Rust и Tauri 2 с нативным PTY. Без встроенного Chromium.

---

## Поддерживаемые агенты

Работает с **любым CLI-агентом** — если он запускается в терминале, он запустится и в PromptOps.

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
  <kbd>+ любой CLI-агент</kbd>
</p>

PromptOps запускает официальные CLI с аккаунтами, за которые вы уже платите. Никаких прокси и перепродажи токенов: каждый агент общается со своим провайдером на его собственных условиях.

<sub>Названия продуктов и логотипы принадлежат их владельцам. PromptOps — независимый проект, не связанный с ними и не одобренный ими.</sub>

Нужного нет? Добавление провайдера — чётко описанное изменение, см. [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Установка

### PromptOps Desktop — готов к запуску

macOS, Windows и Linux. Включает Teams, синхронизацию между устройствами, мобильное приложение и SSO; требуется аккаунт.

- **[Скачать из GitHub Releases](https://github.com/shellonback/promptops/releases/latest)**, с нотаризацией на macOS.
- Или, с Node.js 18 или новее: `npx @shellonback/promptops`. Команда устанавливает и открывает PromptOps Desktop и отклоняет любую загрузку, не подписанную релизным ключом PromptOps.

Данные ваших сессий шифруются тем же алгоритмом, что и в open-source-версии; разница в том, что ключ хранится на наших серверах, поэтому ваши сессии доступны вам на любом устройстве. См. [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition).

### Open-source-версия

Без аккаунта и без сервера: всё остаётся на вашем компьютере. Её исходный код скоро появится в этом репозитории вместе с командами для самостоятельной сборки на macOS, Windows и Linux. Поставьте репозиторию [звезду](https://github.com/shellonback/promptops), чтобы узнать, когда он появится.

---

## Сообщество &amp; поддержка

- **Отзывы &amp; идеи:** Чего-то не хватает? [Создайте issue](https://github.com/shellonback/promptops/issues).
- **Telegram:** релизы, эксперименты и ранний доступ в [t.me/promptoperations](https://t.me/promptoperations).
- **Конфиденциальность:** В open-source-версии нет телеметрии, аналитики и проверки обновлений. PromptOps Desktop требует аккаунт и обращается к серверам PromptOps. [PRIVACY.md](../../PRIVACY.md) объясняет, что и куда отправляет каждая версия.
- **Безопасность:** Сообщайте об уязвимостях конфиденциально, как описано в [SECURITY.md](../../SECURITY.md).
- **Open source и хостинг:** что находится здесь, что требует PromptOps Desktop и кто принимает решения: [GOVERNANCE.md](../../GOVERNANCE.md).
- **Поддержите проект:** Поставьте репозиторию [звезду](https://github.com/shellonback/promptops), чтобы следить за новостями.

---

## Разработка

Хотите поучаствовать? См. [CONTRIBUTING.md](../../CONTRIBUTING.md). Коммиты подписываются через sign-off ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="Контрибьюторы PromptOps" />
</a>

## Языки

English, Italiano, Français, Español, Deutsch, Português, 中文, 日本語, Русский, العربية, हिन्दी, Polski, Nederlands, Svenska и 한국어, переключение на нижней панели.

## Лицензия

PromptOps — бесплатное программное обеспечение с открытым исходным кодом под лицензией [Apache License 2.0](../../LICENSE).

«PromptOps» и логотип PromptOps являются товарными знаками Shellonback S.r.l. — см. [TRADEMARK.md](../../TRADEMARK.md).
