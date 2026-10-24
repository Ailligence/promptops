import { Injector } from '@angular/core';
import { Observable, defer } from 'rxjs';
import { environment } from '@environment/environment';
import type { DataMethod } from './data-methods';
import { SessionProfilesService } from '@/app/views/admin-core/sessions/services/session-profiles.service';

/**
 * Why a data call failed. `code` is meant for code (`invalid`, `not_found`,
 * `conflict`, `session_name_taken`, `unknown_method`, `unavailable`,
 * `storage`, `internal`); `message` is a short sentence for people.
 */
export interface DataError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type DataParams = object;

/**
 * Where the app's data lives: sessions, workspaces, profiles, sidebar
 * folders, prompts, shortcuts, action slots, notes and the user profile.
 *
 * The app reads and writes data only through this interface. Services inject
 * the `DataBackend` token, never a concrete class; the app config registers
 * the implementation. Method names and their parameters are listed in
 * `DATA_METHODS` (data-methods.ts).
 */
export abstract class DataBackend {
  /** Runs `method` with `params`. Rejects with a {@link DataError}. */
  abstract call<T>(method: DataMethod, params?: DataParams): Promise<T>;
}

/** True when `err` is a {@link DataError}, optionally with the given code. */
export function isDataError(err: unknown, code?: string): err is DataError {
  const e = err as DataError | null;
  return !!e && typeof e === 'object' && typeof e.code === 'string' && (code === undefined || e.code === code);
}

/** {@link DataBackend.call} as a cold Observable. */
export function call$<T>(backend: DataBackend, method: DataMethod, params?: DataParams): Observable<T> {
  return defer(() => backend.call<T>(method, params));
}

/**
 * `params` plus the active session profile. Sessions, workspaces and sidebar
 * folders belong to a profile; without one they belong to the Standard
 * profile.
 */
export function withProfile(injector: Injector, params?: DataParams): DataParams {
  if (!environment.sessionProfiles) return { ...(params ?? {}) };
  // Resolved at call time: the profiles service itself reads data through DataBackend.
  const profileId = injector.get(SessionProfilesService).getActiveProfileIdSync();
  return profileId ? { ...(params ?? {}), profile_id: profileId } : { ...(params ?? {}) };
}

/** {@link call$} scoped to the active session profile (see {@link withProfile}). */
export function scoped$<T>(backend: DataBackend, injector: Injector, method: DataMethod, params?: DataParams): Observable<T> {
  return defer(() => backend.call<T>(method, withProfile(injector, params)));
}
