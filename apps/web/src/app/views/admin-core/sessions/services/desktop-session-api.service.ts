import { Injectable, inject, Injector } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { DataBackend, call$, isDataError, scoped$, type DataError } from '@core/data/data-backend';
import { SessionSummary, ProviderType, DeviceWorkspaceInfo, SessionViewState } from '@/store/sessions/session.state';

export interface DeviceWorkspaceDto {
  id: string;
  local_path: string;
  updated_at: string;
}

export interface DesktopSessionDto {
  id: string;
  name: string;
  provider: string;
  status: string;
  workspace_path: string | null;
  workspace_name: string | null;
  workspace_id: string | null;
  config: Record<string, unknown> | null;
  repo_url: string | null;
  repo_branch: string | null;
  team_id: number | null;
  team?: { id: number; name: string } | null;
  project_id: number | null;
  project?: { id: number; name: string } | null;
  category_id: number | null;
  device_workspace?: DeviceWorkspaceDto | null;
  view_state?: SessionViewState | null;
  sub_agents_order?: string[] | null;
  standby_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Saved sessions, kept on this device by the desktop shell (see
 * DataBackend). Sessions survive app restarts.
 *
 * Every method is best-effort: the live desktop state is the source of truth
 * and the stored records are reconciled on the next save. Methods that
 * callers need to react to (rename, `update` with `rethrow`) propagate the
 * {@link DataError}; the others resolve to null/false/[] on failure.
 */
@Injectable({ providedIn: 'root' })
export class DesktopSessionApiService {
  private data = inject(DataBackend);
  private injector = inject(Injector);

  /** All saved sessions of the active profile. Propagates errors. */
  private fetchSessions(): Observable<SessionSummary[]> {
    return scoped$<DesktopSessionDto[]>(this.data, this.injector, 'sessions.list')
      .pipe(map((list) => (list ?? []).map((dto) => this.toSummary(dto))));
  }

  /**
   * All saved sessions. Swallows errors to [] for fire-and-forget callers.
   */
  list(): Observable<SessionSummary[]> {
    return this.fetchSessions().pipe(catchError(() => of([])));
  }

  /**
   * List variant for the background poll: propagates errors so the caller
   * can keep the previously-loaded sessions on failure instead of wiping them.
   */
  pollList(): Observable<SessionSummary[]> {
    return this.fetchSessions();
  }

  /** One session by id; null if it does not exist. */
  show(id: string): Observable<SessionSummary | null> {
    return call$<DesktopSessionDto>(this.data, 'sessions.get', { id }).pipe(
      map((dto) => this.toSummary(dto)),
      catchError(() => of(null)),
    );
  }

  /**
   * Saves a new session. A deleted session with the same name comes back; a
   * LIVE one with the name makes the store refuse (`session_name_taken`)
   * unless `replace` (explicit restore) or `local_session_id` names the same
   * terminal. Pass { rethrowNameTaken: true } to receive that refusal.
   */
  create(data: {
    name: string;
    provider: string;
    workspace_path?: string;
    workspace_name?: string;
    workspace_id?: string | null;
    config?: Record<string, unknown>;
    team_id?: number | null;
    project_id?: number | null;
    category_id?: number | null;
    /** Id of the live terminal this record belongs to. */
    local_session_id?: string;
    /** Explicit restore: overwrite the live record with this name. */
    replace?: boolean;
  }, opts?: { rethrowNameTaken?: boolean }): Observable<SessionSummary | null> {
    // The terminal is already spawned locally and the store adds the session
    // regardless; a failed save is reconciled by the next save. A refused
    // name is not a transient failure: callers that can report it get it.
    return scoped$<DesktopSessionDto>(this.data, this.injector, 'sessions.create', data).pipe(
      map((dto) => this.toSummary(dto)),
      catchError((err) => (opts?.rethrowNameTaken && isDataError(err, 'session_name_taken') ? throwError(() => err) : of(null))),
    );
  }

  /**
   * Updates a session. The id may also be the session name. By default a
   * failure resolves to null; pass { rethrow: true } to handle the
   * {@link DataError} (for example a duplicate name on rename).
   */
  update(id: string, data: Record<string, any>, opts?: { silent?: boolean; rethrow?: boolean }): Observable<SessionSummary | null> {
    // Callers pass the session name as `_lookup_name` (the field name the
    // hosted API used); the local store reads `lookup_name` for its by-name
    // fallback when the live id differs from the stored one.
    const { _lookup_name, ...fields } = data;
    const params = _lookup_name != null && fields['lookup_name'] == null
      ? { ...fields, lookup_name: _lookup_name, id }
      : { ...fields, id };
    const req = call$<DesktopSessionDto>(this.data, 'sessions.update', params).pipe(
      map((dto) => this.toSummary(dto)),
    );
    return opts?.rethrow ? req : req.pipe(catchError(() => of(null)));
  }

  /**
   * Renames a session, propagating errors so the caller can react to a
   * duplicate name ({@link DataError} with code `session_name_taken` and
   * `details.conflict_name`). Names are unique.
   *
   * Pass force=true to resolve a collision: the other session gets a free,
   * suffixed name first so this one can take the name.
   */
  rename(id: string, name: string, lookupName?: string, force = false): Observable<SessionSummary | null> {
    return call$<DesktopSessionDto>(this.data, 'sessions.update', { id, name, lookup_name: lookupName, force_rename: force })
      .pipe(map((dto) => this.toSummary(dto)));
  }

