import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  inject,
  Output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { AuthenticationService } from '@core/services/auth.service';
import { ProviderId } from '@core/providers/provider-capability';

export type FirstSessionChoice = 'local' | 'cloud' | 'later';

@Component({
  selector: 'app-first-session-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="fsm-wrap">
      <header class="fsm-header">
        <div class="fsm-icon" aria-hidden="true">🚀</div>
        <h2 class="fsm-title">{{ 'FIRST_SESSION.Title' | translate }}</h2>
        <p class="fsm-subtitle">{{ 'FIRST_SESSION.Subtitle' | translate }}</p>
      </header>

      <div class="fsm-options">
        <button
          type="button"
          class="fsm-option"
          data-accent="emerald"
          [disabled]="busy()"
          (click)="pick('local')"
        >
          <div class="opt-badge opt-badge--free">{{ 'FIRST_SESSION.Badge_Free' | translate }}</div>
          <div class="opt-icon"><i class="ti ti-bolt"></i></div>
          <h3 class="opt-title">{{ 'FIRST_SESSION.Local_Title' | translate }}</h3>
          <p class="opt-desc">{{ 'FIRST_SESSION.Local_Desc' | translate }}</p>
          <p class="opt-micro">{{ 'FIRST_SESSION.Local_Micro' | translate }}</p>
        </button>

        <button
          type="button"
          class="fsm-option"
          data-accent="indigo"
          [disabled]="busy()"
          (click)="pick('cloud')"
        >
          <div class="opt-badge opt-badge--primary">{{ 'FIRST_SESSION.Badge_Recommended' | translate }}</div>
          <div class="opt-icon"><i class="ti ti-cloud"></i></div>
          <h3 class="opt-title">{{ 'FIRST_SESSION.Cloud_Title' | translate }}</h3>
          <p class="opt-desc">{{ 'FIRST_SESSION.Cloud_Desc' | translate }}</p>
          <p class="opt-micro">{{ 'FIRST_SESSION.Cloud_Micro' | translate }}</p>
        </button>
      </div>

      <footer class="fsm-footer">
        <button
          type="button"
          class="fsm-skip"
          [disabled]="busy()"
          (click)="pick('later')"
        >
          {{ 'FIRST_SESSION.Later' | translate }}
        </button>
      </footer>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .fsm-wrap {
      padding: 32px 28px 22px;
      background: var(--bs-body-bg, #fff);
      border-radius: 16px;
      min-width: 520px;
      max-width: 720px;
    }

    .fsm-header { text-align: center; margin-bottom: 22px; }
    .fsm-icon { font-size: 34px; margin-bottom: 8px; }
    .fsm-title {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 4px;
      background: linear-gradient(135deg, var(--po-accent) 0%, #a855f7 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }
    .fsm-subtitle {
      font-size: 14px;
      color: var(--bs-secondary-color, #6c757d);
      margin: 0;
    }

    .fsm-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
    }

    @media (max-width: 600px) {
      .fsm-wrap { min-width: 0; padding: 24px 18px 18px; }
      .fsm-options { grid-template-columns: 1fr; }
    }

    .fsm-option {
      position: relative;
      text-align: left;
      background: var(--bs-tertiary-bg, #f8f9fa);
      border: 1.5px solid transparent;
      border-radius: 14px;
      padding: 18px 16px 16px;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      font: inherit;
      color: inherit;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .fsm-option:hover:not([disabled]) {
      transform: translateY(-2px);
      box-shadow: 0 10px 22px -10px oklch(from var(--po-accent) l c h / 35%);
    }

    .fsm-option[data-accent="emerald"]:hover:not([disabled]) {
      border-color: rgba(16, 185, 129, 0.5);
      box-shadow: 0 10px 22px -10px rgba(16, 185, 129, 0.45);
    }

    .fsm-option[data-accent="indigo"]:hover:not([disabled]) {
      border-color: oklch(from var(--po-accent) l c h / 50%);
    }

    .fsm-option[disabled] { opacity: .5; cursor: not-allowed; }

    .opt-badge {
      position: absolute;
      top: 10px;
      right: 10px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .opt-badge--free { background: linear-gradient(135deg, #10b981, #34d399); color: #fff; }
    .opt-badge--primary { background: rgba(99, 102, 241, 0.14); color: #4f46e5; }

    .opt-icon {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 20px;
      box-shadow: 0 6px 14px -6px oklch(from var(--po-accent) l c h / 55%);
      margin-bottom: 6px;
    }
    .fsm-option[data-accent="emerald"] .opt-icon {
      background: linear-gradient(135deg, #10b981, #34d399);
      box-shadow: 0 6px 14px -6px rgba(16, 185, 129, 0.55);
    }
    .fsm-option[data-accent="indigo"] .opt-icon {
      background: linear-gradient(135deg, var(--po-accent), var(--po-accent-text));
    }

    .opt-title { font-size: 16px; font-weight: 600; margin: 0; }
    .opt-desc { font-size: 13px; color: var(--bs-secondary-color, #6c757d); margin: 0; line-height: 1.45; }
    .opt-micro {
      font-size: 12px;
      color: var(--bs-secondary-color, #8a94a6);
      margin: 4px 0 0;
      font-style: italic;
    }

    .fsm-footer { display: flex; justify-content: center; padding-top: 4px; }
    .fsm-skip {
      background: none;
      border: none;
      color: var(--bs-secondary-color, #6c757d);
      font-size: 13px;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
    }
    .fsm-skip:hover:not(:disabled) {
      color: var(--po-accent);
      background: oklch(from var(--po-accent) l c h / 8%);
    }
    .fsm-skip:disabled { opacity: .5; cursor: not-allowed; }
  `],
})
export class FirstSessionModalComponent {
  private readonly modal = inject(NgbActiveModal);
  private readonly auth = inject(AuthenticationService);

  readonly busy = signal(false);

  @Output() readonly choice = new EventEmitter<{ choice: FirstSessionChoice; provider: ProviderId | null }>();

  async pick(choice: FirstSessionChoice): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);

    const provider: ProviderId | null =
      choice === 'local' ? 'opencode' :
      choice === 'cloud' ? 'claude-code-cli' :
      null;

    if (provider) {
      try {
        await new Promise<void>((resolve) => {
          this.auth.setPreferredProvider(provider).subscribe({
            next: () => resolve(),
            error: () => resolve(),
          });
        });
      } catch { /* best-effort */ }
    }

    this.choice.emit({ choice, provider });
    this.modal.close({ choice, provider });
  }
}
