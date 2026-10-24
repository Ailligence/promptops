import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { DataBackend, call$ } from '@core/data/data-backend';

export interface SessionProfileDto {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  desktop_sessions_count?: number;
  workspaces_count?: number;
  created_at: string;
  updated_at: string;
}

export interface SessionProfile {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  sessionsCount: number;
  workspacesCount: number;
}

/**
 * Session profiles (named groupings of workspaces + standalone sessions),
 * kept on this device. The "Standard" profile is implicit (no record): it is
 * never returned here and is rendered client-side as a fixed entry.
 */
@Injectable({ providedIn: 'root' })
export class SessionProfileApiService {
  private data = inject(DataBackend);

  list(): Observable<SessionProfile[]> {
    return call$<SessionProfileDto[]>(this.data, 'profiles.list').pipe(map((list) => (list ?? []).map((d) => this.toModel(d))));
  }

  create(input: { name: string; color?: string | null }): Observable<SessionProfile> {
    return call$<SessionProfileDto>(this.data, 'profiles.create', input).pipe(map((d) => this.toModel(d)));
  }

  update(
    id: string,
    patch: { name?: string; color?: string | null; sort_order?: number },
  ): Observable<SessionProfile> {
    return call$<SessionProfileDto>(this.data, 'profiles.update', { ...patch, id }).pipe(map((d) => this.toModel(d)));
  }

  delete(id: string): Observable<void> {
    return call$(this.data, 'profiles.delete', { id }).pipe(map(() => undefined));
  }

  private toModel(d: SessionProfileDto): SessionProfile {
    return {
      id: d.id,
      name: d.name,
      color: d.color ?? null,
      sortOrder: d.sort_order ?? 0,
      sessionsCount: d.desktop_sessions_count ?? 0,
      workspacesCount: d.workspaces_count ?? 0,
    };
  }
}
