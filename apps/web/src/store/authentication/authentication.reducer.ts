import { createReducer, on } from "@ngrx/store";
import { setCurrentUser } from "./authentication.actions";
import { User } from "@core/models/user";

/** The local profile. There is no sign-in: the app always runs as you. */
export type AuthenticationState = {
  user: User | null;
};

const initialState: AuthenticationState = {
  user: null,
};

export const authenticationReducer = createReducer(
  initialState,
  on(setCurrentUser, (state, { user }) => {
    try {
      localStorage.setItem("user", JSON.stringify(user));
    } catch {
      // Storage full or blocked: the profile still applies for this run.
    }
    return { ...state, user };
  })
);
