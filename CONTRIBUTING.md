# Contributing to PromptOps

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

New to the code? [docs/architecture.md](docs/architecture.md) maps the
repository and shows how the web UI, the Rust shell and the agent CLIs talk
to each other.

Install the tools listed in step 1 of
["Open-source edition — build it yourself"](README.md#open-source-edition--build-it-yourself)
in the README, then:

```bash
cd apps/web && npm ci
cd ../desktop && npm ci
npm run dev
```

## Running the checks

`scripts/check.sh` runs the tests, lints and the web build that the CI runs
(`scripts/check.sh rust`, `cli` or `web` for one part). These are the
commands it runs:

```bash
# Rust: formatting and lints
cd apps/desktop/src-tauri && cargo fmt --check \
  && cargo clippy --lib --all-targets -- -D warnings
# Rust: unit tests
cd apps/desktop/src-tauri && cargo test --lib
# CLI and MCP server
cd apps/desktop && npm run test:cli && node --test test/*.test.cjs
# Web UI: types, unit tests, component specs, production build
cd apps/web && npx tsc --noEmit -p tsconfig.app.json \
  && node --test test/*.test.cjs \
  && npx ng test --watch=false --browsers=ChromeHeadless \
  && npx ng build --configuration=desktop
```

The CI also checks that every version number agrees and tests the npm
launcher; run these too if you touch a version or `apps/npm`:

```bash
node scripts/versions.mjs check
cd apps/npm && node --test test/*.test.mjs
```

## Secret scanning on your machine

Install [pre-commit](https://pre-commit.com/) and enable the hooks once:

```bash
pre-commit install
```

Every commit is then scanned with gitleaks before it is created.

## Adding a provider

Support for a new agent CLI is spread over a few well-known places: how it
is launched and resumed, its models and effort levels, its auto-approve
flags and hooks, accounts, its icon and the translations. The quickest way
to find them all is to follow an existing provider:

```bash
git grep -l kimi -- apps ':!*.json'
```

Mirror what that provider does in each file, add the logo to
`apps/web/src/assets/providers`, and add tests next to the existing ones for
launch and resume commands. Open an issue first if the CLI behaves very
differently from the others (no resume, no hooks): we will help you pick the
right approach.

## License

By contributing you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
