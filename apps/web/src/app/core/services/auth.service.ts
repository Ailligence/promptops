import { inject, Injectable } from "@angular/core";
import type { Observable } from "rxjs";
import { DataBackend, call$ } from "@core/data/data-backend";

/**
 * The local profile. This edition has no accounts: there is no sign-in,
 * registration or sign-out, and the profile lives on this device
 * (see core/local-mode.ts).
 */
@Injectable({ providedIn: "root" })
export class AuthenticationService {
  private data = inject(DataBackend);

  /** Always true once main.ts has stored the local placeholder token. */
  isAuthenticated(): boolean {
    const token = localStorage.getItem("token");
    return !!token && token !== "undefined";
  }

  /** The local profile: display name, UI preferences, onboarding state. */
  me(): Observable<any> {
    return call$<any>(this.data, "user.me");
  }

  completeOnboarding(interest: 'sessions' | 'prompts' | 'teams' | 'explore' | null): Observable<any> {
    return call$<any>(this.data, "user.completeOnboarding", { interest });
  }

  setPreferredProvider(provider: string | null): Observable<any> {
    return call$<any>(this.data, "user.setPreferredProvider", { provider });
  }
}
