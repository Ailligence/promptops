import { Component, ChangeDetectionStrategy } from "@angular/core";
import { RouterLink } from "@angular/router";
import { TranslateModule } from "@ngx-translate/core";


@Component({
  selector: 'app-logo-box',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  template: `
    <a routerLink="/admin" class="po-brand" aria-label="PromptOps">
      <!-- Light theme: dark ink on a light background -->
      <span class="po-brand-for-light">
        <span class="po-brand-full">
          <span class="promptops-brand">
            <span class="promptops-wordmark">
              <span class="prompt-text">Prompt</span><span class="ops-text">Ops</span>
            </span>
            <span class="powered-by">
              {{ 'COMMON.Powered by' | translate }}
              <img src="assets/logos/shellonback-logo.png" alt="Shellonback" class="shellonback-sm" />
            </span>
          </span>
        </span>
        <span class="po-brand-mark">
          <img src="assets/logos/compact-logo-v3.png" alt="PromptOps" class="compact-mark" />
        </span>
      </span>

      <!-- Dark theme: light ink on a dark background -->
      <span class="po-brand-for-dark">
        <span class="po-brand-full">
          <span class="promptops-brand">
            <span class="promptops-wordmark">
              <span class="prompt-text light">Prompt</span><span class="ops-text">Ops</span>
            </span>
            <span class="powered-by light">
              {{ 'COMMON.Powered by' | translate }}
              <img src="assets/logos/shellonback-logo.png" alt="Shellonback" class="shellonback-sm light" />
            </span>
          </span>
        </span>
        <span class="po-brand-mark">
          <img src="assets/logos/compact-logo-v3.png" alt="PromptOps" class="compact-mark" />
        </span>
      </span>
    </a>`,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
    .po-brand {
      display: flex;
      width: 100%;
    }
    .po-brand > span {
      width: 100%;
    }
    .po-brand-full {
      display: flex;
      align-items: center;
      width: 100%;
    }
    .promptops-brand {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 2px;
      padding: 0;
      width: 100%;
    }
    .promptops-wordmark {
      display: flex;
      align-items: baseline;
      width: 100%;
      font-family: "Geist", "Inter", sans-serif;
      font-weight: 700;
      font-size: 1.55rem;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    /* Light mode: dark text */
    .prompt-text {
      color: #1a1a1a;
    }
    .prompt-text.light {
      color: #f0f0f0;
    }
    /* Dark theme override: always white text regardless of the ink block */
    :host-context([data-bs-theme="dark"]) .prompt-text {
      color: #f0f0f0;
    }
    /* Light theme override: always black text regardless of the ink block */
    :host-context([data-bs-theme="light"]) .prompt-text {
      color: #1a1a1a;
    }
    .ops-text {
      background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 50%, #A855F7 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .powered-by {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 0.55rem;
      font-weight: 400;
      color: #9ca3af;
      letter-spacing: 0.03em;
      line-height: 1;
    }
    .powered-by.light {
      color: #9ca3af;
    }
    .shellonback-sm {
      height: 9px;
      width: auto;
      opacity: 0.7;
    }
    /* Invert the logo for dark mode */
    .shellonback-sm.light {
      filter: brightness(0) invert(1);
      opacity: 0.8;
    }
    .promptops-icon {
      display: flex;
      align-items: baseline;
      font-family: "Geist", "Inter", sans-serif;
      font-weight: 800;
      font-size: 1.3rem;
      letter-spacing: -0.03em;
      line-height: 1;
    }
    .po-brand-mark {
      width: 100%;
      text-align: center;
    }
    .compact-mark {
      display: inline-block;
      height: 34px;
      width: 34px;
      box-sizing: border-box;
      padding: 5px;
      background: #ffffff;
      border-radius: 50%;
      object-fit: contain;
      vertical-align: middle;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
    }
  `],
})

export class LogoBoxComponent {}
