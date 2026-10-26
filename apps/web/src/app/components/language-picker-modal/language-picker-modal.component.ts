import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  Input,
} from "@angular/core";
import { NgbActiveModal } from "@ng-bootstrap/ng-bootstrap";
import { TranslateModule } from "@ngx-translate/core";

export interface LanguageOption {
  code: string;
  flag: string;
  label: string;
}

/**
 * The 15 supported locales — single source for every language picker entry point.
 * `flag` is an SVG asset path (not an emoji): Windows does not render
 * regional-indicator emoji pairs as flags.
 */
export const AVAILABLE_LANGUAGES: LanguageOption[] = [
  { code: 'en', flag: 'assets/images/flags/gb.svg', label: 'English' },
  { code: 'it', flag: 'assets/images/flags/it.svg', label: 'Italiano' },
  { code: 'es', flag: 'assets/images/flags/es.svg', label: 'Español' },
  { code: 'fr', flag: 'assets/images/flags/fr.svg', label: 'Français' },
  { code: 'de', flag: 'assets/images/flags/de.svg', label: 'Deutsch' },
  { code: 'pt', flag: 'assets/images/flags/br.svg', label: 'Português' },
  { code: 'nl', flag: 'assets/images/flags/nl.svg', label: 'Nederlands' },
  { code: 'pl', flag: 'assets/images/flags/pl.svg', label: 'Polski' },
  { code: 'sv', flag: 'assets/images/flags/se.svg', label: 'Svenska' },
  { code: 'ru', flag: 'assets/images/flags/ru.svg', label: 'Русский' },
  { code: 'zh', flag: 'assets/images/flags/cn.svg', label: '中文' },
  { code: 'ja', flag: 'assets/images/flags/jp.svg', label: '日本語' },
  { code: 'ko', flag: 'assets/images/flags/kr.svg', label: '한국어' },
  { code: 'hi', flag: 'assets/images/flags/in.svg', label: 'हिन्दी' },
  { code: 'ar', flag: 'assets/images/flags/sa.svg', label: 'العربية' },
];

@Component({
  selector: "po-language-picker-modal",
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-header py-2">
      <div class="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
        <iconify-icon icon="solar:globus-bold-duotone" width="22" class="text-primary"></iconify-icon>
        <h5 class="modal-title mb-0 text-truncate">{{ "COMMON.Language" | translate }}</h5>
      </div>
      <button type="button" class="btn-close" [attr.aria-label]="'BUTTONS.Close' | translate" (click)="cancel()"></button>
    </div>

    <div class="modal-body p-3">
      <div class="po-lang-grid">
        @for (lang of languages; track lang.code) {
          <button
            type="button"
            class="po-lang-cell"
            [class.active]="lang.code === currentLang"
            [attr.aria-pressed]="lang.code === currentLang"
            [attr.lang]="lang.code"
            (click)="pick(lang.code)"
          >
            <img class="po-lang-flag" [src]="lang.flag" alt="" aria-hidden="true" />
            <span class="po-lang-label">{{ lang.label }}</span>
            @if (lang.code === currentLang) {
              <iconify-icon
                icon="solar:check-circle-bold"
                width="16"
                class="po-lang-check"
              ></iconify-icon>
            }
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .min-w-0 {
        min-width: 0;
      }
      .po-lang-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.5rem;
      }
      @media (min-width: 576px) {
        .po-lang-grid {
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 0.625rem;
        }
      }
      .po-lang-cell {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        min-height: 96px;
        padding: 0.75rem 0.5rem;
        border-radius: 0.75rem;
        border: 1px solid var(--bs-border-color, rgba(0, 0, 0, 0.1));
        background: var(--bs-tertiary-bg, rgba(0, 0, 0, 0.02));
        color: var(--bs-body-color);
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          border-color 0.15s ease,
          transform 0.15s ease;
      }
      .po-lang-cell:hover {
        background: var(--bs-secondary-bg, rgba(0, 0, 0, 0.04));
        border-color: var(--bs-border-color-translucent, rgba(0, 0, 0, 0.15));
      }
      .po-lang-cell:active {
        transform: scale(0.98);
      }
      .po-lang-cell.active {
        border-color: var(--bs-primary, var(--po-accent));
        background: color-mix(in srgb, var(--bs-primary, var(--po-accent)) 10%, transparent);
        box-shadow:
          0 0 0 1px var(--bs-primary, #6366f1),
          inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }
      .po-lang-flag {
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 50%;
        object-fit: cover;
        display: block;
      }
      .po-lang-label {
        font-size: 0.75rem;
        font-weight: 500;
        text-align: center;
        line-height: 1.15;
      }
      .po-lang-cell.active .po-lang-label {
        color: var(--bs-primary-text-emphasis, var(--bs-primary, var(--po-accent)));
        font-weight: 600;
      }
      .po-lang-check {
        position: absolute;
        top: 0.375rem;
        inset-inline-end: 0.375rem;
        color: var(--bs-primary, var(--po-accent));
      }
    `,
  ],
  host: {
    "(keydown.escape)": "cancel()",
    tabindex: "0",
  },
})
export class LanguagePickerModalComponent {
  /** Caller must set. */
  @Input() languages: LanguageOption[] = [];
  /** Caller must set. Currently active language code. */
  @Input() currentLang = "";

  constructor(private readonly activeModal: NgbActiveModal) {}

  pick(code: string): void {
    this.activeModal.close(code);
  }

  cancel(): void {
    this.activeModal.dismiss();
  }
}
