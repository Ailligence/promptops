import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnInit,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TooltipDirective } from '../../../../common/tooltip.directive';
import { EscCloseDirective } from '../../../../common/esc-close.directive';
import { SessionProfilesService } from '../services/session-profiles.service';

/**
 * Compact profile switcher that lives in the sessions sidebar header, beside the
 * "New" button. The trigger is a single profile icon (accented while a named
 * profile is active); clicking opens a dropdown listing the Standard profile
 * (always present, never deletable) plus the user's named profiles, with inline
 * create and a two-click inline delete (no blocking dialogs).
 *
 * Switching delegates to SessionProfilesService, which drives the desktop
 * teardown/restore and reloads the lists. Rendered only when the feature flag is
 * on AND the minimal skin is active (gated by the parent sidebar).
 */
@Component({
  selector: 'app-session-profile-switcher',
  standalone: true,
  imports: [FormsModule, TranslateModule, TooltipDirective, EscCloseDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="profile-switcher">
      <button
        class="ps-trigger"
        [class.active]="activeId() !== null"
        (click)="toggle()"
        [disabled]="switching()"
        [appTooltip]="'SESSIONS.PROFILES.ActiveTooltip' | translate: { name: activeLabel() }"
        [attr.aria-label]="'SESSIONS.PROFILES.ActiveTooltip' | translate: { name: activeLabel() }"
        [attr.aria-expanded]="open()"
      >
        @if (switching()) {
          <iconify-icon icon="svg-spinners:90-ring-with-bg" width="15"></iconify-icon>
        } @else {
          <iconify-icon icon="solar:user-rounded-linear" width="15"></iconify-icon>
        }
      </button>

      @if (open()) {
        <div class="ps-backdrop" (click)="close()"></div>
        <div class="ps-menu" appEscClose (escClose)="close()">
          <div class="ps-menu-head">{{ 'SESSIONS.PROFILES.Title' | translate }}</div>

          <button
            class="ps-item"
            [class.active]="activeId() === null"
            (click)="select(null)"
          >
            <iconify-icon icon="solar:home-2-linear" width="13"></iconify-icon>
            <span class="ps-name">{{ 'SESSIONS.PROFILES.Standard' | translate }}</span>
            @if (activeId() === null) {
              <iconify-icon class="ps-check" icon="solar:check-circle-bold" width="13"></iconify-icon>
            }
          </button>

          @for (p of profiles(); track p.id) {
            <div class="ps-row">
              <button
                class="ps-item"
                [class.active]="activeId() === p.id"
                (click)="select(p.id)"
              >
                <iconify-icon icon="solar:folder-linear" width="13"></iconify-icon>
                <span class="ps-name">{{ p.name }}</span>
                @if (activeId() === p.id) {
                  <iconify-icon class="ps-check" icon="solar:check-circle-bold" width="13"></iconify-icon>
                }
              </button>
              @if (pendingDeleteId() === p.id) {
                <button
                  class="ps-del confirm"
                  (click)="confirmDelete(p.id, $event)"
                  [appTooltip]="'SESSIONS.PROFILES.ConfirmDelete' | translate"
                  [attr.aria-label]="'SESSIONS.PROFILES.ConfirmDelete' | translate"
                >
                  <iconify-icon icon="solar:trash-bin-trash-bold" width="12"></iconify-icon>
                </button>
              } @else {
                <button
                  class="ps-del"
                  (click)="askDelete(p.id, $event)"
                  [appTooltip]="'SESSIONS.PROFILES.Delete' | translate"
                  [attr.aria-label]="'SESSIONS.PROFILES.Delete' | translate"
                >
                  <iconify-icon icon="solar:trash-bin-minimalistic-linear" width="12"></iconify-icon>
                </button>
              }
            </div>
          }

          <div class="ps-sep"></div>

          @if (errorKey(); as err) {
            <div class="ps-error" role="alert">{{ err | translate }}</div>
          }

          @if (creating()) {
            <div class="ps-create">
              <input
                [(ngModel)]="newName"
                (keydown.enter)="confirmCreate()"
                (keydown.escape)="$event.stopPropagation(); creating.set(false)"
                [attr.aria-label]="'SESSIONS.PROFILES.NamePlaceholder' | translate"
                [placeholder]="'SESSIONS.PROFILES.NamePlaceholder' | translate"
                maxlength="255"
                autofocus
              />
              <button (click)="confirmCreate()" [disabled]="busy()" [appTooltip]="'SESSIONS.PROFILES.Create' | translate" [attr.aria-label]="'SESSIONS.PROFILES.Create' | translate">
                <iconify-icon icon="solar:check-circle-bold" width="15"></iconify-icon>
              </button>
            </div>
          } @else {
            <button class="ps-item ps-new" (click)="startCreate()">
              <iconify-icon icon="solar:add-circle-linear" width="13"></iconify-icon>
              <span class="ps-name">{{ 'SESSIONS.PROFILES.New' | translate }}</span>
            </button>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .profile-switcher { position: relative; display: inline-flex; }

    /* Circular outline icon button, sits just before the "Sessions" label. */
    .ps-trigger {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px;
      border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 50%;
      background: transparent; color: var(--po-text-secondary);
      cursor: pointer; flex-shrink: 0; transition: all 0.15s;
    }
    .ps-trigger:hover {
      background: rgba(255, 255, 255, 0.06); color: var(--po-text-primary);
      border-color: rgba(255, 255, 255, 0.35);
    }
    .ps-trigger.active { color: var(--po-accent); border-color: var(--po-accent); }
    .ps-trigger:disabled { opacity: 0.6; cursor: default; }

    .ps-backdrop { position: fixed; inset: 0; z-index: 40; }
    .ps-menu {
      position: absolute; z-index: 41; top: 100%; inset-inline-start: 0; margin-top: 6px;
      min-width: 212px; max-height: 340px; overflow-y: auto;
      background: var(--po-bg-2, #1b1b22); border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 9px; padding: 4px; box-shadow: 0 14px 36px -12px rgba(0, 0, 0, 0.65);
    }
    .ps-menu-head {
      padding: 5px 8px 6px; font-size: 0.62rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.07em; color: var(--po-text-secondary);
    }
    .ps-row { display: flex; align-items: center; gap: 2px; }
    .ps-item {
      display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0;
      padding: 6px 8px; border: none; border-radius: 6px; background: transparent;
      color: var(--po-text-secondary); font-size: 0.78rem; cursor: pointer; text-align: start;
    }
    .ps-item:hover { background: rgba(255, 255, 255, 0.05); }
    .ps-item.active { color: var(--po-text-primary); }
    .ps-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ps-check { color: var(--po-accent); }
    .ps-new { color: var(--po-accent); }
    .ps-del {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border: none; border-radius: 6px;
      background: transparent; color: var(--po-text-secondary); cursor: pointer;
    }
    .ps-del:hover { background: rgba(255, 80, 80, 0.12); color: #ff6b6b; }
    .ps-del.confirm { color: #ff6b6b; background: rgba(255, 80, 80, 0.12); }
    .ps-error { padding: 4px 8px; font-size: 0.72rem; color: var(--po-error, #ff6b6b); }
    .ps-sep { height: 1px; background: rgba(255, 255, 255, 0.07); margin: 4px 6px; }
    .ps-create { display: flex; align-items: center; gap: 4px; padding: 4px 6px; }
    .ps-create input {
      flex: 1; min-width: 0; padding: 5px 8px; font-size: 0.78rem;
      border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 6px;
      background: var(--po-bg-3, rgba(255, 255, 255, 0.04)); color: var(--po-text-primary);
    }
    .ps-create button {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: none; border-radius: 6px;
      background: transparent; color: var(--po-accent); cursor: pointer;
    }
  `,
})
export class SessionProfileSwitcherComponent implements OnInit {
  private svc = inject(SessionProfilesService);
  private translate = inject(TranslateService);

  readonly profiles = this.svc.profiles;
  readonly activeId = this.svc.activeProfileId;
  readonly switching = this.svc.switching;

  readonly open = signal(false);
  readonly creating = signal(false);
  readonly pendingDeleteId = signal<string | null>(null);
  /** i18n key of the last failed action, shown inside the menu. */
  readonly errorKey = signal<string | null>(null);
  readonly busy = signal(false);
  newName = '';

  readonly activeLabel = computed(() => {
    const id = this.activeId();
    const standard = this.translate.instant('SESSIONS.PROFILES.Standard');
    if (!id) return standard;
    return this.profiles().find((p) => p.id === id)?.name ?? standard;
  });

  ngOnInit(): void {
    void this.svc.init();
  }

  toggle(): void {
    this.open.update((o) => !o);
    this.creating.set(false);
    this.pendingDeleteId.set(null);
    this.errorKey.set(null);
  }

  close(): void {
    this.open.set(false);
    this.creating.set(false);
    this.pendingDeleteId.set(null);
    this.errorKey.set(null);
  }

  async select(id: string | null): Promise<void> {
    this.close();
    if (!(await this.svc.switchTo(id))) {
      // Reopen the menu on the failure so it is not silent.
      this.open.set(true);
      this.errorKey.set('SESSIONS.PROFILES.SwitchFailed');
    }
  }

  startCreate(): void {
    this.creating.set(true);
    this.errorKey.set(null);
    this.newName = '';
  }

  async confirmCreate(): Promise<void> {
    const name = this.newName.trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    let created: Awaited<ReturnType<SessionProfilesService['createProfile']>> = null;
    try {
      created = await this.svc.createProfile(name);
    } catch {
      created = null;
    } finally {
      this.busy.set(false);
    }
    if (!created) {
      // Keep the row open with the typed name so the user can retry.
      this.errorKey.set('SESSIONS.PROFILES.CreateFailed');
      return;
    }
    this.creating.set(false);
    this.newName = '';
    await this.select(created.id);
  }

  askDelete(id: string, ev: Event): void {
    ev.stopPropagation();
    this.pendingDeleteId.set(id);
  }

  async confirmDelete(id: string, ev: Event): Promise<void> {
    ev.stopPropagation();
    this.pendingDeleteId.set(null);
    this.errorKey.set(null);
    if (!(await this.svc.deleteProfile(id))) this.errorKey.set('SESSIONS.PROFILES.DeleteFailed');
  }
}
