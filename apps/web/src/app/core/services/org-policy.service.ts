import { Injectable, computed, signal } from "@angular/core";

export interface OrgPolicy {
  /** null = every provider allowed. */
  allowed_providers: string[] | null;
  auto_approve_allowed: boolean;
  /** all | builtin (no registry/local plugins) | none (no optional plugins at all) */
  plugins: "all" | "builtin" | "none";
}

/**
 * Organization-wide agent policy.
 *
 * This edition has no organization: unless a policy is passed to apply(),
 * every check passes and nothing is restricted.
 */
@Injectable({ providedIn: "root" })
export class OrgPolicyService {
  private _policy = signal<OrgPolicy | null>(null);
  private _organization = signal<string | null>(null);

  readonly policy = this._policy.asReadonly();
  readonly active = computed(() => this._policy() !== null);
  readonly autoApproveAllowed = computed(() => this._policy()?.auto_approve_allowed ?? true);

  /** Sets the policy, or clears it with null. Never called in this edition. */
  apply(policy: OrgPolicy | null, organizationName: string | null = null): void {
    this._policy.set(policy);
    this._organization.set(policy ? organizationName : null);
  }

  isProviderAllowed(provider: string | null | undefined): boolean {
    const list = this._policy()?.allowed_providers;
    return !list || !provider || list.includes(provider);
  }

  filterProviders<T>(items: ReadonlyArray<T>, idOf: (item: T) => string): T[] {
    return items.filter((i) => this.isProviderAllowed(idOf(i)));
  }

  /** Registry and locally linked plugins. */
  canInstallPlugins(): boolean {
    return (this._policy()?.plugins ?? "all") === "all";
  }

  /** Optional plugins shipped with the app. */
  canEnableBuiltinPlugins(): boolean {
    return (this._policy()?.plugins ?? "all") !== "none";
  }

  /** Error text used when the app refuses an action. */
  deniedMessage(what: string): string {
    const org = this._organization();
    return org ? `${what} is disabled by ${org}'s policy.` : `${what} is disabled by your organization's policy.`;
  }
}
