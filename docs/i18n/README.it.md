<h1 align="center">
  <img src="../../docs/assets/logo.png" alt="PromptOps" width="64" valign="middle" /> PromptOps
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&amp;label=%E2%98%85&amp;color=4F41FA" alt="Stelle su GitHub" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-4F41FA?style=flat" alt="Licenza: Apache-2.0" />
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshellonback%2Fpromptops%2Fbadges%2Fdownloads.json" alt="Download" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4F41FA?style=flat-square" alt="Piattaforme supportate: macOS, Windows e Linux" />
  <a href="https://t.me/promptoperations"><img src="https://img.shields.io/badge/Telegram-promptoperations-26A5E4?style=flat&amp;logo=telegram&amp;logoColor=white" alt="Canale Telegram" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <b>Italiano</b> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>La sala di controllo per i tuoi agenti di coding.</strong><br/>
  Esegui Claude Code, Codex, Gemini CLI e qualsiasi altro agente CLI fianco a fianco, organizzati per cliente e progetto, sulla tua macchina e con i tuoi abbonamenti.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>Scarica PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="Sette agenti al lavoro fianco a fianco in una sessione PromptOps: uno aperto dalla casella del prompt, cinque aperti dal lead tramite MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>Il codice sorgente dell'edizione open source, senza account, senza login e senza server PromptOps, arriverà in questo repository. PromptOps Desktop è l'app pronta all'uso, con Teams, sincronizzazione e app mobile. <a href="../../PRIVACY.md">Cosa esce dalla tua macchina →</a></sub>
</p>

## Avvio rapido

