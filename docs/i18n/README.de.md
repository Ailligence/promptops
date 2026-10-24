<h1 align="center">
  <img src="../../docs/assets/logo.png" alt="PromptOps" width="64" valign="middle" /> PromptOps
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&amp;label=%E2%98%85&amp;color=4F41FA" alt="GitHub-Sterne" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-4F41FA?style=flat" alt="Lizenz: Apache-2.0" />
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshellonback%2Fpromptops%2Fbadges%2Fdownloads.json" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4F41FA?style=flat-square" alt="Unterstützte Plattformen: macOS, Windows und Linux" />
  <a href="https://t.me/promptoperations"><img src="https://img.shields.io/badge/Telegram-promptoperations-26A5E4?style=flat&amp;logo=telegram&amp;logoColor=white" alt="Telegram-Kanal" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <b>Deutsch</b> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>Die Kommandozentrale für deine Coding-Agents.</strong><br/>
  Führe Claude Code, Codex, Gemini CLI und jeden anderen CLI-Agent nebeneinander aus – geordnet nach Kunde und Projekt, auf deinem Rechner, mit deinen eigenen Abos.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>PromptOps Desktop herunterladen</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="Sieben Agents arbeiten nebeneinander in einer PromptOps-Sitzung: einer über das Prompt-Feld geöffnet, fünf vom Lead-Agent über MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>Der Quellcode der Open-Source-Edition – ohne Konto, ohne Anmeldung und ohne PromptOps-Server – kommt in dieses Repository. PromptOps Desktop ist die sofort einsatzbereite App, mit Teams, Sync und der mobilen App. <a href="../../PRIVACY.md">Was deinen Rechner verlässt →</a></sub>
</p>

## Schnellstart

