# Governance

PromptOps is maintained by [Shellonback S.r.l.](https://shellonback.com).
This page explains who decides what, and how the open-source edition relates
to PromptOps Desktop, the hosted edition we sell.

## Maintainers

The maintainers review pull requests, triage issues and cut releases. They
are listed in [CODEOWNERS](.github/CODEOWNERS). Contributors who send
sustained, good-quality work can be invited to become maintainers.

## How decisions are made

- Small changes: a maintainer reviews and merges.
- Larger changes (new areas of the app, new dependencies, changes to what
  leaves the user's machine): open an issue first and discuss the approach.
- Anything that touches privacy or security follows [PRIVACY.md](PRIVACY.md)
  and [SECURITY.md](SECURITY.md); a change that would add a network
  connection must add it to PRIVACY.md in the same pull request.

## Open source and the hosted edition

The two editions share the same client. The line between them is simple:

- **In the open-source edition**: everything that runs on your computer. Sessions,
  agents, terminals, the prompt library, plugins, the MCP server, voice
  input, the Session Vault. It works with no account and no server.
- **In PromptOps Desktop**: what needs a server because it involves other
  people or other devices: Teams, sync across devices, the mobile app,
  organizations and SSO, the community ranking and shared prompts. In this
  edition these places show a lock and run no code.

Code published here is licensed under Apache-2.0, and that license stays with
every version already published. Contributions are accepted under the same
license through the [DCO](CONTRIBUTING.md#developer-certificate-of-origin-dco),
with no copyright assignment.
