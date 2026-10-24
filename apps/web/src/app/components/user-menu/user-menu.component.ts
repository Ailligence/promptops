import { Component, Input, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { Store } from '@ngrx/store';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Placement } from '@ng-bootstrap/ng-bootstrap';
import { getUser } from '@/store/authentication/authentication.selector';
import { TutorialService } from '@/app/components/tutorial/tutorial.service';
import { UiStyleService } from '@core/services/ui-style.service';
import type { User } from '@core/models/user';
import { initialsAvatar } from '@core/helper/initials-avatar';

/**
 * User avatar + dropdown (settings, tutorial when minimal, support).
 * Extracted from the topbar
 * so the very same menu can live in the topbar (classic) or as the last
 * sidebar entry (minimal) without duplicating the markup or its logic.
 */
@Component({
  selector: 'app-user-menu',
  standalone: true,
  imports: [RouterModule, NgbDropdownModule, TranslateModule],
  template: `
    <div ngbDropdown [placement]="placement" [container]="variant === 'sidebar' ? 'body' : null" [class.um-sidebar]="variant === 'sidebar'">
      <a
        ngbDropdownToggle
        class="po-topbar-btn po-no-caret px-2 um-toggle"
        role="button"
        tabindex="0"
        aria-haspopup="menu"
        [attr.aria-label]="fullname || ('SETTINGS.Title' | translate)"
        (keydown.enter)="$event.preventDefault(); $any($event.currentTarget).click()"
        (keydown.space)="$event.preventDefault(); $any($event.currentTarget).click()"
      >
        <img
          [src]="avatarUrl"
          width="28"
          class="rounded-circle me-lg-2 d-flex"
          alt=""
          style="height: 28px; object-fit: cover;"
        />
        <span class="um-identity" [class.d-lg-flex]="variant === 'topbar'" [class.d-none]="variant === 'topbar'">
          <h5 class="my-0 d-flex align-items-center gap-1">
            {{ fullname }}
          </h5>
          <h6 class="my-0 fw-normal">{{ user()?.email }}</h6>
        </span>
        <i class="ti ti-chevron-down align-middle ms-2" [class.d-none]="variant === 'topbar'" [class.d-lg-block]="variant === 'topbar'"></i>
      </a>
      <div ngbDropdownMenu [class.dropdown-menu-end]="variant === 'topbar'">
        <div class="dropdown-header">
          <h6 class="m-0">{{ 'TOPBAR.Welcome' | translate }}</h6>
        </div>

        <a routerLink="/admin/settings" ngbDropdownItem>
          <i class="ti ti-settings me-1 fs-17 align-middle"></i>
          <span class="align-middle">{{ 'SETTINGS.Title' | translate }}</span>
        </a>

        <!-- Minimal: the tutorial lives here (topbar button hidden by the skin) -->
        @if (uiStyle() === 'minimal') {
          <button type="button" ngbDropdownItem (click)="startTutorial()">
            <i class="ti ti-player-play me-1 fs-17 align-middle"></i>
            <span class="align-middle">{{ 'TUTORIAL.start' | translate }}</span>
          </button>
        }

        <a routerLink="/admin/feedback" ngbDropdownItem>
          <i class="ti ti-lifebuoy me-1 fs-17 align-middle"></i>
          <span class="align-middle">{{ 'TOPBAR.Support' | translate }}</span>
        </a>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .um-toggle { position: relative; }
    /* Behave like the original inline dropdown inside .po-topbar-user. */
    :host { display: flex; align-items: center; }
    /* Drop the ngbDropdown caret: the toggle draws its own chevron. */
    .um-toggle::after { display: none !important; }
    /* Keep the avatar a perfect circle — flex must not squeeze it oval. */
    .um-toggle img {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      min-width: 28px;
    }
    /* Name over email, as in the classic topbar. */
    .um-identity { flex-direction: column; gap: 1px; }
    .um-identity h5 { font-size: 0.8125rem; line-height: 1.2; }
    .um-identity h6 { font-size: 0.6875rem; line-height: 1.2; }
    /* Sidebar variant: the toggle reads as a full-width menu row. */
    .um-sidebar .um-toggle {
      display: flex;
      align-items: center;
      width: 100%;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
    }
    .um-sidebar .um-identity {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .um-sidebar .um-identity h5 {
      font-size: var(--po-text-base, 0.8125rem);
      font-weight: var(--po-weight-semibold, 600);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .um-sidebar .um-identity h6 {
      font-size: var(--po-text-xs, 0.6875rem);
      color: var(--po-text-tertiary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `],
})
export class UserMenuComponent {
  /** 'topbar' = compact avatar + names; 'sidebar' = full-width menu row. */
  @Input() variant: 'topbar' | 'sidebar' = 'topbar';
  @Input() placement: Placement = 'bottom-end';

  private store = inject(Store);
  private tutorialService = inject(TutorialService);
  private uiStyleService = inject(UiStyleService);

  readonly uiStyle = this.uiStyleService.style;
  readonly isDesktop = !!(window as any).promptops;
  readonly user = signal<User | null>(readStoredUser());

  constructor() {
    // Keep the avatar/name fresh as the store user changes (login, /me).
    this.store.select(getUser).pipe(takeUntilDestroyed()).subscribe((u) => {
      if (u) this.user.set(u as User);
    });
  }

  get fullname(): string {
    const u = this.user();
    return u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '';
  }

  get avatarUrl(): string {
    const u = this.user();
    if (u?.avatar_url) return u.avatar_url;
    return initialsAvatar(this.fullname);
  }

  startTutorial(): void {
    this.tutorialService.start();
  }
}

function readStoredUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem('user')!) as User;
  } catch {
    return null;
  }
}
