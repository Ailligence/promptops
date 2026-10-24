import { Component, Input, ChangeDetectionStrategy } from "@angular/core";
import { TranslateModule } from "@ngx-translate/core";
import { openExternal } from "@core/local-mode";

const RELEASES_URL = "https://github.com/shellonback/promptops/releases";

/**
 * Shown only when the web UI is opened outside the desktop shell (a plain
 * browser on the dev server): sessions and terminals need the native app.
 */
@Component({
  selector: "app-desktop-download-cta",
  standalone: true,
  imports: [TranslateModule],
  template: `
    <div class="desktop-cta-page">
      <div class="cta-icon-wrap"><i class="ti ti-device-desktop"></i></div>
      <h2>{{ "DESKTOP_CTA.title" | translate }}</h2>
      <p class="cta-desc">{{ "DESKTOP_CTA.desc" | translate }}</p>
      <button type="button" class="btn btn-primary" (click)="open()">
        <i class="ti ti-brand-github me-1"></i>{{ "DESKTOP_CTA.Releases" | translate }}
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .desktop-cta-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      min-height: 60vh;
      padding: 32px;
      text-align: center;
    }
    .cta-icon-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 14px;
      background: rgba(79, 65, 250, 0.1);
      color: #4f41fa;
      font-size: 1.6rem;
    }
    h2 { margin: 0; font-size: 1.5rem; font-weight: 700; }
    .cta-desc { margin: 0; max-width: 460px; color: var(--promptops-secondary-color, #64748b); }
  `,
})
export class DesktopDownloadCtaComponent {
  /** Where it is shown; kept for the templates that pass it. */
  @Input() context: "sessions" | "terminal" = "sessions";

  open(): void {
    openExternal(RELEASES_URL);
  }
}
