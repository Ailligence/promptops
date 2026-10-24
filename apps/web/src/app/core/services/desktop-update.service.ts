import { Injectable, signal, inject, OnDestroy } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';

export type DesktopUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface DesktopUpdateInfo {
  state: DesktopUpdateState;
  version: string | null;
  releaseNotes: string | null;
  progress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null;
  error: string | null;
  downloadUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class DesktopUpdateService implements OnDestroy {
  private store = inject(Store);
  private unsubscribers: Array<() => void> = [];

  info = signal<DesktopUpdateInfo>({
    state: 'idle',
    version: null,
    releaseNotes: null,
    progress: null,
    error: null,
    downloadUrl: null,
  });

  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  private get api(): any {
    return (window as any).promptops;
  }

  /**
   * Start listening for update events from the desktop app.
   * Call once at app startup.
   */
  init(): void {
    if (!this.isDesktop) return;

    this.unsubscribers.push(
      this.api.onUpdateAvailable((_: unknown, data: { version: string; releaseNotes?: string }) => {
        this.info.set({
          state: 'available',
          version: data.version,
          releaseNotes: data.releaseNotes ?? null,
          progress: null,
          error: null,
          downloadUrl: null,
        });
      }),

      this.api.onUpdateNotAvailable((_: unknown, _data: { version: string }) => {
        this.info.set({
          state: 'not-available',
          version: null,
          releaseNotes: null,
          progress: null,
          error: null,
          downloadUrl: null,
        });
      }),

      this.api.onUpdateProgress((_: unknown, data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
        this.info.update(s => ({
          ...s,
          state: 'downloading',
          progress: data,
        }));
      }),

      this.api.onUpdateDownloaded((_: unknown, data: { version: string; releaseNotes?: string }) => {
        this.info.set({
          state: 'downloaded',
          version: data.version,
          releaseNotes: data.releaseNotes ?? null,
          progress: null,
          error: null,
          downloadUrl: null,
        });
      }),

      this.api.onUpdateError((_: unknown, data: { error: string; version?: string; downloadUrl?: string }) => {
        this.info.update(s => ({
          ...s,
          state: 'error',
          error: data.error,
          version: data.version ?? s.version,
          downloadUrl: data.downloadUrl ?? null,
        }));
      }),
    );
  }

  async checkForUpdates(): Promise<void> {
    if (!this.isDesktop) return;
    this.info.update(s => ({ ...s, state: 'checking', error: null }));
    let result: any;
    try {
      result = await this.api.checkForUpdates();
    } catch (err) {
      this.fail(err);
      return;
    }
    // Use returned status as fallback if push events haven't arrived yet
    if (result?.state && this.info().state === 'checking') {
      this.info.update(s => ({
        ...s,
        state: result.state,
        error: result.error ?? null,
        version: result.version ?? null,
        downloadUrl: result.downloadUrl ?? null,
      }));
    }
  }

  /**
   * Check and, if something is waiting, pull it straight away — the campaign
   * "join the beta" flow installs over the current app instead of sending the
   * user to a browser download.
   *
   * Returns the state it settled on, so the caller can fall back to a manual
   * download when the updater has nothing for this user (e.g. the eligibility
   * gate hasn't opened yet, or they're on an unsupported channel).
   */
  async checkAndDownload(): Promise<DesktopUpdateState> {
    if (!this.isDesktop) return 'error';

    await this.checkForUpdates();

    // checkForUpdates resolves as soon as the main process answers; the
    // available/not-available verdict may still be in flight over the push
    // channel. Give it a bounded window before deciding there's nothing.
    for (let i = 0; i < 40 && this.info().state === 'checking'; i++) {
      await new Promise(r => setTimeout(r, 250));
    }

    const state = this.info().state;
    if (state === 'available') {
      await this.downloadUpdate();
    }

    return this.info().state;
  }

  async downloadUpdate(): Promise<void> {
    if (!this.isDesktop) return;
    this.info.update(s => ({ ...s, state: 'downloading', progress: null }));
    try {
      await this.api.downloadUpdate();
    } catch (err) {
      this.fail(err);
      return;
    }
    this.pollUntilSettled();
  }

  /** A refused call leaves the menu on "error — retry", never stuck on checking/downloading. */
  private fail(err: unknown): void {
    const error = typeof err === 'string' ? err : (err as { message?: string })?.message ?? String(err);
    this.info.update(s => ({ ...s, state: 'error', error, progress: null }));
  }

  /**
   * Push-less fallback: the transition out of 'downloading' normally arrives
   * via update:progress / update:downloaded push events. On Tauri those global
   * emits may not reach the webview, leaving the menu stuck on a disabled
   * "Downloading 0%" forever. Poll update:get-status until the state settles
   * on downloaded/error (or the push events beat us to it), then stop.
   */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollUntilSettled(): void {
    if (typeof this.api?.getUpdateStatus !== 'function') return;
    if (this.pollTimer !== null) return;
    const startedAt = Date.now();
    this.pollTimer = setInterval(async () => {
      const state = this.info().state;
      const timedOut = Date.now() - startedAt > 5 * 60_000;
      if (state !== 'downloading' || timedOut) {
        if (this.pollTimer !== null) { clearInterval(this.pollTimer); this.pollTimer = null; }
        return;
      }
      try {
        const st = await this.api.getUpdateStatus();
        if (!st?.state || st.state === 'downloading') {
          // Still in flight — surface progress if the push events aren't doing it.
          if (st?.progress) this.info.update(s => ({ ...s, progress: st.progress }));
          return;
        }
        this.info.update(s => ({
          ...s,
          state: st.state,
          version: st.version ?? s.version,
          releaseNotes: st.releaseNotes ?? s.releaseNotes,
          error: st.error ?? null,
          downloadUrl: st.downloadUrl ?? null,
          progress: null,
        }));
      } catch { /* bridge hiccup — retry on next tick */ }
    }, 700);
  }

  /**
   * Save the current desktop UI state and then install the update.
   * This ensures the active session and sub-agent positions survive the restart.
   */
  async installUpdate(): Promise<void> {
    if (!this.isDesktop) return;

    // Persist UI state to desktop-state.json before quitting
    try {
      const { getActiveSession } = await import('../../../store/sessions/session.selectors');
      const activeSession = await firstValueFrom(this.store.select(getActiveSession));

      // Read sub-agent panel state from localStorage (set by session-view)
      const saExpanded = localStorage.getItem('promptops_sa_expanded') === 'true';
      const saFocusedRole = localStorage.getItem('promptops_sa_focused_role');

      await this.api.saveDesktopState({
        activeSessionName: activeSession?.name ?? null,
        subAgentsExpanded: saExpanded,
        focusedSubAgentRole: saFocusedRole ?? null,
      });
    } catch {
      // Best effort: the update installs even if the layout is not saved.
    }

    try {
      await this.api.installUpdate();
    } catch (err) {
      this.fail(err);
    }
  }

  async openManualDownload(): Promise<void> {
    if (!this.isDesktop) return;
    try {
      await this.api.openManualDownload();
    } catch (err) {
      this.fail(err);
    }
  }

  dismiss(): void {
    this.info.set({
      state: 'idle',
      version: null,
      releaseNotes: null,
      progress: null,
      error: null,
      downloadUrl: null,
    });
  }

  ngOnDestroy(): void {
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];
    if (this.pollTimer !== null) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }
}
