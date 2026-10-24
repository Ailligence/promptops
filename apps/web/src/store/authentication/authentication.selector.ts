import { createFeatureSelector, createSelector } from "@ngrx/store";
import { AuthenticationState } from "./authentication.reducer";

export const getUserState =
  createFeatureSelector<AuthenticationState>("authentication");

export const getUser = createSelector(
  getUserState,
  (state: AuthenticationState) => state.user
);
