import { createAction, props } from "@ngrx/store";
import { User } from "@core/models/user";

/** Reload the local profile. */
export const me = createAction("[Authentication] Me");
export const setCurrentUser = createAction(
  "[USER] set current user",
  props<{ user: User }>()
);
