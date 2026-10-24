import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { focusMainWindow, isDetachedWindow, openDetached, tauri } from '@/app/detached/detached-window';
import { getSessions } from '@/store/sessions/session.selectors';
import { getWorkspaces } from '@/store/workspaces/workspace.selectors';
import { SidebarFoldersService } from '../services/sidebar-folders.service';
import { SubAgentService } from '../services/sub-agent.service';
import { buildWorkspaceSnapshot, SnapshotSession, SnapshotStatus } from '../../plugins/plugin-workspace-snapshot';
import { FloorAgent, FloorAlert, FloorDesk, FloorRoom } from '../../plugins/plugin-page-view';

/** State the main window sends to the detached floor plan. */
export interface FloorPlanRemoteState {
  rooms: FloorRoom[];
  stats: { projects: number; sessions: number; parked: number; working: number; waiting: number };
  openable: string[];
  hideInactive: boolean;
  alertCount: number;
}
/** Actions the detached floor plan sends back to the main window. */
export type FloorPlanRemoteAction = { type: 'ready' } | { type: 'closed' } | { type: 'open'; session: string } | { type: 'hide'; value: boolean };

/** Where the floor plan sits in the sessions view: closed, in place of the agents, or shrunk to a side panel. */
export type FloorPlanMode = 'off' | 'full' | 'docked';

const HIDE_KEY = 'po.floorPlan.hideInactive';
// The most urgent state wins on the desk: whoever is waiting for an answer comes first.
const RANK: Record<SnapshotStatus, number> = { waiting: 0, working: 1, error: 2, idle: 3, standby: 4, off: 5 };
const NO_FOLDER = '~';

const best = (list: SnapshotStatus[]): SnapshotStatus => list.reduce<SnapshotStatus>((a, b) => (RANK[b] < RANK[a] ? b : a), 'off');
/** A session is as urgent as its most urgent agent: a waiting sub-agent counts too. */
const live = (s: SnapshotSession): SnapshotStatus => best([s.status, ...s.agents.map((a) => a.status)]);
const inactive = (s: SnapshotSession) => s.status === 'standby' || s.status === 'off';
const FP = 'SESSIONS.FLOOR_PLAN.';

/**
 * Built-in "Floor Plan" plugin: all of PromptOps seen from above. Rooms = sidebar folders,
 * desks = workspaces (or sessions without a workspace), with the agents and their state on top.
 * Reads only the state already in the app: no calls, no extra data.
 */
@Injectable({ providedIn: 'root' })
export class FloorPlanService {
  private store = inject(Store);
  private router = inject(Router);
  private folders = inject(SidebarFoldersService);
  private subAgents = inject(SubAgentService);
  private translate = inject(TranslateService);
  /** Re-run the labeled computeds (rooms/desks) when the language changes. */
  private lang = toSignal(this.translate.onLangChange, { initialValue: null });
  private sessions = toSignal(this.store.select(getSessions), { initialValue: [] });
  private workspaces = toSignal(this.store.select(getWorkspaces), { initialValue: [] });

  readonly mode = signal<FloorPlanMode>('off');
  readonly hideInactive = signal(this.readHide());

  /**
   * Silent per-session alerts: an agent is waiting for input or has finished working. They stay on
   * (the desk stays lit) until the session is opened; "input" turns off by itself
   * if no agent in the session is waiting anymore.
   */
  readonly alerts = signal<Map<string, FloorAlert>>(new Map());
  readonly alertCount = computed(() => this.alerts().size);
  private lastStatus = new Map<string, SnapshotStatus>();
  private alertSeq = 0;

  /** The floor plan is also open in a detached window: we send it the state on every change. */
  readonly external = signal(false);
  /** Session to open requested by the detached window: the sessions view consumes it. */
  readonly pendingOpen = signal<string | null>(null);
  private bridgeStarted = false;

  constructor() {
    effect(() => {
      const snap = this.snapshot();
      untracked(() => this.detect(snap.sessions));
    });
    effect(() => {
      if (!this.external()) return;
      const state = this.remoteState();
      untracked(() => this.emitState(state));
    });
    // Main window: listen from the start, not only after popOut(). A detached
    // floor plan survives a reload of the main window; "hello" makes it
    // announce itself again, so it does not stay frozen on the old state.
    if (tauri() && !isDetachedWindow()) {
      this.startBridge()
        .then(() => tauri()?.event.emit('floor-plan:hello', null))
        .catch((err: unknown) => console.warn('[floor-plan] bridge not started', err));
    }
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(FP + key, params);
  }

