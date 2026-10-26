import { Component, inject, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ClaudeHookService, PendingHookInteraction } from '../../views/admin-core/sessions/services/claude-hook.service';

@Component({
  selector: 'app-claude-hook-modal',
  standalone: true,
  imports: [TranslateModule],
  template: `
    @if (hookService.showGlobalModal()) {
      <div class="hook-toast-stack">
        @for (interaction of hookService.pendingQueue(); track interaction.id) {
          <div class="hook-toast" role="status" [class.permission]="isPermission(interaction)" [class.input]="isInput(interaction)"
               [class.hover-pausable]="hookService.toastPauseOnHover()"
               [style.--po-toast-duration]="interaction.durationMs ? interaction.durationMs + 'ms' : null"
               (mouseenter)="onToastEnter(interaction)"
               (mouseleave)="onToastLeave(interaction)">
            <div class="hook-toast-icon">
              <i class="ti"
                 [class.ti-shield-check]="isPermission(interaction)"
                 [class.ti-message-dots]="isInput(interaction)"
                 [class.ti-robot]="!isPermission(interaction) && !isInput(interaction)"></i>
            </div>

            <div class="hook-toast-body">
              <div class="hook-toast-title">{{ interaction.title }}</div>
              @if (interaction.action) {
                <div class="hook-toast-msg">{{ interaction.message }}</div>
              }
              <div class="hook-toast-meta">
                <span class="hook-toast-badge session">
                  <i class="ti ti-terminal-2"></i>
                  {{ interaction.sessionName }}
                </span>
                @if (interaction.workspaceName) {
                  <span class="hook-toast-badge workspace">
                    <i class="ti ti-folder"></i>
                    {{ interaction.workspaceName }}
                  </span>
                }
              </div>
              @if (interaction.action === 'compact') {
                <div class="hook-toast-actions">
                  <button class="hook-toast-settings" (click)="openSettings(interaction)" [title]="'SETTINGS.Compact Suggestions' | translate" [attr.aria-label]="'SETTINGS.Compact Suggestions' | translate">
                    <i class="ti ti-settings"></i>
                  </button>
                  <button class="hook-toast-skip" (click)="dismiss(interaction)">{{ 'HOOK_TOAST.Skip' | translate }}</button>
                  <button class="hook-toast-cta" (click)="compact(interaction)">
                    <i class="ti ti-arrows-minimize"></i>
                    {{ 'HOOK_TOAST.Compact now' | translate }}
                  </button>
                </div>
              }
            </div>

            @if (interaction.action !== 'compact') {
              <button class="hook-toast-cta" (click)="goToSession(interaction)">
                <i class="ti ti-arrow-right"></i>
                {{ 'SESSIONS.Go to session' | translate }}
              </button>

              <button class="hook-toast-close" (click)="dismiss(interaction)" [title]="'BUTTONS.Close' | translate" [attr.aria-label]="'BUTTONS.Close' | translate">
                <i class="ti ti-x"></i>
              </button>
            }

            @if (interaction.durationMs) {
              <div class="hook-toast-progress"></div>
            }
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .hook-toast-stack {
      position: fixed;
      top: 1rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      z-index: 10001;
      pointer-events: none;
      max-width: calc(100vw - 2rem);
      width: 460px;
    }

    .hook-toast {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: #fff;
      border: 1px solid rgba(100, 116, 139, 0.12);
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
      padding: 0.65rem 0.75rem 0.65rem 0.75rem;
      pointer-events: all;
      overflow: hidden;
      animation: toastIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    :host-context([data-bs-theme="dark"]) .hook-toast {
      background: #1e293b;
      border-color: rgba(255, 255, 255, 0.08);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .hook-toast-icon {
      width: 34px; height: 34px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--po-accent), var(--po-accent));
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .hook-toast.permission .hook-toast-icon {
      background: linear-gradient(135deg, #f59e0b, #ef4444);
    }
    .hook-toast.input .hook-toast-icon {
      background: linear-gradient(135deg, #3b82f6, var(--po-accent));
    }
    .hook-toast-icon .ti { font-size: 1.05rem; color: #fff; }

    .hook-toast-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .hook-toast-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: rgba(15, 23, 42, 0.9);
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    :host-context([data-bs-theme="dark"]) .hook-toast-title {
      color: rgba(255, 255, 255, 0.95);
    }

    .hook-toast-meta {
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
    }

    .hook-toast-badge {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0.1rem 0.4rem;
      border-radius: 5px;
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hook-toast-badge.session {
      background: oklch(from var(--po-accent) l c h / 12%);
      color: var(--po-accent);
    }
    .hook-toast-badge.workspace {
      background: rgba(34, 197, 94, 0.12);
      color: #22c55e;
    }

    .hook-toast-cta {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      color: #fff;
      border: none;
      padding: 0.4rem 0.7rem;
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .hook-toast-cta:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(34, 197, 94, 0.3);
    }

    .hook-toast-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.35rem;
    }
    .hook-toast-skip {
      background: none;
      border: none;
      padding: 0.4rem 0.55rem;
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 600;
      color: rgba(100, 116, 139, 0.8);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .hook-toast-skip:hover {
      color: rgba(71, 85, 105, 1);
      background: rgba(100, 116, 139, 0.1);
    }
    /* Settings shortcut: turn compact suggestions off from the toast itself */
    .hook-toast-settings {
      margin-right: auto;
      background: none;
      border: none;
      padding: 0.35rem;
      border-radius: 8px;
      font-size: 0.9rem;
      color: rgba(100, 116, 139, 0.6);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .hook-toast-settings:hover {
      color: rgba(71, 85, 105, 1);
      background: rgba(100, 116, 139, 0.1);
    }
    :host-context([data-bs-theme="dark"]) .hook-toast-settings { color: rgba(148, 163, 184, 0.65); }
    :host-context([data-bs-theme="dark"]) .hook-toast-settings:hover { color: #e2e8f0; background: rgba(255, 255, 255, 0.06); }
    :host-context([data-bs-theme="dark"]) .hook-toast-skip { color: rgba(148, 163, 184, 0.8); }
    :host-context([data-bs-theme="dark"]) .hook-toast-skip:hover { color: #e2e8f0; background: rgba(255, 255, 255, 0.06); }

    .hook-toast-msg {
      margin-top: 2px;
      font-size: 0.75rem;
      line-height: 1.35;
      opacity: 0.75;
    }

    .hook-toast-close {
      background: none;
      border: none;
      padding: 0.2rem;
      cursor: pointer;
      color: rgba(100, 116, 139, 0.55);
      font-size: 0.95rem;
      border-radius: 6px;
      flex-shrink: 0;
      transition: all 0.15s;
    }
    .hook-toast-close:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.08);
    }

    .hook-toast-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 2px;
      background: linear-gradient(90deg, var(--po-accent), var(--po-accent));
      animation: toastProgress var(--po-toast-duration, 5000ms) linear forwards;
    }
    .hook-toast.hover-pausable:hover .hook-toast-progress {
      animation-play-state: paused;
    }
    .hook-toast.permission .hook-toast-progress {
      background: linear-gradient(90deg, #f59e0b, #ef4444);
    }
    .hook-toast.input .hook-toast-progress {
      background: linear-gradient(90deg, #3b82f6, var(--po-accent));
    }

    @keyframes toastIn {
      from { opacity: 0; transform: translateY(-12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes toastProgress {
      from { width: 100%; }
      to { width: 0%; }
    }
  `,
})
export class ClaudeHookModalComponent {
  protected readonly hookService = inject(ClaudeHookService);
  private readonly router = inject(Router);