1. **[PromptOps Desktop herunterladen](https://github.com/shellonback/promptops/releases/latest)** oder `npx @shellonback/promptops` ausführen.
2. **Workspace hinzufügen**: Wähle den Projektordner, in dem deine Agents arbeiten sollen.
3. **Sitzung starten** mit einer Agent-CLI, die du bereits nutzt (Claude Code, Codex, Gemini CLI…). PromptOps erkennt die installierten automatisch.
4. **Weitere Agents öffnen lassen**: Bitte den Lead-Agent *„Öffne hier 3 PromptOps-Agents: einen für die Tests, einen für die README, einen für ein Review“*, und sie erscheinen direkt daneben, jeder mit seinem eigenen Teil. Claude Code und Codex erhalten den PromptOps-MCP-Server automatisch; jeder andere Agent kann dasselbe über den Befehl `promptops ctl` in seinem Terminal tun.

## Funktionen

<table>
<tr>
<td width="50%" valign="middle">

### Agents, die Agents steuern

Lass deinen Lead-Agent die Arbeit aufteilen: Über den integrierten MCP-Server öffnet er einen Agent pro Teilaufgabe, sammelt ihre Berichte ein und verschiebt Arbeit in eine neue Sitzung. Riskante Aktionen erfordern weiterhin deine Freigabe.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="Ein Lead-Agent öffnet weitere Agents über den PromptOps-MCP-Server" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="Sub-Agents mit verschiedenen Providern und Modellen starten" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Der richtige Agent für jede Aufgabe

Wähle Provider, Modell und Effort pro Sub-Agent: Claude für das Refactoring, Gemini für die Bundle-Analyse, Codex für das Review – alles in einer Sitzung. Arbeitsmodi (Sprint, Architect, Detective, Paranoid…) werden auf die nativen Flags jeder CLI abgebildet.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Befehle mit einem Klick, Sitzungen, die bleiben

Wenn Claude einen Befehl vorschlägt, klick daneben auf Play: Er läuft im Terminal und der Agent liest das Ergebnis. App schließen und wieder öffnen – dieselben Sitzungen, dieselben Agents, an derselben Stelle.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="Einen vorgeschlagenen Befehl mit einem Klick ausführen und danach die Sitzung wiederherstellen" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan mit Agents, gruppiert nach Kunde" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

Jeder Kunde, jede Sitzung, eine Etage. Schreibtische leuchten auf, wenn ein Agent fertig ist oder dich braucht, und die Etage bleibt beim Arbeiten an deiner Seite, in 3D oder 2D.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

Ist der Prompt eines Sub-Agents nur ein Befehl, bietet PromptOps an, ihn direkt im Terminal auszuführen: schneller und ohne Token-Verbrauch. Jede Sitzung zeigt echten Token-Verbrauch, Cache-Treffer und Kosten, gelesen aus dem Transcript des Agenten.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps schlägt vor, einen Befehl direkt im Terminal auszuführen, statt Tokens zu verbrauchen" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="Teams in PromptOps Desktop: virtuelles Büro, Chat und Boards" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

Dein Team direkt neben deinen Agents: ein virtuelles Büro, Chat, Projektboards und Sprints. Klick bei einer Aufgabe auf Play und ein Agent übernimmt sie in deiner Sitzung; zieh sie auf Done, sobald die Tests grün sind.

Teams braucht einen Server und ist deshalb Teil von [PromptOps Desktop](https://www.promptoperations.ai/), der gehosteten Edition. In der Open-Source-Edition zeigt es ein Schloss und führt keinen Code aus.

</td>
</tr>
</table>

**Außerdem dabei:**

- **Session Vault** – Sitzungen, Prompts, Notizen und Einstellungen, Eintrag für Eintrag mit AES-256-GCM verschlüsselt, der Schlüssel liegt im Schlüsselbund deines Betriebssystems.
- **Prompt-Bibliothek** – Versionierte Prompts mit Variablen, Kategorien und Tags, mit einem Klick in jedem Agent verfügbar.
- **Lokal gebaute Plugins** – Ein Plugin-Host in einer Sandbox und Plugin Studio: Plugin-Gerüst in einem Ordner anlegen, von einem Agent schreiben lassen, live neu laden. Teile es per Pull Request mit dem offiziellen Katalog.
- **Integrierte Dev-Tools** – Git-Explorer und KI-generierte Commit-Messages, Datenbank-Explorer, Code-Editor, Docker- und Port-Panels, SSH-Terminals.
- **Provider-Limits im Griff** – Erreicht ein Agent das Limit seines Plans, zeigt PromptOps, welche anderen installierten CLIs übernehmen können, und wechselt mit einem Klick.
- **Sprach-Prompts auf deinem Gerät** – Lokale Transkription mit Whisper; dein eigener Groq- oder OpenAI-Schlüssel dient nur als Fallback, falls du einen hinterlegst.
- **Nutzung und Geschwindigkeit** – Token-Verbrauch pro Sitzung und ein direkter Geschwindigkeitsvergleich der Modelle, auf die du Zugriff hast.
- **Nativ und schlank** – Rust und Tauri 2 mit nativem PTY. Kein mitgeliefertes Chromium.

---

## Unterstützte Agents

Funktioniert mit **jedem CLI-Agent** – was im Terminal läuft, läuft auch in PromptOps.

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
  <kbd>+ jeder CLI-Agent</kbd>
</p>

PromptOps startet die offiziellen CLIs mit den Konten, für die du ohnehin bezahlst. Kein Proxy, kein Weiterverkauf von Tokens: Jeder Agent spricht direkt mit seinem eigenen Provider, zu dessen eigenen Bedingungen.

<sub>Produktnamen und Logos gehören ihren jeweiligen Inhabern. PromptOps ist ein unabhängiges Projekt und steht in keiner Verbindung zu ihnen und wird nicht von ihnen unterstützt.</sub>

Fehlt einer? Einen Provider hinzuzufügen ist eine klar umrissene Änderung – siehe [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Installation

### PromptOps Desktop – sofort einsatzbereit

macOS, Windows und Linux. Enthält Teams, Sync zwischen Geräten, die mobile App und SSO und erfordert ein Konto.

- **[Von GitHub Releases herunterladen](https://github.com/shellonback/promptops/releases/latest)**, unter macOS notarisiert.
- Oder, mit Node.js 18 oder neuer: `npx @shellonback/promptops`. Der Befehl installiert und öffnet PromptOps Desktop und verweigert jeden Download, der nicht mit dem Release-Schlüssel von PromptOps signiert ist.

Deine Sitzungsdaten werden mit demselben Algorithmus verschlüsselt wie in der Open-Source-Edition; der Unterschied ist, dass der Schlüssel auf unseren Servern liegt, damit deine Sitzungen dir auf andere Geräte folgen können. Siehe [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition).

### Open-Source-Edition

Kein Konto und kein Server: Alles bleibt auf deinem Computer. Der Quellcode kommt in dieses Repository, zusammen mit den Befehlen, um ihn selbst unter macOS, Windows und Linux zu bauen. Gib dem Repo einen [Stern](https://github.com/shellonback/promptops), um zu erfahren, wann es so weit ist.

---

## Community &amp; Support

- **Feedback &amp; Ideen:** Fehlt dir etwas? [Eröffne ein Issue](https://github.com/shellonback/promptops/issues).
- **Telegram:** Releases, Experimente und Early Access auf [t.me/promptoperations](https://t.me/promptoperations).
- **Datenschutz:** Die Open-Source-Edition hat keine Telemetrie, keine Analytics und keine Update-Prüfungen. PromptOps Desktop erfordert ein Konto und kommuniziert mit den Servern von PromptOps. [PRIVACY.md](../../PRIVACY.md) erklärt, was jede Edition wohin sendet.
- **Sicherheit:** Melde Schwachstellen vertraulich, wie in [SECURITY.md](../../SECURITY.md) beschrieben.
- **Open Source und gehostet:** was hier liegt, was PromptOps Desktop braucht und wer entscheidet: [GOVERNANCE.md](../../GOVERNANCE.md).
- **Unterstützung zeigen:** Gib dem Repo einen [Stern](https://github.com/shellonback/promptops), um auf dem Laufenden zu bleiben.

---

## Entwicklung

Du möchtest beitragen? Siehe [CONTRIBUTING.md](../../CONTRIBUTING.md). Commits werden mit Sign-off versehen ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="PromptOps-Mitwirkende" />
</a>

## Sprachen

English, Italiano, Français, Español, Deutsch, Português, 中文, 日本語, Русский, العربية, हिन्दी, Polski, Nederlands, Svenska und 한국어, umschaltbar über die untere Leiste.

## Lizenz

PromptOps ist kostenlos und Open Source unter der [Apache License 2.0](../../LICENSE).

„PromptOps“ und das PromptOps-Logo sind Marken der Shellonback S.r.l. – siehe [TRADEMARK.md](../../TRADEMARK.md).
