import { Injectable } from '@angular/core';
import { SessionSummary } from '@/store/sessions/session.state';

/** localStorage key prefix for the per-session TODO list. */
const TODOS_KEY_PREFIX = 'promptops_todos_';

/** Envelopes older than this (untouched) are garbage-collected at init. */
const TODOS_MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000; // 120 days

/**
 * A single TODO entry. `text` MAY be a full prompt the user wants to inject or
 * spawn later, so this NEVER goes to the local store — it lives only in
 * localStorage (mirrors the never-store-prompts guardrail).
 */
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

/**
 * Optional, LOCAL-only link from this session's TODO list to a team + project
 * board. Kept client-side so viewing/pushing to a board needs no session write.
 */
export interface TodoBoardLink {
  teamId: number;
  projectId: number;
  teamName?: string;
  projectName?: string;
}

interface TodoEnvelope {
  v: 1;
  key: string;
  /** Local id of the session that wrote it — ownership proof (a reused name is not). */
  sessionId?: string | null;
  sessionName: string;
  savedAt: string;
  items: TodoItem[];
  link?: TodoBoardLink | null;
}

/** Minimal slice of a session needed to locate its TODO list. */
type SessionKeySource = Pick<SessionSummary, 'id' | 'name' | 'dbId'>;

/**
 * Persists each session's TODO list in localStorage — NO local store write (TODO
 * text can be a full prompt). Keyed by the stored id (stable across restarts
 * and renames), falling back to the runtime id for never-synced sessions. Reads
 * only accept an envelope the session OWNS (same ULID/id, or written by this
 * very session) — the session name is never an identity, so a new session that
 * reuses a deleted one's name cannot inherit its list. Same identity strategy
 * as {@link SubAgentStashService}.
 */
@Injectable({ providedIn: 'root' })
export class TodoStoreService {
  constructor() {
    this.gc();
  }

  /** The full list for a session (empty when none/corrupt). */
  read(session: SessionKeySource): TodoItem[] {
    return this.locateOwned(session)?.envelope.items ?? [];
  }

  /** The locally-linked board for a session, if any. */
  readLink(session: SessionKeySource): TodoBoardLink | null {
    return this.locateOwned(session)?.envelope.link ?? null;
  }

  /** Drop a session's list (deliberate close). Legacy name key wiped too. */
  remove(session: SessionKeySource): void {
    try {
      for (const key of this.candidateKeys(session)) localStorage.removeItem(key);
      if (session.name) localStorage.removeItem(TODOS_KEY_PREFIX + session.name);
    } catch { /* non-fatal */ }
  }

  /** Overwrite the whole list for a session. Empties are still written so a
   *  cleared list stays cleared (does not resurrect from an old envelope). */
  save(session: SessionKeySource, items: TodoItem[]): void {
    this.persist(session, (env) => ({ ...env, items }));
  }

  /** Persist (or clear, with null) the local board link for a session. */
  saveLink(session: SessionKeySource, link: TodoBoardLink | null): void {
    this.persist(session, (env) => ({ ...env, link }));
  }

  // ── internals ──────────────────────────────────────────────────────

  private persist(session: SessionKeySource, mutate: (env: TodoEnvelope) => TodoEnvelope): void {
    try {
      const located = this.locateOwned(session);
      const base: TodoEnvelope = located?.envelope ?? {
        v: 1,
        key: this.primaryKey(session),
        sessionId: session.id ?? null,
        sessionName: session.name ?? '',
        savedAt: '',
        items: [],
        link: null,
      };
      const next: TodoEnvelope = {
        ...mutate(base),
        v: 1,
        key: this.primaryKey(session),
        sessionId: session.id ?? base.sessionId ?? null,
        sessionName: session.name ?? base.sessionName,
        savedAt: new Date().toISOString(),
      };
      // Once the ULID is known, retire any older key-variants for this session
      // so a later read never resurrects a stale copy.
      for (const key of this.candidateKeys(session)) {
        if (key !== next.key) localStorage.removeItem(key);
      }
      if (located && located.key !== next.key) localStorage.removeItem(located.key);
      localStorage.setItem(next.key, JSON.stringify(next));
    } catch {
      /* localStorage full/unavailable — non-fatal */
    }
  }

  /** Canonical write key: ULID > runtime id. */
  private primaryKey(session: SessionKeySource): string {
    return TODOS_KEY_PREFIX + (session.dbId ?? session.id ?? 'unknown');
  }

  private candidateKeys(session: SessionKeySource): string[] {
    const keys: string[] = [];
    if (session.dbId) keys.push(TODOS_KEY_PREFIX + session.dbId);
    if (session.id && session.id !== session.dbId) keys.push(TODOS_KEY_PREFIX + session.id);
    return keys;
  }

  /** First envelope under the session's keys that the session actually owns. */
  private locateOwned(session: SessionKeySource): { key: string; envelope: TodoEnvelope } | null {
    try {
      for (const key of this.candidateKeys(session)) {
        const envelope = this.parse(localStorage.getItem(key));
        if (envelope && this.owns(session, envelope)) return { key, envelope };
      }
    } catch {
      /* non-fatal */
    }
    return null;
  }

  /**
   * Ownership proof: written under the session's ULID/runtime id, or by this
   * very session (local id). A name-keyed legacy envelope never qualifies.
   */
  private owns(session: SessionKeySource, envelope: TodoEnvelope): boolean {
    if (session.dbId && envelope.key === TODOS_KEY_PREFIX + session.dbId) return true;
    if (session.id && envelope.key === TODOS_KEY_PREFIX + session.id) return true;
    return !!envelope.sessionId && envelope.sessionId === session.id;
  }

  private parse(raw: string | null): TodoEnvelope | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) return null;
      return parsed as TodoEnvelope;
    } catch {
      return null;
    }
  }

  /** Drop envelopes untouched for longer than the max age. */
  private gc(): void {
    try {
      const cutoff = Date.now() - TODOS_MAX_AGE_MS;
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(TODOS_KEY_PREFIX)) continue;
        const envelope = this.parse(localStorage.getItem(key));
        if (!envelope || new Date(envelope.savedAt).getTime() < cutoff) stale.push(key);
      }
      for (const key of stale) localStorage.removeItem(key);
    } catch {
      /* non-fatal */
    }
  }
}
