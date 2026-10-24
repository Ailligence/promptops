import { createAction, props } from '@ngrx/store';
import { SessionSummary, Interaction, AgentProfile, SessionStatus, LayoutMode, SessionViewState } from './session.state';

// Session lifecycle
export const loadSessions = createAction('[Sessions] Load Sessions');
export const loadSessionsSuccess = createAction(
  '[Sessions] Load Sessions Success',
  props<{ sessions: SessionSummary[] }>(),
);
export const loadSessionsFailure = createAction(
  '[Sessions] Load Sessions Failure',
  props<{ error: string }>(),
);

// `requestId`: echoed on the outcome so a caller that waits for its own
// session (intent, agent move) never takes another create's success or failure.
export const createSession = createAction(
  '[Sessions] Create Session',
  props<{ name?: string; provider: string; config?: Record<string, unknown>; categoryId?: number | null; teamId?: number | null; projectId?: number | null; workspaceId?: string | null; initialPrompt?: string | null; requestId?: string }>(),
);
export const createSessionSuccess = createAction(
  '[Sessions] Create Session Success',
  props<{ session: SessionSummary; requestId?: string }>(),
);
export const createSessionFailure = createAction(
  '[Sessions] Create Session Failure',
  props<{ error: string; requestId?: string; name?: string; code?: string }>(),
);

/** A fresh id for {@link createSession}'s `requestId`. */
export function newCreateSessionRequestId(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Same comparison the local store uses for session names (local_data.rs
 * name_key): trailing spaces ignored, case- and accent-insensitive.
 */
export function sessionNameKey(name: string): string {
  return name.replace(/ +$/, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export const destroySession = createAction(
  '[Sessions] Destroy Session',
  props<{ sessionId: string }>(),
);
export const destroySessionSuccess = createAction(
  '[Sessions] Destroy Session Success',
  props<{ sessionId: string }>(),
);

// Standby (park to save resources) / Wake (resume provider)
export const standbySession = createAction(
  '[Sessions] Standby Session',
  props<{ sessionId: string }>(),
);
export const wakeSession = createAction(
  '[Sessions] Wake Session',
  props<{ sessionId: string }>(),
);
export const standbyWorkspace = createAction(
  '[Sessions] Standby Workspace',
  props<{ workspaceId: string }>(),
);
export const wakeWorkspace = createAction(
  '[Sessions] Wake Workspace',
  props<{ workspaceId: string }>(),
);
/** Reducer-only: reflect a standby state change (from IPC push or effect). */
export const sessionStandbyChanged = createAction(
  '[Sessions] Standby Changed',
  props<{ sessionId: string; standbyAt: string | null }>(),
);
/**
 * [Tauri] The wake IPC resolved — the new PTY is live. This (not the
 * optimistic standbyAt flip) is the signal the view uses to re-attach the
 * terminal (fresh xterm + buffer replay at the right grid). No reducer.
 */
export const wakeSessionSuccess = createAction(
  '[Sessions] Wake Session Success',
  props<{ sessionId: string }>(),
);
/** [Tauri] The wake IPC rejected — spawn failed, Rust re-parked. No reducer. */
export const wakeSessionFailure = createAction(
  '[Sessions] Wake Session Failure',
  props<{ sessionId: string; error: string }>(),
);

export const setActiveSession = createAction(
  '[Sessions] Set Active Session',
  props<{ sessionId: string | null }>(),
);

/** Replace a saved (idle) session with a live one that has a terminal */
export const activateSavedSession = createAction(
  '[Sessions] Activate Saved Session',
  props<{ savedSessionId: string; liveSession: SessionSummary }>(),
);

export const updateSessionSuccess = createAction(
  '[Sessions] Update Session Success',
  props<{ session: SessionSummary }>(),
);

export const sessionStatusChanged = createAction(
  '[Sessions] Status Changed',
  props<{ sessionId: string; status: SessionStatus }>(),
);

// Interactions
export const interactionCreated = createAction(
  '[Sessions] Interaction Created',
  props<{ interaction: Interaction }>(),
);
export const interactionResolved = createAction(
  '[Sessions] Interaction Resolved',
  props<{ interactionId: string; sessionId: string }>(),
);

// Layout mode
export const setLayoutMode = createAction(
  '[Sessions] Set Layout Mode',
  props<{ sessionId: string; layoutMode: LayoutMode }>(),
);

// Per-session view state (size, lock, sub-agent view mode) — persisted to local store
export const updateSessionViewState = createAction(
  '[Sessions] Update Session View State',
  props<{ sessionId: string; viewState: SessionViewState }>(),
);

// Reorder
export const reorderSessions = createAction(
  '[Sessions] Reorder Sessions',
  props<{ sessionIds: string[] }>(),
);

// Workspace-first promote: move a standalone session into a workspace.
// Unidirectional — local store rejects mutations on already-bound sessions.
export const promoteSession = createAction(
  '[Sessions] Promote Session',
  props<{ sessionId: string; targetWorkspaceId: string }>(),
);
export const promoteSessionSuccess = createAction(
  '[Sessions] Promote Session Success',
  props<{ session: SessionSummary }>(),
);
export const promoteSessionFailure = createAction(
  '[Sessions] Promote Session Failure',
  props<{ error: string }>(),
);

// Combo: create-or-find a workspace by path, then promote the session.
export const promoteSessionToWorkspace = createAction(
  '[Sessions] Promote Session To Workspace',
  props<{
    sessionId: string;
    projectPath: string;
    workspaceName?: string;
  }>(),
);

// Profiles
export const loadProfiles = createAction('[Sessions] Load Profiles');
export const clearSessions = createAction('[Sessions] Clear Sessions');

export const loadProfilesSuccess = createAction(
  '[Sessions] Load Profiles Success',
  props<{ profiles: AgentProfile[] }>(),
);
