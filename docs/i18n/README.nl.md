<h1 align="center">
  <img src="../../docs/assets/logo.png" alt="PromptOps" width="64" valign="middle" /> PromptOps
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&amp;label=%E2%98%85&amp;color=4F41FA" alt="GitHub-sterren" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-4F41FA?style=flat" alt="Licentie: Apache-2.0" />
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshellonback%2Fpromptops%2Fbadges%2Fdownloads.json" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4F41FA?style=flat-square" alt="Ondersteunde platforms: macOS, Windows en Linux" />
  <a href="https://t.me/promptoperations"><img src="https://img.shields.io/badge/Telegram-promptoperations-26A5E4?style=flat&amp;logo=telegram&amp;logoColor=white" alt="Telegram-kanaal" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <b>Nederlands</b> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>De controlekamer voor je coding agents.</strong><br/>
  Draai Claude Code, Codex, Gemini CLI en elke andere CLI-agent naast elkaar — geordend per klant en project, op je eigen machine, met je eigen abonnementen.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>PromptOps Desktop downloaden</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="Zeven agents werken naast elkaar in één PromptOps-sessie: één geopend via het promptvak, vijf geopend door de lead-agent via MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>De broncode van de open-source-editie, zonder account, zonder inloggen en zonder PromptOps-server, komt naar deze repository. PromptOps Desktop is de kant-en-klare app, met Teams, synchronisatie en de mobiele app. <a href="../../PRIVACY.md">Wat je machine verlaat →</a></sub>
</p>

## Snel aan de slag