  /** "1 project" / "3 projects": separate one/many keys so every locale can phrase it. */
  private plural(n: number, one: string, many: string): string {
    return this.t(n === 1 ? one : many, { count: n });
  }

  private emitState(state: FloorPlanRemoteState): void {
    tauri()?.event.emit('floor-plan:state', state).catch((err: unknown) => console.warn('[floor-plan] state sync failed', err));
  }

  private remoteState(): FloorPlanRemoteState {
    return { rooms: this.rooms(), stats: this.stats(), openable: [...this.openable()], hideInactive: this.hideInactive(), alertCount: this.alertCount() };
  }

  /** Tauri main window only: listens to the detached floor plan's actions. Idempotent. */
  async startBridge(): Promise<void> {
    const t = tauri();
    if (!t || this.bridgeStarted || isDetachedWindow()) return;
    this.bridgeStarted = true;
    try {
      await t.event.listen<FloorPlanRemoteAction>('floor-plan:action', (e) => this.onRemote(e.payload));
    } catch (err) {
      // Let a later call retry instead of believing the bridge is up.
      this.bridgeStarted = false;
      throw err;
    }
  }

  /** Opens the floor plan in a window of its own; the one in the sessions view makes room for the agents. */
  async popOut(): Promise<void> {
    await this.startBridge();
    if (this.mode() === 'full') this.close();
    this.external.set(true);
    try {
      await openDetached('floor-plan');
    } catch (err) {
      // No window opened: stop streaming state to nobody and let the caller report it.
      this.external.set(false);
      throw err;
    }
  }

  private onRemote(a: FloorPlanRemoteAction): void {
    switch (a?.type) {
      case 'ready':
        this.external.set(true);
        this.emitState(this.remoteState());
        break;
      case 'closed':
        this.external.set(false);
        break;
      case 'hide':
        this.setHideInactive(a.value === true);
        break;
      case 'open':
        // Only one of the user's sessions; the sessions view opens it, then the main window comes back to the front.
        if (typeof a.session !== 'string' || !this.openable().has(a.session)) return;
        this.router.navigate(['/admin/sessions'])
          .then(() => this.pendingOpen.set(a.session))
          .catch((err) => console.warn('[floor-plan] navigation failed', err));
        focusMainWindow().catch((err) => console.warn('[floor-plan] focus failed', err));
        break;
    }
  }

  /** The person opened the session: the alert did its job. */
  acknowledge(sessionId: string): void {
    if (!this.alerts().has(sessionId)) return;
    const next = new Map(this.alerts());
    next.delete(sessionId);
    this.alerts.set(next);
  }

  private detect(sessions: SnapshotSession[]): void {
    const first = this.lastStatus.size === 0;
    const seen = new Map<string, SnapshotStatus>();
    const next = new Map(this.alerts());
    let changed = false;
    for (const s of sessions) {
      for (const a of s.agents) {
        const key = `${s.id}/${a.id}`;
        const prev = this.lastStatus.get(key);
        seen.set(key, a.status);
        if (first || prev === undefined || prev === a.status) continue;
        const who = a.isMain ? s.name : a.name;
        if (a.status === 'waiting') {
          next.set(s.id, { kind: 'input', text: this.t('Needs input', { name: who }), seq: ++this.alertSeq, at: Date.now() });
          changed = true;
        } else if (prev === 'working' && (a.status === 'idle' || a.status === 'off') && next.get(s.id)?.kind !== 'input') {
          next.set(s.id, { kind: 'done', text: this.t('Finished', { name: who }), seq: ++this.alertSeq, at: Date.now() });
          changed = true;
        }
      }
      // Answer given elsewhere (terminal, mobile): the wait is over, the input alert turns off.
      const al = next.get(s.id);
      if (al?.kind === 'input' && !s.agents.some((a) => a.status === 'waiting')) {
        next.delete(s.id);
        changed = true;
      }
    }
    for (const id of [...next.keys()]) {
      if (!sessions.some((s) => s.id === id)) { next.delete(id); changed = true; }
    }
    this.lastStatus = seen;
    if (changed) this.alerts.set(next);
  }

  showFull(): void { this.mode.set('full'); }
  dock(): void { if (this.mode() === 'full') this.mode.set('docked'); }
  close(): void { this.mode.set('off'); }

  setHideInactive(on: boolean): void {
    this.hideInactive.set(on);
    try { localStorage.setItem(HIDE_KEY, on ? '1' : '0'); } catch { /* stays in memory */ }
  }

