import { Injectable, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { SessionProfile, SessionProfileApiService } from './session-profile-api.service';
import { loadSessions, clearSessions } from '@/store/sessions/session.actions';
import { loadWorkspaces } from '@/store/workspaces/workspace.actions';

/** Subset of the desktop bridge (window.promptops) used for the per-device active profile. */
interface SessionProfileBridge {
  getActiveSessionProfile?: () => Promise<string | null>;
  setActiveSessionProfile?: (
    profileId: string | null,
  ) => Promise<{ ok: boolean; activeProfileId?: string | null; error?: string }>;
  onSessionProfileChanged?: (
    cb: (ev: unknown, data: { activeProfileId: string | null }) => void,
  ) => () => void;
}

/**
 * Owns the session-profile UI state. The LIST of profiles is stored on this
 * device; the ACTIVE profile is owned by the desktop app.
 *
 * Switching delegates the heavy lifting to the desktop app (persist current → tear down
 * PTYs → restore target) and then reloads the NgRx session/workspace lists, which
 * the data layer scopes to the active profile.
 */
@Injectable({ providedIn: 'root' })
export class SessionProfilesService {
  private api = inject(SessionProfileApiService);
  private store = inject(Store);

  readonly profiles = signal<SessionProfile[]>([]);
  readonly activeProfileId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly switching = signal(false);

  readonly activeProfile = computed(() =>
    this.profiles().find((p) => p.id === this.activeProfileId()) ?? null,
  );

  private initialized = false;

  private bridge(): SessionProfileBridge | undefined {
    return (window as unknown as { promptops?: SessionProfileBridge }).promptops;
  }

  get isDesktop(): boolean {
    return !!this.bridge();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const b = this.bridge();

    // Active profile is owned by the desktop app (per-device).
    if (b?.getActiveSessionProfile) {
      try {
        this.activeProfileId.set((await b.getActiveSessionProfile()) ?? null);
      } catch {
        /* default Standard */
      }
    }

    // Keep the signal in sync if the desktop app switches the profile out of band.
    if (b?.onSessionProfileChanged) {
      b.onSessionProfileChanged((_ev, data) => {
        // switchTo() below reloads too: reload once, whichever lands first,
        // or a late clearSessions would empty the freshly loaded list.
        const next = data?.activeProfileId ?? null;
        if (next === this.activeProfileId()) return;
        this.activeProfileId.set(next);
        this.reloadAfterSwitch();
      });
    }

    await this.loadProfiles();
  }

  async loadProfiles(): Promise<void> {
    this.loading.set(true);
    try {
      this.profiles.set(await firstValueFrom(this.api.list()));
    } catch {
      /* leave the current list in place on a transient failure */
    } finally {
      this.loading.set(false);
    }
  }

  async createProfile(name: string, color?: string | null): Promise<SessionProfile | null> {
    try {
      const profile = await firstValueFrom(this.api.create({ name, color }));
      await this.loadProfiles();
      return profile;
    } catch {
      return null;
    }
  }

  /** False when the change was not saved (the caller tells the user). */
  async updateProfile(id: string, patch: { name?: string; color?: string | null }): Promise<boolean> {
    try {
      await firstValueFrom(this.api.update(id, patch));
      await this.loadProfiles();
      return true;
    } catch {
      return false;
    }
  }

  /** False when the profile was not deleted (the caller tells the user). */
  async deleteProfile(id: string): Promise<boolean> {
    try {
      // If we're deleting the active profile, fall back to Standard first so the
      // local store (which reassigns its sessions to NULL) and the local runtime agree.
      if (this.activeProfileId() === id) {
        await this.switchTo(null);
        // The switch failed: deleting now would pull the sessions out from
        // under the running profile.
        if (this.activeProfileId() === id) return false;
      }
      await firstValueFrom(this.api.delete(id));
      await this.loadProfiles();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Switch the active profile. The desktop app persists the current profile, tears down
   * its PTYs and restores the target; we then reload the UI lists.
   */
  async switchTo(profileId: string | null): Promise<boolean> {
    const normalized = profileId ?? null;
    if (normalized === this.activeProfileId()) return true;

    const b = this.bridge();
    if (!b?.setActiveSessionProfile) {
      // Web (no desktop runtime): reflect the selection and reload — the data
      // layer scopes the next list to it.
      this.activeProfileId.set(normalized);
      this.reloadAfterSwitch();
      return true;
    }

    this.switching.set(true);
    try {
      const res = await b.setActiveSessionProfile(normalized);
      // The change event may already have applied (and reloaded) it.
      if (res?.ok === false) return false; // selection unchanged
      if (this.activeProfileId() !== normalized) {
        this.activeProfileId.set(normalized);
        this.reloadAfterSwitch();
      }
      return true;
    } catch {
      return false; // selection unchanged
    } finally {
      this.switching.set(false);
    }
  }

  /** Active profile id read synchronously (used by the data layer). */
  getActiveProfileIdSync(): string | null {
    return this.activeProfileId();
  }

  private reloadAfterSwitch(): void {
    this.store.dispatch(clearSessions());
    this.store.dispatch(loadSessions());
    this.store.dispatch(loadWorkspaces());
  }
}
