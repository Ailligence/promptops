import { Injectable } from '@angular/core';
import { SessionSummary } from '../../../../../store/sessions/session.state';

/** localStorage key prefix for the per-session parked sub-agent stash. */
const PARKED_SUB_AGENTS_KEY_PREFIX = 'promptops_parked_subagents_';

/** Envelopes older than this are garbage-collected at init. */
const STASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Slim resumable sub-agent entry as pushed by the native desktop process
 * (the native side is the authority; the renderer only persists and hands the
 * data back verbatim).
 */
export interface ParkedSubAgentEntry {
  model?: string;
  effort?: string;
  executionMode?: 'interactive' | 'worker';
  role: string;
  title: string;
  prompt: string;
  userPrompt?: string;
  icon: string;
  mode?: string;
  config?: Record<string, unknown>;
  provider?: string;
  claudeSessionId?: string;
  sessionId?: string;
  workspacePath?: string;
  status: 'active';
}

interface ParkedStashEnvelope {
  v: 1;
  dbId: string | null;
  /** Local session id of the run that wrote it — ownership proof for never-synced sessions. */
  sessionId?: string | null;
  sessionName: string;
  savedAt: string;
  /** true = park-time snapshot (authoritative freeze), false = live mirror. */
  frozen: boolean;
  subAgents: ParkedSubAgentEntry[];
}

/** Payload of the `subagent:stash-updated` push. */
interface StashUpdatePayload {
  sessionId: string;
  dbId: string | null;
  sessionName: string;
  frozen: boolean;
  subAgents: ParkedSubAgentEntry[];
}

/** Minimal slice of a session needed to locate its stash. */
type SessionKeySource = Pick<SessionSummary, 'id' | 'name' | 'dbId'>;

/**
 * Persists each session's resumable sub-agents in localStorage so they survive
 * app restarts WITHOUT any local store write (the `sub_agents` DB column stays
 * archived-only). Main pushes slim snapshots (live mirror + a frozen one at
 * park time); on wake the stash rides the wakeSession IPC payload, and for
 * hot/restored sessions it is handed back via restoreSubAgentStash.
 *
 * Keys use the stored id (stable across restarts and renames) with the
 * session name as fallback for never-synced sessions. The NAME IS NOT AN
 * IDENTITY though: restores only accept an envelope that proves ownership
 * (same ULID, or same local session id within the run that wrote it) — a
 * deleted session's stash must never be inherited by a new session that
 * happens to reuse its name, or its sub-agents get cloned into the newcomer.
 */
@Injectable({ providedIn: 'root' })
export class SubAgentStashService {
  private get api(): any {
    return (window as any).promptops;
  }

  private get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  private initialized = false;
  private unsubStash?: () => void;

  /** Subscribe to main's stash pushes and GC stale envelopes. Idempotent. */
  init(): void {
    if (this.initialized || !this.isDesktop || !this.api.onSubAgentStashUpdated) return;
    this.initialized = true;
    this.unsubStash = this.api.onSubAgentStashUpdated(
      (_event: unknown, payload: StashUpdatePayload) => this.write(payload),
    );
    this.gc();
  }

  destroy(): void {
    this.unsubStash?.();
    this.unsubStash = undefined;
    this.initialized = false;
  }

