import { Action, createReducer, on } from '@ngrx/store'
import { localStorageSync } from 'ngrx-store-localstorage'
import {
  LAYOUT_COLOR_TYPES,
  MENU_COLOR_TYPES,
  SIDEBAR_SIZE_TYPES,
  TOPBAR_COLOR_TYPES,
  LAYOUT_MODE_TYPES,
  LAYOUT_TYPES,
} from './layout'
import * as appActions from './layout-action'
import {
  changemenucolor,
  changesidebarsize,
  changetheme,
  changetopbarcolor,
  changemode,
  changelayout
} from './layout-action'

export interface LayoutState {
  LAYOUT: string
  LAYOUT_THEME: string
  LAYOUT_MODE: string
  TOPBAR_COLOR: string
  MENU_COLOR: string
  MENU_SIZE: string
}

// IntialState
// Default theme is dark everywhere. On the desktop app the theme is also
// force-locked to dark at render time (see LayoutComponent).
export const initialState: LayoutState = {
  LAYOUT: LAYOUT_TYPES.VERTICAL,
  LAYOUT_THEME: LAYOUT_COLOR_TYPES.DARKMODE,
  LAYOUT_MODE: LAYOUT_MODE_TYPES.FLUIDMODE,
  TOPBAR_COLOR: TOPBAR_COLOR_TYPES.DARK,
  MENU_COLOR: MENU_COLOR_TYPES.DARK,
  MENU_SIZE: SIDEBAR_SIZE_TYPES.HOVER_ACTIVE,
}

// Reducer
export const layoutReducer = createReducer(
  initialState,
  on(changelayout, (state, action) => ({ ...state, LAYOUT: action.layout })),
  on(changetheme, (state, action) => ({
    ...state,
    LAYOUT_THEME: action.color,
  })),
  on(changemode, (state, action) => ({
    ...state,
    LAYOUT_MODE: action.mode,
  })),
  on(changetopbarcolor, (state, action) => ({
    ...state,
    TOPBAR_COLOR: action.topbar,
  })),
  on(changemenucolor, (state, action) => ({
    ...state,
    MENU_COLOR: action.menu,
  })),
  on(changesidebarsize, (state, action) => ({
    ...state,
    MENU_SIZE: action.size,
  })),
  on(appActions.resetState, () => initialState)
)

// Configuration for localStorageSync
export function localStorageSyncReducer(reducer: any) {
  return localStorageSync({ keys: ['layout'], rehydrate: true })(reducer)
}

// Selector
export function reducer(state: LayoutState | undefined, action: Action) {
  return layoutReducer(state, action)
}

export const rootReducer = localStorageSyncReducer(layoutReducer)

const metaReducers = [rootReducer]
