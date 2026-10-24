import type { IDisposable, Terminal } from '@xterm/xterm';

/**
 * OSC 52 → local clipboard.
 *
 * On a remote host (`cmd://` / `ssh://` sessions) the CLI cannot see the Mac
 * clipboard: Claude Code & co. copy by emitting `ESC ] 52 ; <sel> ; <base64> BEL`
 * and expect the terminal to write to the clipboard. Without this
 * handler xterm.js dropped the sequence → "nothing can be copied".
 *
 * Write only: the `?` query (reading the clipboard from the remote) is ignored.
 */
const MAX_OSC52_BYTES = 1024 * 1024;

export function attachOsc52Clipboard(
  terminal: Terminal,
  copy: (text: string) => Promise<void>,
): IDisposable {
  return terminal.parser.registerOscHandler(52, (data) => {
    const sep = data.indexOf(';');
    const payload = sep >= 0 ? data.slice(sep + 1) : data;
    if (!payload || payload === '?' || payload.length > MAX_OSC52_BYTES) return true;
    try {
      const bin = atob(payload.replace(/\s+/g, ''));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      if (text) void copy(text).catch(() => { /* clipboard unavailable */ });
    } catch { /* malformed base64: ignore */ }
    return true;
  });
}
