import { inject, Injectable } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { EMPTY, catchError, exhaustMap, map } from "rxjs";
import { me, setCurrentUser } from "./authentication.actions";
import { AuthenticationService } from "@core/services/auth.service";

@Injectable()
export class AuthenticationEffects {
  private actions$ = inject(Actions);
  private authService = inject(AuthenticationService);

  /** Reloads the local profile (name, UI preferences, onboarding state). */
  me$ = createEffect(() =>
    this.actions$.pipe(
      ofType(me),
      exhaustMap(() =>
        this.authService.me().pipe(
          map((user) => setCurrentUser({ user })),
          catchError(() => EMPTY)
        )
      )
    )
  );
}
