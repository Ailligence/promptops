import { SessionSummary } from '@/store/sessions/session.state';

/** localStorage key prefix of a session's persisted bench (role|title identities). */
export const BENCHED_SUB_AGENTS_KEY_PREFIX = 'promptops_benched_subagents_';
/** localStorage key prefix of a session's locked agents (same role|title identities). */
export const LOCKED_SUB_AGENTS_KEY_PREFIX = 'promptops_locked_subagents_';

/**
 * Wipe a session's persisted bench (deliberate close). Pure helper, no DI, so
 * the store effects can call it without pulling in the whole SubAgentService.
 * The name key is legacy-only (benches are no longer written by name — a new
 * session reusing the name must not inherit it) and is removed for hygiene.
 */
export function purgeBenchStorage(session: Pick<SessionSummary, 'id' | 'dbId' | 'name'>): void {
  try {
    for (const id of [session.dbId, session.id, session.name]) {
      if (id) localStorage.removeItem(BENCHED_SUB_AGENTS_KEY_PREFIX + id);
    }
  } catch { /* non-fatal */ }
}

/** Wipe a session's persisted locks (deliberate close): same hygiene as the bench. */
export function purgeLockStorage(session: Pick<SessionSummary, 'id' | 'dbId'>): void {
  try {
    for (const id of [session.dbId, session.id]) {
      if (id) localStorage.removeItem(LOCKED_SUB_AGENTS_KEY_PREFIX + id);
    }
  } catch { /* non-fatal */ }
}