1. **[Scarica PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** oppure esegui `npx @shellonback/promptops`.
2. **Aggiungi un workspace**: scegli la cartella del progetto su cui lavoreranno i tuoi agenti.
3. **Avvia una sessione** con una CLI di agenti che già usi (Claude Code, Codex, Gemini CLI…). PromptOps rileva quelle installate.
4. **Lascia che apra altri agenti**: chiedi al lead *"Apri qui 3 agenti PromptOps: uno per i test, uno per il README, uno per una review"* e compariranno accanto a lui, ognuno sulla propria parte. Claude Code e Codex ricevono automaticamente il server MCP di PromptOps; qualsiasi altro agente può fare lo stesso con il comando `promptops ctl` nel suo terminale.

## Funzionalità

<table>
<tr>
<td width="50%" valign="middle">

### Agenti che gestiscono agenti

Chiedi al tuo agente lead di dividere il lavoro: tramite il server MCP integrato apre un agente per ogni parte, raccoglie i loro report e sposta il lavoro in una nuova sessione. Le azioni rischiose restano soggette alla tua approvazione.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="Un agente lead apre agenti fratelli tramite il server MCP di PromptOps" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="Avvio di sub-agenti con provider e modelli diversi" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### L'agente giusto per ogni compito

Scegli provider, modello ed effort per ogni sub-agente: Claude sul refactoring, Gemini sull'analisi del bundle, Codex sulla review, tutto in un'unica sessione. Le modalità di lavoro (Sprint, Architect, Detective, Paranoid…) corrispondono ai flag nativi di ogni CLI.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Comandi con un clic, sessioni che restano

Quando Claude suggerisce un comando, premi play accanto: viene eseguito nel terminale e l'agente ne legge il risultato. Chiudi e riapri l'app: stesse sessioni, stessi agenti, stesso punto.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="Esecuzione di un comando suggerito con un clic e ripristino della sessione" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan con gli agenti raggruppati per cliente" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

Ogni cliente, ogni sessione, un unico piano. Le scrivanie si illuminano quando un agente finisce o ha bisogno di te, e il piano resta al tuo fianco, in 3D o 2D, mentre lavori.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

Quando il prompt di un sub-agente è solo un comando, PromptOps propone di eseguirlo direttamente nel terminale: più veloce e senza spendere token. Ogni sessione mostra token reali, cache hit e costo, letti dal transcript dell'agente.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps propone di eseguire un comando direttamente nel terminale invece di spendere token" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="Teams in PromptOps Desktop: ufficio virtuale, chat e board" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

Il tuo team proprio accanto ai tuoi agenti: un ufficio virtuale, chat, board di progetto e sprint. Premi play su un task e un agente lo prende in carico nella tua sessione; trascinalo in Done quando i test passano.

Teams richiede un server, quindi è disponibile in [PromptOps Desktop](https://www.promptoperations.ai/), l'edizione hosted. Nell'edizione open source mostra un lucchetto e non esegue codice.

</td>
</tr>
</table>

**Inclusi anche:**

- **Session Vault** — Sessioni, prompt, note e impostazioni cifrati record per record con AES-256-GCM, con la chiave nel portachiavi del sistema operativo.
- **Libreria di prompt** — Prompt versionati con variabili, categorie e tag, a un clic da qualsiasi agente.
- **Plugin creati in locale** — Un host di plugin in sandbox e Plugin Studio: crea lo scheletro di un plugin in una cartella, fallo scrivere a un agente e ricaricalo al volo. Condividilo con una pull request al catalogo ufficiale.
- **Strumenti di sviluppo integrati** — Git explorer e messaggi di commit generati dall'AI, database explorer, editor di codice, pannelli Docker e porte, terminali SSH.
- **Limiti dei provider sotto controllo** — Quando un agente raggiunge il limite del suo piano, PromptOps mostra quali altre CLI installate possono subentrare e cambia con un clic.
- **Prompt vocali sul tuo dispositivo** — Trascrizione locale con Whisper; la tua chiave Groq o OpenAI solo come fallback, se ne aggiungi una.
- **Utilizzo e velocità** — Utilizzo dei token per sessione e un test di velocità affiancato dei modelli a cui hai accesso.
- **Nativa e leggera** — Rust e Tauri 2 con un PTY nativo. Nessun Chromium incluso.

---

## Agenti supportati

Funziona con **qualsiasi agente CLI**: se gira in un terminale, gira in PromptOps.

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
  <kbd>+ qualsiasi agente CLI</kbd>
</p>

PromptOps avvia le CLI ufficiali con gli account che già paghi. Nessun proxy, nessuna rivendita di token: ogni agente parla con il proprio provider, secondo i suoi termini.

<sub>I nomi dei prodotti e i loghi appartengono ai rispettivi proprietari. PromptOps è un progetto indipendente, non affiliato né approvato da essi.</sub>

Ne manca uno? Aggiungere un provider è una modifica ben definita: vedi [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Installazione

### PromptOps Desktop — pronto all'uso

macOS, Windows e Linux. Include Teams, sincronizzazione tra dispositivi, l'app mobile e SSO, e richiede un account.

- **[Scarica da GitHub Releases](https://github.com/shellonback/promptops/releases/latest)**, notarizzato su macOS.
- Oppure, con Node.js 18 o successivo: `npx @shellonback/promptops`. Installa e apre PromptOps Desktop, e rifiuta qualsiasi download non firmato con la chiave di release di PromptOps.

Cifra i dati delle tue sessioni con lo stesso algoritmo dell'edizione open source; la differenza è che la chiave è custodita dai nostri server, così le tue sessioni possono seguirti. Vedi [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition).

### Edizione open source

Nessun account e nessun server: tutto resta sul tuo computer. Il suo codice sorgente arriverà in questo repository, con i comandi per compilarla da solo su macOS, Windows e Linux. Metti una [stella](https://github.com/shellonback/promptops) al repo per sapere quando arriva.

---

## Community &amp; supporto

- **Feedback &amp; idee:** Manca qualcosa? [Apri una issue](https://github.com/shellonback/promptops/issues).
- **Telegram:** release, esperimenti e accesso anticipato su [t.me/promptoperations](https://t.me/promptoperations).
- **Privacy:** L'edizione open source non ha telemetria, analytics né controlli degli aggiornamenti. PromptOps Desktop richiede un account e comunica con i server di PromptOps. [PRIVACY.md](../../PRIVACY.md) spiega cosa invia ciascuna edizione e dove.
- **Sicurezza:** Segnala le vulnerabilità in privato, come descritto in [SECURITY.md](../../SECURITY.md).
- **Open source e hosted:** cosa vive qui, cosa richiede PromptOps Desktop e chi decide: [GOVERNANCE.md](../../GOVERNANCE.md).
- **Sostieni il progetto:** Metti una [stella](https://github.com/shellonback/promptops) al repo per seguirne gli sviluppi.

---

## Sviluppo

Vuoi contribuire? Vedi [CONTRIBUTING.md](../../CONTRIBUTING.md). I commit sono firmati con sign-off ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="Contributori di PromptOps" />
</a>

## Lingue

English, Italiano, Français, Español, Deutsch, Português, 中文, 日本語, Русский, العربية, हिन्दी, Polski, Nederlands, Svenska e 한국어, selezionabili dalla barra inferiore.

## Licenza

PromptOps è libero e open source sotto la [Apache License 2.0](../../LICENSE).

"PromptOps" e il logo PromptOps sono marchi di Shellonback S.r.l. — vedi [TRADEMARK.md](../../TRADEMARK.md).
