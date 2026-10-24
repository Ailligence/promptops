export type TerminalClipboardAction = 'copy' | 'paste' | null;

/**
 * Decides whether a keydown in the xterm terminal should copy/paste.
 * Returns null to let the key through to xterm/PTY (e.g. Ctrl+C without a selection → SIGINT).
 *
 * Always (all platforms): Ctrl/Cmd+Shift+C/V, Ctrl+Insert, Shift+Insert.
 * Windows/Linux only, additionally: plain Ctrl+C ONLY with a selection, plain Ctrl+V.
 * macOS: plain Ctrl is not touched (SIGINT/raw); Cmd stays handled by the app menu.
 *
 * @param platform value of `process.platform` exposed by the desktop bridge ('win32' | 'linux' | 'darwin' | ...)
 * @param hasSelection lazy: evaluated only for the Ctrl+C branch, so it doesn't weigh on every key
 * @param metaClipboard true ONLY under Tauri v2: also handles plain Cmd+C/Cmd+V.
 *   In Chromium the native Cmd goes through xterm (copy handler on
 *   `getSelection()`, paste with bracketed-paste) and is already correct. In WKWebView
 *   the native Cmd copies/pastes the DOM selection line by line, inserting a
 *   newline at every visual wrap and splitting a multi-line paste into many sends:
 *   here we intercept and redirect to the same copySelection()/pasteClipboard()
 *   used by the context menu. Elsewhere it stays unchanged (flag false).
 */
export function decideTerminalClipboardAction(
  ev: KeyboardEvent,
  platform: string | undefined,
  hasSelection: () => boolean,
  metaClipboard = false,
): TerminalClipboardAction {
  const mod = ev.ctrlKey || ev.metaKey;
  const isC = ev.code === 'KeyC' || ev.key === 'c' || ev.key === 'C';
  const isV = ev.code === 'KeyV' || ev.key === 'v' || ev.key === 'V';

  // Explicit shortcuts, unchanged on all platforms.
  if (mod && ev.shiftKey && isC) return 'copy';
  if (mod && ev.shiftKey && isV) return 'paste';
  if (mod && ev.key === 'Insert') return 'copy';
  if (ev.shiftKey && ev.key === 'Insert') return 'paste';

  // Windows/Linux terminal convention: Ctrl+C copies if there is a selection, Ctrl+V pastes.
  // !metaKey excludes the Win key; !altKey excludes AltGr (non-US layouts) and other combos.
  const ctrlClipboard = platform === 'win32' || platform === 'linux';
  if (ctrlClipboard && ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey) {
    if (isC) return hasSelection() ? 'copy' : null; // no selection → SIGINT
    if (isV) return 'paste';
  }

  // Plain Cmd+C / Cmd+V (Tauri only): without a selection Cmd+C does nothing — on
  // macOS it is not SIGINT, so letting it through is harmless.
  if (metaClipboard && ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
    if (isC) return hasSelection() ? 'copy' : null;
    if (isV) return 'paste';
  }
  return null;
}
