import { createReducer, on } from '@ngrx/store';
import { hydratedWorkspacesState, WorkspacesState } from './workspace.state';
import {
  loadWorkspaces,
  loadWorkspacesSuccess,
  loadWorkspacesFailure,
  createWorkspaceSuccess,
  createWorkspaceFailure,
  upsertWorkspace,
  setActiveWorkspace,
  updateWorkspaceSuccess,
  deleteWorkspaceSuccess,
  incrementSessionCount,
  decrementSessionCount,
} from './workspace.actions';

export const workspacesReducer = createReducer(
  hydratedWorkspacesState,

  on(loadWorkspaces, (state): WorkspacesState => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(loadWorkspacesSuccess, (state, { workspaces }): WorkspacesState => ({
    ...state,
    workspaces,
    loading: false,
  })),

  on(loadWorkspacesFailure, (state, { error }): WorkspacesState => ({
    ...state,
    loading: false,
    error,
  })),

  on(createWorkspaceSuccess, (state, { workspace }): WorkspacesState => ({
    ...state,
    workspaces: [...state.workspaces, workspace],
    activeWorkspaceId: workspace.id,
  })),

  on(createWorkspaceFailure, (state, { error }): WorkspacesState => ({
    ...state,
    error,
  })),

  on(upsertWorkspace, (state, { workspace }): WorkspacesState => ({
    ...state,
    workspaces: state.workspaces.some((w) => w.id === workspace.id)
      ? state.workspaces.map((w) => (w.id === workspace.id ? { ...w, ...workspace } : w))
      : [...state.workspaces, workspace],
  })),

  on(setActiveWorkspace, (state, { workspaceId }): WorkspacesState => ({
    ...state,
    activeWorkspaceId: workspaceId,
  })),

  on(updateWorkspaceSuccess, (state, { workspace }): WorkspacesState => ({
    ...state,
    workspaces: state.workspaces.map((w) =>
      w.id === workspace.id ? { ...w, ...workspace } : w,
    ),
  })),

  on(deleteWorkspaceSuccess, (state, { workspaceId }): WorkspacesState => ({
    ...state,
    workspaces: state.workspaces.filter((w) => w.id !== workspaceId),
    activeWorkspaceId: state.activeWorkspaceId === workspaceId ? null : state.activeWorkspaceId,
  })),

  on(incrementSessionCount, (state, { workspaceId }): WorkspacesState => ({
    ...state,
    workspaces: state.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, activeSessionsCount: w.activeSessionsCount + 1 } : w,
    ),
  })),

  on(decrementSessionCount, (state, { workspaceId }): WorkspacesState => ({
    ...state,
    workspaces: state.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, activeSessionsCount: Math.max(0, w.activeSessionsCount - 1) } : w,
    ),
  })),
);
