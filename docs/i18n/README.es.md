<h1 align="center">
  <img src="../../docs/assets/logo.png" alt="PromptOps" width="64" valign="middle" /> PromptOps
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&amp;label=%E2%98%85&amp;color=4F41FA" alt="Estrellas en GitHub" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-4F41FA?style=flat" alt="Licencia: Apache-2.0" />
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshellonback%2Fpromptops%2Fbadges%2Fdownloads.json" alt="Descargas" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4F41FA?style=flat-square" alt="Plataformas compatibles: macOS, Windows y Linux" />
  <a href="https://t.me/promptoperations"><img src="https://img.shields.io/badge/Telegram-promptoperations-26A5E4?style=flat&amp;logo=telegram&amp;logoColor=white" alt="Canal de Telegram" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <a href="README.fr.md">Français</a> · <b>Español</b> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>El ADE multiproyecto y multisesión para los CLI AI coding agents.</strong><br/>
  Ejecuta Claude Code, Codex, Gemini CLI y cualquier otro agente CLI en paralelo, organizados por cliente, proyecto y sesión, en tu máquina y con tus propias suscripciones.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>Descargar PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="Siete agentes trabajando en paralelo en una sesión de PromptOps: uno abierto desde el cuadro de prompt, cinco abiertos por el lead a través de MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>El código fuente de la edición open source, sin cuenta, sin inicio de sesión y sin servidor de PromptOps, llegará pronto a este repositorio. PromptOps Desktop es la app lista para usar, con Teams, sincronización y la app móvil. <a href="../../PRIVACY.md">Qué sale de tu máquina →</a></sub>
</p>

## Inicio rápido

