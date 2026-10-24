/**
 * Typed reference for the native standalone-terminal commands (terminal.rs).
 *
 * The app does not import this module: the webview talks to these commands
 * through `window.promptops` (src-tauri/src/promptops_bridge.js), which adds a
 * per-terminal stream decoder and byte offsets on top of the same calls. Keep
 * the two in sync when a command changes.
 *
 *   npm i @tauri-apps/api
 */
import { invoke, Channel } from '@tauri-apps/api/core';

export interface OpenOpts {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  /** Session whose shell (Windows: PowerShell, cmd, Git Bash, WSL) to use. */
  sessionId?: string;
}

/**
 * terminal:open — returns the id and routes the raw PTY output to onData.
 *
 * Each message is an ArrayBuffer of up to 128 KB, cut by size: a UTF-8
 * character can span two messages, so decode with one
 * `new TextDecoder()` per terminal and `decode(bytes, { stream: true })`.
 * Messages that arrive before the id resolves belong to this terminal too.
 */
export async function terminalOpen(
  opts: OpenOpts,
  onData: (bytes: ArrayBuffer) => void,
): Promise<string> {
  const onOutput = new Channel<ArrayBuffer>();
  onOutput.onmessage = onData;
  return invoke<string>('terminal_open', { ...opts, onOutput });
}

export const terminalInput = (id: string, data: string) =>
  invoke<void>('terminal_input', { id, data });

export const terminalResize = (id: string, cols: number, rows: number) =>
  invoke<void>('terminal_resize', { id, cols, rows });

/** Ends the shell and its foreground job (SIGHUP, then SIGKILL after 2 s). */
export const terminalClose = (id: string) =>
  invoke<void>('terminal_close', { id });

export const terminalList = () => invoke<string[]>('terminal_list');

/**
 * terminal:buffer — the last 2 MB of output as text, plus the absolute byte
 * offset it ends at. The offset always falls between two onData messages:
 * drop the messages whose cumulative end is <= endOffset, write the rest whole.
 */
export const terminalBuffer = (id: string) =>
  invoke<{ data: string; endOffset: number }>('terminal_buffer', { id });
