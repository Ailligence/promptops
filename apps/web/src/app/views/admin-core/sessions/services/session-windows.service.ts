import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { getSessions } from '@/store/sessions/session.selectors';
import { loadSessionsSuccess, wakeSession } from '@/store/sessions/session.actions';
import { SessionSummary } from '@/store/sessions/session.state';
import { SubAgent, SubAgentService } from './sub-agent.service';
import { closeSessionWindow, isDetachedWindow, openSessionWindow, tauri } from '@/app/detached/detached-window';

/** What the main window sends to a session's dedicated window. */
export interface SessionWindowState { sessionId: string; session: SessionSummary | null; subAgents: SubAgent[]; sessions: SessionSummary[] }
/** What the dedicated window asks of the main window (which remains the only one that starts or resumes agents). */
export type SessionWindowAction = { type: 'hello'; sessionId: string } | { type: 'wake'; sessionId: string };

/**
 * Main window: sessions opened in their own dedicated window (a child of the main window).
 * While a session is there, the main window shows "open in a dedicated window" instead of the
 * terminals: terminals are never visible in two places, so there is no fight over the PTY
 * size. When the window closes the session comes back here as before.
 */
@Injectable({ providedIn: 'root' })
export class SessionWindowsService {
  private store = inject(Store);
  private subAgents = inject(SubAgentService);
  private sessions = toSignal(this.store.select(getSessions), { initialValue: [] as SessionSummary[] });
  private started = false;

  /** Ids of the sessions open in a dedicated window. */
  readonly detached = signal<ReadonlySet<string>>(new Set());
  readonly hasAny = computed(() => this.detached().size > 0);

  constructor() {
    // On every change (state, sub-agents) the dedicated windows receive their updated session.
    effect(() => {
      const ids = this.detached();
      if (!ids.size) return;
      const sessions = this.sessions() ?? [];
      const subs = this.subAgents.allSubAgents();
      untracked(() => {
        for (const id of ids) this.send(id, sessions, subs);
      });
    });
  }

  isDetached(sessionId: string | null | undefined): boolean {
    return !!sessionId && this.detached().has(sessionId);
  }

  /** Tauri main window only. Idempotent. */
  async init(): Promise<void> {
    const t = tauri();
    if (!t || this.started || isDetachedWindow()) return;
    this.started = true;
    await t.event.listen<{ label?: string }>('detached:closed', (e) => {
      const label = String(e.payload?.label ?? '');
      if (label.startsWith('detached-session-')) this.mark(label.slice('detached-session-'.length), false);
    });
    await t.event.listen<SessionWindowAction>('session-window:action', (e) => this.onAction(e.payload));
  }

  /** Opens (or brings to front) the session's dedicated window. */
  async open(session: Pick<SessionSummary, 'id' | 'name'>): Promise<void> {
    await this.init();
    this.mark(session.id, true);
    try {
      await openSessionWindow(session.id, session.name);
    } catch {
      this.mark(session.id, false);
    }
  }

  /** Shows the already open window (same command: if it exists it brings it to front). */
  show(session: Pick<SessionSummary, 'id' | 'name'>): Promise<void> {
    return openSessionWindow(session.id, session.name);
  }

  /** Closes the window: on close (Rust event) the terminals come back here. */
  bringBack(sessionId: string): Promise<void> {
    return closeSessionWindow(sessionId);
  }

  private mark(id: string, on: boolean): void {
    const next = new Set(this.detached());
    if (on) next.add(id); else next.delete(id);
    this.detached.set(next);
  }

  private send(sessionId: string, sessions: SessionSummary[], subs: SubAgent[]): void {
    const state: SessionWindowState = {
      sessionId,
      session: sessions.find((s) => s.id === sessionId) ?? null,
      subAgents: subs.filter((a) => a.parentSessionId === sessionId),
      sessions,
    };
    void tauri()?.event.emit('session-window:state', state);
  }

  /**
   * Dedicated window side: the store receives the sessions from the main window on every change (states, standby),
   * because here the state channel is not registered (single slot, owned by the main window).
   */
  async attach(sessionId: string): Promise<() => void> {
    const t = tauri();
    if (!t) return () => undefined;
    const off = await t.event.listen<SessionWindowState>('session-window:state', (e) => {
      if (e.payload?.sessionId !== sessionId || !Array.isArray(e.payload.sessions)) return;
      this.store.dispatch(loadSessionsSuccess({ sessions: e.payload.sessions }));
    });
    void t.event.emit('session-window:action', { type: 'hello', sessionId } satisfies SessionWindowAction);
    return off;
  }

  private onAction(a: SessionWindowAction): void {
    const id = typeof a?.sessionId === 'string' ? a.sessionId : '';
    if (!id || !(this.sessions() ?? []).some((s) => s.id === id)) return;
    switch (a.type) {
      case 'hello':
        // The window is ready (also after its own reload): it receives the session right away.
        this.mark(id, true);
        this.send(id, this.sessions() ?? [], this.subAgents.allSubAgents());
        break;
      case 'wake':
        // Only the main window resumes a session: its output channel stays here, the window receives a copy.
        this.store.dispatch(wakeSession({ sessionId: id }));
        break;
    }
  }
}
