import { Injectable, signal } from "@angular/core";
import { Observable, Subject } from "rxjs";

@Injectable({ providedIn: "root" })
export class ConsentCheckService {
  requiresReacceptance = signal<boolean>(false);
  requiredConsents = signal<{ type: string; version: string }[]>([]);

  private readonly allConsentsAccepted = new Subject<void>();
  readonly allConsentsAccepted$: Observable<void> =
    this.allConsentsAccepted.asObservable();

  triggerReacceptance(
    consents: { type: string; version: string }[]
  ): void {
    this.requiredConsents.set(consents);
    this.requiresReacceptance.set(true);
  }

  notifyAllAccepted(): void {
    this.allConsentsAccepted.next();
  }

  reset(): void {
    this.requiresReacceptance.set(false);
    this.requiredConsents.set([]);
  }
}
