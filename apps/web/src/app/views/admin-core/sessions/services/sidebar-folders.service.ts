import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SidebarFolder, SidebarFolderApiService } from './sidebar-folder-api.service';
import { SessionProfilesService } from './session-profiles.service';

/**
 * Owns the sidebar-folder state (stored, best-effort). Folders are
 * scoped to the active session profile: switching profile reloads the list
 * (the data layer passes the active profile). All writes reload the
 * list afterwards so `folders` stays the single source of truth for the join
 * the sidebar performs against workspaces/sessions.
 *
 * Failure mode is always "no folders" → the sidebar renders the pre-feature
 * flat list, which is also the retro-compat behavior for users without folders.
 */
/**
 * Local cache of the last folder list (same pattern as the sessions/workspaces
 * caches): without it the sidebar paints the flat pre-folder layout at boot
 * and re-groups once the HTTP load lands.
 */
const FOLDERS_CACHE_KEY = 'promptops_sidebar_folders_cache_v1';

function readFoldersCache(): SidebarFolder[] | null {
  try {
    const raw = localStorage.getItem(FOLDERS_CACHE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as SidebarFolder[];
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

export function clearSidebarFoldersCache(): void {
  try {
    localStorage.removeItem(FOLDERS_CACHE_KEY);
  } catch { /* non-critical */ }
}

@Injectable({ providedIn: 'root' })
export class SidebarFoldersService {
  private api = inject(SidebarFolderApiService);
  private profiles = inject(SessionProfilesService);

  readonly folders = signal<SidebarFolder[]>(readFoldersCache() ?? []);
  readonly loading = signal(false);
  private loadRevision = 0;
  private pendingReorders = 0;
  private reorderQueue: Promise<void> = Promise.resolve();

  private cacheFolders(): void {
    try { localStorage.setItem(FOLDERS_CACHE_KEY, JSON.stringify(this.folders())); }
    catch { /* non-critical */ }
  }

  /** workspaceId → folderId, for the sidebar's client-side join. */
  readonly workspaceFolderMap = computed<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const f of this.folders()) {
      for (const wsId of f.workspaceIds) m.set(wsId, f.id);
    }
    return m;
  });

  /** session dbId (stored id) → folderId, for standalone sessions. */
  readonly sessionFolderMap = computed<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const f of this.folders()) {
      for (const sid of f.sessionIds) m.set(sid, f.id);
    }
    return m;
  });

  constructor() {
    // Load on first injection and again whenever the active profile changes
    // (folders are profile-scoped, so the switch invalidates the current list).
    // effect() needs an injection context, hence the constructor.
    effect(() => {
      this.profiles.activeProfileId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    const revision = ++this.loadRevision;
    const profile = this.profiles.activeProfileId();
    this.loading.set(true);
    try {
      const list = await firstValueFrom(this.api.list());
      if (revision !== this.loadRevision || profile !== this.profiles.activeProfileId() || this.pendingReorders > 0) return;
      this.folders.set(list);
      this.cacheFolders();
    } catch {
      /* keep the current list on a transient failure */
    } finally {
      if (revision === this.loadRevision) this.loading.set(false);
    }
  }

  async createFolder(name: string, color?: string | null): Promise<SidebarFolder | null> {
    try {
      const folder = await firstValueFrom(this.api.create({ name, color }));
      await this.load();
      return folder;
    } catch {
      return null;
    }
  }

  async renameFolder(id: string, name: string): Promise<void> {
    try {
      await firstValueFrom(this.api.update(id, { name }));
      await this.load();
    } catch {
      /* ignore */
    }
  }

  async setFolderColor(id: string, color: string | null): Promise<void> {
    try {
      await firstValueFrom(this.api.update(id, { color }));
      await this.load();
    } catch {
      /* ignore */
    }
  }

  /** Contents are reassigned to "no folder" by the local store — nothing is lost. */
  async deleteFolder(id: string): Promise<void> {
    try {
      await firstValueFrom(this.api.delete(id));
      await this.load();
    } catch {
      /* ignore */
    }
  }

  async reorderFolders(orderedIds: string[]): Promise<void> {
    const ids = [...new Set(orderedIds)];
    const byId = new Map(this.folders().map(folder => [folder.id, folder]));
    if (ids.length !== byId.size || ids.some(id => !byId.has(id))) return;
    this.folders.set(ids.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder })));
    this.cacheFolders();
    ++this.loadRevision; // Discard loads started before this drag.
    ++this.pendingReorders;
    const write = this.reorderQueue.then(async () => {
      try {
        await firstValueFrom(this.api.reorder(ids));
      } catch {
        console.error('[SidebarFoldersService] Could not save folder order');
      } finally {
        --this.pendingReorders;
      }
    });
    this.reorderQueue = write;
    await write;
    // Only the final drag reloads: an earlier response cannot undo a later drag.
    if (this.pendingReorders === 0) await this.load();
  }

  async assignWorkspace(workspaceId: string, folderId: string | null): Promise<void> {
    try {
      await firstValueFrom(this.api.assign({ folderId, workspaceIds: [workspaceId] }));
      await this.load();
    } catch {
      /* ignore */
    }
  }

  async assignSession(sessionDbId: string, folderId: string | null): Promise<void> {
    try {
      await firstValueFrom(this.api.assign({ folderId, sessionIds: [sessionDbId] }));
      await this.load();
    } catch {
      /* ignore */
    }
  }
}