  /** Persist a snapshot pushed by main. */
  private write(payload: StashUpdatePayload): void {
    if (!payload || (!payload.dbId && !payload.sessionName)) return;
    const key = PARKED_SUB_AGENTS_KEY_PREFIX + (payload.dbId ?? payload.sessionName);
    try {
      // Once the dbId is known, retire the name-keyed envelope of the same
      // session so reads never resurrect a stale copy — but only OUR copy: a
      // never-synced session sharing the name must keep its own.
      if (payload.dbId && payload.sessionName) {
        const nameKey = PARKED_SUB_AGENTS_KEY_PREFIX + payload.sessionName;
        const stale = this.parse(localStorage.getItem(nameKey));
        if (stale && (!stale.sessionId || stale.sessionId === payload.sessionId)) {
          localStorage.removeItem(nameKey);
        }
      }
      const subAgents = Array.isArray(payload.subAgents) ? payload.subAgents : [];
      if (subAgents.length === 0 && !payload.frozen) {
        // Live mirror emptied (last sub-agent closed by the user) — no stash.
        localStorage.removeItem(key);
        return;
      }
      const envelope: ParkedStashEnvelope = {
        v: 1,
        dbId: payload.dbId ?? null,
        sessionId: payload.sessionId ?? null,
        sessionName: payload.sessionName,
        savedAt: new Date().toISOString(),
        frozen: payload.frozen,
        subAgents,
      };
      localStorage.setItem(key, JSON.stringify(envelope));
    } catch {
      /* localStorage full/unavailable — non-fatal, wake degrades gracefully */
    }
  }

  /**
   * Stash for a session, or [] when none/corrupt (fresh machine, cleared
   * storage): the wake then simply proceeds without sub-agents.
   */
  read(session: SessionKeySource): ParkedSubAgentEntry[] {
    const envelope = this.readEnvelope(session);
    return envelope?.subAgents ?? [];
  }

  /** Drop a session's stash (deliberate close must not resurrect anything). */
  remove(session: SessionKeySource): void {
    try {
      // Only envelopes of THIS session (or legacy ones with no owner): a
      // close must not wipe the parked roster of another session that has
      // the same name.
      for (const key of this.candidateKeys(session)) {
        const envelope = this.parse(localStorage.getItem(key));
        if (!envelope || this.mayTouch(session, envelope)) localStorage.removeItem(key);
      }
      const byName = this.scanByName(session.name, session);
      if (byName) localStorage.removeItem(byName.key);
    } catch { /* non-fatal */ }
  }

  /**
   * Surgically drop ONE sub-agent from a session's stash, synchronously.
   * Deliberately closing a sub-agent must never resurrect it: main's mirror
   * push is debounced (500ms), and a sessions reload landing inside that
   * window would hand the stale stash back to main for a respawn.
   * Matches by the sub-agent's own sessionId (strong, same-run) with a
   * role+title fallback (cross-run, same convention as the spawn dedupe).
   */
  removeEntry(session: SessionKeySource, identity: { sessionId?: string; role: string; title: string }): void {
    try {
      const located = this.locate(session);
      if (!located) return;
      // The sub-agent's own id decides when both sides have one: two agents
      // with the same role and title must not both disappear.
      const matches = (e: ParkedSubAgentEntry): boolean =>
        identity.sessionId && e.sessionId
          ? e.sessionId === identity.sessionId
          : e.role === identity.role && e.title === identity.title;
      const remaining = located.envelope.subAgents.filter((e) => !matches(e));
      if (remaining.length === located.envelope.subAgents.length) return;
      if (remaining.length === 0) {
        localStorage.removeItem(located.key);
        return;
      }
      const envelope: ParkedStashEnvelope = {
        ...located.envelope,
        savedAt: new Date().toISOString(),
        subAgents: remaining,
      };
      localStorage.setItem(located.key, JSON.stringify(envelope));
    } catch { /* non-fatal — main's immediate push repairs the mirror */ }
  }

  /**
   * Hand stashes back to main for sessions restored HOT (lazy-boot active
   * session, profile switch): their sub-agents died with the previous run but
   * no wake will ever fire for them. Parked sessions are skipped — their stash
   * rides the wakeSession payload, which is race-free. Safe to call on every
   * sessions load: main's guards make it idempotent.
   */
  seedRestore(sessions: SessionSummary[]): void {
    if (!this.isDesktop || !this.api.restoreSubAgentStash) return;
    for (const session of sessions) {
      if (session.standbyAt || session.name?.startsWith('[sub]')) continue;
      const entries = this.read(session);
      if (entries.length === 0) continue;
      Promise.resolve(this.api.restoreSubAgentStash(session.id, entries)).catch(() => {});
    }
  }

  // ── internals ──────────────────────────────────────────────────────

