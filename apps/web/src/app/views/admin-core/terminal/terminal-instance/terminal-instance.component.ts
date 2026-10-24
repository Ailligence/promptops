import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  AfterViewInit,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { attachUnicode11, attachWebglRenderer } from '../../../../core/helper/xterm-renderer';
import { TerminalManagerService } from '../services/terminal-manager.service';
import { SessionService } from '../../sessions/services/session.service';
import { openTerminalLink } from '@core/helper/terminal-link-handler';
import { decideTerminalClipboardAction } from '@core/helper/terminal-clipboard';
import { decideTerminalMacLineKey } from '@core/helper/terminal-mac-line-keys';
import { liveTextAfterSnapshot } from '@core/helper/terminal-replay-stream';

@Component({
  selector: 'app-terminal-instance',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <div #terminalContainer class="terminal-container" (contextmenu)="onContextMenu($event)"></div>
    @if (contextMenu(); as menu) {
      <div class="ctx-menu" [style.left.px]="menu.x" [style.top.px]="menu.y">
        <button class="ctx-item" (click)="copySelection()">
          <i class="ti ti-copy"></i> {{ 'TERMINAL.Copy' | translate }}
        </button>
        <button class="ctx-item" (click)="pasteClipboard()">
          <i class="ti ti-clipboard"></i> {{ 'TERMINAL.Paste' | translate }}
        </button>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .terminal-container {
      width: 100%;
      height: 100%;
    }
    .ctx-menu {
      position: fixed;
      z-index: 10000;
      min-width: 140px;
      background: #1e1e2e;
      border: 1px solid #313244;
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 4px 12px rgba(0,0,0,.4);
    }
    .ctx-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 14px;
      background: none;
      border: none;
      color: #cdd6f4;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
    }
    .ctx-item:hover {
      background: #313244;
    }
  `,
})
export class TerminalInstanceComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input({ required: true }) terminalId!: string;
  @ViewChild('terminalContainer', { static: true }) containerRef!: ElementRef<HTMLDivElement>;

  private manager = inject(TerminalManagerService);
  private sessionService = inject(SessionService);
  private xterm!: Terminal;
  private fitAddon!: FitAddon;
  private resizeObserver!: ResizeObserver;
  private needsVisibilityRefresh = false;
  private lastDims: { cols: number; rows: number } | null = null;
  /** Set in ngOnDestroy so async replay/live callbacks never write to a
   * disposed xterm (which would throw inside the IPC output dispatcher). */
  private isDisposed = false;
  contextMenu = signal<{ x: number; y: number } | null>(null);

  @HostListener('document:click')
  closeContextMenu(): void { this.contextMenu.set(null); }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu.set({ x: event.clientX, y: event.clientY });
  }

  async copySelection(): Promise<void> {
    const text = this.xterm?.getSelection();
    if (text) await this.writeClipboard(text);
    this.contextMenu.set(null);
    this.xterm?.focus();
  }

  async pasteClipboard(): Promise<void> {
    const text = await this.readClipboard();
    if (text) this.manager.write(this.terminalId, text);
    this.contextMenu.set(null);
    this.xterm?.focus();
  }

  /** Write clipboard with IPC fallback (Windows app:// may block navigator.clipboard). */
  private async writeClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      await this.sessionService.clipboardWrite(text);
    }
  }

  private async readClipboard(): Promise<string> {
    // Tauri: native IPC first (see session-terminal.component.ts).
    if (!this.sessionService.isTauri) {
      try {
        const t = await navigator.clipboard.readText();
        if (t) return t;
      } catch { /* fall through to IPC */ }
    }
    try {
      const res = await this.sessionService.clipboardRead();
      return res?.text ?? '';
    } catch { return ''; }
  }

  ngOnInit(): void {
    this.xterm = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#c9d1d9',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      scrollback: 5000,
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.xterm.loadAddon(this.fitAddon);
    attachUnicode11(this.xterm);
    this.xterm.loadAddon(new WebLinksAddon(openTerminalLink));
  }

  async ngAfterViewInit(): Promise<void> {
    const el = this.containerRef.nativeElement;
    this.xterm.open(el);

    attachWebglRenderer(this.xterm);

    // If the host tab is display:none at open time, the container is 0×0:
    // xterm would initialize its renderer with bogus metrics and text would
    // stay clamped to the "previous view" size until a full refresh.
    this.needsVisibilityRefresh = el.offsetWidth === 0 || el.offsetHeight === 0;
    if (!this.needsVisibilityRefresh) {
      this.fitAddon.fit();
    }

    // Clipboard shortcuts. On Windows/Linux xterm forwards Ctrl+C/V to the PTY
    // (SIGINT / raw ^V), so copy/paste never happen. decideTerminalClipboardAction
    // adds Ctrl/Cmd+Shift+C/V and Ctrl/Shift+Insert on all platforms, plus plain
    // Ctrl+C (copy only with a selection, else SIGINT) and Ctrl+V on Windows/Linux.
    this.xterm.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      // Tauri: plain Cmd+C/V too (native WKWebView breaks lines at visual
      // wraps and pastes multi-line text as separate submits).
      const metaClipboard = this.sessionService.isTauri;
      const action = decideTerminalClipboardAction(
        ev,
        (window as any).promptops?.platform,
        () => !!this.xterm?.getSelection(),
        metaClipboard,
      );
      if (action && metaClipboard) ev.preventDefault();
      if (action === 'copy') { void this.copySelection(); return false; }
      if (action === 'paste') { void this.pasteClipboard(); return false; }
      // Shift+Enter → insert a newline instead of submitting. preventDefault()
      // is required: returning false alone lets xterm's hidden textarea still
      // emit the Enter as \r (which submits). Ctrl+J (\n) is the universal newline.
      // Cmd as a line modifier (macOS): Cmd+←/→ → Ctrl+A/E, Cmd+Backspace → Ctrl+U.
      // xterm drops Cmd+arrow, so without this nothing would reach the PTY.
      const seq = decideTerminalMacLineKey(ev, (window as any).promptops?.platform);
      if (seq) {
        ev.preventDefault();
        this.manager.write(this.terminalId, seq);
        return false;
      }
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ev.shiftKey && !ctrl && !ev.altKey && (ev.key === 'Enter' || ev.code === 'Enter')) {
        ev.preventDefault();
        this.manager.write(this.terminalId, '\n');
        return false;
      }
      return true;
    });

    // User types → send to the desktop pty
    this.xterm.onData((data) => {
      this.manager.write(this.terminalId, data);
    });

    // Pty output → write to xterm.
    //
    // The replay buffer is fetched over async IPC; live output can arrive both
    // before that resolves AND overlap with the bytes the buffer already holds.
    // We dedupe by byte cursor: every chunk carries its end offset (cumulative
    // bytes from the PTY), and `writtenOffset` tracks how far we've rendered.
    // The native replay cursor always falls between two chunks, so a chunk is
    // either already rendered (dropped) or written whole — never sliced, since
    // `data` is decoded text and the offsets count bytes.
    let writtenOffset = -1; // unknown until the buffer cursor is established
    const pending: Array<{ data: string; offset: number }> = [];

    const writeChunk = (data: string, offset: number): void => {
      if (this.isDisposed) return;
      const out = liveTextAfterSnapshot(data, offset, writtenOffset);
      if (out === null) return;
      this.xterm.write(out);
      writtenOffset = offset;
    };

    this.manager.onOutput(this.terminalId, (data, offset) => {
      if (this.isDisposed) return;
      if (writtenOffset < 0) {
        pending.push({ data, offset }); // buffer not yet restored — queue it
      } else {
        writeChunk(data, offset);
      }
    });

    // Restore prior output captured by the desktop PTY (e.g. when the modal
    // was closed and reopened), then flush any live output queued meanwhile,
    // deduped against the buffer's byte cursor.
    try {
      const { data, endOffset } = await this.manager.getBuffer(this.terminalId);
      if (!this.isDisposed && data) this.xterm.write(data);
      writtenOffset = endOffset; // everything up to endOffset is now rendered
    } catch {
      // No buffer (fresh terminal / error) — render all live output as-is.
      writtenOffset = 0;
    }
    for (const chunk of pending) writeChunk(chunk.data, chunk.offset);
    pending.length = 0;
    if (this.isDisposed) return;

    // Auto-resize when container changes
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const rect = entry?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      this.refit(true);
    });
    this.resizeObserver.observe(el);
  }

  /**
   * Re-fit the xterm to the current container size and sync the pty.
   * When `forceRefresh` is true, also force a full re-render of the visible
   * buffer — required when the container transitions from 0×0 (display:none)
   * to a real size, since xterm's renderer keeps stale glyph metrics until
   * an explicit refresh.
   */
  private refit(forceRefresh = false): void {
    const el = this.containerRef.nativeElement;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
    try {
      this.fitAddon.fit();
    } catch { return; }
    const dims = this.fitAddon.proposeDimensions();
    if (!dims) return;
    const changed = !this.lastDims || this.lastDims.cols !== dims.cols || this.lastDims.rows !== dims.rows;
    if (changed) {
      this.lastDims = { cols: dims.cols, rows: dims.rows };
      this.manager.resize(this.terminalId, dims.cols, dims.rows);
    }
    if (this.needsVisibilityRefresh || forceRefresh) {
      this.needsVisibilityRefresh = false;
      try { this.xterm.refresh(0, this.xterm.rows - 1); } catch { /* noop */ }
    }
  }

  /** Call when the tab becomes visible (xterm needs a re-fit). */
  focus(): void {
    // Multi-stage fit: browsers may need one or two frames to fully commit
    // the layout after a display: none → flex transition, so we retry across
    // a short window before settling.
    requestAnimationFrame(() => this.refit(true));
    setTimeout(() => this.refit(true), 50);
    setTimeout(() => {
      this.refit(true);
      this.xterm.focus();
    }, 150);
  }

  ngOnDestroy(): void {
    this.isDisposed = true;
    this.resizeObserver?.disconnect();
    this.xterm?.dispose();
  }
}
