#!/usr/bin/env bash
# Runs the checks the CI runs, from any directory.
#   scripts/check.sh          everything
#   scripts/check.sh rust     only the Rust crate (fmt, clippy, tests)
#   scripts/check.sh web      only the web UI (types, tests, specs, build)
#   scripts/check.sh cli      only the CLI and MCP server
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
what="${1:-all}"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

rust() {
  cd "$root/apps/desktop/src-tauri"
  step "cargo fmt --check"
  cargo fmt --check
  step "cargo clippy"
  cargo clippy --lib --all-targets -- -D warnings
  step "cargo test --lib"
  cargo test --lib
}

cli() {
  cd "$root/apps/desktop"
  step "CLI and MCP server tests"
  npm run test:cli
  node --test test/*.test.cjs
}

web() {
  cd "$root/apps/web"
  step "TypeScript"
  npx tsc --noEmit -p tsconfig.app.json
  step "Unit tests"
  node --test test/*.test.cjs
  step "Component specs"
  npx ng test --watch=false --browsers=ChromeHeadless
  step "Production build"
  npx ng build --configuration=desktop
}

case "$what" in
  all) rust; cli; web ;;
  rust) rust ;;
  cli) cli ;;
  web) web ;;
  *) echo "usage: scripts/check.sh [all|rust|cli|web]" >&2; exit 2 ;;
esac

step "All checks passed"
