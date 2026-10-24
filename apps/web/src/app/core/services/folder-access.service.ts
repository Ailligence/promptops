import { Injectable, OnDestroy, signal } from '@angular/core';

/**
 * macOS TCC folder-access state (Documents/Desktop/Downloads consent).
 *
 * When macOS denies folder access, the desktop backend parks the
 * affected sessions in standby instead of spawning broken PTYs and pushes
 * the denied state here; the global banner (folder-access-modal) offers
 * "Open System Settings" / "Retry". Recovery (re-probe + wake of the parked
 * sessions) happens entirely in main — this service only mirrors the state.
 */
export interface FolderAccessInfo {
  denied: boolean;
  deniedRoots: string[];
  /** Errno per root: EPERM = TCC/Privacy, EACCES = POSIX folder permissions. */
  deniedDetails: Array<{ root: string; code: string }>;
  /** App running Gatekeeper-translocated: Privacy grants may not apply to it. */
  translocated: boolean;
  parkedSessionIds: string[];
  retrying: boolean;
  dismissed: boolean;
}

@Injectable({ providedIn: 'root' })
export class FolderAccessService implements OnDestroy {
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  info = signal<FolderAccessInfo>({
    denied: false,
    deniedRoots: [],
    deniedDetails: [],
    translocated: false,
    parkedSessionIds: [],
    retrying: false,
    dismissed: false,
  });

  /** At least one denial is plain POSIX permissions, not macOS Privacy. */
  get hasPosixDenial(): boolean {
    return this.info().deniedDetails.some((d) => d.code === 'EACCES');
  }

  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  private get api(): any {
    return (window as any).promptops;
  }

  /**
   * Subscribe to pushes AND pull the initial state: the denial typically
   * happens during session restore, BEFORE this renderer exists — the push
   * alone would miss it. Call once at app startup; safe to call again.
   */
  init(): void {
    if (!this.isDesktop || this.initialized) return;
    // Older main builds (mid-update) may not expose the bridge yet.
    if (typeof this.api.checkFolderAccess !== 'function') return;
    this.initialized = true;

    this.unsubscribers.push(
      this.api.onFolderAccessChanged((_: unknown, state: unknown) => this.apply(state)),
    );
    this.api.checkFolderAccess()
      .then((state: unknown) => this.apply(state))
      .catch(() => { /* main not ready — the next push will catch us up */ });
  }

  /** Force re-probe; if the permission was granted, main wakes the parked sessions. */
  async retry(): Promise<void> {
    if (!this.isDesktop || this.info().retrying) return;
    this.info.update((s) => ({ ...s, retrying: true }));
    try {
      const state = await this.api.retryFolderAccess();
      this.apply(state);
    } catch { /* banner stays; the user can retry again */ } finally {
      this.info.update((s) => ({ ...s, retrying: false }));
    }
  }

  openSettings(): void {
    if (!this.isDesktop) return;
    Promise.resolve(this.api.openFolderAccessSettings?.()).catch(() => { /* the banner keeps its instructions */ });
  }

  /** Older main builds (mid-update) may not expose the newer bridges yet. */
  get canResetPermissions(): boolean {
    return this.isDesktop && typeof this.api.resetFolderAccessPermissions === 'function';
  }

  get canRelaunch(): boolean {
    return this.isDesktop && typeof this.api.relaunchAppForFolderAccess === 'function';
  }

  /**
   * Escape hatch when System Settings claims access is granted but macOS
   * still denies (stale TCC entry after an update, or a denied folder with
   * no toggle left in Settings): main resets PromptOps' folder permissions
   * via tccutil and re-probes, which re-shows the macOS consent dialog —
   * "Allow" wakes the parked sessions.
   */
  async resetPermissions(): Promise<void> {
    if (!this.canResetPermissions || this.info().retrying) return;
    this.info.update((s) => ({ ...s, retrying: true }));
    try {
      const state = await this.api.resetFolderAccessPermissions();
      this.apply(state);
    } catch { /* banner stays; the user can retry */ } finally {
      this.info.update((s) => ({ ...s, retrying: false }));
    }
  }

  /** Full Disk Access only takes effect after an app relaunch. */
  relaunch(): void {
    if (!this.canRelaunch) return;
    Promise.resolve(this.api.relaunchAppForFolderAccess()).catch(() => { /* still running: the user can quit by hand */ });
  }

  /** Hide the banner until the denial clears and comes back. */
  dismiss(): void {
    this.info.update((s) => ({ ...s, dismissed: true }));
  }

  private apply(state: unknown): void {
    const s = state as {
      denied?: boolean;
      deniedRoots?: string[];
      deniedDetails?: Array<{ root: string; code: string }>;
      translocated?: boolean;
      parkedSessionIds?: string[];
    } | null;
    if (!s || typeof s.denied !== 'boolean') return;
    this.info.update((prev) => ({
      ...prev,
      denied: s.denied!,
      deniedRoots: s.deniedRoots ?? [],
      deniedDetails: s.deniedDetails ?? [],
      translocated: s.translocated ?? false,
      parkedSessionIds: s.parkedSessionIds ?? [],
      // A cleared denial resets the dismissal so a FUTURE denial re-shows the
      // banner; repeated denied pushes (e.g. parked-count updates) keep it.
      dismissed: s.denied ? prev.dismissed && prev.denied : false,
    }));
  }

  ngOnDestroy(): void {
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
  }
}
