<h1 align="center">
  <img src="../../docs/assets/logo.png" alt="PromptOps" width="64" valign="middle" /> PromptOps
</h1>

<p align="center">
  <a href="https://github.com/shellonback/promptops/stargazers"><img src="https://img.shields.io/github/stars/shellonback/promptops?style=flat&amp;label=%E2%98%85&amp;color=4F41FA" alt="Étoiles GitHub" /></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-4F41FA?style=flat" alt="Licence : Apache-2.0" />
  <a href="https://github.com/shellonback/promptops/releases"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshellonback%2Fpromptops%2Fbadges%2Fdownloads.json" alt="Téléchargements" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4F41FA?style=flat-square" alt="Plateformes prises en charge : macOS, Windows et Linux" />
  <a href="https://t.me/promptoperations"><img src="https://img.shields.io/badge/Telegram-promptoperations-26A5E4?style=flat&amp;logo=telegram&amp;logoColor=white" alt="Canal Telegram" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.it.md">Italiano</a> · <b>Français</b> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt.md">Português</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.pl.md">Polski</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.sv.md">Svenska</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>L'ADE multi-projet et multi-session pour les CLI AI coding agents.</strong><br/>
  Lancez Claude Code, Codex, Gemini CLI et tous les autres agents CLI côte à côte, organisés par client, projet et session, sur votre machine et avec vos propres abonnements.
</p>

<h3 align="center"><a href="https://github.com/shellonback/promptops/releases/latest"><ins>Télécharger PromptOps Desktop</ins></a></h3>

<p align="center">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/seven-agents.jpg"><img src="../../docs/assets/readme/seven-agents.gif" alt="Sept agents travaillant côte à côte dans une session PromptOps : un ouvert depuis la zone de prompt, cinq ouverts par le lead via MCP" width="960" /></picture>
</p>

<p align="center">
  <sub>Ce dépôt héberge les versions de PromptOps Desktop et l'édition open source : pas de compte, pas de connexion, pas de serveur PromptOps, et <a href="../../README.md#open-source-edition--build-it-yourself">vous la compilez vous-même</a>. PromptOps Desktop est l'application prête à l'emploi, avec Teams, la synchronisation et l'application mobile. <a href="../../PRIVACY.md">Ce qui quitte votre machine →</a></sub>
</p>

## Démarrage rapide

