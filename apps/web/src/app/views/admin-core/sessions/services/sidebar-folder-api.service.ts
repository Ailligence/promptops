import { Injectable, inject, Injector } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { DataBackend, call$, scoped$ } from '@core/data/data-backend';

export interface SidebarFolderDto {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  workspace_ids?: string[];
  session_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface SidebarFolder {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  /** Workspace ids assigned to this folder. */
  workspaceIds: string[];
  /** Stored session ids (SessionSummary.dbId) assigned to this folder. */
  sessionIds: string[];
}

/**
 * Sidebar folders — user-defined visual groupings of workspaces + standalone
 * sessions in the session sidebar ("Work", "Personal"), kept on this device.
 * Orthogonal to session profiles: folders live INSIDE a profile. Items outside
 * any folder have no folder id and render exactly as before.
 */
@Injectable({ providedIn: 'root' })
export class SidebarFolderApiService {
  private data = inject(DataBackend);
  private injector = inject(Injector);

  list(): Observable<SidebarFolder[]> {
    return scoped$<SidebarFolderDto[]>(this.data, this.injector, 'folders.list').pipe(map((list) => (list ?? []).map((d) => this.toModel(d))));
  }

  create(input: { name: string; color?: string | null }): Observable<SidebarFolder> {
    return scoped$<SidebarFolderDto>(this.data, this.injector, 'folders.create', input).pipe(map((d) => this.toModel(d)));
  }

  update(
    id: string,
    patch: { name?: string; color?: string | null; sort_order?: number },
  ): Observable<SidebarFolder> {
    return call$<SidebarFolderDto>(this.data, 'folders.update', { ...patch, id }).pipe(map((d) => this.toModel(d)));
  }

  delete(id: string): Observable<void> {
    return call$(this.data, 'folders.delete', { id }).pipe(map(() => undefined));
  }

  reorder(folderIds: string[]): Observable<void> {
    return call$(this.data, 'folders.reorder', { folder_ids: folderIds }).pipe(map(() => undefined));
  }

  /** folderId null = remove the given items from whatever folder they are in. */
  assign(input: {
    folderId: string | null;
    workspaceIds?: string[];
    sessionIds?: string[];
  }): Observable<void> {
    return call$(this.data, 'folders.assign', {
        folder_id: input.folderId,
        workspace_ids: input.workspaceIds ?? [],
        session_ids: input.sessionIds ?? [],
      })
      .pipe(map(() => undefined));
  }

  private toModel(d: SidebarFolderDto): SidebarFolder {
    return {
      id: d.id,
      name: d.name,
      color: d.color ?? null,
      sortOrder: d.sort_order ?? 0,
      workspaceIds: d.workspace_ids ?? [],
      sessionIds: d.session_ids ?? [],
    };
  }
}
