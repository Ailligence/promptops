import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { getActiveSessionId, getSessions } from '@/store/sessions/session.selectors';
import type { SessionSummary } from '@/store/sessions/session.state';
import { SessionCanvasService } from '@core/services/session-canvas.service';
import { TooltipDirective } from '@/app/common/tooltip.directive';
import { NotificationCenterComponent } from '@/app/components/notification-center/notification-center.component';

type Lamp = 'working' | 'idle' | 'blocked' | 'off';

function lampOf(s: SessionSummary): Lamp {
  if (s.standbyAt) return 'off';
  switch (s.status) {
    case 'running':
    case 'in_progress': return 'working';
    case 'waiting_input':
    case 'error': return 'blocked';
    case 'exited': return 'off';
    default: return 'idle';
  }
}

/**
 * The bottom dock of the session canvas: every session as a lamp chip,
 * grouped by workspace in the order they appear, plus the doors to the full
 * session tree and to a new session. Selection goes through
 * SessionCanvasService so the session view keeps owning it.
 */
@Component({
  selector: 'app-session-dock',
  standalone: true,
  imports: [TranslateModule, TooltipDirective, NotificationCenterComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="dock" [attr.aria-label]="'PALETTE.Sessions' | translate">
      <button type="button" class="dock-btn" [class.on]="canvas.sessionsSheetOpen()"
              (click)="canvas.toggleSessionsSheet()"
              [appTooltip]="'PALETTE.All sessions' | translate"
              [attr.aria-label]="'PALETTE.All sessions' | translate"
              [attr.aria-pressed]="canvas.sessionsSheetOpen()">
        <iconify-icon icon="tabler:layout-sidebar" width="16"></iconify-icon>
      </button>
      <div class="dock-track" #track (wheel)="onWheel($event, track)">
        @for (group of groups(); track group.name) {
          <span class="dock-group" role="group" [attr.aria-label]="group.name">
            <span class="dock-ws">{{ group.name }}</span>
            @for (s of group.sessions; track s.id) {
              <button type="button" class="chip"
                      [class.active]="s.id === activeId()"
                      [class.blocked]="lamp(s) === 'blocked'"
                      [class.off]="lamp(s) === 'off'"
                      [attr.aria-current]="s.id === activeId() ? 'true' : null"
                      [attr.aria-label]="s.name + ' · ' + ('SESSIONS.Status ' + (s.standbyAt ? 'standby' : s.status) | translate)"
                      [appTooltip]="s.name"
                      (click)="canvas.requestSelect(s.id)">
                <span [class]="'po-lamp po-lamp--' + lamp(s)" aria-hidden="true"></span>
                <span class="chip-name">{{ s.name }}</span>
              </button>
            }
          </span>
        }
      </div>
      <button type="button" class="dock-btn" (click)="canvas.requestCreate()"
              [appTooltip]="'PALETTE.New session' | translate"
              [attr.aria-label]="'PALETTE.New session' | translate">
        <iconify-icon icon="tabler:plus" width="16"></iconify-icon>
      </button>
      <app-notification-center class="dock-notify" [label]="'NOTIFICATIONS.Title' | translate"></app-notification-center>
      <button type="button" class="dock-cmd" (click)="canvas.togglePalette(true)"
              [attr.aria-label]="'PALETTE.Commands' | translate" [appTooltip]="'PALETTE.Placeholder' | translate">
        <iconify-icon icon="tabler:search" width="13"></iconify-icon>
        <kbd>{{ shortcut }}</kbd>
      </button>
    </nav>
  `,
  styles: `
    :host { display: flex; min-width: 0; height: 100%; flex: 1; }
    .dock { display: flex; align-items: center; gap: var(--po-space-1); min-width: 0; height: 100%; padding-inline: var(--po-space-2); flex: 1; }
    .dock-btn {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      border: 0;
      border-radius: var(--po-radius-sm);
      background: transparent;
      color: var(--po-text-secondary);
      cursor: pointer;
    }
    .dock-btn:hover, .dock-btn.on { background: var(--po-bg-3); color: var(--po-text-primary); }
    .dock-track {
      display: flex;
      align-items: center;
      gap: var(--po-space-4);
      min-width: 0;
      flex: 1;
      height: 100%;
      padding-inline: var(--po-space-2);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .dock-group { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .dock-group + .dock-group { padding-inline-start: var(--po-space-4); border-inline-start: 1px solid var(--po-track-dim, var(--po-border-strong)); }
    .dock-ws {
      margin-inline-end: var(--po-space-1);
      font-size: var(--po-label-size, 11px);
      font-weight: 600;
      letter-spacing: var(--po-label-tracking, 0.09em);
      text-transform: uppercase;
      color: var(--po-text-tertiary);
      white-space: nowrap;
    }
    .chip {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 28px;
      max-width: 200px;
      padding: 0 10px;
      border: 1px solid transparent;
      border-radius: var(--po-radius-sm);
      background: transparent;
      color: var(--po-text-secondary);
      font-size: var(--po-text-sm);
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out), color var(--po-duration-fast) var(--po-ease-out);
    }
    .chip:hover { background: var(--po-bg-3); color: var(--po-text-primary); }
    .chip:focus-visible, .dock-btn:focus-visible, .dock-cmd:focus-visible { outline: 2px solid var(--po-accent); outline-offset: 1px; }
    .chip.active { background: var(--po-bg-3); color: var(--po-text-primary); }
    .chip.active::after {
      content: "";
      position: absolute;
      inset-inline: 8px;
      bottom: 1px;
      height: 2px;
      border-radius: 1px;
      background: var(--po-accent);
    }
    .chip.blocked { border-color: oklch(from var(--po-error) l c h / 40%); background: oklch(from var(--po-error) l c h / 10%); color: var(--po-text-primary); }
    .chip.off .chip-name { text-decoration: line-through; text-decoration-color: var(--po-border-strong); color: var(--po-text-tertiary); }
    .chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dock-notify { display: inline-flex; flex-shrink: 0; }
    .dock-cmd {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 26px;
      margin-inline-start: var(--po-space-2);
      padding: 0 8px;
      flex-shrink: 0;
      border: 1px solid var(--po-border-strong);
      border-radius: var(--po-radius-sm);
      background: var(--po-bg-2);
      color: var(--po-text-secondary);
      font-size: var(--po-text-xs);
      cursor: pointer;
    }
    .dock-cmd:hover { color: var(--po-text-primary); border-color: var(--po-text-tertiary); }
    .dock-cmd kbd { padding: 0; background: transparent; font-family: var(--po-font-mono); font-size: 10px; color: var(--po-text-tertiary); }
  `,
})
export class SessionDockComponent {
  protected readonly canvas = inject(SessionCanvasService);
  private readonly store = inject(Store);
  private readonly sessions = toSignal(this.store.select(getSessions), { initialValue: [] as SessionSummary[] });
  protected readonly activeId = toSignal(this.store.select(getActiveSessionId), { initialValue: null });
  protected readonly shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl⇧K';

  protected readonly groups = computed(() => {
    const out: { name: string; sessions: SessionSummary[] }[] = [];
    for (const s of this.sessions()) {
      const name = s.workspace?.name ?? '—';
      let g = out.find((x) => x.name === name);
      if (!g) out.push((g = { name, sessions: [] }));
      g.sessions.push(s);
    }
    // Exited and parked sessions stay on the track, after the live ones.
    for (const g of out) g.sessions.sort((a, b) => Number(lampOf(a) === 'off') - Number(lampOf(b) === 'off'));
    return out;
  });

  protected lamp(s: SessionSummary): Lamp {
    return lampOf(s);
  }

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  constructor() {
    // Keep the selected chip and every red chip in view as the track scrolls.
    effect(() => {
      const id = this.activeId();
      this.groups();
      const el = this.track()?.nativeElement;
      if (!el) return;
      queueMicrotask(() => {
        const target = el.querySelector<HTMLElement>('.chip.blocked') ?? (id ? el.querySelector<HTMLElement>('.chip.active') : null);
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    });
  }

  /** A vertical wheel scrolls the dock sideways. */
  protected onWheel(event: WheelEvent, el: HTMLElement): void {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    el.scrollLeft += event.deltaY;
    event.preventDefault();
  }
}