  /**
   * Moves a standalone session into a workspace. A session that already
   * belongs to a workspace cannot be moved (resolves to null).
   */
  promote(sessionId: string, targetWorkspaceId: string): Observable<SessionSummary | null> {
    return call$<DesktopSessionDto>(this.data, 'sessions.promote', { id: sessionId, target_workspace_id: targetWorkspaceId })
      .pipe(
        map((dto) => this.toSummary(dto)),
        catchError(() => of(null)),
      );
  }

  /** Deletes a session by id. */
  destroy(id: string): Observable<boolean> {
    return call$(this.data, 'sessions.delete', { id }).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /**
   * Deletes a session by name.
   * Used when the live desktop session ID differs from the stored id.
   */
  destroyByName(name: string): Observable<boolean> {
    return call$(this.data, 'sessions.deleteByName', { name }).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /** Saves the tab order of a workspace. */
  reorderSessions(workspaceId: string, sessionIds: string[]): Observable<boolean> {
    return call$(this.data, 'sessions.reorder', { workspace_id: workspaceId, session_ids: sessionIds }).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /** Saves the desktop UI state (active session, open panels). */
  saveStateSnapshot(data: {
    active_session_name: string | null;
    sub_agents_state: { expanded: boolean; focused_role: string | null } | null;
    ui_state?: Record<string, unknown> | null;
  }): Observable<boolean> {
    return call$(this.data, 'sessions.saveSnapshot', data).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /** The last saved desktop UI state, or null. */
  getStateSnapshot(): Observable<{
    active_session_name: string | null;
    sub_agents_state: { expanded: boolean; focused_role: string | null } | null;
    ui_state: Record<string, unknown> | null;
  } | null> {
    return call$<any>(this.data, 'sessions.getSnapshot').pipe(
      map((snapshot) => snapshot ?? null),
      catchError(() => of(null)),
    );
  }

  /** Updates a session's sub-agents, found by session name. */
  syncSubAgentsByName(sessionName: string, subAgents: any[]): Observable<boolean> {
    return call$(this.data, 'sessions.updateByName', { lookup_name: sessionName, sub_agents: subAgents }).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /** The stored sub-agents of the session with this name. */
  getSessionSubAgentsByName(sessionName: string): Observable<any[]> {
    return scoped$<any[]>(this.data, this.injector, 'sessions.list').pipe(
      map((list) => {
        const session = (list ?? []).find((s: any) => s.name === sessionName);
        return session?.sub_agents ?? [];
      }),
      catchError(() => of([])),
    );
  }

  /**
   * Archived sub-agents of every session, newest first.
   * Used by the Resume Sub-Agent modal.
   */
  listSubAgentArchive(): Observable<any[]> {
    return call$<any[]>(this.data, 'sessions.archive').pipe(
      map((archive) => archive ?? []),
      catchError(() => of([])),
    );
  }

  /**
   * Removes one archived sub-agent, identified by archive_id, falling back
   * to claude_session_id, then title + archived_at.
   */
  clearSubAgentArchiveEntry(criteria: {
    archive_id?: string;
    claude_session_id?: string;
    title?: string;
    archived_at?: string;
  }): Observable<boolean> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(criteria)) {
      if (value != null) params[key] = value;
    }
    return call$(this.data, 'sessions.removeArchived', params).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /** Saves the custom display order of a session's active sub-agents. */
  updateSubAgentsOrder(sessionId: string, order: string[]): Observable<void> {
    return call$(this.data, 'sessions.setSubAgentsOrder', { id: sessionId, order }).pipe(map(() => undefined));
  }

  private toSummary(dto: DesktopSessionDto): SessionSummary {
    // Determine workspace binding: prefer device_workspace local_path over legacy workspace_path
    const localPath = dto.device_workspace?.local_path ?? dto.workspace_path;
    const workspaceBinding = localPath
      ? { path: localPath, name: dto.workspace_name ?? localPath.split(/[\\/]/).filter(Boolean).pop() ?? '' }
      : undefined;

    // Build device workspace info
    let deviceWorkspace: DeviceWorkspaceInfo | null = null;
    if (dto.device_workspace) {
      deviceWorkspace = {
        id: dto.device_workspace.id,
        localPath: dto.device_workspace.local_path,
        status: 'configured', // path validation happens on the desktop side
        updatedAt: dto.device_workspace.updated_at,
      };
    } else if (dto.workspace_path) {
      // Legacy session with workspace_path but no device_workspace yet
      // Treat as configured (backward compat — will be migrated)
      deviceWorkspace = {
        id: '',
        localPath: dto.workspace_path,
        status: 'configured',
        updatedAt: dto.updated_at,
      };
    }

    return {
      id: dto.id,
      name: dto.name,
      provider: dto.provider as ProviderType,
      status: 'idle',
      workspace: workspaceBinding,
      createdAt: dto.created_at,
      pendingInteractionCount: 0,
      workspaceId: dto.workspace_id ?? null,
      categoryId: dto.category_id ?? null,
      teamId: dto.team_id ?? null,
      teamName: dto.team?.name ?? null,
      projectId: dto.project_id ?? null,
      projectName: dto.project?.name ?? null,
      repoUrl: dto.repo_url ?? null,
      repoBranch: dto.repo_branch ?? null,
      deviceWorkspace,
      viewState: dto.view_state ?? undefined,
      subAgentsOrder: dto.sub_agents_order ?? null,
      // status stays 'idle' here (the store does not track live runtime state);
      // standby is carried independently so it survives polling/merge.
      standbyAt: dto.standby_at ?? null,
    };
  }
}
