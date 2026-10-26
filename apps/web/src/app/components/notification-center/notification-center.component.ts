import { Component, Input, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import {
  NotificationCenterService,
  UnifiedNotification,
} from '@core/services/notification-center.service';

@Component({
  selector: 'app-notification-center',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    NgbDropdownModule,
    TranslateModule,
  ],
  styles: `
    /* ═══════════════════════════════════════════════
       Bell button
       ═══════════════════════════════════════════════ */
    .nc-badge {
      position: absolute;
      top: -3px;
      inset-inline-end: -7px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: #fff;
      font-size: 0.58rem;
      font-weight: 700;
      line-height: 18px;
      text-align: center;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(239, 68, 68, 0.4);
    }

    /* ═══════════════════════════════════════════════
       Dropdown panel
       ═══════════════════════════════════════════════ */
    .nc-dropdown {
      width: 420px;
      max-width: 96vw;
      border-radius: 16px;
      overflow: hidden;
      background: var(--bs-body-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(0, 0, 0, 0.06);
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.05),
        0 20px 50px -12px rgba(0, 0, 0, 0.15);
    }
    :host-context([data-bs-theme="dark"]) .nc-dropdown {
      background: rgba(15, 23, 42, 0.96);
      border-color: rgba(255, 255, 255, 0.06);
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.15),
        0 20px 50px -12px rgba(0, 0, 0, 0.5);
    }

    /* ═══════════════════════════════════════════════
       Header
       ═══════════════════════════════════════════════ */
    .nc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px 14px;
      background: linear-gradient(180deg, oklch(from var(--po-accent) l c h / 3%) 0%, transparent 100%);
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }
    :host-context([data-bs-theme="dark"]) .nc-header {
      background: linear-gradient(180deg, oklch(from var(--po-accent) l c h / 6%) 0%, transparent 100%);
      border-bottom-color: rgba(255, 255, 255, 0.05);
    }
    .nc-header-title {
      font-size: 0.92rem;
      font-weight: 700;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      letter-spacing: -0.01em;
    }
    .nc-header-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      padding: 0 7px;
      border-radius: 11px;
      font-size: 0.65rem;
      font-weight: 700;
      background: linear-gradient(135deg, oklch(from var(--po-accent) l c h / 12%) 0%, oklch(from var(--po-accent) l c h / 12%) 100%);
      color: var(--po-accent);
    }
    :host-context([data-bs-theme="dark"]) .nc-header-count {
      background: linear-gradient(135deg, oklch(from var(--po-accent) l c h / 20%) 0%, oklch(from var(--po-accent) l c h / 20%) 100%);
      color: var(--po-accent-text);
    }
    .nc-mark-btn {
      font-size: 0.73rem;
      font-weight: 600;
      color: var(--po-accent);
      background: oklch(from var(--po-accent) l c h / 6%);
      border: none;
      border-radius: 8px;
      padding: 5px 10px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    .nc-mark-btn:hover {
      background: oklch(from var(--po-accent) l c h / 12%);
      color: var(--po-accent);
    }
    :host-context([data-bs-theme="dark"]) .nc-mark-btn {
      background: oklch(from var(--po-accent) l c h / 10%);
      color: var(--po-accent-text);
    }
    :host-context([data-bs-theme="dark"]) .nc-mark-btn:hover {
      background: oklch(from var(--po-accent) l c h / 18%);
    }

    /* ═══════════════════════════════════════════════
       Scrollable body
       ═══════════════════════════════════════════════ */
    .nc-body {
      max-height: 440px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .nc-body::-webkit-scrollbar { width: 4px; }
    .nc-body::-webkit-scrollbar-track { background: transparent; }
    .nc-body::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 4px;
    }
    :host-context([data-bs-theme="dark"]) .nc-body::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.08);
    }

    /* ═══════════════════════════════════════════════
       Section labels
       ═══════════════════════════════════════════════ */
    .nc-section {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--bs-secondary-color);
      padding: 14px 20px 6px;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .nc-section i { font-size: 13px; opacity: 0.55; }
    .nc-section-divider {
      flex: 1;
      height: 1px;
      background: var(--bs-border-color);
      opacity: 0.5;
      margin-left: 6px;
    }

    /* ═══════════════════════════════════════════════
       Notification item
       ═══════════════════════════════════════════════ */
    .nc-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 20px;
      cursor: pointer;
      transition: background 0.15s ease;
      position: relative;
    }
    .nc-item:hover {
      background: oklch(from var(--po-accent) l c h / 4%);
    }
    :host-context([data-bs-theme="dark"]) .nc-item:hover {
      background: oklch(from var(--po-accent) l c h / 6%);
    }
    .nc-item + .nc-item {
      border-top: 1px solid rgba(0, 0, 0, 0.03);
    }
    :host-context([data-bs-theme="dark"]) .nc-item + .nc-item {
      border-top-color: rgba(255, 255, 255, 0.03);
    }

    /* Unread state */
    .nc-item.unread {
      background: oklch(from var(--po-accent) l c h / 4%);
    }
    :host-context([data-bs-theme="dark"]) .nc-item.unread {
      background: oklch(from var(--po-accent) l c h / 7%);
    }
    .nc-item.unread:hover {
      background: oklch(from var(--po-accent) l c h / 6%);
    }
    :host-context([data-bs-theme="dark"]) .nc-item.unread:hover {
      background: oklch(from var(--po-accent) l c h / 10%);
    }

    /* Left accent stripe */
    .nc-item.unread::after {
      content: '';
      position: absolute;
      inset-inline-start: 0; top: 6px; bottom: 6px;
      width: 3px;
      border-radius: 0 4px 4px 0;
      background: linear-gradient(180deg, var(--po-accent), var(--po-accent-text));
    }
    .nc-item.actionable::after {
      background: linear-gradient(180deg, #f59e0b, #fbbf24);
    }

    /* ═══════════════════════════════════════════════
       Icon
       ═══════════════════════════════════════════════ */
    .nc-icon {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 17px;
      transition: transform 0.15s ease;
    }
    .nc-item:hover .nc-icon { transform: scale(1.05); }

    .nc-icon.team {
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(16, 185, 129, 0.1));
      color: #22c55e;
    }
    .nc-icon.share {
      background: linear-gradient(135deg, oklch(from var(--po-accent) l c h / 10%), oklch(from var(--po-accent) l c h / 10%));
      color: var(--po-accent);
    }
    .nc-icon.promo {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(251, 191, 36, 0.08));
      color: #f59e0b;
    }
    .nc-icon.task {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(234, 179, 8, 0.08));
      color: #d97706;
    }
    .nc-icon.comment {
      background: linear-gradient(135deg, oklch(from var(--po-accent) l c h / 8%), oklch(from var(--po-accent) l c h / 8%));
      color: var(--po-accent-text);
    }
    .nc-icon.general {
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(6, 182, 212, 0.08));
      color: #0ea5e9;
    }

    /* ═══════════════════════════════════════════════
       Content area
       ═══════════════════════════════════════════════ */
    .nc-content { flex: 1; min-width: 0; }
    .nc-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .nc-title {
      font-size: 0.82rem;
      font-weight: 600;
      line-height: 1.35;
      color: var(--bs-body-color);
      letter-spacing: -0.005em;
    }
    .nc-time {
      font-size: 0.67rem;
      color: var(--bs-tertiary-color);
      white-space: nowrap;
      flex-shrink: 0;
      margin-top: 2px;
      font-variant-numeric: tabular-nums;
    }
    .nc-message {
      font-size: 0.78rem;
      color: var(--bs-secondary-color);
      line-height: 1.45;
      margin-top: 2px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* Context metadata */
    .nc-context {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      margin-top: 6px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.67rem;
      color: var(--bs-secondary-color);
      background: rgba(0, 0, 0, 0.025);
    }
    :host-context([data-bs-theme="dark"]) .nc-context {
      background: rgba(255, 255, 255, 0.04);
    }
    .nc-context i { font-size: 11px; opacity: 0.6; }
    .nc-dot {
      width: 2px; height: 2px; border-radius: 50%;
      background: currentColor; opacity: 0.35;
      margin: 0 1px;
    }

    /* ═══════════════════════════════════════════════
       Team invite buttons
       ═══════════════════════════════════════════════ */
    .nc-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .nc-btn-accept {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 5px 14px;
      border-radius: 8px;
      font-size: 0.73rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      background: linear-gradient(135deg, var(--po-accent), var(--po-accent));
      color: #fff;
      box-shadow: 0 1px 3px oklch(from var(--po-accent) l c h / 30%);
      transition: all 0.15s ease;
    }
    .nc-btn-accept:hover {
      background: linear-gradient(135deg, #4338ca, var(--po-accent));
      box-shadow: 0 2px 6px oklch(from var(--po-accent) l c h / 40%);
      transform: translateY(-1px);
    }
    .nc-btn-decline {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 5px 14px;
      border-radius: 8px;
      font-size: 0.73rem;
      font-weight: 600;
      border: 1px solid rgba(239, 68, 68, 0.2);
      cursor: pointer;
      background: rgba(239, 68, 68, 0.05);
      color: #ef4444;
      transition: all 0.15s ease;
    }
    .nc-btn-decline:hover {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.3);
    }

    /* ═══════════════════════════════════════════════
       Unread dot
       ═══════════════════════════════════════════════ */
    .nc-unread-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: linear-gradient(135deg, var(--po-accent), var(--po-accent-text));
      flex-shrink: 0; margin-top: 6px;
      box-shadow: 0 0 0 2px oklch(from var(--po-accent) l c h / 15%);
    }

    /* ═══════════════════════════════════════════════
       Empty state
       ═══════════════════════════════════════════════ */
    .nc-empty {
      padding: 44px 20px;
      text-align: center;
    }
    .nc-empty-icon {
      width: 56px; height: 56px; border-radius: 16px;
      background: linear-gradient(135deg, rgba(100, 116, 139, 0.06), rgba(100, 116, 139, 0.02));
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 26px; color: var(--bs-tertiary-color); margin-bottom: 12px;
    }
    :host-context([data-bs-theme="dark"]) .nc-empty-icon {
      background: linear-gradient(135deg, rgba(100, 116, 139, 0.12), rgba(100, 116, 139, 0.06));
    }
    .nc-empty-title {
      font-size: 0.85rem;
      font-weight: 600;
      margin: 0 0 4px;
      color: var(--bs-body-color);
    }
    .nc-empty-desc {
      font-size: 0.76rem;
      color: var(--bs-secondary-color);
      margin: 0;
    }

    /* ═══════════════════════════════════════════════
       Footer
       ═══════════════════════════════════════════════ */
    .nc-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 13px 20px;
      border-top: 1px solid rgba(0, 0, 0, 0.05);
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--po-accent);
      text-decoration: none;
      transition: all 0.15s ease;
    }
    :host-context([data-bs-theme="dark"]) .nc-footer {
      border-top-color: rgba(255, 255, 255, 0.05);
      color: var(--po-accent-text);
    }
    .nc-footer:hover {
      background: oklch(from var(--po-accent) l c h / 4%);
      color: var(--po-accent);
    }
    :host-context([data-bs-theme="dark"]) .nc-footer:hover {
      background: oklch(from var(--po-accent) l c h / 8%);
      color: var(--po-accent-text);
    }
    .nc-footer i {
      font-size: 15px;
      transition: transform 0.15s ease;
    }
    .nc-footer:hover i {
      transform: translateX(2px);
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="po-topbar-slot">
      <div ngbDropdown>
        <button
          ngbDropdownToggle
          class="po-topbar-btn po-no-caret position-relative"
          type="button"
          [attr.aria-label]="label ? null : ('NOTIFICATIONS.Title' | translate)"
        >
          <i class="ti ti-bell fs-22" [class.po-bell-ring]="nc.hasPending()" aria-hidden="true"></i>
          @if (label) {
            <span class="nc-toggle-label">{{ label }}</span>
          }
          @if (nc.totalCount() > 0) {
            <span class="nc-badge">
              {{ nc.totalCount() > 99 ? '99+' : nc.totalCount() }}
            </span>
          }
        </button>

        <div ngbDropdownMenu class="dropdown-menu-end p-0 nc-dropdown">
          <!-- Header -->
          <div class="nc-header">
            <h6 class="nc-header-title">
              {{ 'NOTIFICATIONS.Title' | translate }}
              @if (nc.totalCount() > 0) {
                <span class="nc-header-count">{{ nc.totalCount() }}</span>
              }
            </h6>
            @if (nc.totalCount() > 0) {
              <button
                class="nc-mark-btn"
                (click)="nc.markAllAsRead(); $event.stopPropagation()"
              >
                <i class="ti ti-checks"></i>
                {{ 'NOTIFICATIONS.Mark all read' | translate }}
              </button>
            }
          </div>

          <!-- Body -->
          <div class="nc-body">
            @if (nc.notifications().length === 0) {
              <div class="nc-empty">
                <div class="nc-empty-icon">
                  <i class="ti ti-bell-off"></i>
                </div>
                <div class="nc-empty-title">{{ 'NOTIFICATIONS.No notifications' | translate }}</div>
                <div class="nc-empty-desc">{{ 'NOTIFICATIONS.EmptyDesc' | translate }}</div>
              </div>
            } @else {

              <!-- Recent -->
              @if (nc.notifications().length > 0) {
                @for (item of nc.notifications(); track item.id) {
                  <div
                    class="nc-item"
                    role="button"
                    tabindex="0"
                    [class.unread]="!item.read"
                    (click)="handleClick(item); $event.stopPropagation()"
                    (keydown.enter)="handleClick(item); $event.stopPropagation()"
                    (keydown.space)="handleClick(item); $event.preventDefault(); $event.stopPropagation()"
                  >
                    <div class="nc-icon" [ngClass]="getIconBgClass(item)">
                      <i [class]="item.icon"></i>
                    </div>
                    <div class="nc-content">
                      <div class="nc-row">
                        <div class="nc-title">{{ item.title }}</div>
                        <div class="nc-time">{{ nc.getTimeAgo(item.timestamp) }}</div>
                      </div>
                      <div class="nc-message">{{ item.message }}</div>

                    </div>
                    @if (!item.read) {
                      <div class="nc-unread-dot"></div>
                    }
                  </div>
                }
              }
            }
          </div>

        </div>
      </div>
    </div>
  `,
})
export class NotificationCenterComponent {
  nc = inject(NotificationCenterService);

  /** Optional toggle label (used in the minimal sidebar; empty = icon-only). */
  @Input() label = '';

  handleClick(item: UnifiedNotification): void {
    if (item.raw.data?.type === 'agent_activity') {
      this.nc.goToAgentSession(item.raw);
    } else {
      this.nc.markAsRead(item.raw.id);
    }
  }

  getIconBgClass(_item: UnifiedNotification): string {
    return 'general';
  }

}
