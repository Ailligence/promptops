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
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <b>Svenska</b> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>ADE:n för flera projekt och sessioner, byggd för CLI AI coding agents.</strong><br/>
  Kör Claude Code, Codex, Gemini CLI och alla andra CLI-agenter sida vid sida, ordnade efter kund, projekt och session, på din egen dator och med dina egna abonnemang.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>Ladda ner PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="Sju agenter som arbetar sida vid sida i en PromptOps-session: en öppnad från promptrutan, fem öppnade av huvudagenten via MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>Källkoden för open source-utgåvan, utan konto, utan inloggning och utan PromptOps-server, kommer snart till det här repot. PromptOps Desktop är den färdiga appen, med Teams, synkning och mobilappen. <a href="../../PRIVACY.md">Vad som lämnar din dator →</a></sub>
</p>

## Kom igång

1. **[Ladda ner PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** eller kör `npx @shellonback/promptops`.
2. **Lägg till en arbetsyta**: välj projektmappen som dina agenter ska arbeta i.
3. **Starta en session** med en agent-CLI du redan använder (Claude Code, Codex, Gemini CLI…). PromptOps hittar de som är installerade.
4. **Låt den öppna fler agenter**: be huvudagenten *"Öppna 3 PromptOps-agenter här: en för testerna, en för README, en för en granskning"*, så dyker de upp bredvid den, var och en med sin egen del. Claude Code och Codex får PromptOps MCP-server automatiskt; alla andra agenter kan göra samma sak via kommandot `promptops ctl` i sin terminal.

## Funktioner

<table>
<tr>
<td width="50%" valign="middle">

### Agenter som styr agenter

Be huvudagenten dela upp arbetet: via den inbyggda MCP-servern öppnar den en agent per del, samlar in deras rapporter och flyttar arbete till en ny session. Riskabla åtgärder kräver alltid ditt godkännande.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="En huvudagent öppnar syskonagenter via PromptOps MCP-server" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="Underagenter startas med olika leverantörer och modeller" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Rätt agent för varje uppgift

Välj leverantör, modell och ansträngningsnivå per underagent: Claude på refaktoreringen, Gemini på bundle-analysen, Codex på granskningen — allt i en session. Arbetslägen (Sprint, Architect, Detective, Paranoid…) mappas till varje CLI:s egna flaggor.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Kommandon med ett klick, sessioner som består

När Claude föreslår ett kommando trycker du på play bredvid det: det körs i terminalen och agenten läser resultatet. Stäng och öppna appen igen — samma sessioner, samma agenter, på samma plats.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="Ett föreslaget kommando körs med ett klick, sedan återställs sessionen" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan med agenter grupperade efter kund" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

Alla kunder, alla sessioner, på ett och samma våningsplan. Skrivborden lyser upp när en agent blir klar eller behöver dig, och planen finns vid din sida, i 3D eller 2D, medan du arbetar.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

När en underagents prompt bara är ett kommando föreslår PromptOps att köra det direkt i terminalen: snabbare och utan att förbruka tokens. Varje session visar verklig tokenanvändning, cacheträffar och kostnad, lästa från agentens egen utskrift.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps föreslår att köra ett kommando direkt i terminalen i stället för att förbruka tokens" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="Teams i PromptOps Desktop: virtuellt kontor, chatt och tavlor" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

Ditt team precis bredvid dina agenter: ett virtuellt kontor, chatt, projekttavlor och sprintar. Tryck på play på en uppgift så tar en agent sig an den i din session; dra den till Klart när testerna går igenom.

Teams kräver en server och finns därför i [PromptOps Desktop](https://www.promptoperations.ai/), den hostade utgåvan. I open source-utgåvan visas ett lås och ingen kod körs.

</td>
</tr>
</table>

**Dessutom ingår:**

- **Session Vault** — Sessioner, promptar, anteckningar och inställningar krypteras post för post med AES-256-GCM, med nyckeln i operativsystemets nyckelring.
- **Promptbibliotek** — Versionerade promptar med variabler, kategorier och taggar, ett klick bort från vilken agent som helst.
- **Plugins som du bygger lokalt** — En sandlådad plugin-värd och Plugin Studio: skapa ett plugin i en mapp, låt en agent skriva det och ladda om det live. Dela det med en pull request till den officiella katalogen.
- **Inbyggda utvecklarverktyg** — Git-utforskare och AI-genererade commit-meddelanden, databasutforskare, kodredigerare, paneler för Docker och portar, SSH-terminaler.
- **Leverantörsgränser, hanterade** — När en agent når gränsen i sin plan visar PromptOps vilka andra installerade CLI:er som kan ta över och byter med ett klick.
- **Röstpromptar på din enhet** — Lokal transkribering med Whisper; din egen Groq- eller OpenAI-nyckel används bara som reserv, om du lägger till en.
- **Användning och hastighet** — Tokenanvändning per session och ett hastighetstest sida vid sida av de modeller du har tillgång till.
- **Native och lätt** — Rust och Tauri 2 med en native PTY. Ingen medföljande Chromium.

---

## Agenter som stöds

Fungerar med **alla CLI-agenter** — körs den i en terminal, så körs den i PromptOps.

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
  <kbd>+ alla CLI-agenter</kbd>
</p>

PromptOps startar de officiella CLI:erna med de konton du redan betalar för. Ingen proxy, ingen vidareförsäljning av tokens: varje agent pratar med sin egen leverantör, enligt dess egna villkor.

<sub>Produktnamn och logotyper tillhör sina respektive ägare. PromptOps är ett oberoende projekt, inte anknutet till eller godkänt av dem.</sub>

Saknas någon? Att lägga till en leverantör är en väldefinierad ändring — se [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Installation

### PromptOps Desktop — redo att köra

macOS, Windows och Linux. Inkluderar Teams, synkning mellan enheter, mobilappen och SSO, och kräver ett konto.

- **[Ladda ner från GitHub Releases](https://github.com/shellonback/promptops/releases/latest)**, notariserad på macOS.
- Eller, med Node.js 18 eller senare: `npx @shellonback/promptops`. Det installerar och öppnar PromptOps Desktop, och vägrar alla nedladdningar som inte är signerade med PromptOps release-nyckel.

Den krypterar dina sessionsdata med samma algoritm som open source-utgåvan; skillnaden är att nyckeln förvaras på våra servrar, så att dina sessioner kan följa med dig. Se [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition).

### Open source-utgåvan

Inget konto och ingen server: allt stannar på din dator. Källkoden kommer snart till det här repot, med kommandona för att bygga den själv på macOS, Windows och Linux. Ge repot en [stjärna](https://github.com/shellonback/promptops) för att få veta när den släpps.

---

## Community &amp; support

- **Feedback &amp; idéer:** Saknar du något? [Öppna ett issue](https://github.com/shellonback/promptops/issues).
- **Telegram:** releaser, experiment och tidig åtkomst på [t.me/promptoperations](https://t.me/promptoperations).
- **Integritet:** Open source-utgåvan har ingen telemetri, ingen analys och inga uppdateringskontroller. PromptOps Desktop kräver ett konto och kommunicerar med PromptOps servrar. [PRIVACY.md](../../PRIVACY.md) förklarar vad varje utgåva skickar och vart.
- **Säkerhet:** Rapportera sårbarheter privat, enligt beskrivningen i [SECURITY.md](../../SECURITY.md).
- **Open source och hostat:** vad som finns här, vad som kräver PromptOps Desktop och vem som bestämmer: [GOVERNANCE.md](../../GOVERNANCE.md).
- **Visa ditt stöd:** Ge repot en [stjärna](https://github.com/shellonback/promptops) för att följa utvecklingen.

---

## Utveckling

Vill du bidra? Se [CONTRIBUTING.md](../../CONTRIBUTING.md). Commits signeras med sign-off ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="Bidragsgivare till PromptOps" />
</a>

## Språk

[English](../../README.md), [Italiano](README.it.md), [Français](README.fr.md), [Español](README.es.md), [Deutsch](README.de.md), [Português](README.pt.md), [中文](README.zh.md), [日本語](README.ja.md), [Русский](README.ru.md), [العربية](README.ar.md), [हिन्दी](README.hi.md), [Polski](README.pl.md), [Nederlands](README.nl.md), **Svenska** och [한국어](README.ko.md), valbara från den nedre listen.

## Licens

PromptOps är fri och öppen källkod under [Apache License 2.0](../../LICENSE).

"PromptOps" och PromptOps-logotypen är varumärken som tillhör Shellonback S.r.l. — se [TRADEMARK.md](../../TRADEMARK.md).
