import { Component, computed, inject, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PluginFloorplanComponent } from '../../plugins/plugin-floorplan.component';
import { FloorDesk } from '../../plugins/plugin-page-view';
import { FloorPlanService } from './floor-plan.service';
import { canDetach } from '@/app/detached/detached-window';

/**
 * Built-in "Floor Plan" plugin in the sessions view. `compact` = side panel next to the session
 * opened from the floor plan; otherwise it takes up the agents area.
 */
@Component({
  selector: 'app-floor-plan-view',
  standalone: true,
  imports: [PluginFloorplanComponent, TranslateModule],
  template: `
    <div class="fpv" [class.compact]="compact()">
      <header class="fpv-head">
        <div class="fpv-title">
          <i class="ti ti-map-2" aria-hidden="true"></i>
          <h2>{{ 'SESSIONS.FLOOR_PLAN.Title' | translate }}</h2>
          <span class="fpv-chip" [title]="'SESSIONS.FLOOR_PLAN.Chip tooltip' | translate"><i class="ti ti-puzzle" aria-hidden="true"></i>@if (!compact()) { PromptOps }</span>
        </div>
        <div class="fpv-actions">
          @if (canDetach && !external()) {
            <button type="button" class="fpv-icon" (click)="popOut()" [title]="'SESSIONS.FLOOR_PLAN.Pop out tooltip' | translate" [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Pop out' | translate"><i class="ti ti-external-link" aria-hidden="true"></i></button>
          }
          @if (compact()) {
            <button type="button" class="fpv-icon" (click)="fp.showFull()" [title]="'SESSIONS.FLOOR_PLAN.Expand' | translate" [attr.aria-label]="'SESSIONS.FLOOR_PLAN.Expand' | translate"><i class="ti ti-arrows-maximize" aria-hidden="true"></i></button>
          }
          <button type="button" class="fpv-icon" (click)="fp.close()" [title]="(external() ? 'SESSIONS.FLOOR_PLAN.Close window' : 'SESSIONS.FLOOR_PLAN.Close') | translate" [attr.aria-label]="(external() ? 'SESSIONS.FLOOR_PLAN.Close window' : 'SESSIONS.FLOOR_PLAN.Close') | translate"><i class="ti ti-x" aria-hidden="true"></i></button>
        </div>
      </header>

      @if (popOutError()) {
        <p class="fpv-error" role="alert">{{ 'SESSIONS.FLOOR_PLAN.Pop out failed' | translate }}</p>
      }

      @if (!compact()) {
        <div class="fpv-stats">
          <div><small>{{ 'SESSIONS.FLOOR_PLAN.Projects' | translate }}</small><strong>{{ fp.stats().projects }}</strong></div>
          <div><small>{{ 'SESSIONS.Sessions' | translate }}</small><strong>{{ fp.stats().sessions }}</strong></div>
          <div class="working"><small>{{ 'SESSIONS.FLOOR_PLAN.Working' | translate }}</small><strong>{{ fp.stats().working }}</strong></div>
          <div class="waiting"><small>{{ 'SESSIONS.FLOOR_PLAN.Waiting' | translate }}</small><strong>{{ fp.stats().waiting }}</strong></div>
        </div>
      }

      <label class="fpv-toggle">
        <input type="checkbox" [checked]="fp.hideInactive()" (change)="fp.setHideInactive($any($event.target).checked)" />
        <span>{{ 'SESSIONS.FLOOR_PLAN.Hide inactive' | translate }}</span>
        @if (fp.stats().parked) { <small>{{ fp.stats().parked }}</small> }
      </label>

      <div class="fpv-body">
        <app-plugin-floorplan [block]="block()" [openable]="fp.openable()" [compact]="compact()" [fill]="true" [activeSession]="activeSession()"
                              (openDesk)="open($event)" />
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
    .fpv { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; height: 100%; min-height: 0; overflow: hidden; }
    .fpv.compact { padding: 10px; gap: 8px; }
    .fpv-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .fpv-title { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; }
    .fpv-actions { flex: none; }
    .fpv-title > .ti { font-size: 20px; color: var(--promptops-primary, #6366f1); }
    .fpv-title h2 { margin: 0; font-size: 17px; font-weight: 700; white-space: nowrap; }
    .compact .fpv-title h2 { font-size: 14px; }
    .fpv-chip { display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; padding: 1px 7px; border-radius: 10px;
      border: 1px solid var(--promptops-border-color, rgba(127,127,127,.3)); opacity: .75; white-space: nowrap; }
    .fpv-actions { display: flex; gap: 4px; }
    .fpv-icon { width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--promptops-border-color, rgba(127,127,127,.3));
      background: transparent; color: inherit; display: inline-grid; place-items: center; cursor: pointer; }
    .fpv-icon:hover { background: rgba(99,102,241,.08); }
    .fpv-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .fpv-stats > div { border: 1px solid var(--promptops-border-color, rgba(127,127,127,.25)); border-radius: 9px; padding: 7px 10px; display: flex; flex-direction: column; }
    .fpv-stats small { font-size: 11px; opacity: .65; }
    .fpv-stats strong { font-size: 18px; }
    .fpv-stats .working strong { color: #16a34a; }
    .fpv-stats .waiting strong { color: #d97706; }
    .fpv-toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; cursor: pointer; align-self: flex-start; }
    .fpv-toggle small { font-size: 10.5px; padding: 0 6px; border-radius: 8px; background: rgba(127,127,127,.18); }
    .fpv-error { margin: 0; font-size: 12px; color: var(--po-error, #dc2626); }
    .fpv-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .fpv-body > app-plugin-floorplan { flex: 1; min-height: 0; }
    @media (max-width: 900px) { .fpv-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `],
})
export class FloorPlanViewComponent {
  readonly fp = inject(FloorPlanService);
  readonly compact = input(false);
  /** Inside the detached window: no "open in a window", the X closes the window. */
  readonly external = input(false);
  readonly canDetach = canDetach();
  readonly activeSession = input<string | null>(null);
  readonly openSession = output<string>();
  private readonly translate = inject(TranslateService);
  private readonly lang = toSignal(this.translate.onLangChange, { initialValue: null });
  readonly popOutError = signal(false);

  readonly block = computed(() => {
    this.lang();
    return {
      type: 'floorplan' as const, hub: 'PromptOps', rooms: this.fp.rooms(),
      empty: this.translate.instant(this.fp.hideInactive() && this.fp.stats().sessions ? 'SESSIONS.FLOOR_PLAN.Empty hidden' : 'SESSIONS.FLOOR_PLAN.Empty'),
    };
  });

  popOut(): void {
    this.popOutError.set(false);
    (this.fp as FloorPlanService).popOut().catch((err) => {
      console.warn('[floor-plan] pop-out failed', err);
      this.popOutError.set(true);
    });
  }

  open(d: FloorDesk): void {
    if (d.session) this.openSession.emit(d.session);
  }
}
