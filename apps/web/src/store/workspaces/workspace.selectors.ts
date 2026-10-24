import { createFeatureSelector, createSelector } from '@ngrx/store';
import { WorkspacesState } from './workspace.state';

export const getWorkspacesState = createFeatureSelector<WorkspacesState>('workspaces');

export const getWorkspaces = createSelector(
  getWorkspacesState,
  (state) => state.workspaces,
);

export const getActiveWorkspaceId = createSelector(
  getWorkspacesState,
  (state) => state.activeWorkspaceId,
);

export const getActiveWorkspace = createSelector(
  getWorkspacesState,
  (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null,
);

export const getWorkspacesLoading = createSelector(
  getWorkspacesState,
  (state) => state.loading,
);

export const getWorkspacesError = createSelector(
  getWorkspacesState,
  (state) => state.error,
);