  private candidateKeys(session: SessionKeySource): string[] {
    const keys: string[] = [];
    if (session.dbId) keys.push(PARKED_SUB_AGENTS_KEY_PREFIX + session.dbId);
    // Store-sourced summaries carry the ULID directly as `id`.
    if (session.id && session.id !== session.dbId) keys.push(PARKED_SUB_AGENTS_KEY_PREFIX + session.id);
    if (session.name) keys.push(PARKED_SUB_AGENTS_KEY_PREFIX + session.name);
    return keys;
  }

  /**
   * Restore-path lookup: only an envelope this session OWNS. Unlike `locate`
   * (used by the removal paths, deliberately liberal) a name match alone is
   * never enough — see `owns`.
   */
  private readEnvelope(session: SessionKeySource): ParkedStashEnvelope | null {
    try {
      for (const key of this.candidateKeys(session)) {
        const envelope = this.parse(localStorage.getItem(key));
        if (envelope && this.owns(session, envelope)) return envelope;
      }
      // dbId-keyed envelope written before this renderer knew the dbId:
      // still ours when it carries our local session id (same run).
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(PARKED_SUB_AGENTS_KEY_PREFIX)) continue;
        const envelope = this.parse(localStorage.getItem(key));
        if (envelope && this.owns(session, envelope)) return envelope;
      }
    } catch { /* non-fatal */ }
    return null;
  }

  /**
   * Ownership proof: the stored id (cross-run, survives renames) or the
   * local id of the session that wrote the envelope (never-synced session,
   * same run). A new session can hold neither of a deleted one, so a reused
   * name can no longer pull the old roster in.
   */
  private owns(session: SessionKeySource, envelope: ParkedStashEnvelope): boolean {
    if (envelope.dbId && (envelope.dbId === session.dbId || envelope.dbId === session.id)) return true;
    return !!envelope.sessionId && envelope.sessionId === session.id;
  }

  /**
   * Removal paths may touch an envelope this session owns, or a legacy one
   * that carries no owner at all; never one owned by another session.
   */
  private mayTouch(session: SessionKeySource, envelope: ParkedStashEnvelope): boolean {
    return this.owns(session, envelope) || (!envelope.dbId && !envelope.sessionId);
  }

  /** Find a session's envelope together with the key it lives under. */
  private locate(session: SessionKeySource): { key: string; envelope: ParkedStashEnvelope } | null {
    try {
      for (const key of this.candidateKeys(session)) {
        const envelope = this.parse(localStorage.getItem(key));
        if (envelope && this.mayTouch(session, envelope)) return { key, envelope };
      }
      // Last resort: dbId-keyed envelope written before this renderer knew the
      // dbId (or vice versa) — match on the session name snapshot inside.
      return this.scanByName(session.name, session);
    } catch {
      return null;
    }
  }

  private scanByName(sessionName: string | undefined, session: SessionKeySource): { key: string; envelope: ParkedStashEnvelope } | null {
    if (!sessionName) return null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(PARKED_SUB_AGENTS_KEY_PREFIX)) continue;
        const envelope = this.parse(localStorage.getItem(key));
        if (envelope?.sessionName === sessionName && this.mayTouch(session, envelope)) return { key, envelope };
      }
    } catch { /* non-fatal */ }
    return null;
  }

  private parse(raw: string | null): ParkedStashEnvelope | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.subAgents)) return null;
      return parsed as ParkedStashEnvelope;
    } catch {
      return null;
    }
  }

  /** Drop envelopes older than 30 days (sessions long gone). */
  private gc(): void {
    try {
      const cutoff = Date.now() - STASH_MAX_AGE_MS;
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(PARKED_SUB_AGENTS_KEY_PREFIX)) continue;
        const envelope = this.parse(localStorage.getItem(key));
        if (!envelope || new Date(envelope.savedAt).getTime() < cutoff) stale.push(key);
      }
      for (const key of stale) localStorage.removeItem(key);
    } catch { /* non-fatal */ }
  }
}
