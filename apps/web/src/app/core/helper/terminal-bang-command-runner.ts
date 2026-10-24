import type { Terminal, IDisposable, IMarker, IDecoration } from '@xterm/xterm';

/**
 * Play button on Claude Code's "run this yourself" lines.
 *
 * When Claude needs the user to run a command it prints it as `  ! <command>`
 * (the `!` prefix = Claude Code bash mode). This helper scans the normal
 * buffer after each parsed write, anchors an xterm decoration (marker-based,
 * so it scrolls with the line) in the indent gutter left of the `!`, and on
 * click types the command into the TUI: `!` (enter bash mode), the command,
 * then Enter.
 *
 * Lines inside/below Claude's input box (between the `────` rules at the
 * bottom) are ignored, so the user's own `! …` draft never gets a button.
 */

// The command can also be the FIRST line of Claude's reply: then the row is
// `● ! <command>` (reply bullet, `⏺` on older CLIs) and the button covers the bullet.
const BANG_LINE_RE = /^(\s{1,8}|\s{0,4}[●⏺]\s{1,4})! (\S.*?)\s*$/;
const INPUT_RULE_RE = /^[\s╭╰]*[─━]{10,}/;
const SCAN_BACK_LINES = 300;
const BOTTOM_LOOKUP_LINES = 30;
const MAX_BUTTONS = 60;

interface BangEntry {
  marker: IMarker;
  decoration: IDecoration;
  command: string;
}

export interface BangCommandRunnerOptions {
  /** Re-evaluated on every scan (provider can change in place). */
  isEnabled: () => boolean;
  /** Raw write to the PTY of this terminal. */
  write: (data: string) => void;
  /** Accessible name / tooltip of the ▶ button (translated by the caller). */
  runLabel?: (command: string) => string;
}

/** Type `! <command>` + Enter into a Claude Code TUI. */
export async function typeBangCommand(write: (data: string) => void, command: string): Promise<void> {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Empty the input first: `!` switches to bash mode only as the first char
  // of an empty prompt, otherwise it is typed literally.
  write('\x05\x15'); // Ctrl+E (end of line) + Ctrl+U (delete to line start)
  await pause(80);
  // `!` alone first: Claude switches to bash mode only on a lone keystroke.
  write('!');
  await pause(250);
  write(command);
  // A long chunk is handled as a paste: an Enter arriving while Claude is
  // still ingesting it becomes a newline instead of submitting.
  await pause(300 + Math.min(700, command.length * 2));
  write('\r');
}

function lineText(terminal: Terminal, index: number): string {
  return terminal.buffer.active.getLine(index)?.translateToString(true) ?? '';
}

// Rows that open something new: never a continuation of the command.
const NEW_ITEM_RE = /^\s*(?:\d+[.)]|[-*•●⏺]|!)\s/;

/**
 * Command on the `!` row plus its continuation rows. Claude's TUI word-wraps
 * long commands with hard newlines (not xterm soft wraps), so a following row
 * is a continuation when its first word could not have fit on the row above.
 */
function bangAt(terminal: Terminal, index: number, limit: number): { indent: number; command: string } | null {
  const m = BANG_LINE_RE.exec(lineText(terminal, index));
  if (!m) return null;
  const buffer = terminal.buffer.active;
  const cols = terminal.cols;
  let command = m[2];
  let prev = lineText(terminal, index).replace(/\s+$/, '');
  for (let i = index + 1; i < limit; i++) {
    const row = buffer.getLine(i);
    if (!row) break;
    const text = lineText(terminal, i);
    if (row.isWrapped) {
      command += text.replace(/\s+$/, '');
      prev = text;
      continue;
    }
    const body = text.trim();
    if (!body || NEW_ITEM_RE.test(text)) break;
    if (text.length - text.trimStart().length > m[1].length + 2) break;
    const firstWord = body.split(/\s/, 1)[0];
    if (prev.length + 1 + firstWord.length <= cols) break;
    command += ' ' + body;
    prev = text.replace(/\s+$/, '');
  }
  return { indent: m[1].length, command };
}

export function attachBangCommandRunner(terminal: Terminal, opts: BangCommandRunnerOptions): IDisposable {
  let entries: BangEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const drop = (entry: BangEntry) => {
    entry.decoration.dispose();
    entry.marker.dispose();
  };
  const clear = () => {
    for (const e of entries) drop(e);
    entries = [];
  };

  const renderButton = (el: HTMLElement, entry: BangEntry) => {
    if (el.dataset['poBang']) return;
    el.dataset['poBang'] = '1';
    el.style.pointerEvents = 'auto';
    el.style.zIndex = '7';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '▶';
    const label = opts.runLabel ? opts.runLabel(entry.command) : `Run: ${entry.command}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    Object.assign(btn.style, {
      width: '100%',
      height: '100%',
      padding: '0',
      margin: '0',
      border: 'none',
      borderRadius: '3px',
      background: '#4F41FA',
      color: '#fff',
      fontSize: '0.7em',
      lineHeight: '1',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    } satisfies Partial<CSSStyleDeclaration>);
    // Keep xterm from starting a selection / stealing the click.
    btn.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Stale rows are dropped by scan(); don't re-validate here, a redraw in
      // progress made the click silently do nothing.
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '✓';
      btn.style.background = '#16a34a';
      void typeBangCommand(opts.write, entry.command).finally(() => {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = '▶';
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
    if (!opts.isEnabled() || buffer.type !== 'normal') {
      clear();
      return;
    }

    const cursorAbs = buffer.baseY + buffer.cursorY;
    let limit = cursorAbs + 1;
    for (let i = cursorAbs; i >= Math.max(0, cursorAbs - BOTTOM_LOOKUP_LINES); i--) {
      if (INPUT_RULE_RE.test(buffer.getLine(i)?.translateToString(true) ?? '')) limit = i;
    }

    // Drop buttons whose row was trimmed or redrawn with something else.
    entries = entries.filter((e) => {
      const b = e.marker.isDisposed ? null : bangAt(terminal, e.marker.line, limit);
      if (b && b.command === e.command) return true;
      drop(e);
      return false;
    });

    const taken = new Set(entries.map((e) => e.marker.line));
    for (let i = Math.max(0, limit - SCAN_BACK_LINES); i < limit; i++) {
      const row = buffer.getLine(i);
      if (!row || row.isWrapped || taken.has(i)) continue;
      const b = bangAt(terminal, i, limit);
      if (!b) continue;
      const indent = b.indent;
      const marker = terminal.registerMarker(i - cursorAbs);
      if (!marker) continue;
      const decoration = terminal.registerDecoration({
        marker,
        x: Math.max(0, indent - 2),
        width: Math.min(2, indent),
        layer: 'top',
      });
      if (!decoration) { marker.dispose(); continue; }
      const entry: BangEntry = { marker, decoration, command: b.command };
      decoration.onRender((el) => renderButton(el, entry));
      entries.push(entry);
    }

    while (entries.length > MAX_BUTTONS) drop(entries.shift()!);
  };

  const schedule = () => {
    if (timer === null && !disposed) timer = setTimeout(scan, 200);
  };
  const subs = [
    terminal.onWriteParsed(schedule),
    terminal.buffer.onBufferChange(schedule),
  ];
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
