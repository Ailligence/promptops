# Plugin guidelines

This guide is for people who write PromptOps plugins. It describes what the desktop app enforces today. The
sources of truth are `apps/desktop/src-tauri/src/plugins/` (runtime, broker, SDK, Studio) and
`apps/web/src/app/views/admin-core/plugins/` (catalog, pages, Studio UI). When this guide and the code disagree,
the code wins.

## What a plugin is

A plugin is a folder with a manifest (`promptops-plugin.json`) and **one** JavaScript file (`entry`). The app runs
that file inside a sandboxed iframe and exposes a small SDK to it. A plugin never draws its own UI and never calls
the app directly: it returns plain JSON data, and PromptOps renders it with its own components. Every side effect
(network, storage, toasts, git reads, file writes, AI runs) is a request to a broker in Rust that checks the
permissions of the **installed** manifest.

Plugins can contribute:

- **Pages**: one to three entries in the side menu (`place: "menu"`) or at the top of the session sidebar
  (`place: "sidebar"`). Category `pages` only.
- **Session buttons**: up to two buttons per plugin, any category, with the `session:buttons` permission.
- **A section contract** for their category (`tasks`, `code`, `data`, `providers`, `context`). See
  [Limits](#limits) for what this edition calls. In this edition the `tasks` section is hidden: it is not in the
  catalog or in the Studio.

## Folder layout

The Plugin Studio creates this layout. Only the manifest and the entry file are read by the runtime.

```
my-plugin/
  promptops-plugin.json   manifest (required)
  src/plugin.js           entry file (required; any relative `.js` path, see the `entry` rule)
  fixtures.json           sample HTTP answers (page, sidebar and task-source templates)
  test/plugin.test.mjs    tests run with `node --test` (the button templates ship one; add your own for pages)
  CLAUDE.md, AGENTS.md, GEMINI.md, PLUGIN_GUIDE.md   instructions for coding agents (Studio)
```

## Manifest

File name: `promptops-plugin.json`, at the root of the plugin folder.

| Field | Type | Rule enforced by the runtime |
|---|---|---|
| `id` | string | `<handle>.<slug>`. Each part 2 to 60 characters of `a-z`, `0-9`, `-`; no leading or trailing hyphen; exactly one dot. Studio drafts use `local.<slug>` |
| `name` | string | Stored truncated to 80 characters |
| `version` | string | 1 to 40 characters of letters, digits, `.`, `-` and `+`, starting with a letter or digit, with no `..`. For local folders a version that does not have this form becomes `0.0.0-dev`; registry installs are refused unless the registry entry's `version` has it |
| `category` | string | One of `tasks`, `code`, `data`, `providers`, `context`, `notify`, `agent`, `pages`. The runtime does not check this list (any string is stored, cut to 20 characters), but only `pages` and the five section names are ever called. For registry installs it must equal the registry entry's `category` |
| `entry` | string | Relative path to a `.js` file: no `..`, no leading `/` or `.`, only `A-Za-z0-9_./-`, at most 200 characters. File at most 2,000,000 bytes, UTF-8 |
| `permissions` | string[] | Required (may be empty). See [Permissions](#sdk-and-permissions) |
| `contributes.pages` | object[] | `pages` category only, 1 to 3 items: `{ id, title, icon?, place? }` |
| `contributes.sessionButtons` | object[] | Requires `session:buttons`; 1 to 2 items: `{ id, title, icon?, target?, place? }` |
| `config.fields` | object[] | Settings form: `{ key, type, label?, required?, default?, options? }`. Not validated by the runtime. The form draws `secret` as a password box, `boolean` as a checkbox, `select` as a dropdown built from `options` and `number` as a number box; every other type, including `multiselect` and `url`, is a plain text box. `required` is not enforced yet |
| `repository` | string | Optional. For local folders it is kept only if it is `https://github.com/<owner>/<repo>` and is used to show the owner and avatar; registry installs show the registry entry's `repo_url` instead. Never a download source |
| `providers` | string[] | Optional, display only. Up to 12 distinct ids, 2 to 40 characters of `a-z`, `0-9`, `-`, no leading or trailing hyphen. Invalid ids are dropped |
| `description` | string | Optional. The catalog shows the registry entry's `description` |

Item rules:

- `id` (page or button): 2 to 60 characters of `a-z`, `0-9`, `-`, unique within the list.
- `title`: required, 1 to 40 characters, no control characters.
- `icon`: a Tabler icon name such as `ti-file-pencil` (default `ti-puzzle`).
- Page `place`: `menu` (default) or `sidebar`.
- Button `target`: `main`, `subagent` or `both` (default); validated but not used yet: the button appears under
  every agent terminal. Button `place`: `terminal` (default, the toolbar under
  every agent terminal), `header` (session header), `composer` (spawn composer tools), `runtime` (the AI Squad,
  Goal and Worker row).

### Minimal working example

A `pages` plugin with one menu entry and no permissions:

```json
{
  "schemaVersion": 1,
  "id": "local.hello-page",
  "name": "Hello page",
  "version": "0.1.0",
  "category": "pages",
  "entry": "src/plugin.js",
  "permissions": [],
  "contributes": {
    "pages": [{ "id": "hello", "title": "Hello", "icon": "ti-hand-stop" }]
  }
}
```

```js
// src/plugin.js
let clicks = 0;
const view = () => ({
  title: 'Hello',
  blocks: [
    { type: 'text', text: `Clicked ${clicks} times.` },
    { type: 'actions', items: [{ id: 'click', label: 'Click', style: 'primary' }] },
  ],
});

promptops.pages.register({
  async open(pageId, context, sdk) { return view(); },
  async event(pageId, event, sdk) {
    if (event.type === 'action' && event.id === 'click') clicks++;
    return view();
  },
});
```

A session button needs the permission and the declaration:

```json
"permissions": ["session:buttons"],
"contributes": { "sessionButtons": [{ "id": "run", "title": "Summarize", "icon": "ti-player-play" }] }
```

```js
promptops.session.registerButtons({
  async action(buttonId, ctx) {
    return { prompt: 'Summarize what you did so far in 5 bullets.', target: ctx.paneAgentId };
  },
});
```

## Where plugins render

| Contribution | Where it appears | Called as |
|---|---|---|
| Page, `place: "menu"` | Under Plugins in the side menu | `pages.open(pageId, context)`, `pages.event(pageId, event)` |
| Page, `place: "sidebar"` | Top of the session sidebar, above folders and workspaces | Same. With `sessions:read`, `context.workspace` / `event.workspace` carry a snapshot of folders, workspaces, sessions and agents (ids, names, providers and status; no paths, prompts or output) |
| Button, `place: "terminal"` | Toolbar under each agent terminal | `session.action(buttonId, ctx)` |
| Button, `place: "header"` | Session header | Same |
| Button, `place: "composer"` | Spawn composer tools | Same |
| Button, `place: "runtime"` | AI Squad / Goal / Worker row | Same |

**Pages.** A page is `{ title, subtitle, blocks }`. Block types: `heading`, `text`, `notice`, `divider`, `field`,
`actions`, `output`, `list`, `table`, `stats`, `progress`, `columns`, `floorplan`. Field kinds: `text`, `textarea`,
`select`, `choice`, `toggle`, `repo`. Unknown blocks and kinds are dropped; all text is rendered as text. `event` is
`{ type: 'action' | 'change', id, values }`. A `repo` field lets the person pick a folder; you receive
`{ handle, name, branch }` and never the path. The full block reference is in
`apps/desktop/src-tauri/src/plugins/studio_templates/CONTRACTS.md`.

**Session buttons.** `ctx` is `{ sessionId, sessionName, provider, status, workspaceName, paneAgentId, agents }`,
plus `composerText` only with `composer:read`. Return one proposal: `{ insert }`, `{ prompt, target }`,
`{ spawn: { prompt, provider, mode, name } }`, `{ panel: view }` or `{ toast }`. PromptOps carries it out; prompts
follow the confirmation policy the person sets for that button.

## SDK and permissions

Inside the iframe, the global `promptops` exposes `sdk`, `onActivate(fn)`, `actions.register(id, fn)`,
`events.on(name, fn)` and one `register*` function per section (`tasks.registerSource`, `code.registerHost`,
`data.registerExplorer`, `providers.registerUsage`, `context.registerProvider`, `pages.register`,
`session.registerButtons`). Every contract method gets `sdk` as its last argument.

| SDK call | Permission | Notes |
|---|---|---|
| `sdk.http.fetch(url, { method, headers, body })` | `net:<host>` for that exact host | HTTPS, port 443, domain names only. Methods `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`. Body is a string. Returns `{ status, ok, headers, body }`. Redirects are not followed |
| `sdk.storage.get(key)` / `set(key, value)` / `remove(key)` | `storage` | Private JSON map, keys up to 200 bytes, 1 MB total |
| `sdk.config.get()` | none | Non-secret settings plus `__secretsSet` (names of secrets that have a value) |
| `sdk.notify.toast(message)` | `notify` | Truncated to 300 characters, control characters removed |
| `sdk.prompt.propose(text, title)` | `prompt:propose` | Shown to the person as untrusted text; nothing is sent without them. Text up to 8,000 characters, title up to 120; control characters other than line breaks and tabs are removed |
| `sdk.git.status(repo)` / `log(repo, limit)` / `diff(repo, { staged })` | `git:read` | `repo` is a handle from a `repo` field |
| `sdk.workspace.writeFile(repo, path, content)` | `workspace:write` | Only paths under `docs/` (subfolders allowed, no hidden segments) ending in `.md`, `.markdown` or `.txt`; at most 500,000 bytes; the person confirms with the full content |
| `sdk.ai.generate({ prompt, model })` or `sdk.ai.generate(prompt)` | `ai:generate` | Runs the person's Claude CLI with no tools in an empty folder. Prompt up to 200,000 characters; one run at a time, 30 per hour; confirmed every time. Returns `{ text, truncated }`. Not available on Windows yet. `ai.generate` and `ai.benchmark` share the one-run-at-a-time slot, and a declined request still counts toward the 30 |
| `sdk.ai.benchmarkModels()` / `sdk.ai.benchmark(modelIds)` | `ai:benchmark` | 1 to 12 models, 6 runs per hour, one confirmation per series. Progress arrives as the `benchmark.progress` event |
| `sdk.pages.update(pageId, view)` | none | Page must be declared; view at most 256,000 bytes |
| `sdk.log(...values)` | none | One line in the audit log, 500 characters, control characters removed |

Other permission rules:

- `git:read`, `workspace:write`, `ai:generate` and `ai:benchmark` are accepted only for the `pages` category.
- `sessions:read` delivers the session events (`session.*`, `turn.completed`, `approval.requested`) and the sidebar
  workspace snapshot. `tasks:read` delivers `task.*`
  events.
- `composer:read` adds `composerText` to session button context.
- `tasks:write` is required for the write methods of the `tasks` contract (`setStatus`, `createTask`,
  `updateTask`, `deleteTask`, `addComment`): without it the app refuses the call. `agents:propose` is not
  supported: a manifest that asks for it fails to install or link.
- Any other permission string makes install or linking fail.

Confirmations that the person declines reject with an error starting with `user_denied`; no answer within three
minutes rejects with `confirm_timeout`. Treat both as normal outcomes.

## Secrets and declared hosts

Declare a `config.fields` entry with `type: "secret"`. The person enters the value in the plugin settings; it is
stored by Rust and never returned to the UI or to the plugin. In requests, write placeholders:

- `{{secret:key}}` in a header value, or in the URL path or query. Never in the host, never in the body.
- `{{basic:user:secret}}` in a header value only: the broker builds `base64(user:password)`. `user` is a setting or
  a secret, `secret` must be a secret, and the user value cannot contain `:`.

Placeholders require the `secrets` permission. A missing secret fails the request instead of sending the
placeholder. The host is validated before and after substitution and must not change. Secret values (6 characters
or more) and built Basic values are replaced with `[secret]` in response headers and bodies.

`net:<host>` must be a public domain name: no IP addresses, wildcards, `localhost`, single-label names, or the TLDs
`local`, `internal`, `lan`, `home`, `corp`. At request time the broker resolves DNS and refuses the call if any
address is IPv4 loopback, private, link-local, CGNAT (`100.64.0.0/10`), multicast, broadcast, documentation, IETF
protocol assignments (`192.0.0.0/24`), benchmarking (`198.18.0.0/15`), `0.0.0.0/8` or `240.0.0.0/4`; or IPv6
loopback, unspecified, multicast, unique-local (`fc00::/7`), link-local (`fe80::/10`), site-local (`fec0::/10`),
Teredo (`2001::/32`) or documentation (`2001:db8::/32`). IPv6 addresses that carry an IPv4 address are judged by
the IPv4 inside: IPv4-mapped (`::ffff:a.b.c.d`), IPv4-compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`) and 6to4
(`2002::/16`); the NAT64 local-use prefix `64:ff9b:1::/48` is always refused. It then pins the connection to the checked address. Plugins cannot set `host`, `content-length`, `connection`, `transfer-encoding`, `upgrade`,
`proxy-authorization`, `cookie`, `te`, `expect`, or any `sec-*` / `proxy-*` header.

A plugin that holds `git:read` must get the person's consent the first time it contacts each host during an app
launch. A refusal sticks until the plugin is turned off and on again.

## Security model

- Plugin code runs in an iframe with `sandbox="allow-scripts"` and a CSP of `default-src 'none'; script-src
  'unsafe-inline'`. `fetch`, `XMLHttpRequest`, storage, cookies and navigation do not work.
- The iframe lives in a hidden `plugin-host` webview that is listed in no Tauri capability, so it cannot invoke app
  commands. It talks to Rust only through the `po-plugin://` protocol with a per-launch token.
- The plugin is identified by the iframe a message comes from, not by anything it claims.
- The broker reads permissions from the installed record, rate-limits each plugin to 120 calls per minute, and logs
  every call (method, target, outcome; never bodies or secrets) to a local audit log.
- Registry installs download the manifest and entry from `raw.githubusercontent.com` at a pinned 40-character
  commit. The manifest must equal the approved one and the entry's SHA-256 must match. The hash is checked again on
  every load; a mismatch disables the plugin.
- An update keeps the plugin enabled only if it asks for no new permissions. Otherwise it waits for the person to
  approve the new permissions in the catalog. Automatic updates apply only updates that add no permissions.
- Plugins never see terminal output, absolute paths or the app's stored data. They see the composer draft only with
  `composer:read`, and repository-relative paths, commits and diffs only with `git:read` on a folder the person
  picked.
- Secrets are encrypted with AES-256-GCM using a key kept in the system keychain. Without a keychain the file stays
  in plain text, with `0600` permissions on macOS and Linux, and the settings show that status. Development builds
  skip the keychain unless `PROMPTOPS_PLUGIN_KEYCHAIN=1`.

## Plugin Studio workflow

1. **Scaffold.** In the Studio, pick a zone: terminal buttons, session header, spawn composer, Squad/Goal/Worker row,
   menu page or session sidebar. The app creates `~/promptops-plugins/<slug>/` from a
   bundled template, sets the id to `local.<slug>`, writes the agent instruction files, runs `git init`, and marks
   the folder as trusted for Claude Code. The Studio never overwrites a folder: each new draft gets a free folder (`<slug>`, `<slug>-2`, …), and a non-empty
   folder without a manifest is refused.
2. **Let an agent write it.** The Studio opens a terminal in the folder with the coding agent you choose (Claude Code,
   Codex, Gemini CLI, and others in the list). The agent reads `CLAUDE.md` / `AGENTS.md` / `PLUGIN_GUIDE.md`.
3. **Reload.** The Studio enables developer mode and links the folder with the same sandbox and broker as published
   plugins. Press **Reload** to relink and redraw the preview. The Studio also reloads on its own when the agent goes
   quiet with changed files or asks you to press Reload.
4. **Check.** The **Checks** tab reports manifest errors, `node --test` results (60-second limit), and calls the
   broker refused. Failures can be sent back to the agent.

Without the Studio, enable developer mode on the Plugins page and link any folder that contains a manifest. A
local link is refused if a registry version of the same id is installed.

## Sharing to the catalog

The catalog is a static index fetched without credentials from
`https://raw.githubusercontent.com/shellonback/promptops-plugin-templates/main/registry/official.json`. To share a
plugin:

1. Give it a permanent `id` with your own handle (not `local.`), and push the folder to a public GitHub repository.
2. Open a pull request to `https://github.com/shellonback/promptops-plugin-templates` that adds an entry to
   `registry/official.json`.

The app lists an entry only if it has `status: "published"`, `plugin_id`, `manifest`, `commit_sha` and
`bundle_sha256`, and installs it only if it also has `version` and `repo_url`. `category` and `name` must be present,
and `category` must match the manifest (the app shows the entry's `name`); the manifest `id` must equal `plugin_id`.
`source_dir` is optional (subfolder of the repository). The `manifest` in the entry must equal
(as parsed JSON) the `promptops-plugin.json` at that commit. Each new version updates the plugin's entry with a new `version`, `commit_sha` and `bundle_sha256`; the app offers
the update when `bundle_sha256` changes.

## Limits

| Limit | Value |
|---|---|
| Entry file and downloaded files | 2,000,000 bytes |
| Broker calls | 120 per minute per plugin |
| HTTP request body / response body | 1,000,000 / 2,000,000 bytes; 20 s timeout |
| Storage | 1,000,000 bytes per plugin |
| Settings | 100,000 bytes; secret names 100 bytes, values 8,000 bytes |
| Pages per plugin / session buttons per plugin | 3 / 2 |
| One message between the plugin and the app (an SDK call or a contract reply) | 4,000,000 bytes |
| Page view | 200 blocks; `sdk.pages.update` views at most 256,000 bytes |
| Contract call timeout | 600 s for pages, 30 s otherwise |
| Confirmation timeout | 180 s |
| AI generation | 30 per hour, one at a time, 300 s timeout |
| Benchmarks | 6 per hour, 12 models per run |
| Git diff | 200,000 bytes; status 500 files; log 100 entries |

In this edition the app calls only the `pages` and session-button contracts during normal use. The `tasks`, `code`,
`data`, `providers` and `context` contracts can be exercised only from the test panel on the Plugins page; no other
screen calls them yet. The session and task events (`session.*`, `turn.completed`,
`approval.requested`, `task.status_changed`) and `actions.register` are wired in the runtime but no screen triggers
them yet (`benchmark.progress` does work), and the `agent` section (skills, quick actions) is not run by the app.
