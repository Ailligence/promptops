import { inject, Injectable, signal } from '@angular/core';
import { DesktopBridgeService, TerminalOutputEvent } from './desktop-bridge.service';

export interface TerminalTab {
  id: string;
  label: string;
  createdAt: Date;
}

interface SessionTerminalState {
  tabs: TerminalTab[];
  activeId: string | null;
  /** Monotonic counter to label new tabs within this session (Terminal 1, 2, ...). */
  tabCounter: number;
}

/**
 * Per-session terminal manager. Terminals are bucketed by sessionId so each
 * session owns an independent list of open shells. State is in-memory only;
 * processes survive modal close but are terminated when their session is
 * destroyed (via closeSession).
 */
@Injectable({ providedIn: 'root' })
export class TerminalManagerService {
  private bridge = inject(DesktopBridgeService);

  /** Per-session state. Updated immutably so `signal()` reads trigger change detection. */
  private state = signal<Map<string, SessionTerminalState>>(new Map());

  /** Registry of output listeners per terminal (xterm writes). The offset is
   * the cumulative byte cursor incl. this chunk, used for replay dedupe. */
  private outputCallbacks = new Map<string, (data: string, offset: number) => void>();

  /** Extra read-only taps per terminal (readiness detection…), independent of the xterm listener. */
  private outputTaps = new Map<string, Set<(data: string) => void>>();

  /** Global unsubscribe handle for IPC output stream. */
  private unsubOutput: (() => void) | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Subscribes to the global terminal output IPC stream. Safe to call many
   * times — only the first call wires the listener. The manager is a root
   * singleton, so this typically runs once for the lifetime of the app.
   */
  init(): void {
    if (this.unsubOutput) return;
    this.unsubOutput = this.bridge.onTerminalOutput((event: TerminalOutputEvent) => {
      const cb = this.outputCallbacks.get(event.terminalId);
      if (cb) cb(event.data, event.offset);
      const taps = this.outputTaps.get(event.terminalId);
      if (taps) for (const tap of taps) tap(event.data);
    });
  }

  destroy(): void {
    this.unsubOutput?.();
    this.unsubOutput = null;
  }

  // ── Per-session reads (call from signal contexts / computed) ─────

  tabsForSession(sessionId: string): TerminalTab[] {
    return this.state().get(sessionId)?.tabs ?? [];
  }

  activeIdForSession(sessionId: string): string | null {
    return this.state().get(sessionId)?.activeId ?? null;
  }

  // ── Terminal CRUD (per-session) ──────────────────────────────────

  async create(opts: {
    sessionId: string;
    cols?: number;
    rows?: number;
    cwd?: string;
  }): Promise<string> {
    const { sessionId, cols, rows, cwd } = opts;
    const result = await this.bridge.openTerminal({ cols, rows, cwd });
    if (!result.ok || !result.terminalId) {
      throw new Error(result.error ?? 'Failed to open terminal');
    }

    const next = new Map(this.state());
    const current: SessionTerminalState = next.get(sessionId) ?? {
      tabs: [],
      activeId: null,
      tabCounter: 0,
    };
    const tabCounter = current.tabCounter + 1;
    const tab: TerminalTab = {
      id: result.terminalId,
      label: `Terminal ${tabCounter}`,
      createdAt: new Date(),
    };
    next.set(sessionId, {
      tabs: [...current.tabs, tab],
      activeId: tab.id,
      tabCounter,
    });
    this.state.set(next);
    return tab.id;
  }

  async close(sessionId: string, terminalId: string): Promise<void> {
    await this.bridge.closeTerminal(terminalId).catch(() => {});
    this.outputCallbacks.delete(terminalId);

    const next = new Map(this.state());
    const current = next.get(sessionId);
    if (!current) return;

    const remaining = current.tabs.filter((x) => x.id !== terminalId);
    let activeId = current.activeId;
    if (activeId === terminalId) {
      activeId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }
    next.set(sessionId, { ...current, tabs: remaining, activeId });
    this.state.set(next);
  }

  async closeAll(sessionId: string): Promise<void> {
    const current = this.state().get(sessionId);
    if (!current) return;

    const ids = current.tabs.map((t) => t.id);
    for (const id of ids) {
      await this.bridge.closeTerminal(id).catch(() => {});
      this.outputCallbacks.delete(id);
    }
    const next = new Map(this.state());
    next.set(sessionId, { ...current, tabs: [], activeId: null });
    this.state.set(next);
  }

  /**
   * Terminate every terminal belonging to a session and drop its bucket
   * entirely. Use this when a session is destroyed/closed by the user so
   * orphan processes don't linger.
   */
  async closeSession(sessionId: string): Promise<void> {
    await this.closeAll(sessionId);
    const next = new Map(this.state());
    next.delete(sessionId);
    this.state.set(next);
  }

  activate(sessionId: string, terminalId: string): void {
    const next = new Map(this.state());
    const current = next.get(sessionId);
    if (!current) return;
    next.set(sessionId, { ...current, activeId: terminalId });
    this.state.set(next);
  }

  // ── Per-terminal IO (sessionId not needed — terminalId is unique) ─

  write(terminalId: string, data: string): void {
    this.bridge.writeTerminal(terminalId, data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.bridge.resizeTerminal(terminalId, cols, rows);
  }

  onOutput(terminalId: string, callback: (data: string, offset: number) => void): void {
    this.outputCallbacks.set(terminalId, callback);
  }

  /** Adds a side listener on a terminal's output (does not replace the xterm one). Returns the unsubscribe. */
  tapOutput(terminalId: string, tap: (data: string) => void): () => void {
    let taps = this.outputTaps.get(terminalId);
    if (!taps) { taps = new Set(); this.outputTaps.set(terminalId, taps); }
    taps.add(tap);
    return () => {
      const set = this.outputTaps.get(terminalId);
      set?.delete(tap);
      if (set && set.size === 0) this.outputTaps.delete(terminalId);
    };
  }

  /**
   * Fetch the native-side replay buffer for a terminal along with its byte
   * cursor (endOffset), so a freshly-created xterm can restore its history
   * when the modal is reopened and dedupe it against concurrent live output.
   */
  async getBuffer(terminalId: string): Promise<{ data: string; endOffset: number }> {
    const result = await this.bridge.getTerminalBuffer(terminalId);
    if (!result.ok) return { data: '', endOffset: 0 };
    return { data: result.data, endOffset: result.endOffset };
  }
}
