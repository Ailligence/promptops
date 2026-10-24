import { createAction, props } from '@ngrx/store';
import { WorkspaceSummary } from './workspace.state';

// Workspace lifecycle
export const loadWorkspaces = createAction('[Workspaces] Load Workspaces');
export const loadWorkspacesSuccess = createAction(
  '[Workspaces] Load Workspaces Success',
  props<{ workspaces: WorkspaceSummary[] }>(),
);
export const loadWorkspacesFailure = createAction(
  '[Workspaces] Load Workspaces Failure',
  props<{ error: string }>(),
);

export const createWorkspace = createAction(
  '[Workspaces] Create Workspace',
  props<{ name: string; projectPath: string }>(),
);
export const createWorkspaceSuccess = createAction(
  '[Workspaces] Create Workspace Success',
  props<{ workspace: WorkspaceSummary }>(),
);
export const createWorkspaceFailure = createAction(
  '[Workspaces] Create Workspace Failure',
  props<{ error: string }>(),
);

// Insert-or-replace without touching activeWorkspaceId — used when a
// workspace materializes as a side effect (e.g. promote session → workspace).
export const upsertWorkspace = createAction(
  '[Workspaces] Upsert Workspace',
  props<{ workspace: WorkspaceSummary }>(),
);

export const setActiveWorkspace = createAction(
  '[Workspaces] Set Active Workspace',
  props<{ workspaceId: string | null }>(),
);

export const updateWorkspace = createAction(
  '[Workspaces] Update Workspace',
  props<{ workspaceId: string; name: string }>(),
);
export const updateWorkspaceSuccess = createAction(
  '[Workspaces] Update Workspace Success',
  props<{ workspace: WorkspaceSummary }>(),
);

export const deleteWorkspace = createAction(
  '[Workspaces] Delete Workspace',
  props<{ workspaceId: string }>(),
);
export const deleteWorkspaceSuccess = createAction(
  '[Workspaces] Delete Workspace Success',
  props<{ workspaceId: string }>(),
);

export const incrementSessionCount = createAction(
  '[Workspaces] Increment Session Count',
  props<{ workspaceId: string }>(),
);
export const decrementSessionCount = createAction(
  '[Workspaces] Decrement Session Count',
  props<{ workspaceId: string }>(),
);
