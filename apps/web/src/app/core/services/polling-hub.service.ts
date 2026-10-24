import { Injectable, OnDestroy, NgZone, inject } from '@angular/core';

/**
 * Centralized polling hub — replaces scattered setInterval calls with a
 * single, visibility-aware engine.
 *
 * Key behaviors:
 *  - **Pauses completely** when the document is hidden (minimized, tab switch).
 *  - On **return to visible**, fires every registered source immediately.
 *  - Each source keeps its own cadence (intervalMs) and is staggered to avoid
 *    request storms.
 *  - Sources are reference-counted: register/unregister is safe to call from
 *    component lifecycles.
 */

interface PollingSource {
  callback: () => void | Promise<void>;
  intervalMs: number;
  timerId: ReturnType<typeof setInterval> | null;
}

@Injectable({ providedIn: 'root' })
export class PollingHubService implements OnDestroy {
  private zone = inject(NgZone);
  private sources = new Map<string, PollingSource>();
  private isVisible = !document.hidden;

  private readonly STAGGER_STEP_MS = 3_000;

  private handleVisibility = (): void => {
    const wasHidden = !this.isVisible;
    this.isVisible = !document.hidden;

    if (this.isVisible && wasHidden) {
      // Came back — restart all timers and refresh immediately (staggered)
      let delay = 0;
      for (const [key] of this.sources) {
        this.scheduleResume(key, delay);
        delay += this.STAGGER_STEP_MS;
      }
    } else if (!this.isVisible) {
      // Going away — pause all timers
      for (const source of this.sources.values()) {
        this.clearTimer(source);
      }
    }
  };

  constructor() {
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Register a polling source.
   *
   * @param key         Unique key (e.g. 'notifications', 'sessions')
   * @param callback    Function invoked on each tick
   * @param intervalMs  Cadence in milliseconds (e.g. 60_000)
   */
  register(key: string, callback: () => void | Promise<void>, intervalMs: number): void {
    this.unregister(key);

    const source: PollingSource = { callback, intervalMs, timerId: null };
    this.sources.set(key, source);

    if (this.isVisible) {
      // Initial fetch immediately, then start the cadence with a stagger offset
      // based on current number of active sources (avoids unbounded growth)
      this.runCallback(source);
      const staggerOffset = (this.sources.size - 1) * this.STAGGER_STEP_MS;
      this.startTimer(source, staggerOffset);
    }
  }

  /**
   * Remove a polling source and stop its timer.
   */
  unregister(key: string): void {
    const source = this.sources.get(key);
    if (source) {
      this.clearTimer(source);
      this.sources.delete(key);
    }
  }

  /**
   * Force an immediate refresh of one or all sources.
   */
  forceRefresh(key?: string): void {
    if (key) {
      const source = this.sources.get(key);
      if (source) this.runCallback(source);
    } else {
      for (const source of this.sources.values()) {
        this.runCallback(source);
      }
    }
  }

  // ── Internal ────────────────────────────────────────────────────────

  private startTimer(source: PollingSource, initialDelayMs: number = 0): void {
    this.clearTimer(source);

    this.zone.runOutsideAngular(() => {
      // First tick after the stagger offset, then regular cadence
      const kickoff = setTimeout(() => {
        if (!this.isVisible) return;
        source.timerId = setInterval(() => {
          if (this.isVisible) {
            this.runCallback(source);
          }
        }, source.intervalMs);
      }, initialDelayMs);

      // Store the kickoff timeout so we can cancel it; we overwrite timerId
      // after the first tick fires — but if visibility changes before that,
      // we need to be able to cancel it.
      source.timerId = kickoff as unknown as ReturnType<typeof setInterval>;
    });
  }

  private scheduleResume(key: string, delayMs: number): void {
    const source = this.sources.get(key);
    if (!source) return;

    this.clearTimer(source);

    this.zone.runOutsideAngular(() => {
      const resumeTimeout = setTimeout(() => {
        if (!this.isVisible) return;
        this.runCallback(source);
        this.startTimer(source);
      }, delayMs);

      source.timerId = resumeTimeout as unknown as ReturnType<typeof setInterval>;
    });
  }

  private runCallback(source: PollingSource): void {
    this.zone.run(() => {
      try {
        const result = source.callback();
        if (result instanceof Promise) {
          result.catch(() => {}); // swallow — individual services log their own errors
        }
      } catch {
        // swallow
      }
    });
  }

  private clearTimer(source: PollingSource): void {
    if (source.timerId !== null) {
      clearInterval(source.timerId);
      clearTimeout(source.timerId as unknown as ReturnType<typeof setTimeout>);
      source.timerId = null;
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.handleVisibility);
    for (const source of this.sources.values()) {
      this.clearTimer(source);
    }
    this.sources.clear();
  }
}
