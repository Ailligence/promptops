import { createFeatureSelector, createSelector } from '@ngrx/store';
import { SessionsState } from './session.state';

export const getSessionsState = createFeatureSelector<SessionsState>('sessions');

export const getSessions = createSelector(
  getSessionsState,
  (state) => state.sessions,
);

export const getActiveSessionId = createSelector(
  getSessionsState,
  (state) => state.activeSessionId,
);

export const getActiveSession = createSelector(
  getSessionsState,
  (state) => state.sessions.find((s) => s.id === state.activeSessionId) ?? null,
);

export const getActiveSessionInteractions = createSelector(
  getSessionsState,
  (state) => {
    if (!state.activeSessionId) return [];
    return state.pendingInteractions[state.activeSessionId] ?? [];
  },
);

export const getAllPendingInteractionsCount = createSelector(
  getSessionsState,
  (state) => state.sessions.reduce((sum, s) => sum + s.pendingInteractionCount, 0),
);

export const getProfiles = createSelector(
  getSessionsState,
  (state) => state.profiles,
);

export const getSessionsLoading = createSelector(
  getSessionsState,
  (state) => state.loading,
);

export const getSessionsHasLoadedOnce = createSelector(
  getSessionsState,
  (state) => state.hasLoadedOnce,
);

export const getSessionsListLoadFailed = createSelector(
  getSessionsState,
  (state) => state.listLoadFailed,
);

export const getSessionsError = createSelector(
  getSessionsState,
  (state) => state.error,
);

export const getWaitingInputSessionsCount = createSelector(
  getSessionsState,
  (state) => state.sessions.filter((s) => s.status === 'waiting_input' || s.pendingInteractionCount > 0).length,
);

export const getSessionsByWorkspaceId = (workspaceId: string) =>
  createSelector(
    getSessionsState,
    (state) => state.sessions.filter((s) => s.workspaceId === workspaceId),
  );

// Sessions that are not bound to any workspace (workspace_id IS NULL).
// Global counterpart of the per-component `standaloneSessions()` computed in
// session-sidebar.component — exposed at store level so effects and guards
// can reason about standalone-only sessions consistently.
export const getStandaloneSessions = createSelector(
  getSessionsState,
  (state) => state.sessions.filter((s) => !s.workspaceId),
);
