# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Angular 22 app in `apps/web`, shipped inside the Tauri desktop shell in `apps/desktop`. Desktop-class windows; mobile web is not a target for this fork.)

## Users

The primary user is a solo developer / small consultancy (Ailligence) running PromptOps all day as their main development environment. They keep 3–8 CLI coding agents (Claude Code, Codex, Gemini CLI, …) working in parallel across several client projects, glance at the screen to see who is working and who needs them, and step in to answer, review, commit or redirect.

## Product Purpose

PromptOps is an ADE (agentic development environment) for CLI AI coding agents: it runs the agents in real terminals, organized by client → workspace → session, on the user's machine with their own subscriptions. Success means the user can supervise many agents at once without losing track of any of them, and can do the surrounding work (git, database, docker, code, prompts, accounts) without leaving the session.

## Positioning

Not a new agent and not an IDE plugin: it orchestrates the CLI agents the user already pays for, side by side, with a built-in MCP server that lets a lead agent open, prompt and read sibling agents. Local-first, no account in the open-source edition.

## Operating Context

- Long sessions (hours), desktop app always open, frequently on a second monitor or glanced at between other work.
- Many agents in a grid; each agent can be starting / working / idle / blocked (permission or question dialog only the user can answer) / exited.
- Surrounding panels inside a session: Git (branch graph, staging, AI commit messages, AI Resolver), Database explorer (natural-language read-only queries), Docker, forwarded ports, code editor, assets, SSH.
- Secondary areas: Prompt Library, AI Accounts & Usage, Plugins, Browser mirror, Agent Evals, AI Git Writer, MCP guide, Floor Plan (2D/3D), voice agent, settings, onboarding.

## Capabilities and Constraints

- Personal fork of `shellonback/promptops` (Apache-2.0). The user uses **all** features: simplification means consolidating and re-ranking, not removing.
- i18n via ngx-translate across 15 languages (incl. RTL Arabic); new copy must go through translation keys, `en.json` is the source.
- Stack is fixed: Angular 22 + NgRx + ng-bootstrap + Tabler icons webfont + xterm.js; fonts already bundled: Geist, Geist Mono, Instrument Sans.
- Existing `uiStyle` variants (incl. `minimal`) and light/dark theming exist in code.
- A `desktop-demo` build simulates data for recordings (`src/app/demo`), usable to run the UI without the Tauri backend.

## Brand Commitments

- Name **PromptOps** and the existing logo assets (`apps/web/src/assets/logos/`).
- Brand violet `#4F41FA` as the anchor color (README badges, logo).
- Provider marks in `assets/providers/` stay the providers' own.

## Evidence on Hand

- README feature GIFs/JPGs in `docs/assets/readme/` show the current UI.
- No testimonials, metrics or customers to show in-app; none should be invented.

## Product Principles

1. **Agent state first.** At any moment the user must see, without reading, which agents are working, idle, blocked or failed — "needs you" outranks everything else on screen.
2. **One place per thing.** Every action and destination has a single obvious home; no duplicated entry points across sidebar, topbar, bottom bar and quick access.
3. **Quiet chrome, loud content.** Terminals and agent output are the work; navigation and controls recede until needed.
4. **Progressive disclosure over removal.** Everything stays reachable (command palette, overflow), but only the frequent actions are visible.
5. **Built for hours.** Low glare, stable layout, no decorative motion; density that holds up on a second monitor.

## Accessibility & Inclusion

Keyboard-first operation (shortcuts, Esc to close, focus visible), RTL support for Arabic, WCAG AA contrast in both themes, `prefers-reduced-motion` respected.
