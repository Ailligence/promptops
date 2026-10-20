# Contributing to PromptOps Manager

Thanks for helping! This guide covers how to report issues, propose changes and get a pull request merged.

## Ground rules

- Be kind: this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security issues go through [SECURITY.md](SECURITY.md), never through public issues.
- Never commit secrets, tokens, private keys or `.env` files. CI scans every commit and blocks the merge if it finds one.

## Reporting a bug

Open an issue with the **Bug report** template. Include your OS, the app version (Settings → About), the agent CLI and its version, and the steps to reproduce.

## Proposing a feature

Open an issue with the **Feature request** template before writing code for anything larger than a small fix, so we can agree on the approach.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused: one topic per pull request.
3. Add or update tests where it makes sense.
4. Make sure the build and the checks pass locally.
5. Sign off every commit (see below) and open the pull request against `main`.

Good first contributions are labeled [`good first issue`](https://github.com/shellonback/promptops/labels/good%20first%20issue).

## Developer Certificate of Origin (DCO)

We use the [DCO](https://developercertificate.org/) instead of a CLA. By signing off you state that you wrote the change, or have the right to submit it, under the project's license.

Add the sign-off with `-s`:

```bash
git commit -s -m "fix(terminal): keep scrollback after resize"
```

This appends `Signed-off-by: Your Name <you@example.com>` to the commit message. Pull requests with unsigned commits cannot be merged.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, with an optional scope, e.g. `feat(providers): add resume for OpenCode`.

## Development setup

Prerequisites: Node.js >= 20, Rust (rustup) and, on Linux, the webkit2gtk dependencies.

## Secret scanning on your machine

Install [pre-commit](https://pre-commit.com/) and enable the hooks once:

```bash
pre-commit install
```

Every commit is then scanned with gitleaks before it is created.

## Adding a provider

Support for a new agent CLI touches the provider registry, the launch and resume commands, models and effort levels, auto-approve flags, hooks, the icon and the translations. Open an issue first: we will point you to the exact files.

## License

By contributing you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
