# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- Preferred: use GitHub's [private vulnerability reporting](https://github.com/shellonback/promptops/security/advisories/new).
- Or email **info@shellonback.com** with the subject `SECURITY: <short title>`.

Include the affected version, your OS, steps to reproduce and the impact you expect. A proof of concept helps.

## What to expect

- We acknowledge the report within 3 business days.
- We send a first assessment within 10 business days.
- We agree on a disclosure date with you and credit you in the release notes, unless you prefer to stay anonymous.

## Supported versions

| Version | Security fixes |
|---|---|
| Latest release | Yes |
| Older releases | No, please update first |

## Threat model

PromptOps runs coding agents in terminals on your computer, with your user
account's rights. It protects your data at rest (the encrypted local store,
see [docs/session-vault.md](docs/session-vault.md)) and opens ports only on
the loopback interface, with two exceptions: on Windows with WSL, the local
hook server also listens on the WSL virtual network adapter so agents running
inside WSL can reach it (the same token is required), and a port forward that
you mark as public in the Ports panel listens on every interface. It does not
try to protect you from the agents you run or from other software running as
your user: those already have the same access to your files and keychain that
you do.

### Auto-approve and background agents

Agents ask for your approval in their own terminal unless you turn on
auto-approve for the session: the switch in the create-session form, or the
Quick or AI mode of the Auto Approve bar (the preview mode, which waits for
your click, does not count). The same setting decides what agents may do
without you:

- **Background workers** (agents that run without a terminal) skip the
  provider's permission checks only while the session is in auto-approve.
  Otherwise a worker that only reads (reviews, analysis, zero-risk modes) runs
  read-only, and a worker that writes runs in the provider's accept-edits mode
  limited to the workspace; anything that would need your approval is refused
  instead of asked, because nobody can answer a background prompt. Per
  provider: Claude Code `--permission-mode plan | acceptEdits` (auto-approve:
  `bypassPermissions`); Codex `-s read-only | workspace-write` (auto-approve:
  `--dangerously-bypass-approvals-and-sandbox`); Gemini CLI
  `--approval-mode plan | auto_edit` (auto-approve: `yolo`). Cursor's headless
  mode (`--force`) approves every change and command, so a Cursor worker runs
  only in auto-approve and is refused with a message otherwise. The setting is
  read again before every turn.
- **`promptops ctl` and the MCP server** can open raw shells, pick a mode that
  auto-accepts edits, leave the workspace, send keys or prompt a busy agent
  only while the session is in auto-approve.

### Accepted risks

These are known and deliberate. Reports that only restate them are not
vulnerabilities, but we welcome ideas that remove them without breaking how
agents work.

**The control-plane token is shared by every PromptOps terminal.** The app
creates one random token per run and passes it to every terminal it opens
(`PROMPTOPS_CTL_TOKEN`). `promptops ctl` and the `promptops` MCP server use it
to reach the loopback control plane, and the bundled `promptops` CLI uses it to
fetch the model API key you saved in the app. Any process in any PromptOps
terminal can read that token and call any endpoint, including ones meant for
another session. The MCP server started by Codex, which does not receive the
terminal environment, reads a second token from `ctl.json` in the app data
folder: it drives agents like the first one but cannot fetch the API key. We accept this because an agent in a terminal already runs
with your full shell rights: it can read your files, your SSH keys and your
shell history directly. Limiting `ctl` and MCP calls to the caller's session
prevents an agent from driving another session's agents by mistake; it is not
a security boundary between sessions. The token does protect the control
plane from other local users and from web pages (requests sent by a browser
are refused).

**SSH host keys are trusted on first use.** Like OpenSSH with
`StrictHostKeyChecking=accept-new`, PromptOps accepts the key of a server it
has never seen and records it (in the app's own `ssh/known_hosts`; keys in
your `~/.ssh/known_hosts` are honored too). A server whose recorded key has
changed is refused, with a message that says which line to remove if the
change is expected. The first connection to a new host is therefore exposed
to an attacker who already controls the network path at that moment, exactly
as with OpenSSH defaults. Verify the fingerprint out of band, or add the host
to `~/.ssh/known_hosts` yourself before connecting, when that matters.

## Dependencies

How dependencies are pinned and checked, and the published advisories that
still match one of them with the reason each does not affect the app, are in
[docs/supply-chain.md](docs/supply-chain.md).

## Scope

In scope: the desktop app and the code in this repository.

Out of scope: PromptOps Desktop, our hosted edition (report its issues to the same address), the websites, and the third-party agent CLIs launched by the app (report those to their vendors).
