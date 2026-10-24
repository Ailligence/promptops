import type { ActionReducerMap } from '@ngrx/store'
import { layoutReducer, type LayoutState } from './layout/layout-reducers'
import {
  authenticationReducer,
  type AuthenticationState,
} from './authentication/authentication.reducer'
import { sessionsReducer } from './sessions/session.reducer'
import { type SessionsState } from './sessions/session.state'
import { workspacesReducer } from './workspaces/workspace.reducer'
import { type WorkspacesState } from './workspaces/workspace.state'
import { tokenEfficiencyReducer } from './token-efficiency/token-efficiency.reducer'
import { type TokenEfficiencyState } from './token-efficiency/token-efficiency.state'

export interface RootReducerState {
  authentication: AuthenticationState
  layout: LayoutState
  sessions: SessionsState
  workspaces: WorkspacesState
  tokenEfficiency: TokenEfficiencyState
}

export const rootReducer: ActionReducerMap<RootReducerState> = {
  authentication: authenticationReducer,
  layout: layoutReducer,
  sessions: sessionsReducer,
  workspaces: workspacesReducer,
  tokenEfficiency: tokenEfficiencyReducer,
}
