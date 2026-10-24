import type { Terminal, IDisposable, IMarker, IDecoration } from '@xterm/xterm';

/**
 * Copy button on long links printed by the CLI (e.g. Claude Code `/login`
 * "Use the url below to sign in").
 *
 * The TUI hard-wraps long URLs into several rows (real newlines, not xterm
 * soft-wraps), so a mouse selection copies a broken link. This helper
 * rebuilds the full URL from the consecutive rows and anchors an xterm
 * decoration (marker-based, scrolls with the line) that copies it in one
 * click. Same scan/anchor mechanics as terminal-bang-command-runner.ts.
 */

// Optional box border (fullscreen TUI dialogs) around the URL text.
const URL_START_RE = /^(\s*(?:[│┃|]\s*)?)(https?:\/\/[^\s│┃]+)\s*(?:[│┃|]\s*)?$/;
// Continuation rows of a hard-wrapped URL: URL characters only, no spaces.
const URL_CONT_RE = /^(\s*(?:[│┃]\s*)?)([A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)\s*(?:[│┃]\s*)?$/;
const LOGIN_HINT_RE = /oauth|authorize|login|signin|sign-in|auth\?/i;
const MIN_PLAIN_URL_LEN = 100;
const MAX_CONT_ROWS = 20;
const SCAN_BACK_LINES = 300;
const MAX_BUTTONS = 20;
const BTN_WIDTH = 6;

interface LinkEntry {
  marker: IMarker;
  decoration: IDecoration;
  url: string;
  /** Rows between the anchor (button) row and the URL's first row. */
  urlOffset: number;
}

const urlRowOf = (e: LinkEntry) => e.marker.line + e.urlOffset;

export interface LinkCopierOptions {
  /** Re-evaluated on every scan (provider can change in place). */
  isEnabled: () => boolean;
  /** Clipboard write (navigator.clipboard / native bridge). */
  copy: (text: string) => Promise<void>;
  /** Button texts, translated by the caller (English when omitted). */
  labels?: { copy: string; copied: string; copyLink: string };
}

function rowText(terminal: Terminal, index: number): string {
  const buffer = terminal.buffer.active;
  const line = buffer.getLine(index);
  if (!line) return '';
  let text = line.translateToString(true);
  for (let i = index + 1; i < buffer.length; i++) {
    const next = buffer.getLine(i);
    if (!next?.isWrapped) break;
    text += next.translateToString(true);
  }
  return text;
}

/** Rows that start a soft-wrapped run, from `index` on. */
function nextLogicalRow(terminal: Terminal, index: number): number {
  const buffer = terminal.buffer.active;
  let i = index + 1;
  while (i < buffer.length && buffer.getLine(i)?.isWrapped) i++;
  return i;
}

/** Full URL starting at row `index` (hard-wrapped continuations joined), or null. */
export function readUrlAt(terminal: Terminal, index: number): { url: string; indent: number; rows: number } | null {
  const m = URL_START_RE.exec(rowText(terminal, index));
  if (!m) return null;
  let url = m[2];
  let rows = 1;
  // Wrap width = where the first URL segment ends (terminal edge, or the
  // inner edge of a padded/bordered dialog in the fullscreen TUI).
  const wrapEnd = m[1].length + m[2].length;
  let prevEnd = wrapEnd;
  let i = nextLogicalRow(terminal, index);
  // A continuation only follows a row that ran to the wrap edge, and starts
  // at the same column as the first segment.
  while (rows <= MAX_CONT_ROWS && i < terminal.buffer.active.length && prevEnd >= wrapEnd - 1) {
    const c = URL_CONT_RE.exec(rowText(terminal, i));
    if (!c || c[1].length !== m[1].length || /^https?:\/\//.test(c[2])) break;
    url += c[2];
    rows++;
    prevEnd = c[1].length + c[2].length;
    i = nextLogicalRow(terminal, i);
  }
  const interesting = rows > 1 || LOGIN_HINT_RE.test(url) || url.length >= MIN_PLAIN_URL_LEN;
  return interesting ? { url, indent: m[1].length, rows } : null;
}

export function attachLinkCopier(terminal: Terminal, opts: LinkCopierOptions): IDisposable {
  let entries: LinkEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const drop = (entry: LinkEntry) => {
    entry.decoration.dispose();
    entry.marker.dispose();
  };
  const clear = () => {
    for (const e of entries) drop(e);
    entries = [];
  };

  const renderButton = (el: HTMLElement, entry: LinkEntry) => {
    if (el.dataset['poLinkCopy']) return;
    el.dataset['poLinkCopy'] = '1';
    el.style.pointerEvents = 'auto';
    el.style.zIndex = '7';
    const btn = document.createElement('button');
    btn.type = 'button';
    const labels = opts.labels ?? { copy: 'Copy', copied: 'Copied', copyLink: 'Copy link' };
    btn.textContent = `⧉ ${labels.copy}`;
    btn.title = labels.copyLink;
    btn.setAttribute('aria-label', labels.copyLink);
    Object.assign(btn.style, {
      width: '100%',
      height: '100%',
      padding: '0 2px',
      margin: '0',
      border: 'none',
      borderRadius: '3px',
      background: '#4F41FA',
      color: '#fff',
      fontSize: '0.75em',
      lineHeight: '1',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    } satisfies Partial<CSSStyleDeclaration>);
    btn.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.disabled) return;
      // Re-read: the TUI may have redrawn the rows since the scan.
      const url = readUrlAt(terminal, urlRowOf(entry))?.url ?? entry.url;
      btn.disabled = true;
      void opts.copy(url)
        .then(() => {
          btn.textContent = `✓ ${labels.copied}`;
          btn.style.background = '#16a34a';
        })
        .catch(() => {
          btn.textContent = '✗';
          btn.style.background = '#dc2626';
        })
        .finally(() => {
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = `⧉ ${labels.copy}`;
            btn.style.background = '#4F41FA';
          }, 1500);
          terminal.focus();
        });
    });
    el.appendChild(btn);
  };

  const scan = () => {
    timer = null;
    if (disposed) return;
    const buffer = terminal.buffer.active;
    // Normal AND alternate buffer: Claude Code with `"tui": "fullscreen"`
    // draws `/login` on the alternate screen.
    if (!opts.isEnabled()) {
      clear();
      return;
    }

    entries = entries.filter((e) => {
      const r = e.marker.isDisposed ? null : readUrlAt(terminal, urlRowOf(e));
      if (r && r.url === e.url) return true;
      drop(e);
      return false;
    });

    const cursorAbs = buffer.baseY + buffer.cursorY;
    // Alternate screen: no scrollback, the cursor can sit anywhere → whole screen.
    const lastRow = buffer.type === 'alternate' ? buffer.length - 1 : cursorAbs;
    const taken = new Set(entries.map(urlRowOf));
    const cols = terminal.cols;
    for (let i = Math.max(0, lastRow - SCAN_BACK_LINES); i <= lastRow; i++) {
      const row = buffer.getLine(i);
      if (!row || row.isWrapped || taken.has(i)) continue;
      const found = readUrlAt(terminal, i);
      if (!found) continue;
      // Anchor: room on the row above (e.g. "…sign in:", not a border) →
      // button after its text; else the indent gutter; else the right edge.
      const aboveRaw = i > 0 ? rowText(terminal, i - 1).replace(/\s+$/, '') : null;
      const above = aboveRaw !== null && !/[─━╭╮┌┐]{3,}/.test(aboveRaw) ? aboveRaw : null;
      let anchorRow = i;
      let x: number;
      if (above !== null && above.length + 1 + BTN_WIDTH <= cols) {
        anchorRow = i - 1;
        x = above.length + 1;
      } else if (found.indent >= BTN_WIDTH) {
        x = found.indent - BTN_WIDTH;
      } else {
        x = cols - BTN_WIDTH;
      }
      const marker = terminal.registerMarker(anchorRow - cursorAbs);
      if (!marker) continue;
      const decoration = terminal.registerDecoration({ marker, x, width: BTN_WIDTH, layer: 'top' });
      if (!decoration) { marker.dispose(); continue; }
      const entry: LinkEntry = { marker, decoration, url: found.url, urlOffset: i - anchorRow };
      decoration.onRender((el) => renderButton(el, entry));
      entries.push(entry);
      taken.add(i);
    }

    while (entries.length > MAX_BUTTONS) drop(entries.shift()!);
  };

  const schedule = () => {
    if (timer === null && !disposed) timer = setTimeout(scan, 250);
  };
  const subs = [terminal.onWriteParsed(schedule), terminal.buffer.onBufferChange(schedule), terminal.onResize(schedule)];
  schedule();

  return {
    dispose: () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      for (const s of subs) s.dispose();
      clear();
    },
  };
}
