import { createFeatureSelector, createSelector } from '@ngrx/store'
import { LayoutState } from './layout-reducers'

export const getLayoutState = createFeatureSelector<LayoutState>('layout')

export const getLayout = createSelector(
  getLayoutState,
  (state: LayoutState) => state.LAYOUT
)

export const getLayoutColor = createSelector(
  getLayoutState,
  (state: LayoutState) => state.LAYOUT_THEME
)

export const getLayoutMode = createSelector(
  getLayoutState,
  (state: LayoutState) => state.LAYOUT_MODE
)

export const getTopbarcolor = createSelector(
  getLayoutState,
  (state: LayoutState) => state.TOPBAR_COLOR
)

export const getMenucolor = createSelector(
  getLayoutState,
  (state: LayoutState) => state.MENU_COLOR
)

export const getSidebarsize = createSelector(
  getLayoutState,
  (state: LayoutState) => state.MENU_SIZE
)
