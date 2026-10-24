import { computed, inject, Injectable, signal } from '@angular/core';
import { APP_VERSION } from '@environment/version';

export interface VersionState {
  appVersion: string;
  minimumVersion: string | null;
  latestVersion: string | null;
  updateUrl: string;
  updateRequired: boolean;
  updateAvailable: boolean;
  checked: boolean;
  /** When false a required update can be postponed. Always false in this edition. */
  hardBlock: boolean;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const SNOOZE_MS = 30 * 60 * 1000; // "Later" hides the prompt for 30 minutes
const SNOOZE_KEY = 'promptops_update_snooze_until';

@Injectable({ providedIn: 'root' })
export class VersionService {
  state = signal<VersionState>({
    appVersion: APP_VERSION,
    minimumVersion: null,
    latestVersion: null,
    updateUrl: 'https://github.com/shellonback/promptops/releases',
    updateRequired: false,
    updateAvailable: false,
    checked: false,
    hardBlock: false,
  });

  /** Epoch-ms until which the user postponed the required update (persisted). */
  private snoozedUntil = signal<number>(this.readSnooze());
  private snoozeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A required update can be postponed unless `hardBlock` is set (never in
   * this edition).
   */
  canPostpone = computed(() => !this.state().hardBlock);

  /** Blocking overlay: update required AND not (postponable and postponed). */
  blocking = computed(() => {
    const s = this.state();
    if (!s.updateRequired) return false;
    if (!this.canPostpone()) return true;
    return this.snoozedUntil() <= Date.now();
  });

  /** "Later": hide the overlay for 30 minutes, then it comes back. */
  postpone(): void {
    const until = Date.now() + SNOOZE_MS;
    this.snoozedUntil.set(until);
    try { localStorage.setItem(SNOOZE_KEY, String(until)); } catch { /* private mode */ }
    this.armSnoozeTimer(until);
  }

  private readSnooze(): number {
    try {
      const raw = localStorage.getItem(SNOOZE_KEY);
      const n = raw ? Number(raw) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  /** Re-show the overlay when the snooze lapses even if no check ran meanwhile. */
  private armSnoozeTimer(until: number): void {
    if (this.snoozeTimer) clearTimeout(this.snoozeTimer);
    const delay = Math.max(0, until - Date.now());
    if (delay === 0 || delay > 2_147_000_000) return;
    this.snoozeTimer = setTimeout(() => this.snoozedUntil.set(0), delay);
  }

  private intervalId: ReturnType<typeof setInterval> | null = null;

  get appVersion(): string {
    return APP_VERSION;
  }

  private get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  /**
   * Start periodic version checks (only in desktop app — the web app is always up-to-date).
   */
  startPeriodicCheck(): void {
    if (!this.isDesktop) return;
    this.checkVersion();
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.checkVersion(), CHECK_INTERVAL_MS);
  }

  stopPeriodicCheck(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * New versions are announced on GitHub Releases and the app never asks a
   * server about them, so the check only marks the state as checked: no
   * update is ever required.
   */
  async checkVersion(): Promise<void> {
    if (!this.state().checked) {
      this.state.update(s => ({ ...s, checked: true }));
    }
  }

  /**
   * Semantic version comparison.
   * Returns: -1 if a < b, 0 if a == b, 1 if a > b
   */
  compareVersions(a: string, b: string): number {
    // parseInt so pre-release parts ("8-beta") compare on their numeric base
    // instead of becoming NaN (which silently made every comparison "equal").
    const toParts = (v: string) =>
      v.split('.').map(p => {
        const n = parseInt(p, 10);
        return Number.isNaN(n) ? 0 : n;
      });
    const partsA = toParts(a);
    const partsB = toParts(b);
    const len = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < len; i++) {
      const numA = partsA[i] ?? 0;
      const numB = partsB[i] ?? 0;
      if (numA < numB) return -1;
      if (numA > numB) return 1;
    }
    return 0;
  }
}