1. **[Download PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** of voer `npx @shellonback/promptops` uit.
2. **Voeg een workspace toe**: kies de projectmap waarin je agents gaan werken.
3. **Start een sessie** met een agent-CLI die je al gebruikt (Claude Code, Codex, Gemini CLI…). PromptOps herkent welke er geïnstalleerd zijn.
4. **Laat hem meer agents openen**: vraag de lead-agent *"Open hier 3 PromptOps-agents: één voor de tests, één voor de README, één voor een review"*, en ze verschijnen ernaast, elk met een eigen deel. Claude Code en Codex krijgen automatisch de PromptOps MCP-server; elke andere agent kan hetzelfde doen via het commando `promptops ctl` in zijn terminal.

## Functies

<table>
<tr>
<td width="50%" valign="middle">

### Agents die agents aansturen

Laat je lead-agent het werk opsplitsen: via de ingebouwde MCP-server opent hij één agent per onderdeel, verzamelt hun rapporten en verplaatst werk naar een nieuwe sessie. Riskante acties blijven afhankelijk van jouw goedkeuring.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="Een lead-agent opent naastgelegen agents via de PromptOps MCP-server" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="Sub-agents starten met verschillende providers en modellen" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### De juiste agent voor elke taak

Kies provider, model en effort per sub-agent: Claude voor de refactor, Gemini voor de bundle-analyse, Codex voor de review — allemaal in één sessie. Werkmodi (Sprint, Architect, Detective, Paranoid…) worden vertaald naar de native flags van elke CLI.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Commando's met één klik, sessies die blijven

Stelt Claude een commando voor, klik dan op play ernaast: het draait in de terminal en de agent leest het resultaat. Sluit de app en open hem opnieuw — dezelfde sessies, dezelfde agents, op dezelfde plek.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="Een voorgesteld commando met één klik uitvoeren en daarna de sessie herstellen" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan met agents gegroepeerd per klant" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

Elke klant, elke sessie, één verdieping. Bureaus lichten op wanneer een agent klaar is of je nodig heeft, en de verdieping blijft naast je staan, in 3D of 2D, terwijl je werkt.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

Is de prompt van een sub-agent alleen een commando, dan stelt PromptOps voor het direct in de terminal uit te voeren: sneller en zonder tokens te verbruiken. Elke sessie toont echt tokengebruik, cache hits en kosten, gelezen uit het transcript van de agent.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps stelt voor een commando direct in de terminal uit te voeren in plaats van tokens te verbruiken" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="Teams in PromptOps Desktop: virtueel kantoor, chat en borden" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

Je team direct naast je agents: een virtueel kantoor, chat, projectborden en sprints. Klik op play bij een taak en een agent pakt hem op in je sessie; sleep hem naar Done zodra de tests slagen.

Teams heeft een server nodig en zit daarom in [PromptOps Desktop](https://www.promptoperations.ai/), de gehoste editie. In de open-source-editie toont het een slotje en voert het geen code uit.

</td>
</tr>
</table>

**Verder inbegrepen:**

- **Session Vault** — Sessies, prompts, notities en instellingen, record voor record versleuteld met AES-256-GCM, met de sleutel in de sleutelhanger van je besturingssysteem.
- **Promptbibliotheek** — Prompts met versiebeheer, variabelen, categorieën en tags, met één klik beschikbaar in elke agent.
- **Plugins die je lokaal bouwt** — Een plugin-host in een sandbox en Plugin Studio: zet een plugin op in een map, laat een agent hem schrijven en herlaad hem live. Deel hem via een pull request met de officiële catalogus.
- **Ingebouwde dev-tools** — Git-verkenner en AI-commitberichten, databaseverkenner, code-editor, panelen voor Docker en poorten, SSH-terminals.
- **Providerlimieten, opgelost** — Bereikt een agent de limiet van zijn abonnement, dan toont PromptOps welke andere geïnstalleerde CLI's het kunnen overnemen en schakelt met één klik over.
- **Spraakprompts op je eigen apparaat** — Lokale transcriptie met Whisper; je eigen Groq- of OpenAI-sleutel alleen als terugvaloptie, als je er een toevoegt.
- **Gebruik en snelheid** — Tokengebruik per sessie en een snelheidstest naast elkaar van de modellen waartoe je toegang hebt.
- **Native en licht** — Rust en Tauri 2 met een native PTY. Geen meegeleverde Chromium.

---

## Ondersteunde agents

Werkt met **elke CLI-agent** — als het in een terminal draait, draait het in PromptOps.

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
  <kbd>+ elke CLI-agent</kbd>
</p>

PromptOps start de officiële CLI's met de accounts waarvoor je al betaalt. Geen proxy, geen doorverkoop van tokens: elke agent praat met zijn eigen provider, onder diens eigen voorwaarden.

<sub>Productnamen en logo's zijn eigendom van hun respectieve eigenaars. PromptOps is een onafhankelijk project en is niet aan hen verbonden of door hen goedgekeurd.</sub>

Mis je er een? Een provider toevoegen is een duidelijk afgebakende wijziging — zie [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Installatie

### PromptOps Desktop — kant-en-klaar

macOS, Windows en Linux. Inclusief Teams, synchronisatie tussen apparaten, de mobiele app en SSO, en vereist een account.

- **[Downloaden via GitHub Releases](https://github.com/shellonback/promptops/releases/latest)**, genotariseerd op macOS.
- Of, met Node.js 18 of nieuwer: `npx @shellonback/promptops`. Dit installeert en opent PromptOps Desktop, en weigert elke download die niet is ondertekend met de release-sleutel van PromptOps.

Je sessiegegevens worden versleuteld met hetzelfde algoritme als in de open-source-editie; het verschil is dat de sleutel op onze servers staat, zodat je sessies je kunnen volgen. Zie [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition).

### Open-source-editie

Geen account en geen server: alles blijft op je computer. De broncode komt naar deze repository, samen met de commando's om hem zelf te bouwen op macOS, Windows en Linux. Geef de repo een [ster](https://github.com/shellonback/promptops) om te weten wanneer hij er is.

---

## Community &amp; Support

- **Feedback &amp; ideeën:** Mis je iets? [Open een issue](https://github.com/shellonback/promptops/issues).
- **Telegram:** releases, experimenten en vroege toegang op [t.me/promptoperations](https://t.me/promptoperations).
- **Privacy:** De open-source-editie heeft geen telemetrie, geen analytics en geen updatecontroles. PromptOps Desktop vereist een account en communiceert met de servers van PromptOps. [PRIVACY.md](../../PRIVACY.md) legt uit wat elke editie verstuurt en waarheen.
- **Beveiliging:** Meld kwetsbaarheden vertrouwelijk, zoals beschreven in [SECURITY.md](../../SECURITY.md).
- **Open source en gehost:** wat hier staat, wat PromptOps Desktop nodig heeft en wie beslist: [GOVERNANCE.md](../../GOVERNANCE.md).
- **Toon je steun:** Geef de repo een [ster](https://github.com/shellonback/promptops) om op de hoogte te blijven.

---

## Ontwikkelen

Wil je bijdragen? Zie [CONTRIBUTING.md](../../CONTRIBUTING.md). Commits worden afgetekend ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="Bijdragers aan PromptOps" />
</a>

## Talen

[English](../../README.md), [Italiano](README.it.md), [Français](README.fr.md), [Español](README.es.md), [Deutsch](README.de.md), [Português](README.pt.md), [中文](README.zh.md), [日本語](README.ja.md), [Русский](README.ru.md), [العربية](README.ar.md), [हिन्दी](README.hi.md), [Polski](README.pl.md), **Nederlands**, [Svenska](README.sv.md) en [한국어](README.ko.md), te wisselen via de onderste balk.

## Licentie

PromptOps is gratis en open source onder de [Apache License 2.0](../../LICENSE).

"PromptOps" en het PromptOps-logo zijn handelsmerken van Shellonback S.r.l. — zie [TRADEMARK.md](../../TRADEMARK.md).