1. **[Descarga PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** o ejecuta `npx @shellonback/promptops`.
2. **Añade un workspace**: elige la carpeta del proyecto en la que trabajarán tus agentes.
3. **Inicia una sesión** con una CLI de agente que ya uses (Claude Code, Codex, Gemini CLI…). PromptOps detecta las que tienes instaladas.
4. **Deja que abra más agentes**: pídele al lead *"Abre aquí 3 agentes de PromptOps: uno para los tests, uno para el README y uno para una revisión"*, y aparecerán a su lado, cada uno con su parte. Claude Code y Codex reciben automáticamente el servidor MCP de PromptOps; cualquier otro agente puede hacer lo mismo con el comando `promptops ctl` en su terminal.

## Funcionalidades

<table>
<tr>
<td width="50%" valign="middle">

### Agentes que dirigen agentes

Pídele a tu agente lead que reparta el trabajo: a través del servidor MCP integrado abre un agente por cada parte, recoge sus informes y mueve el trabajo a una nueva sesión. Las acciones arriesgadas siguen requiriendo tu aprobación.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="Un agente lead abre agentes hermanos a través del servidor MCP de PromptOps" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="Lanzamiento de subagentes con distintos providers y modelos" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### El agente adecuado para cada tarea

Elige el provider, el modelo y el effort de cada subagente: Claude para el refactor, Gemini para el análisis del bundle, Codex para la revisión, todo en una sola sesión. Los modos de trabajo (Sprint, Architect, Detective, Paranoid…) se traducen en los flags nativos de cada CLI.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Comandos con un clic, sesiones que perduran

Cuando Claude sugiere un comando, pulsa play a su lado: se ejecuta en el terminal y el agente lee el resultado. Cierra y vuelve a abrir la app: mismas sesiones, mismos agentes, mismo punto.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="Ejecución de un comando sugerido con un clic y restauración de la sesión" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan con los agentes agrupados por cliente" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

Cada cliente, cada sesión, una sola planta. Los escritorios se iluminan cuando un agente termina o te necesita, y la planta se queda a tu lado, en 3D o 2D, mientras trabajas.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

Cuando el prompt de un subagente es solo un comando, PromptOps propone ejecutarlo directamente en el terminal: más rápido y sin gastar tokens. Cada sesión muestra su uso real de tokens, los aciertos de caché y el coste, leídos del transcript del agente.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps propone ejecutar un comando directamente en el terminal en lugar de gastar tokens" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="Teams en PromptOps Desktop: oficina virtual, chat y tableros" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

Tu equipo justo al lado de tus agentes: una oficina virtual, chat, tableros de proyecto y sprints. Pulsa play en una tarea y un agente la asume en tu sesión; arrástrala a Done cuando pasen los tests.

Teams necesita un servidor, así que está en [PromptOps Desktop](https://www.promptoperations.ai/), la edición alojada. En la edición open source muestra un candado y no ejecuta código.

</td>
</tr>
</table>

**Y además:**

- **Session Vault** — Sesiones, prompts, notas y ajustes cifrados registro a registro con AES-256-GCM, con la clave en el llavero de tu sistema operativo.
- **Biblioteca de prompts** — Prompts versionados con variables, categorías y etiquetas, a un clic de cualquier agente.
- **Plugins que creas en local** — Un host de plugins en sandbox y Plugin Studio: genera la estructura de un plugin en una carpeta, deja que un agente lo escriba y recárgalo en caliente. Compártelo con una pull request al catálogo oficial.
- **Herramientas de desarrollo integradas** — Explorador de Git y mensajes de commit generados por IA, explorador de bases de datos, editor de código, paneles de Docker y puertos, terminales SSH.
- **Límites de los providers, resueltos** — Cuando un agente alcanza el límite de su plan, PromptOps muestra qué otras CLI instaladas pueden tomar el relevo y cambia con un clic.
- **Prompts de voz en tu dispositivo** — Transcripción local con Whisper; tu propia clave de Groq u OpenAI solo como alternativa, si añades una.
- **Uso y velocidad** — Uso de tokens por sesión y una prueba de velocidad comparativa de los modelos a los que tienes acceso.
- **Nativa y ligera** — Rust y Tauri 2 con un PTY nativo. Sin Chromium incluido.

---

## Agentes compatibles

Funciona con **cualquier agente CLI**: si se ejecuta en un terminal, se ejecuta en PromptOps.

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
  <kbd>+ cualquier agente CLI</kbd>
</p>

PromptOps lanza las CLI oficiales con las cuentas que ya pagas. Sin proxy ni reventa de tokens: cada agente habla con su propio provider, bajo sus propias condiciones.

<sub>Los nombres de productos y los logotipos pertenecen a sus propietarios. PromptOps es un proyecto independiente, no afiliado a ellos ni respaldado por ellos.</sub>

¿Falta alguno? Añadir un provider es un cambio bien definido: consulta [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Instalación

### PromptOps Desktop — listo para usar

macOS, Windows y Linux. Incluye Teams, sincronización entre dispositivos, la app móvil y SSO, y requiere una cuenta.

- **[Descargar desde GitHub Releases](https://github.com/shellonback/promptops/releases/latest)**, notarizado en macOS.
- O bien, con Node.js 18 o superior: `npx @shellonback/promptops`. Instala y abre PromptOps Desktop, y rechaza cualquier descarga que no esté firmada con la clave de release de PromptOps.

Cifra los datos de tus sesiones con el mismo algoritmo que la edición open source; la diferencia es que la clave la guardan nuestros servidores, para que tus sesiones puedan acompañarte. Consulta [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition).

### Edición open source

Sin cuenta y sin servidor: todo se queda en tu ordenador. Su código fuente llegará pronto a este repositorio, con los comandos para compilarla tú mismo en macOS, Windows y Linux. Dale una [estrella](https://github.com/shellonback/promptops) al repositorio para enterarte cuando llegue.

---

## Comunidad &amp; soporte

- **Comentarios &amp; ideas:** ¿Echas algo en falta? [Abre una issue](https://github.com/shellonback/promptops/issues).
- **Telegram:** releases, experimentos y acceso anticipado en [t.me/promptoperations](https://t.me/promptoperations).
- **Privacidad:** La edición open source no tiene telemetría, ni analítica, ni comprobación de actualizaciones. PromptOps Desktop requiere una cuenta y se comunica con los servidores de PromptOps. [PRIVACY.md](../../PRIVACY.md) explica qué envía cada edición y adónde.
- **Seguridad:** Informa de vulnerabilidades en privado, como se describe en [SECURITY.md](../../SECURITY.md).
- **Open source y alojada:** qué vive aquí, qué requiere PromptOps Desktop y quién decide: [GOVERNANCE.md](../../GOVERNANCE.md).
- **Apoya el proyecto:** Dale una [estrella](https://github.com/shellonback/promptops) al repositorio para seguir su evolución.

---

## Desarrollo

¿Quieres contribuir? Consulta [CONTRIBUTING.md](../../CONTRIBUTING.md). Los commits llevan sign-off ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="Colaboradores de PromptOps" />
</a>

## Idiomas

[English](../../README.md), [Italiano](README.it.md), [Français](README.fr.md), **Español**, [Deutsch](README.de.md), [Português](README.pt.md), [中文](README.zh.md), [日本語](README.ja.md), [Русский](README.ru.md), [العربية](README.ar.md), [हिन्दी](README.hi.md), [Polski](README.pl.md), [Nederlands](README.nl.md), [Svenska](README.sv.md) y [한국어](README.ko.md), seleccionables desde la barra inferior.

## Licencia

PromptOps es libre y open source bajo la [Apache License 2.0](../../LICENSE).

"PromptOps" y el logotipo de PromptOps son marcas comerciales de Shellonback S.r.l. — consulta [TRADEMARK.md](../../TRADEMARK.md).
