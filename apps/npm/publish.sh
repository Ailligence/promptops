#!/usr/bin/env bash
# Publishes @shellonback/promptops from this machine, one version per
# published PromptOps Desktop release, without GitHub Actions.
#
#   apps/npm/publish.sh 2.1.7 [2.1.8 ...]
#
# For each version: the release v<version> must be public with signed
# installers, versions already on npm are skipped, and an older version never
# becomes "latest". npm asks for two-factor confirmation in the browser.
set -euo pipefail
cd "$(dirname "$0")"
PKG="@shellonback/promptops"
RELEASES="https://github.com/shellonback/promptops/releases/download"

[ $# -gt 0 ] || { echo "usage: apps/npm/publish.sh <version> [version ...]" >&2; exit 2; }
node --test test/*.test.mjs >/dev/null || { echo "launcher tests failed" >&2; exit 1; }

older_than() { node -e 'const [a,b]=process.argv.slice(1).map(v=>v.split(".").map(Number));for(let i=0;i<3;i++){if(a[i]!==b[i])process.exit(a[i]<b[i]?0:1)}process.exit(1)' "$1" "$2"; }

for version in "$@"; do
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "$version: not a stable version" >&2; exit 2; }
  if npm view "$PKG@$version" version >/dev/null 2>&1; then
    echo "$PKG@$version is already on npm, skipped."
    continue
  fi
  sig="$RELEASES/v$version/PromptOps-Desktop-v2-$version-x64-setup.exe.sig"
  curl -fsIL -o /dev/null "$sig" || { echo "v$version has no public signed installers ($sig)" >&2; exit 1; }

  tag=latest
  current="$(npm view "$PKG" dist-tags.latest 2>/dev/null || true)"
  if [ -n "$current" ] && older_than "$version" "$current"; then tag=previous; fi

  work="$(mktemp -d)"
  cp -R bin lib assets README.md package.json "$work/"
  (cd "$work" && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null && npm publish --access public --tag "$tag" --auth-type=web)
  rm -rf "$work"
  echo "$PKG@$version published (tag: $tag)."
done
