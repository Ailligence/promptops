import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { getSessions } from '@/store/sessions/session.selectors';
import { setActiveSession } from '@/store/sessions/session.actions';
import type { SessionSummary } from '@/store/sessions/session.state';
import type { AppNotification } from './app-notification.service';

/** Prefix of in-memory ids: never stored. */
export const AGENT_ACTIVITY_PREFIX = 'agent_';
const MAX_ITEMS = 30;
const WORKING = new Set(['in_progress', 'running']);
const OUTCOMES = new Set(['completed', 'error', 'exited']);

/**
 * Agent outcomes (finished, error, exited) in the in-app notification panel.
 * System notifications are not enough: with the window focused the system
 * suppresses them (UX audit 10/2026). Desktop app (Tauri) only, in memory only:
 * the shape is AppNotification's so the panel shows them without
 * special cases; ids have the `agent_` prefix and are never stored.
 */
@Injectable({ providedIn: 'root' })
export class AgentActivityNotificationService {
  private store = inject(Store);
  private router = inject(Router);
  private translate = inject(TranslateService);

  readonly items = signal<AppNotification[]>([]);
  readonly unreadCount = computed(() => this.items().filter((i) => !i.read_at).length);

  private started = false;
  private lastStatus = new Map<string, string>();

  start(): void {
    if (this.started || !(window as unknown as { __TAURI__?: unknown }).__TAURI__) return;
    this.started = true;
    this.store.select(getSessions).subscribe((sessions) => this.diff(sessions));
  }

  private diff(sessions: SessionSummary[]): void {
    const seen = new Set<string>();
    for (const s of sessions) {
      seen.add(s.id);
      const prev = this.lastStatus.get(s.id);
      this.lastStatus.set(s.id, s.status);
      if (!prev || prev === s.status || s.provider === 'generic-shell') continue;
      // Only the end of a job: an `idle → exited` at boot is not news.
      if (WORKING.has(prev) && OUTCOMES.has(s.status)) this.push(s);
      else if (s.status === 'error' && prev !== 'error') this.push(s);
    }
    for (const id of [...this.lastStatus.keys()]) if (!seen.has(id)) this.lastStatus.delete(id);
  }

  private push(s: SessionSummary): void {
    const key = s.status === 'completed' ? 'Finished' : s.status === 'error' ? 'Errored' : 'Exited';
    const item: AppNotification = {
      id: `${AGENT_ACTIVITY_PREFIX}${s.id}_${Date.now()}`,
      type: 'agent_activity',
      data: {
        type: 'agent_activity',
        status: s.status,
        session_id: s.id,
        session_name: s.name,
        message: this.translate.instant(`NOTIFICATIONS.AGENT.${key}`),
      },
      read_at: null,
      created_at: new Date().toISOString(),
    };
    this.items.update((list) => [item, ...list].slice(0, MAX_ITEMS));
  }

  isLocal(id: string): boolean {
    return id.startsWith(AGENT_ACTIVITY_PREFIX);
  }

  markAsRead(id: string): void {
    const now = new Date().toISOString();
    this.items.update((list) => list.map((i) => (i.id === id && !i.read_at ? { ...i, read_at: now } : i)));
  }

  markAllAsRead(): void {
    const now = new Date().toISOString();
    this.items.update((list) => list.map((i) => (i.read_at ? i : { ...i, read_at: now })));
  }

  /** Click: opens the agent's session. */
  open(n: AppNotification): void {
    this.markAsRead(n.id);
    const sessionId = n.data['session_id'] as string | undefined;
    if (sessionId) this.store.dispatch(setActiveSession({ sessionId }));
    void this.router.navigate(['/admin/sessions']);
  }
}
