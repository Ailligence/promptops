import { Component, CUSTOM_ELEMENTS_SCHEMA, signal, ChangeDetectionStrategy } from "@angular/core";
import { TranslateModule } from "@ngx-translate/core";
import { APP_VERSION } from "@environment/version";
import { DESKTOP_SITE_URL, GITHUB_ISSUES_URL, openExternal } from "@core/local-mode";

const REPO_URL = "https://github.com/shellonback/promptops";

/** Version, license and where to find the code, the privacy notes and help. */
@Component({
  selector: "app-about-card",
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="about-row">
      <span class="about-label">{{ 'ABOUT.Version' | translate }}</span>
      <span class="about-value">{{ version }}</span>
    </div>
    <div class="about-row">
      <span class="about-label">{{ 'ABOUT.License' | translate }}</span>
      <span class="about-value">Apache-2.0</span>
    </div>
    @if (keySource(); as source) {
      <div class="about-row">
        <span class="about-label">{{ 'ABOUT.Encryption key' | translate }}</span>
        <span class="about-value" [class.about-warning]="source === 'file'">{{ 'ABOUT.Key ' + source | translate }}</span>
      </div>
      @if (source === 'file') {
        <p class="about-note about-warning">{{ 'ABOUT.Key file note' | translate }}</p>
      }
    }
    <p class="about-note">{{ 'ABOUT.Local note' | translate }}</p>
    <div class="about-links">
      @for (link of links; track link.key) {
        <button type="button" class="about-link" (click)="open(link.url)">
          <i class="ti {{ link.icon }}"></i>{{ 'ABOUT.' + link.key | translate }}
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .about-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.35rem 0;
      font-size: 0.85rem;
    }
    .about-label { color: var(--po-text-secondary, #64748b); }
    .about-value { font-weight: 600; font-variant-numeric: tabular-nums; }
    .about-warning { color: var(--promptops-warning, #b45309); }
    .about-note {
      font-size: 0.78rem;
      color: rgba(100, 116, 139, 0.8);
      line-height: 1.45;
      margin: 0.75rem 0;
    }
    .about-links { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .about-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.4rem 0.8rem;
      border-radius: 10px;
      font-size: 0.8rem;
      font-weight: 500;
      background: oklch(from var(--po-accent) l c h / 6%);
      color: var(--po-accent, var(--po-accent));
      border: 1px solid oklch(from var(--po-accent) l c h / 15%);
      cursor: pointer;
    }
    .about-link:hover { background: rgba(79, 70, 229, 0.12); }
  `,
})
export class AboutCardComponent {
  /** Version of the desktop app (injected by the shell), else the web build's. */
  readonly version: string = (window as { promptops?: { appVersion?: string | null } }).promptops?.appVersion || APP_VERSION;

  /** Where the Session Vault key lives; null outside the desktop app. */
  readonly keySource = signal<"keychain" | "file" | "development" | null>(null);

  constructor() {
    const bridge = (window as { promptops?: { localStoreKeySource?: () => Promise<string> } }).promptops;
    bridge?.localStoreKeySource?.()
      .then((source) => {
        if (source === "keychain" || source === "file" || source === "development") this.keySource.set(source);
      })
      .catch(() => undefined);
  }

  get links() {
    return [
      { key: "Source code", icon: "ti-brand-github", url: REPO_URL },
      { key: "Privacy", icon: "ti-shield-lock", url: `${REPO_URL}/blob/main/PRIVACY.md` },
      { key: "Report an issue", icon: "ti-bug", url: GITHUB_ISSUES_URL },
      { key: "Licenses", icon: "ti-license", url: `${REPO_URL}/blob/main/apps/web/public/THIRD-PARTY-NOTICES.txt` },
      { key: "Get PromptOps Desktop", icon: "ti-download", url: DESKTOP_SITE_URL },
    ];
  }

  open(url: string): void {
    openExternal(url);
  }
}
