import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { SessionSummary } from '@/store/sessions/session.state';

/**
 * The signal box's stop board: one strip above the terminals listing every
 * session whose lamp is red (waiting on you, or failed). Hidden while every
 * signal is clear. Clicking an entry routes straight to that session.
 */
@Component({
  selector: 'app-needs-you-strip',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (blocked().length) {
      <nav class="needs-you" [attr.aria-label]="'SESSIONS.NEEDS_YOU.Title' | translate">
        <span class="ny-title">
          <span class="po-lamp po-lamp--blocked" aria-hidden="true"></span>
          {{ 'SESSIONS.NEEDS_YOU.Title' | translate }}
          <span class="ny-count po-num">{{ blocked().length }}</span>
        </span>
        <ul class="ny-list">
          @for (s of blocked(); track s.id) {
            <li>
              <button type="button" class="ny-item" [class.current]="s.id === activeSessionId()" (click)="select.emit(s.id)">
                <span class="ny-name">{{ s.name }}</span>
                @if (s.workspace?.name && s.workspace?.name !== s.name) {
                  <span class="ny-ws">{{ s.workspace?.name }}</span>
                }
                @if (s.status === 'error') {
                  <span class="ny-kind">{{ 'SESSIONS.Status error' | translate }}</span>
                }
              </button>
            </li>
          }
        </ul>
      </nav>
    }
  `,
  styles: `
    :host { display: block; }
    .needs-you {
      display: flex;
      align-items: center;
      gap: var(--po-space-3);
      min-height: 34px;
      padding: 0 var(--po-space-3);
      border-bottom: 1px solid var(--po-border-subtle);
      background: oklch(from var(--po-error) l c h / 8%);
      overflow: hidden;
    }
    .ny-title {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-2);
      flex-shrink: 0;
      font-size: var(--po-label-size, 11px);
      font-weight: 600;
      letter-spacing: var(--po-label-tracking, 0.09em);
      text-transform: uppercase;
      color: var(--po-error);
    }
    .ny-count { font-size: var(--po-text-xs); }
    .ny-list {
      display: flex;
      gap: var(--po-space-1);
      min-width: 0;
      margin: 0;
      padding: 0;
      list-style: none;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .ny-item {
      display: inline-flex;
      align-items: baseline;
      gap: var(--po-space-2);
      height: 24px;
      padding: 0 var(--po-space-2);
      border: 1px solid oklch(from var(--po-error) l c h / 35%);
      border-radius: var(--po-radius-sm);
      background: var(--po-bg-1);
      color: var(--po-text-primary);
      font-size: var(--po-text-sm);
      white-space: nowrap;
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out), border-color var(--po-duration-fast) var(--po-ease-out);
    }
    .ny-item:hover { background: var(--po-bg-3); border-color: var(--po-error); }
    .ny-item:focus-visible { outline: 2px solid var(--po-accent); outline-offset: 1px; }
    .ny-item.current { border-color: var(--po-accent); }
    .ny-ws, .ny-kind { color: var(--po-text-tertiary); font-size: var(--po-text-xs); }
    .ny-kind { color: var(--po-error); }
  `,
})
export class NeedsYouStripComponent {
  readonly sessions = input<SessionSummary[]>([]);
  readonly activeSessionId = input<string | null>(null);
  readonly select = output<string>();

  protected readonly blocked = computed(() =>
    this.sessions().filter((s) => !s.standbyAt && (s.status === 'waiting_input' || s.status === 'error')),
  );
}