  protected isPermission(interaction: PendingHookInteraction): boolean {
    return interaction.notificationType === 'permission_prompt';
  }

  protected isInput(interaction: PendingHookInteraction): boolean {
    const type = interaction.notificationType;
    return type === 'idle_prompt' || type === 'elicitation_dialog';
  }

  // Keep Escape as a shortcut to dismiss the most recent toast
  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.hookService.showGlobalModal()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hookService.dismissAll();
    }
  }

  protected dismiss(interaction: PendingHookInteraction): void {
    this.hookService.dismissModal(interaction.id);
  }

  protected onToastEnter(interaction: PendingHookInteraction): void {
    this.hookService.pauseAutoDismiss(interaction.id);
  }

  protected onToastLeave(interaction: PendingHookInteraction): void {
    this.hookService.resumeAutoDismiss(interaction.id);
  }

  protected compact(interaction: PendingHookInteraction): void {
    this.hookService.dismissModal(interaction.id);
    void this.hookService.compactSession(interaction.sessionId, interaction.subAgentId);
  }

  /** Compact toast: open Settings → Notifications, where the suggestions can be turned off. */
  protected openSettings(interaction: PendingHookInteraction): void {
    this.hookService.dismissModal(interaction.id);
    void this.router.navigate(['/admin/settings'], { queryParams: { highlight: 'compact-suggestions' } });
  }

  protected goToSession(interaction: PendingHookInteraction): void {
    this.hookService.dismissModal(interaction.id);
    this.hookService.goToSession(interaction.sessionId);
  }
}
