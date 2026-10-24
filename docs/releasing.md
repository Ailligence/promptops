# Releasing

This repository holds the source of the open-source edition. It ships no
binaries of its own: anyone can build it, as the README describes. The
releases you see on this repository are PromptOps Desktop, the ready-to-run
edition with Teams, sync and the mobile app.

## The open-source edition

The desktop shell and the web interface share one version:

```bash
node scripts/versions.mjs set 0.2.0   # writes it everywhere
node scripts/versions.mjs check       # runs in CI; fails when any file disagrees
```

It covers `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, both `package.json`
files and their lock files. Record the changes in [CHANGELOG.md](../CHANGELOG.md).

## The npm launcher

[`apps/npm`](../apps/npm) is `@shellonback/promptops`: `npx @shellonback/promptops`
installs and opens PromptOps Desktop. Its version is the PromptOps Desktop
version, and it refuses any installer that is not signed with the PromptOps
release key.

When a stable PromptOps Desktop release (`v<version>`) is published here, the
[npm](../.github/workflows/npm.yml) workflow sets the package to that version
and publishes it on npmjs.com, with [trusted publishing](https://docs.npmjs.com/trusted-publishers)
and no stored token, and on GitHub Packages, so it shows on the repository page.

Without GitHub Actions, the same can be done from a maintainer's machine,
with npm's two-factor confirmation in the browser:

```bash
apps/npm/publish.sh 2.1.8            # one or more published releases
```

It runs the launcher tests, checks that each release is public with signed
installers, skips versions already on npm and never moves `latest` back to an
older version.
