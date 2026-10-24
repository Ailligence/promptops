import { OrgPolicyService } from '@core/services/org-policy.service';
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { updateSessionSuccess } from '../../../../../store/sessions/session.actions';
import { SessionSummary, ProviderType } from '../../../../../store/sessions/session.state';
import { DesktopSessionApiService } from './desktop-session-api.service';
import { SessionService } from './session.service';

export type ProviderSwitchResult =
  | { ok: true }
  | { ok: false; reason: 'cli-missing' | 'save-failed' | 'policy-denied' };

/**
 * Guarded provider switch for an existing session, shared by the composer
 * provider chip and the install-guide escape hatch. A session whose provider
 * CLI is missing on this device gets locked behind the full-space install
 * guide, so the switch must never land on an unavailable provider without
 * the user having a way back.
 */
@Injectable({ providedIn: 'root' })
export class ProviderSwitchService {
  private orgPolicy = inject(OrgPolicyService);
  private store = inject(Store);
  private api = inject(DesktopSessionApiService);
  private sessionService = inject(SessionService);

  /**
   * Is the provider's CLI usable on THIS device?
   * - pure web (no IPC): true — the check cannot run, and the install guide
   *   never renders outside the desktop app either
   * - generic-shell: always true
   * - IPC failure: true (fail-open, mirrors session-view's runProviderCheck)
   *   unless `strict`: the switch picker must never label as INSTALLED a
   *   provider it could not verify.
   */
  async isProviderAvailable(provider: ProviderType, sessionId?: string, strict = false): Promise<boolean> {
    if (provider === 'generic-shell') return true;
    if (!this.sessionService.isDesktop) return !strict;
    // Positive results are memoized (same TTL as the native cache) so a
    // repeat pick never waits on an IPC round-trip; negatives always re-probe
    // so an "I've installed it" retry isn't stuck behind a stale miss.
    // sessionId: on Windows a WSL / Git Bash session probes the CLI inside
    // its own shell, so availability is per session there (a CLI present in
    // the distro is absent on the host and vice versa).
    const key = sessionId ? `${provider}@${sessionId}` : provider;
    const hit = this.availability.get(key);
    if (hit && Date.now() - hit < ProviderSwitchService.AVAILABILITY_TTL_MS) return true;
    try {
      let result = await this.sessionService.checkProvider(provider, false, sessionId);
      if (!result.installed) {
        // The native probe caches negatives for 5 min too: a CLI installed
        // (or re-linked) after a miss would keep failing the pick. Re-probe
        // once with force before reporting the miss.
        result = await this.sessionService.checkProvider(provider, true, sessionId);
      }
      if (result.installed) this.availability.set(key, Date.now());
      else this.lastMiss = { ...result, at: Date.now() };
      return result.installed;
    } catch {
      return !strict;
    }
  }
  /** Last negative probe (diagnostics for a reverted composer pick). */
  lastMiss: { installed: boolean; platform: string; command: string; provider: string; at: number } | null = null;
  private static readonly AVAILABILITY_TTL_MS = 5 * 60_000;
  private readonly availability = new Map<string, number>();

  /**
   * Guarded, optimistic provider switch for an existing session.
   * Data-only: the running PTY (if any) keeps its current provider until the
   * next spawn/wake — same semantics the composer chip always had.
   */
  async changeSessionProvider(session: SessionSummary, next: ProviderType): Promise<ProviderSwitchResult> {
    if (session.provider === next) return { ok: true };
    // Organization policy (Enterprise): a disallowed provider is never launched.
    if (!this.orgPolicy.isProviderAllowed(next)) return { ok: false, reason: 'policy-denied' };
    if (!(await this.isProviderAvailable(next, session.id))) return { ok: false, reason: 'cli-missing' };

    const prev = session.provider;
    this.store.dispatch(updateSessionSuccess({ session: { ...session, provider: next } }));
    // update() swallows HTTP errors to null — null IS the failure signal.
    // silent:true because the caller owns the failure UX (rollback + toast);
    // non-silent would double-report through the global error modal.
    // _lookup_name: live desktop sessions carry the LOCAL id in the store,
    // not the stored id, so a by-id PUT 404s. The local store falls back to
    // the per-user-unique name — same mechanism rename() relies on.
    const saved = await firstValueFrom(
      this.api.update(session.id, { provider: next, _lookup_name: session.name }, { silent: true }),
    );
    if (!saved) {
      // Roll back to the value the local store still holds. The one asymmetric
      // case (PUT applied in the local store but response unparseable) reconciles
      // on the next session sync from the local store.
      this.store.dispatch(updateSessionSuccess({ session: { ...session, provider: prev } }));
      return { ok: false, reason: 'save-failed' };
    }
    return { ok: true };
  }
}
