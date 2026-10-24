import type { ILinkHandler } from '@xterm/xterm';

/**
 * Click handler for xterm.js WebLinksAddon.
 *
 * The addon's default handler opens links via `window.open()` (with no URL)
 * followed by `newWindow.location.href = uri`. An empty-URL `window.open()`
 * is refused by the desktop app, so the navigation never happens. Passing the
 * URI directly to `window.open` lets the desktop bridge route it to the system
 * browser (`shell_open_external`).
 */
export function openTerminalLink(_event: MouseEvent, uri: string): void {
  // OSC 8 lets any program in the terminal choose the target: only web and
  // mail links leave the app, never javascript:, file: or app-relative URLs.
  if (!isOpenableTerminalLink(uri)) return;
  window.open(uri, '_blank', 'noopener,noreferrer');
}

/** True for absolute http(s) and mailto links. */
export function isOpenableTerminalLink(uri: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(uri.trim());
}

/**
 * `linkHandler` for OSC 8 links (e.g. Claude Code's `/login` URL, which
 * carries the WHOLE URL even when it is wrapped over several lines on screen). Without it,
 * xterm falls back to `confirm()` + an empty `window.open()`: in the webview that does
 * nothing. `onHover` tracks the link under the mouse ("Copy link" menu).
 */
export function createTerminalLinkHandler(onHover: (uri: string | null) => void): ILinkHandler {
  return {
    activate: (event, uri) => openTerminalLink(event, uri),
    hover: (_event, uri) => onHover(uri),
    leave: () => onHover(null),
  };
}

/**
 * Selection of a URL split by the TUI over several lines (real line breaks): copied
 * as is it would be a broken link → lines joined. Other text is left unchanged.
 */
export function joinWrappedUrl(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !/^https?:\/\//.test(lines[0])) return text;
  return lines.every((l) => /^\S+$/.test(l)) ? lines.join('') : text;
}
