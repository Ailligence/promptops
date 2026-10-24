import { Injectable } from '@angular/core';

export interface PtyDims {
  cols: number;
  rows: number;
}

const STORAGE_KEY = 'po_pty_dims';

/**
 * Remembers the last cols/rows actually sent to each PTY, keyed by
 * `sa:<subAgentId>` or `session:<sessionId>`.
 *
 * Terminal components are destroyed on session switch and recreated on
 * return, but the PTY (and the raw buffer it produced) keeps the grid it
 * had when the user left. Replaying that buffer into a fresh xterm only
 * renders correctly if the xterm grid matches the PTY grid — this registry
 * is how the fresh component learns that grid before writing the replay.
 *
 * Backed by localStorage (write-through) so it also survives a webapp
 * reload. After an app restart the PTYs are recreated at default
 * dims, but the disk-restored buffer was generated at the OLD dims — the
 * stale entry here still matches the buffer content, so the replay stays
 * correct and the live stream is realigned by the first real resize.
 */
@Injectable({ providedIn: 'root' })
export class PtyDimsRegistry {
  private dims = new Map<string, PtyDims>();

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, PtyDims>;
        for (const [key, value] of Object.entries(parsed)) {
          if (this.isValid(value)) this.dims.set(key, value);
        }
      }
    } catch { /* corrupted/unavailable storage — start empty */ }
  }

  get(key: string): PtyDims | null {
    const value = this.dims.get(key);
    return value && this.isValid(value) ? value : null;
  }

  set(key: string, cols: number, rows: number): void {
    if (!this.isValid({ cols, rows })) return;
    this.dims.set(key, { cols, rows });
    this.persist();
  }

  remove(key: string): void {
    if (this.dims.delete(key)) this.persist();
  }

  private isValid(value: PtyDims): boolean {
    return Number.isInteger(value?.cols) && Number.isInteger(value?.rows)
      && value.cols >= 2 && value.rows >= 2;
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.dims)));
    } catch { /* storage full/unavailable — in-memory map still works */ }
  }
}
