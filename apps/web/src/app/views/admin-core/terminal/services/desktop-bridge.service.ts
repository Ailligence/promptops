import { Injectable } from '@angular/core';

/**
 * Typed facade over the `window.promptops` API exposed by the desktop app's bridge.
 *
 * When the app runs in a plain browser (no desktop app), every method returns a
 * rejected promise so callers can show a graceful "desktop only" message.
 */

export interface TerminalOpenResult {
  ok: boolean;
  terminalId?: string;
  error?: string;
}

export interface TerminalOutputEvent {
  terminalId: string;
  data: string;
  /** Cumulative byte offset incl. this chunk — used to dedupe live output
   * against the replay buffer when an xterm re-attaches. */
  offset: number;
}

@Injectable({ providedIn: 'root' })
export class DesktopBridgeService {

  /** True when the app is running inside the desktop app. */
  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  private get api(): any {
    const api = (window as any).promptops;
    if (!api) throw new Error('Not running inside the desktop app');
    return api;
  }

  // ── Terminal ─────────────────────────────────────────────────────

  openTerminal(options?: { cols?: number; rows?: number; cwd?: string }): Promise<TerminalOpenResult> {
    return this.api.openTerminal(options);
  }

  closeTerminal(terminalId: string): Promise<{ ok: boolean }> {
    return this.api.closeTerminal(terminalId);
  }

  writeTerminal(terminalId: string, data: string): Promise<{ ok: boolean }> {
    return this.api.writeTerminal(terminalId, data);
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<{ ok: boolean }> {
    return this.api.resizeTerminal(terminalId, cols, rows);
  }

  /**
   * Subscribe to terminal output. Returns an unsubscribe function.
   */
  onTerminalOutput(callback: (data: TerminalOutputEvent) => void): () => void {
    return this.api.onTerminalOutput((_event: unknown, data: TerminalOutputEvent) => callback(data));
  }

  listTerminals(): Promise<Array<{ id: string; createdAt: string }>> {
    return this.api.listTerminals();
  }

  /**
   * Fetch the accumulated replay buffer for a terminal so a re-attaching
   * xterm (modal reopened) can restore prior output.
   */
  getTerminalBuffer(terminalId: string): Promise<{ ok: boolean; data: string; endOffset: number }> {
    return this.api.getTerminalBuffer(terminalId);
  }

  // ── Storage Management ────────────────────────────────────────────

  storageAudit(): Promise<any> {
    return this.api.storageAudit();
  }

  storageCleanup(areas?: string[]): Promise<any> {
    return this.api.storageCleanup(areas);
  }
}