  private readHide(): boolean {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
  }

  readonly snapshot = computed(() =>
    buildWorkspaceSnapshot(this.folders.folders(), this.workspaces() ?? [], this.sessions() ?? [], this.subAgents.allSubAgents()));

  readonly openable = computed(() => new Set((this.sessions() ?? []).map((s) => s.id)));

  readonly stats = computed(() => {
    const ws = this.snapshot();
    const agents = ws.sessions.flatMap((s) => s.agents);
    return {
      projects: ws.workspaces.length + ws.sessions.filter((s) => !s.workspaceId).length,
      sessions: ws.sessions.length,
      parked: ws.sessions.filter(inactive).length,
      working: agents.filter((a) => a.status === 'working').length,
      waiting: agents.filter((a) => a.status === 'waiting').length,
    };
  });

  readonly rooms = computed<FloorRoom[]>(() => {
    this.lang();
    const ws = this.snapshot();
    const hide = this.hideInactive();
    const sessions = ws.sessions.filter((s) => !hide || !inactive(s));
    const folders = ws.folders.map((f) => ({ id: f.id, title: f.name || this.t('Folder'), color: f.color && /^#[0-9a-fA-F]{6}$/.test(f.color) ? f.color : null }));
    const byRoom = new Map<string, FloorDesk[]>(folders.map((f) => [f.id, []]));
    byRoom.set(NO_FOLDER, []);
    const wsById = new Map(ws.workspaces.map((w) => [w.id, w]));
    const grouped = new Map<string, SnapshotSession[]>();
    for (const s of sessions) {
      if (s.workspaceId && wsById.has(s.workspaceId)) {
        grouped.set(s.workspaceId, [...(grouped.get(s.workspaceId) ?? []), s]);
      } else {
        byRoom.get(s.folderId && byRoom.has(s.folderId) ? s.folderId : NO_FOLDER)!.push(this.desk(s.name, [s], true));
      }
    }
    for (const [id, list] of grouped) {
      const w = wsById.get(id)!;
      byRoom.get(w.folderId && byRoom.has(w.folderId) ? w.folderId : NO_FOLDER)!.push(this.desk(w.name, list, false));
    }
    const out: FloorRoom[] = [];
    for (const f of [...folders, { id: NO_FOLDER, title: folders.length ? this.t('Outside folders') : this.t('All projects'), color: null }]) {
      const desks = byRoom.get(f.id)!.sort((a, b) => RANK[a.status] - RANK[b.status] || a.title.localeCompare(b.title));
      if (!desks.length && (hide || f.id === NO_FOLDER)) continue;
      const agents = desks.reduce((n, d) => n + d.agents.length, 0);
      out.push({ title: f.title, color: f.color, subtitle: `${this.plural(desks.length, 'Project one', 'Project many')} · ${this.plural(agents, 'Agent one', 'Agent many')}`, wide: desks.length > 8, desks });
    }
    return out;
  });

  private desk(title: string, sessions: SnapshotSession[], noWorkspace: boolean): FloorDesk {
    const agents: FloorAgent[] = sessions.flatMap((s) => s.agents.map((a) => ({ name: a.isMain ? this.t('Main') : a.name, provider: a.provider, status: a.status })));
    const pending = sessions.reduce((n, s) => n + (s.pending || 0), 0);
    // The session to open: the one waiting for you, then the most active, then the first.
    // With an alert on, the session that raised it is opened.
    const alerts = this.alerts();
    const lit = sessions.filter((s) => alerts.has(s.id)).sort((a, b) => (alerts.get(a.id)!.kind === 'input' ? -1 : 0) - (alerts.get(b.id)!.kind === 'input' ? -1 : 0) || alerts.get(b.id)!.seq - alerts.get(a.id)!.seq);
    const alert = lit[0] ? alerts.get(lit[0].id)! : null;
    const target = lit[0] ?? [...sessions].sort((a, b) => RANK[live(a)] - RANK[live(b)])[0];
    const active = sessions.filter((s) => live(s) === 'working' || live(s) === 'waiting').length;
    const parts = [this.plural(sessions.length, 'Session one', 'Session many')];
    if (active) parts.push(this.t('Active', { count: active }));
    if (noWorkspace) parts.unshift(this.t('No workspace'));
    return {
      title, subtitle: parts.join(' · '), status: best(sessions.map(live)), badge: pending ? String(pending) : '',
      session: target?.id ?? null, agents: agents.slice(0, 16), members: sessions.map((s) => s.id), alert,
    };
  }
}
