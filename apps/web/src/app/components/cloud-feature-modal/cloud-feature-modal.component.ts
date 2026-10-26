import { Component, HostListener, inject, ChangeDetectionStrategy } from "@angular/core";
import { NgbActiveModal, NgbModal } from "@ng-bootstrap/ng-bootstrap";
import { TranslateModule } from "@ngx-translate/core";
import { DESKTOP_SITE_URL, openExternal } from "@core/local-mode";

/** Features that need other people, and so PromptOps Cloud. */
export type CloudFeature = "teams" | "ranking" | "morning" | "explore" | "organization" | "profile" | "remote";

const ICONS: Record<CloudFeature, string> = {
  teams: "ti-users-group",
  ranking: "ti-trophy",
  morning: "ti-news",
  explore: "ti-world",
  organization: "ti-building",
  profile: "ti-user-circle",
  remote: "ti-device-mobile",
};

/**
 * Shown when a locked feature is opened in the open-source edition. Explains
 * why it lives in PromptOps Desktop and links to its website. Nothing is
 * sent anywhere: the button only opens the website in the system browser.
 */
@Component({
  selector: "cloud-feature-modal",
  standalone: true,
  imports: [TranslateModule],
  template: `
    <div class="cloud-modal">
      <button type="button" class="btn-close cloud-close" (click)="activeModal.dismiss()" [attr.aria-label]="'CLOUD.Not now' | translate"></button>

      <div class="cloud-head">
        <span class="cloud-icon"><i class="ti {{ icon }}"></i></span>
        <span class="cloud-badge"><i class="ti ti-lock"></i>{{ "CLOUD.Badge" | translate }}</span>
      </div>

      <h4 class="cloud-title">{{ "CLOUD." + feature + ".Name" | translate }}</h4>
      <p class="cloud-pitch">{{ "CLOUD." + feature + ".Pitch" | translate }}</p>
      <p class="cloud-why">{{ "CLOUD.Why" | translate }}</p>

      <div class="cloud-actions">
        <button class="btn cloud-secondary" type="button" (click)="activeModal.dismiss()">{{ "CLOUD.Not now" | translate }}</button>
        <button class="btn cloud-primary" type="button" (click)="download()">
          {{ "CLOUD.Get" | translate }}<i class="ti ti-external-link ms-2"></i>
        </button>
      </div>

      <p class="cloud-footnote"><i class="ti ti-shield-check"></i>{{ "CLOUD.Local footnote" | translate }}</p>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .cloud-modal {
      position: relative;
      padding: 28px 28px 20px;
      --cloud-accent: var(--po-accent);
    }

    .cloud-close {
      position: absolute;
      top: 18px;
      right: 18px;
      font-size: 0.75rem;
    }

    .cloud-head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
    }

    .cloud-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: oklch(from var(--po-accent) l c h / 10%);
      color: var(--cloud-accent);
      font-size: 1.4rem;
    }

    .cloud-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border: 1px solid var(--promptops-border-color);
      border-radius: 999px;
      color: var(--promptops-secondary-color, #6b7280);
      font-size: 0.75rem;
      font-weight: 500;
    }

    .cloud-title {
      margin: 0 0 8px;
      font-size: 1.375rem;
      font-weight: 700;
      color: var(--promptops-emphasis-color, inherit);
    }

    .cloud-pitch {
      margin: 0 0 10px;
      font-size: 0.95rem;
      line-height: 1.5;
      color: var(--promptops-body-color);
    }

    .cloud-why {
      margin: 0 0 24px;
      font-size: 0.85rem;
      line-height: 1.5;
      color: var(--promptops-secondary-color, #6b7280);
    }

    .cloud-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .cloud-primary {
      background: var(--cloud-accent);
      border: 1px solid var(--cloud-accent);
      border-radius: 10px;
      color: #fff;
      font-weight: 600;
      padding: 8px 16px;
    }

    .cloud-primary:hover,
    .cloud-primary:focus-visible {
      background: #3f32e0;
      border-color: #3f32e0;
      color: #fff;
    }

    .cloud-secondary {
      background: transparent;
      border: 1px solid var(--promptops-border-color);
      border-radius: 10px;
      color: var(--promptops-body-color);
      font-weight: 500;
      padding: 8px 16px;
    }

    .cloud-secondary:hover {
      background: var(--promptops-tertiary-bg);
      color: var(--promptops-body-color);
    }

    .cloud-footnote {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 18px -28px -20px;
      padding: 12px 28px;
      border-top: 1px solid var(--promptops-border-color);
      color: var(--promptops-secondary-color, #6b7280);
      font-size: 0.75rem;
    }

    :host-context([data-bs-theme="dark"]) .cloud-icon {
      background: rgba(129, 120, 255, 0.14);
      color: #a5a0ff;
    }
  `,
})
export class CloudFeatureModalComponent {
  activeModal = inject(NgbActiveModal);

  feature: CloudFeature = "teams";

  get icon(): string {
    return ICONS[this.feature];
  }

  /** Opens the dialog for a feature, unless another dialog is already open. */
  static open(modalService: NgbModal, feature: CloudFeature): void {
    if (modalService.hasOpenModals()) {
      return;
    }
    const ref = modalService.open(CloudFeatureModalComponent, { centered: true, backdrop: true, windowClass: "cloud-feature-window" });
    ref.componentInstance.feature = feature;
  }

  @HostListener("document:keydown.enter", ["$event"])
  onEnter(event: Event): void {
    event.preventDefault();
    this.download();
  }

  download(): void {
    openExternal(DESKTOP_SITE_URL);
    this.activeModal.close();
  }
}
