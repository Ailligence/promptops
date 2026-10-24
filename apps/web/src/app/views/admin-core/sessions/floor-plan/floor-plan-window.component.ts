import { Component, DestroyRef, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { FloorPlanViewComponent } from './floor-plan-view.component';
import { FloorPlanRemoteAction, FloorPlanRemoteState, FloorPlanService } from './floor-plan.service';
import { FloorRoom } from '../../plugins/plugin-page-view';
import { tauri } from '@/app/detached/detached-window';

/**
 * Detached window side: same interface as FloorPlanService, but the data comes from the main
 * window (single source of sessions and agents) and actions go back to it.
 */
class RemoteFloorPlan {
  readonly mode = signal<'full'>('full');
  readonly hideInactive = signal(false);
  readonly rooms = signal<FloorRoom[]>([]);
  readonly stats = signal({ projects: 0, sessions: 0, parked: 0, working: 0, waiting: 0 });
  readonly openableIds = signal<string[]>([]);
  readonly openable = computed(() => new Set(this.openableIds()));
  readonly alertCount = signal(0);
  readonly connected = signal(false);

  apply(s: FloorPlanRemoteState): void {
    this.rooms.set(Array.isArray(s?.rooms) ? s.rooms : []);
    if (s?.stats) this.stats.set(s.stats);
    this.openableIds.set(Array.isArray(s?.openable) ? s.openable : []);
    this.hideInactive.set(s?.hideInactive === true);
    this.alertCount.set(Number(s?.alertCount) || 0);
    this.connected.set(true);
  }

  send(action: FloorPlanRemoteAction): void {
    tauri()?.event.emit('floor-plan:action', action).catch((err: unknown) => console.warn('[floor-plan] action not delivered', err));
  }

  setHideInactive(on: boolean): void {
    this.hideInactive.set(on);
    this.send({ type: 'hide', value: on });
  }

  showFull(): void { /* already full window */ }

  close(): void {
    this.send({ type: 'closed' });
    Promise.resolve(tauri()?.window?.getCurrentWindow().close()).catch((err: unknown) => console.warn('[floor-plan] close failed', err));
  }
}

@Component({
  selector: 'app-floor-plan-window',
  standalone: true,
  imports: [FloorPlanViewComponent, TranslateModule],
  providers: [{ provide: FloorPlanService, useFactory: () => new RemoteFloorPlan() }],
  template: `
    @if (fp.connected()) {
      <app-floor-plan-view [external]="true" (openSession)="fp.send({ type: 'open', session: $event })" />
    } @else {
      <p class="fpw-wait">{{ 'SESSIONS.FLOOR_PLAN.Connecting' | translate }}</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100vh; background: var(--promptops-body-bg); color: var(--promptops-body-color); }
    :host > app-floor-plan-view { flex: 1; min-height: 0; }
    .fpw-wait { margin: auto; opacity: .6; font-size: 13px; }
  `],
})
export class FloorPlanWindowComponent implements OnInit {
  readonly fp = inject(FloorPlanService) as unknown as RemoteFloorPlan;
  private destroyRef = inject(DestroyRef);

  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => { this.destroyed = true; });
  }

  async ngOnInit(): Promise<void> {
    const t = tauri();
    if (!t) return;
    let off: () => void;
    try {
      off = await t.event.listen<FloorPlanRemoteState>('floor-plan:state', (e) => this.fp.apply(e.payload));
    } catch (err) {
      console.warn('[floor-plan] cannot listen to the main window', err);
      return;
    }
    // Window torn down while listen() was pending: onDestroy would throw, so unlisten now.
    if (this.destroyed) { off(); return; }
    this.destroyRef.onDestroy(off);
    const bye = () => this.fp.send({ type: 'closed' });
    window.addEventListener('beforeunload', bye);
    this.destroyRef.onDestroy(() => window.removeEventListener('beforeunload', bye));
    this.fp.send({ type: 'ready' });
    // A reloaded main window asks who is open: answer so it streams the state again.
    try {
      const offHello = await t.event.listen('floor-plan:hello', () => this.fp.send({ type: 'ready' }));
      if (this.destroyed) offHello();
      else this.destroyRef.onDestroy(offHello);
    } catch (err) {
      console.warn('[floor-plan] cannot listen to main window restarts', err);
    }
  }
}