1. **[Téléchargez PromptOps Desktop](https://github.com/shellonback/promptops/releases/latest)** ou lancez `npx @shellonback/promptops`.
2. **Ajoutez un workspace** : choisissez le dossier du projet sur lequel vos agents vont travailler.
3. **Démarrez une session** avec une CLI d'agent que vous utilisez déjà (Claude Code, Codex, Gemini CLI…). PromptOps détecte celles qui sont installées.
4. **Laissez-le ouvrir d'autres agents** : demandez au lead *« Ouvre 3 agents PromptOps ici : un pour les tests, un pour le README, un pour une revue »*, et ils apparaissent à côté de lui, chacun sur sa partie. Claude Code et Codex reçoivent automatiquement le serveur MCP de PromptOps ; tout autre agent peut faire de même avec la commande `promptops ctl` dans son terminal.

## Fonctionnalités

<table>
<tr>
<td width="50%" valign="middle">

### Des agents qui pilotent des agents

Demandez à votre agent lead de répartir le travail : via le serveur MCP intégré, il ouvre un agent par partie, rassemble leurs rapports et déplace le travail vers une nouvelle session. Les actions risquées restent soumises à votre approbation.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/agents-organize.jpg"><img src="../../docs/assets/readme/agents-organize.gif" alt="Un agent lead ouvre des agents voisins via le serveur MCP de PromptOps" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/right-agent.jpg"><img src="../../docs/assets/readme/right-agent.gif" alt="Lancement de sous-agents avec différents providers et modèles" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Le bon agent pour chaque tâche

Choisissez le provider, le modèle et l'effort de chaque sous-agent : Claude sur le refactoring, Gemini sur l'analyse du bundle, Codex sur la revue, le tout dans une seule session. Les modes de travail (Sprint, Architect, Detective, Paranoid…) correspondent aux flags natifs de chaque CLI.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Commandes en un clic, sessions persistantes

Quand Claude suggère une commande, cliquez sur lecture à côté : elle s'exécute dans le terminal et l'agent lit le résultat. Quittez et rouvrez l'application : mêmes sessions, mêmes agents, même endroit.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/one-click-run.jpg"><img src="../../docs/assets/readme/one-click-run.gif" alt="Exécution d'une commande suggérée en un clic, puis restauration de la session" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/floor-plan.jpg"><img src="../../docs/assets/readme/floor-plan.gif" alt="Floor Plan affichant les agents regroupés par client" width="100%" /></picture>
</td>
<td width="50%" valign="middle">

### Floor Plan

Chaque client, chaque session, un seul plateau. Les bureaux s'allument quand un agent a terminé ou a besoin de vous, et le plateau reste à vos côtés, en 3D ou en 2D, pendant que vous travaillez.

</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Token Efficiency Engine

Quand le prompt d'un sous-agent n'est qu'une commande, PromptOps propose de l'exécuter directement dans le terminal : plus rapide, et sans dépenser de tokens. Chaque session affiche sa consommation réelle de tokens, ses cache hits et son coût, lus dans le transcript de l'agent.

</td>
<td width="50%">
  <picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/token-efficiency.jpg"><img src="../../docs/assets/readme/token-efficiency.gif" alt="PromptOps propose d'exécuter une commande directement dans le terminal au lieu de dépenser des tokens" width="100%" /></picture>
</td>
</tr>
<tr>
<td width="50%">
  <a href="https://www.promptoperations.ai/"><picture><source media="(prefers-reduced-motion: reduce)" srcset="../../docs/assets/readme/teams.jpg"><img src="../../docs/assets/readme/teams.gif" alt="Teams dans PromptOps Desktop : bureau virtuel, chat et boards" width="100%" /></picture></a>
</td>
<td width="50%" valign="middle">

### Teams <sub><kbd>PromptOps Desktop</kbd></sub>

Votre équipe juste à côté de vos agents : un bureau virtuel, un chat, des boards de projet et des sprints. Cliquez sur lecture sur une tâche et un agent la prend en charge dans votre session ; faites-la glisser dans Done quand les tests passent.

Teams nécessite un serveur, il est donc disponible dans [PromptOps Desktop](https://www.promptoperations.ai/), l'édition hébergée. Dans l'édition open source, il affiche un cadenas et n'exécute aucun code.

</td>
</tr>
</table>

**Également inclus :**

- **Session Vault** — Sessions, prompts, notes et réglages chiffrés enregistrement par enregistrement avec AES-256-GCM, avec la clé dans le trousseau de votre système.
- **Bibliothèque de prompts** — Des prompts versionnés avec variables, catégories et tags, à un clic de n'importe quel agent.
- **Des plugins créés en local** — Un hôte de plugins en sandbox et Plugin Studio : générez la structure d'un plugin dans un dossier, laissez un agent l'écrire, rechargez-le à chaud. Partagez-le via une pull request vers le catalogue officiel.
- **Outils de développement intégrés** — Explorateur Git et messages de commit générés par IA, explorateur de bases de données, éditeur de code, panneaux Docker et ports, terminaux SSH.
- **Limites des providers, gérées** — Quand un agent atteint la limite de son forfait, PromptOps indique quelles autres CLI installées peuvent prendre le relais et bascule en un clic.
- **Prompts vocaux sur votre appareil** — Transcription locale avec Whisper ; votre propre clé Groq ou OpenAI uniquement en secours, si vous en ajoutez une.
- **Consommation et vitesse** — Consommation de tokens par session et test de vitesse comparatif des modèles auxquels vous avez accès.
- **Natif et léger** — Rust et Tauri 2 avec un PTY natif. Pas de Chromium embarqué.

---

## Agents pris en charge

Fonctionne avec **n'importe quel agent CLI** : s'il tourne dans un terminal, il tourne dans PromptOps.

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
  <kbd>+ tout agent CLI</kbd>
</p>

PromptOps lance les CLI officielles avec les comptes que vous payez déjà. Pas de proxy, pas de revente de tokens : chaque agent communique avec son propre provider, selon ses propres conditions.

<sub>Les noms de produits et les logos appartiennent à leurs propriétaires. PromptOps est un projet indépendant, ni affilié à ceux-ci ni approuvé par eux.</sub>

Il en manque un ? Ajouter un provider est une modification bien définie : voir [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## Installation

### PromptOps Desktop — prêt à l'emploi

macOS, Windows et Linux. Inclut Teams, la synchronisation entre appareils, l'application mobile et le SSO, et nécessite un compte.

- **[Télécharger depuis GitHub Releases](https://github.com/shellonback/promptops/releases/latest)**, notarisé sur macOS.
- Ou, avec Node.js 18 ou plus récent : `npx @shellonback/promptops`. La commande installe et ouvre PromptOps Desktop, et refuse tout téléchargement qui n'est pas signé avec la clé de release de PromptOps.

Il chiffre les données de vos sessions avec le même algorithme que l'édition open source ; la différence est que la clé est conservée par nos serveurs, pour que vos sessions puissent vous suivre. Voir [PRIVACY.md](../../PRIVACY.md#promptops-desktop-the-hosted-edition).

### Édition open source

Pas de compte ni de serveur : tout reste sur votre ordinateur. Le code est dans ce dépôt ; il n'existe pas de binaires précompilés de cette édition : les commandes pour la compiler sur macOS, Windows et Linux sont dans le [README en anglais](../../README.md#open-source-edition--build-it-yourself).

---

## Communauté &amp; support

- **Retours &amp; idées :** Il manque quelque chose ? [Ouvrez une issue](https://github.com/shellonback/promptops/issues).
- **Telegram :** releases, expérimentations et accès anticipé sur [t.me/promptoperations](https://t.me/promptoperations).
- **Confidentialité :** L'édition open source n'a ni télémétrie, ni analytics, ni vérification des mises à jour. PromptOps Desktop nécessite un compte et communique avec les serveurs de PromptOps. [PRIVACY.md](../../PRIVACY.md) explique ce que chaque édition envoie et où.
- **Sécurité :** Signalez les vulnérabilités en privé, comme décrit dans [SECURITY.md](../../SECURITY.md).
- **Open source et hébergé :** ce qui vit ici, ce qui nécessite PromptOps Desktop, et qui décide : [GOVERNANCE.md](../../GOVERNANCE.md).
- **Soutenez le projet :** Ajoutez une [étoile](https://github.com/shellonback/promptops) au dépôt pour suivre son évolution.

---

## Développement

Envie de contribuer ? Voir [CONTRIBUTING.md](../../CONTRIBUTING.md). Les commits sont signés avec sign-off ([DCO](https://developercertificate.org/)).

<a href="https://github.com/shellonback/promptops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shellonback/promptops" alt="Contributeurs de PromptOps" />
</a>

## Langues

[English](../../README.md), [Italiano](README.it.md), **Français**, [Español](README.es.md), [Deutsch](README.de.md), [Português](README.pt.md), [中文](README.zh.md), [日本語](README.ja.md), [Русский](README.ru.md), [العربية](README.ar.md), [हिन्दी](README.hi.md), [Polski](README.pl.md), [Nederlands](README.nl.md), [Svenska](README.sv.md) et [한국어](README.ko.md), à changer depuis la barre inférieure.

## Licence

PromptOps est libre et open source sous [Apache License 2.0](../../LICENSE).

« PromptOps » et le logo PromptOps sont des marques de Shellonback S.r.l. — voir [TRADEMARK.md](../../TRADEMARK.md).
