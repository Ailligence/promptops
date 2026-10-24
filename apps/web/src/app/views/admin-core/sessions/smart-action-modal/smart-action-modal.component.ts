import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { SmartActionAlternative } from '../services/smart-action.service';

/**
 * Pre-Subagent Smart Execution Guard modal.
 *
 * Shown when the guard detects a user prompt can be handled by a direct
 * terminal command instead of spawning an AI sub-agent.
 *
 * Inputs (set via modalRef.componentInstance):
 *   - command: the detected terminal command (e.g. "npm run deploy")
 *   - label: human-readable action label (e.g. "Deploy")
 *   - source: where the command was found (e.g. "package.json scripts")
 *   - prompt: the original user prompt
 *   - alternatives: folder alternatives when multiple folders have the same command
 *
 * Result:
 *   - { action: 'terminal', command: string } → run in terminal
 *   - 'agent'    → spawn AI sub-agent as usual
 *   - dismiss    → cancel
 */
@Component({
  selector: 'app-smart-action-modal',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <h5 class="modal-title">
        <iconify-icon icon="solar:bolt-circle-bold" width="20" class="title-icon"></iconify-icon>
        {{ 'SMART_ACTION.Faster Execution Available' | translate }}
      </h5>
      <button type="button" class="btn-close" (click)="modal.dismiss()" [attr.aria-label]="'COMMON.Close' | translate"></button>
    </div>
    <div class="modal-body">
      <p class="guard-message">
        {{ 'SMART_ACTION.This action can be executed directly via terminal' | translate }}
      </p>

      <!-- Single folder: standard view -->
      @if (alternatives.length === 0) {
        <div class="command-card">
          <div class="command-label">
            <iconify-icon icon="solar:file-terminal-bold-duotone" width="16"></iconify-icon>
            <span>{{ label }}</span>
          </div>
          <code class="command-text">{{ command }}</code>
          @if (source) {
            <div class="command-source text-muted">
              <iconify-icon icon="solar:document-text-linear" width="11"></iconify-icon>
              {{ source }}
            </div>
          }
        </div>
      }

      <!-- Multi-folder: show alternatives for selection -->
      @if (alternatives.length > 0) {
        <div class="folder-select">
          <div class="folder-select-label">
            <iconify-icon icon="solar:folder-with-files-bold-duotone" width="16"></iconify-icon>
            {{ 'SMART_ACTION.Select folder' | translate }}
          </div>
          <div class="folder-list">
            @for (alt of alternatives; track alt; let i = $index) {
              <button
                class="folder-option"
                [class.selected]="selectedAlternativeIndex === i"
                (click)="selectedAlternativeIndex = i">
                <div class="folder-option-header">
                  <iconify-icon icon="solar:folder-bold" width="14" class="folder-icon"></iconify-icon>
                  <span class="folder-name">{{ alt.folderName }}</span>
                  @if (selectedAlternativeIndex === i) {
                    <iconify-icon icon="solar:check-circle-bold" width="14" class="check-icon"></iconify-icon>
                  }
                </div>
                <code class="folder-command">{{ alt.fullCommand }}</code>
              </button>
            }
          </div>
        </div>
      }

      <div class="token-hint">
        <iconify-icon icon="solar:wallet-money-bold-duotone" width="14"></iconify-icon>
        {{ 'SMART_ACTION.Saves tokens and runs faster' | translate }}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-sm btn-ghost" (click)="modal.dismiss()">
        {{ 'COMMON.Cancel' | translate }}
      </button>
      <button class="btn btn-sm btn-outline-secondary" (click)="modal.close('agent')">
        <iconify-icon icon="solar:cpu-bolt-bold-duotone" width="14"></iconify-icon>
        {{ 'SMART_ACTION.Use AI Anyway' | translate }}
      </button>
      <button class="btn btn-sm btn-warning sa-primary" (click)="runInTerminal()">
        <iconify-icon icon="solar:file-terminal-bold" width="14"></iconify-icon>
        {{ 'SMART_ACTION.Run in Terminal' | translate }}
        <kbd class="enter-hint">⏎</kbd>
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .modal-header {
      border-bottom-color: rgba(255, 255, 255, 0.06);
      padding: 0.75rem 1rem;
    }
    .modal-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .title-icon {
      color: var(--bs-warning);
    }
    .modal-body {
      padding: 0.75rem 1rem;
    }
    .guard-message {
      font-size: 0.82rem;
      color: var(--po-text-secondary);
      margin-bottom: 0.75rem;
      line-height: 1.5;
    }
    .command-card {
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }
    .command-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 0.4rem;
      color: var(--bs-warning);
    }
    .command-text {
      display: block;
      font-size: 1rem;
      font-weight: 500;
      padding: 0.4rem 0;
      color: var(--bs-body-color);
    }
    .command-source {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.72rem;
      margin-top: 0.25rem;
    }

    /* ── Multi-folder selection ── */
    .folder-select-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: var(--bs-warning);
    }
    .folder-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      max-height: 220px;
      overflow-y: auto;
    }
    .folder-option {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: 8px;
      padding: 0.6rem 0.75rem;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      text-align: start;
      width: 100%;
      color: inherit;
    }
    .folder-option:hover {
      border-color: rgba(210, 153, 34, 0.4);
      background: rgba(210, 153, 34, 0.04);
    }
    .folder-option.selected {
      border-color: var(--po-warning);
      background: var(--po-warning-bg);
    }
    .folder-option-header {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .folder-icon {
      color: var(--bs-warning);
      flex-shrink: 0;
    }
    .folder-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .check-icon {
      color: var(--po-success);
      flex-shrink: 0;
    }
    .folder-command {
      font-size: 0.72rem;
      color: var(--po-text-secondary);
      word-break: break-all;
    }

    .token-hint {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.75rem;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      background: var(--po-success-bg);
      border: 1px solid rgba(63, 185, 80, 0.15);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--po-success);
    }
    .modal-footer {
      border-top-color: rgba(255, 255, 255, 0.06);
      gap: 0.5rem;
      padding: 0.625rem 1rem;
    }
    .modal-footer .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .btn-ghost {
      background: transparent;
      border: 1px solid transparent;
      color: var(--po-text-secondary);
    }
    .btn-ghost:hover {
      color: var(--bs-body-color);
      background: rgba(255, 255, 255, 0.04);
    }
    .enter-hint {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 16px;
      margin-inline-start: 0.35rem;
      padding: 0 4px;
      font-size: 0.7rem;
      font-weight: 600;
      line-height: 1;
      border-radius: 3px;
      background: rgba(0, 0, 0, 0.25);
      color: rgba(255, 255, 255, 0.85);
      border: 1px solid rgba(0, 0, 0, 0.2);
    }
  `],
})
export class SmartActionModalComponent {
  command = '';
  label = '';
  source = '';
  prompt = '';
  alternatives: SmartActionAlternative[] = [];
  selectedAlternativeIndex = 0;

  constructor(public modal: NgbActiveModal) {}

  @HostListener('document:keydown.enter', ['$event'])
  onEnter(event: KeyboardEvent): void {
    // Enter on a focused secondary button (Cancel, Use AI anyway, close) must
    // activate THAT button, never run the command in the terminal instead.
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.('button');
    if (button && !button.classList.contains('sa-primary') && !button.classList.contains('folder-option')) return;
    if (event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    this.runInTerminal();
  }

  runInTerminal(): void {
    if (this.alternatives.length > 0) {
      const selected = this.alternatives[this.selectedAlternativeIndex];
      this.modal.close({ action: 'terminal', command: selected.fullCommand });
    } else {
      this.modal.close({ action: 'terminal', command: this.command });
    }
  }
}
