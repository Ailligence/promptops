# Section contracts (version 0)

A plugin registers **one** contract: the one of its own section. PromptOps calls the methods and draws what they return. Return plain JSON data. Anything else is dropped.

Every method receives `sdk` as its **last** argument. Every method may be `async`. Throw an `Error` with a short message when something fails: PromptOps shows the message to the person.

- [The `sdk` object](#the-sdk-object)
- [tasks](#tasks) · [code](#code) · [data](#data) · [providers](#providers) · [context](#context) · [notify](#notify) · [agent](#agent)
- [Actions](#actions) · [Manifest](#manifest)

## The `sdk` object

| Call | Permission | What it does |
|---|---|---|
| `sdk.http.fetch(url, { method, headers, body })` | `net:<host>` | HTTPS request. Returns `{ status, ok, headers, body }`, with `body` as text |
| `{{secret:key}}` inside a header, or inside the URL path or query | `secrets` | PromptOps puts the value in when the request leaves. Never in the host, never in the body |
| `{{basic:user:secret}}` inside a header | `secrets` | HTTP Basic authentication. PromptOps builds `base64(user:password)` for you: `user` is a settings key, `secret` is a secret. Write `Authorization: 'Basic {{basic:email:token}}'` |
| `sdk.config.get()` | none | The non-secret settings, plus `__secretsSet`: the list of secret keys that have a value |
| `sdk.storage.get(key)` · `set(key, value)` · `remove(key)` | `storage` | Small JSON storage, private to your plugin |
| `sdk.notify.toast(message)` | `notify` | A short text notification |
| `sdk.prompt.propose(text, title)` | `prompt:propose` | Shows the person a prompt to review. Nothing is sent without them |
| `sdk.git.status(repo)` · `log(repo, limit)` · `diff(repo, { staged })` | `git:read` | Read-only git data of the repository the person picked. `pages` only |
| `sdk.workspace.writeFile(repo, path, content)` | `workspace:write` | Writes a text file under `docs/`. The person sees it and confirms. `pages` only |
| `sdk.ai.generate({ prompt, model })` | `ai:generate` | Runs the prompt on the person's Claude, with no tools. The person sees it and confirms. `pages` only |
| `sdk.ai.benchmarkModels()` · `sdk.ai.benchmark(modelIds)` | `ai:benchmark` | Speed measurements. PromptOps owns the prompt and you get numbers only. The person confirms every run. `pages` only |
| `sdk.pages.update(pageId, view)` | none | Pushes a new version of your page while you work |
| `sdk.log(...values)` | none | Writes a line in the plugin activity log |

`fetch`, `XMLHttpRequest`, `localStorage`, cookies and navigation do not work inside a plugin. Redirects are not followed: you receive the `3xx` status and the `location` header.

## tasks

```js
promptops.tasks.registerSource({ validate, listContainers, listStatuses, listTasks, getTask, setStatus, listComments });
```

| Method | PromptOps calls it when | Return |
|---|---|---|
| `validate()` | The person saves the settings | `{ ok, account?, error? }` |
| `listContainers(parentId)` | The person picks where tasks come from. `parentId` is `null` at the top, then the `id` of the container they opened | `[{ id, name, kind, hasChildren }]` with `kind`: `workspace`, `project`, `folder` or `list` |
| `listStatuses(containerId)` | It builds the board columns | `[{ id, name, type, color? }]` with `type`: `todo`, `in_progress` or `done`. `color` is a hex like `#5b5bd6` |
| `listTasks({ containerId, statuses, updatedSince, cursor })` | It syncs. `cursor` is the `nextCursor` you returned before | `{ tasks: [Task], nextCursor }` with `nextCursor: null` on the last page |
| `getTask(id)` | The person opens a task | `Task` |
| `setStatus(id, statusId)` *optional* | The person moves a card. Needs `tasks:write` | `Task` |
| `listComments(id)` *optional* | The person opens a task | `[{ id, author, body, createdAt }]` |

```
Task = { id, title, description, status, url, assignees: [string], labels: [string], updatedAt,
         priority?, order?, assigneeEmails?: [string] }
```

- `status` is the `id` of one of your statuses. Keep `id` stable: it links the task across syncs.
- A source can be flat or a tree. Return `hasChildren: true` for a container the person can open. Tasks are asked only for a container with `hasChildren: false`.
- `priority` is `low`, `medium`, `high` or `critical`. `order` sorts cards inside a column, lowest first.
- `assigneeEmails` lets PromptOps match assignees to team members. Lowercase them and sort them: a stable order keeps the sync quiet.
- Comments may add `authorEmail`.

## code

```js
promptops.code.registerHost({ listPullRequests, listChecks });
```

| Method | Return |
|---|---|
| `listPullRequests({ repo, state })` with `repo` as `owner/name`, `state` as `open` or `closed` | `[{ number, title, author, state, draft, url, headRef, headSha, updatedAt }]` |
| `listChecks({ repo, ref })` | `[{ name, status, url }]` with `status`: `success`, `failure`, `pending` or `neutral` |

This section reads metadata from the hosting service. A plugin cannot read local files or code.

## data

```js
promptops.data.registerExplorer({ listResources, query });
```

| Method | Return |
|---|---|
| `listResources()` | `[{ id, name, description? }]` |
| `query({ resourceId, limit, filter })` | `{ columns: [{ key, label }], rows: [object], total? }` |

Return at most `limit` rows. Cell values are shown as text.

## providers

```js
promptops.providers.registerUsage({ getUsage });
```

| Method | Return |
|---|---|
| `getUsage()` | `{ provider, plan?, meters: [{ id, label, used, limit, unit, resetsAt? }] }` |

`limit: null` means the provider reports no limit: PromptOps shows the number without a bar.

## context

```js
promptops.context.registerProvider({ search, get });
```

| Method | Return |
|---|---|
| `search(query)` | `[{ id, title, excerpt, url, updatedAt? }]` |
| `get(id)` | `{ id, title, url, content }` with `content` as plain text or Markdown, 50 000 characters at most |

The text comes from outside PromptOps. When you propose it as a prompt, say where it comes from and that it is reference material.

## notify

```js
promptops.events.on('turn.completed', async (event, sdk) => { /* ... */ });
```

Session events need `sessions:read`. Task events need `tasks:read`. Events carry metadata only: never prompt text, answers, file paths or code.

| Event | Payload |
|---|---|
| `session.started` | `{ sessionId, sessionName, provider }` |
| `session.ended` | `{ sessionId, sessionName, provider, durationSec }` |
| `turn.completed` | `{ sessionId, sessionName, provider, durationSec, status }` with `status`: `success` or `error` |
| `approval.requested` | `{ sessionId, sessionName, tool }` |
| `task.status_changed` | `{ taskId, title, from, to }` |

## pages

Your plugin adds an entry to the PromptOps menu and owns the page behind it. It never draws anything: it returns a **description of the page**, as plain data, and PromptOps draws it with its own components. No HTML, no CSS, no script ever comes from a plugin.

```json
"category": "pages",
"contributes": { "pages": [{ "id": "release-notes", "title": "Release Notes", "icon": "ti-notes" }] }
```

One to three entries. `title` is the menu label, 40 characters at most. `icon` is a [Tabler](https://tabler.io/icons) name. In the menu the entry carries a small puzzle, so people know it comes from a plugin.

```js
promptops.pages.register({
  async open(pageId, context, sdk) { return view; },
  async event(pageId, event, sdk) { return view; },
});
```

| Method | When | Returns |
|---|---|---|
| `open(pageId, context, sdk)` | The person opens the menu entry | The page |
| `event(pageId, event, sdk)` | The person clicks a button or changes a `live` field | The page, after your work |

`event` is `{ type: 'action' | 'change', id, values }`. `values` holds the whole form, keyed by field id, so you never need one call per keystroke. You have ten minutes to answer: waiting for a confirmation and for the model is fine. While you work the page is locked and the button shows a spinner. Your state lives inside the sandbox for as long as PromptOps is open.

The page is `{ title, subtitle, blocks }`. Blocks:

| `type` | Properties | Notes |
|---|---|---|
| `heading` | `text` | |
| `text` | `text`, `muted` | Plain text, line breaks kept |
| `notice` | `tone`: `info` `success` `warning` `danger`, `text` | |
| `divider` | | |
| `field` | `id`, `kind`, `label`, `value`, `help`, `placeholder`, `half`, `live` | See the kinds below |
| `actions` | `items`: `{ id, label, style, icon, disabled }` | `style`: `primary` `ghost` `danger`. Eight at most |
| `output` | `text`, `label`, `mono`, `copy`, and `id` + `editable` | Editable outputs come back in `values[id]` |
| `list` | `items`: `{ title, subtitle, meta, icon }`, `empty` | |
| `table` | `columns`: strings, `rows`: arrays of strings | Eight columns at most |
| `stats` | `items`: `{ label, value, hint }` | Six at most |
| `progress` | `value` from 0 to 1, `label` | Use it with `sdk.pages.update` |
| `columns` | `columns`: two arrays of blocks | Top level only. Columns never nest |
| `floorplan` | `hub?` (center label, default `PromptOps`), `rooms`: `[{ title, subtitle?, color?, wide?, desks: [{ title, subtitle?, status, badge?, session?, agents: [{ name, provider, status }] }] }]`, `empty` | Top level only. `status`: `working`, `waiting`, `idle`, `standby`, `error`, `off`. A desk with `session` opens that session on click, only if it is one of the person's sessions. `color` is a hex like `#6366f1`. PromptOps draws it as a 3D virtual office (rooms around a hub, desks as blocks, agents as avatars) with a 2D plan as the alternative view |

Field kinds: `text`, `textarea` (`rows`), `select` and `choice` (`options`: `{ value, label, icon, hint }`), `toggle`, and `repo`.
`half: true` puts two short fields on one row. `live: true` sends a `change` event as soon as the value changes.

**The `repo` field.** PromptOps draws it and lists the folders the person works on. When they pick one you receive `{ handle, name, branch }`. The handle is what you pass to `sdk.git.*` and `sdk.workspace.writeFile`. You never see a path, and a handle is valid only for your plugin, until PromptOps closes.

### Sidebar entries

A page declared with `"place": "sidebar"` in `contributes.pages` is not in the menu: its entry sits at the top of the
session sidebar, above folders and workspaces, in a thin border with its icon, its title and the puzzle mark.

With the `sessions:read` permission, a sidebar page receives a snapshot of everything in the person's PromptOps:
`open(pageId, ctx)` gets `ctx.workspace`, `event(pageId, ev)` gets `ev.workspace`. Names and status only: no paths,
prompts or output. PromptOps reopens the page by itself when something in the snapshot changes.

```js
// ctx.workspace
{ folders: [{ id, name, color }],
  workspaces: [{ id, name, folderId }],
  sessions: [{ id, name, provider, status, standby, workspaceId, folderId, pending,
               agents: [{ id, name, provider, status, isMain }] }],
  takenAt }
```

**What PromptOps drops.** Unknown block types, fields with an unknown kind or a bad id, icons that are not a Tabler name, columns inside columns, and anything over the size limits. Every text is shown as text. The playground lists what was dropped and why.

**Asking the person.** `sdk.workspace.writeFile` and `sdk.ai.generate` open a confirmation with the full file or the full prompt. If the person says no, the call rejects with an error that starts with `user_denied`. No answer in three minutes rejects with `confirm_timeout`. Treat both as a normal outcome, not as a failure.

| Call | Returns |
|---|---|
| `sdk.git.status(repo)` | `{ branch, files: [{ status, path }], total, truncated }` |
| `sdk.git.log(repo, limit)` | `[{ shortHash, message, relativeDate, author }]`, 100 at most. No email addresses |
| `sdk.git.diff(repo, { staged })` | `{ diff, truncated }`, 200 000 bytes at most |
| `sdk.workspace.writeFile(repo, path, content)` | `{ path, repo, overwritten }`. `path` must be `docs/<name>.md`, `.markdown` or `.txt` |
| `sdk.ai.generate({ prompt, model })` | `{ text, truncated }`. One run at a time, thirty per hour |
| `sdk.ai.benchmarkModels()` | `{ data: [{ id, label, provider, providerLabel, available, baseline: { tier, expectedTps: { min, max } }, history: { runs, medianTps, lastRunAt } }] }` |
| `sdk.ai.benchmark(modelIds)` | `{ results: [{ id, label, providerLabel, ok, error, tokensPerSec, outputTokens, tokensEstimated, sampleMs, samples, classification, baseline, history }] }`. One to twelve ids from the list above. Six runs per hour |

**Measuring speed.** With `ai:benchmark` you never write a prompt and you never read an answer. PromptOps runs a short fixed task three times per model, in an empty folder, and gives you the middle run as numbers. `classification` is `below`, `within`, `above` or `unknown` against `baseline.expectedTps`. While it measures, PromptOps reports every finished run:

```js
promptops.events.on('benchmark.progress', async (p, sdk) => {
  // p = { index, total, modelId, label, sample, samples, results, done }
  await sdk.pages.update('my-page', view());
});
```

Because the prompt is not yours and the answer never reaches you, this works with every provider, not only with the ones that can run without tools.

## agent

No code. Everything is in the manifest:

```json
"contributes": {
  "skills": [{ "id": "review-checklist", "title": "Review checklist", "description": "…", "file": "skills/review-checklist.md" }],
  "quickActions": [{ "id": "review-diff", "title": "Review my diff", "prompt": "…" }]
}
```

Skill and quick action text ends up in an agent prompt, so PromptOps shows it in full before the person installs the plugin.

## Session buttons

Any section can add up to two buttons to the toolbar of each agent terminal (next to review, eco, browser mode and
auto-approve), with the `session:buttons` permission. PromptOps draws them, with a small puzzle mark; title and icon
come from the approved manifest.

```json
"permissions": ["session:buttons", "composer:read"],
"contributes": { "sessionButtons": [
  { "id": "second-opinion", "title": "Second opinion", "icon": "ti-eye-check" }
] }
```

`place` says where the button goes (default `terminal`):

| `place` | Where |
| --- | --- |
| `terminal` | the bar under every agent terminal (main agent and sub-agents alike), next to review, eco and auto-approve |
| `header` | the session header, next to SSH, Database and Docker (icon + title) |
| `composer` | the tools of the spawn composer, next to attach and voice |
| `runtime` | the row of AI Squad, Goal and Worker under the spawn composer (icon + title) |

The buttons appear under every agent terminal, main agent and sub-agents alike. The agent of the terminal that was clicked
is the default recipient, and `ctx.paneAgentId` tells you which one it is (`main` or the sub-agent id).

```js
promptops.session.registerButtons({
  async action(buttonId, ctx) {
    // ctx: { sessionId, sessionName, provider, status, workspaceName,
    //        agents: [{ id, name, slug, provider, status, isMain }],
    //        composerText }   // only with `composer:read`
    return { prompt: 'Review the last change…', target: ctx.agents.find((a) => !a.isMain)?.id };
  },
});
```

Return ONE proposal. PromptOps carries it out, the plugin never writes to an agent:

| Answer | What happens |
| --- | --- |
| `{ insert: text }` | `terminal` and `header`: pasted into the agent input, without Enter. `composer` and `runtime`: written into the spawn composer. The person sends it. |
| `{ prompt: text, target }` | Sent to the agent `target` (id or name; default: the agent of that terminal). Before sending, PromptOps follows the confirmation the person chose for this button: ask every time (default), once per session, or don't ask. |
| `{ spawn: { prompt, provider, mode, name } }` | The spawn composer is prefilled for a new sub-agent. The person starts it. |
| `{ panel: view }` | A read-only window drawn with the page blocks (`heading`, `text`, `notice`, `divider`, `output`, `list`, `stats`, `table`). |
| `{ toast: text }` | A notification. |

Rules the plugin cannot change: an agent waiting for an answer to a permission or a question never receives anything;
the confirmation setting lives in PromptOps, and goes back to "ask every time" when the plugin updates or asks for new
permissions; the terminal output of a session is never given to plugins.

## Actions

Any section can add menu entries.

```json
"contributes": { "actions": [{ "id": "send-test", "title": "Send a test message", "contexts": ["workspace"] }] }
```

```js
promptops.actions.register('send-test', async (context, sdk) => { /* ... */ });
```

`contexts` says where the entry appears: `workspace`, `task`, `document`. The `context` argument carries the item the person clicked, for example `{ task }`.

## Manifest

`promptops-plugin.json`, in the root of your plugin folder.

| Field | Rule |
|---|---|
| `schemaVersion` | `1` |
| `id` | `your-handle.plugin-slug`. Lowercase letters, digits, hyphens, one dot. Permanent |
| `name` | 2 to 80 characters |
| `version` | Semantic: `0.1.0`. Every submission needs a higher one |
| `category` | One of `tasks`, `code`, `data`, `providers`, `context`, `notify`, `agent`, `pages` |
| `entry` | Relative path to **one** `.js` file, 2 MB at most. It is the file that runs, and the file the reviewer reads. The templates use `src/plugin.js`: plain JavaScript, no build step. No build ever runs on install |
| `permissions` | Array. `net:<host>` per host, plus any of `secrets`, `storage`, `notify`, `sessions:read`, `tasks:read`, `tasks:write` (required by `setStatus`), `prompt:propose`. For `pages` also `git:read`, `workspace:write`, `ai:generate`, `ai:benchmark` |
| `config.fields` | `[{ key, type, label, required?, default?, options? }]` with `type`: `text`, `secret`, `number`, `boolean`, `select`, `multiselect`, `url`. PromptOps builds the form |
| `description` | Shown in the catalog |
| `repository` | Optional. Your public GitHub repository, as `https://github.com/owner/name`. PromptOps shows the owner and its avatar next to the plugin |
| `providers` | Optional. The AI providers you have tried your plugin with, best first: `claude-code-cli`, `codex`, `gemini-cli`, `antigravity`, `copilot`, `cursor`, `grok`, `hermes`, `muse`, `zai`, `kimi`, `opencode`. The catalog shows the first three as small icons, then `+N` |
| `contributes.pages` | `pages` only. One to three entries: `{ id, title, icon, place? }`. `place`: `menu` (default) or `sidebar` (top of the session sidebar) |

`providers` is your statement: "it works with these". List only what you tested. Leave it out if your plugin does not depend on the provider, like a task source or a notifier. A plugin that uses `ai:generate` runs on Claude, so list `claude-code-cli`.

**Your code must be readable.** Write `src/plugin.js` by hand, as the templates do, and what people read is what runs. If you use a bundler, point `entry` at its output, keep it unminified and commit your sources in `src/` too. A repository that shows only a `dist/` folder looks like the code is missing, and a minified file cannot be reviewed: the validator and the registry scan both flag it.

Hosts must be public domain names. No IP addresses, wildcards, `localhost` or internal domains.
