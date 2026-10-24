# PromptOps — Desktop (Tauri 2 + Rust)

Native desktop app. Goals: fast terminals, lightweight binaries, few
cross-platform issues.

## Why Tauri
- Reuses the Angular frontend (`../web`) **as is**.
- No bundled Chromium → small binaries, low RAM.
- Native **Rust** backend: PTY with `portable-pty` (by the author of WezTerm), binary
  I/O over Tauri **channels**.

## Architecture
| Piece | Where |
|---|---|
| Entry point | `src-tauri/src/main.rs` |
| IPC handlers | `#[tauri::command]` in `src-tauri/src/commands/*` |
| Renderer API | `invoke()` + `tauri.conf.json` capabilities, `window.promptops` bridge |
| Terminals | `portable-pty` + `commands/terminal.rs` |
| Push events | `app_handle.emit` / `Channel<T>` |

## Develop and build

See ["Open-source edition — build it yourself"](../../README.md#open-source-edition--build-it-yourself)
in the main README for the tools to install on each platform. From this folder:

```bash
npm ci
npm run dev      # app with hot reload (starts the web UI on port 4200)
npm run build    # installer for your platform, in src-tauri/target/release/bundle
npm run check    # cargo check + Rust unit tests
npm run test:cli # tests of the `promptops` CLI and MCP server
```
