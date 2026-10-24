import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, inject, Input, signal, ChangeDetectionStrategy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslateModule } from "@ngx-translate/core";
import { NgbActiveModal } from "@ng-bootstrap/ng-bootstrap";

export interface ContextTransferModalResult {
  decision: "transfer" | "skip" | "cancel";
  rememberChoice?: "always" | "never";
}

/**
 * Modal shown when a sub-agent is about to be spawned with a provider that
 * differs from the parent session's provider, and the target provider does
 * not yet have a materialized shared-context file in the workspace.
 *
 * The user chooses whether to transfer the context, start clean, or cancel.
 * An optional "remember this choice" box persists the preference per workspace.
 */
@Component({
  selector: "app-context-transfer-modal",
  standalone: true,
  imports: [FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="ctx-transfer-modal">
      <div class="modal-header-custom">
        <h4 class="modal-title-custom">
          <iconify-icon icon="solar:copy-bold-duotone" width="20"></iconify-icon>
          {{ 'CONTEXT_TRANSFER.Title' | translate:{ from: fromLabel(), to: toLabel() } }}
        </h4>
        <button class="close-btn" (click)="onCancel()" [disabled]="busy()" [attr.aria-label]="'CONTEXT_TRANSFER.Cancel' | translate">
          <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
        </button>
      </div>

      <div class="modal-body-custom">
        <p class="description">
          {{ 'CONTEXT_TRANSFER.Description' | translate:{ from: fromLabel(), to: toLabel() } }}
        </p>

        <div class="providers-flow">
          <div class="provider-chip from">
            <iconify-icon [icon]="fromIcon()" width="18"></iconify-icon>
            <span>{{ fromLabel() }}</span>
          </div>
          <iconify-icon icon="solar:arrow-right-linear" width="18" class="arrow"></iconify-icon>
          <div class="provider-chip to">
            <iconify-icon [icon]="toIcon()" width="18"></iconify-icon>
            <span>{{ toLabel() }}</span>
          </div>
        </div>

        @if (promptPreview) {
          <div class="prompt-preview">
            <div class="prompt-preview-label">
              {{ 'CONTEXT_TRANSFER.Prompt preview' | translate }}
            </div>
            <div class="prompt-preview-body">{{ promptPreview }}</div>
          </div>
        }

        <label class="remember-row">
          <input type="checkbox" [(ngModel)]="rememberChecked" [disabled]="busy()" />
          <span>{{ 'CONTEXT_TRANSFER.Remember for workspace' | translate }}</span>
        </label>

        @if (busy()) {
          <div class="spinner-row">
            <iconify-icon icon="svg-spinners:ring-resize" width="18"></iconify-icon>
            <span>{{ 'CONTEXT_TRANSFER.Transferring' | translate }}</span>
          </div>
        }
      </div>

      <div class="modal-footer-custom">
        <button class="btn-cancel" (click)="onCancel()" [disabled]="busy()">
          {{ 'CONTEXT_TRANSFER.Cancel' | translate }}
        </button>
        <button class="btn-secondary" (click)="onSkip()" [disabled]="busy()">
          {{ 'CONTEXT_TRANSFER.Start clean' | translate }}
        </button>
        <button class="btn-confirm" (click)="onTransfer()" [disabled]="busy()">
          {{ 'CONTEXT_TRANSFER.Transfer' | translate }}
        </button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .ctx-transfer-modal { padding: 0; min-width: min(480px, calc(100vw - 2rem)); max-width: 560px; }
    .modal-header-custom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid rgba(100, 116, 139, 0.1);
    }
    .modal-title-custom {
      font-size: 1rem;
      font-weight: 700;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #6366F1;
    }
    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: rgba(100, 116, 139, 0.55);
      padding: 0.25rem;
      display: flex;
      align-items: center;
    }
    .close-btn:hover { color: rgba(100, 116, 139, 0.9); }
    .close-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .modal-body-custom { padding: 1.25rem; }
    .description {
      font-size: 0.88rem;
      line-height: 1.5;
      color: #475569;
      margin: 0 0 1rem;
    }
    :host-context([data-bs-theme="dark"]) .description { color: #cbd5e1; }

    .providers-flow {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      margin: 0.5rem 0 1.1rem;
    }
    .provider-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.38rem 0.75rem;
      border-radius: 999px;
      border: 1px solid rgba(99, 102, 241, 0.25);
      background: rgba(99, 102, 241, 0.08);
      font-size: 0.82rem;
      font-weight: 600;
      color: #4F46E5;
    }
    .provider-chip.from { opacity: 0.85; }
    .provider-chip.to {
      background: rgba(99, 102, 241, 0.18);
      border-color: rgba(99, 102, 241, 0.45);
    }
    .arrow { color: #6366F1; }

    .prompt-preview {
      background: rgba(100, 116, 139, 0.06);
      border: 1px solid rgba(100, 116, 139, 0.12);
      border-radius: 10px;
      padding: 0.65rem 0.8rem;
      margin-bottom: 0.9rem;
    }
    :host-context([data-bs-theme="dark"]) .prompt-preview {
      background: rgba(30, 41, 59, 0.5);
      border-color: rgba(99, 102, 241, 0.15);
    }
    .prompt-preview-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: rgba(100, 116, 139, 0.85);
      margin-bottom: 0.3rem;
    }
    .prompt-preview-body {
      font-size: 0.82rem;
      line-height: 1.45;
      color: #334155;
      white-space: pre-wrap;
      word-break: break-word;
    }
    :host-context([data-bs-theme="dark"]) .prompt-preview-body { color: #e2e8f0; }

    .remember-row {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      font-size: 0.82rem;
      color: #475569;
      cursor: pointer;
      user-select: none;
    }
    :host-context([data-bs-theme="dark"]) .remember-row { color: #cbd5e1; }
    .remember-row input[type="checkbox"] {
      width: 14px;
      height: 14px;
      accent-color: #6366F1;
      cursor: pointer;
    }

    .spinner-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.9rem;
      font-size: 0.82rem;
      color: #6366F1;
      font-weight: 600;
    }

    .modal-footer-custom {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem;
      border-top: 1px solid rgba(100, 116, 139, 0.1);
    }
    .btn-cancel, .btn-secondary, .btn-confirm {
      padding: 0.48rem 1rem;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    .btn-cancel {
      background: rgba(100, 116, 139, 0.08);
      border-color: rgba(100, 116, 139, 0.15);
      color: #475569;
    }
    .btn-cancel:hover:not(:disabled) { background: rgba(100, 116, 139, 0.15); }
    .btn-secondary {
      background: transparent;
      border-color: rgba(99, 102, 241, 0.35);
      color: #4F46E5;
    }
    .btn-secondary:hover:not(:disabled) {
      background: rgba(99, 102, 241, 0.08);
      border-color: rgba(99, 102, 241, 0.55);
    }
    .btn-confirm {
      background: #6366F1;
      color: #fff;
    }
    .btn-confirm:hover:not(:disabled) {
      background: #4F46E5;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
    }
    .btn-cancel:disabled, .btn-secondary:disabled, .btn-confirm:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `,
})
export class ContextTransferModalComponent {
  readonly activeModal = inject(NgbActiveModal);

  @Input() fromProvider = "claude-code-cli";
  @Input() toProvider = "codex";
  @Input() workspacePath = "";
  @Input() promptPreview = "";

  protected rememberChecked = false;
  protected busy = signal(false);

  private static readonly MIN_SPINNER_MS = 250;

  fromLabel(): string {
    return providerLabel(this.fromProvider);
  }
  toLabel(): string {
    return providerLabel(this.toProvider);
  }
  fromIcon(): string {
    return providerIcon(this.fromProvider);
  }
  toIcon(): string {
    return providerIcon(this.toProvider);
  }

  /** Enter transfers, like the primary button; a focused button or checkbox keeps its own Enter. */
  @HostListener("keydown.enter", ["$event"])
  onEnter(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, a")) return;
    event.preventDefault();
    this.onTransfer();
  }

  onTransfer(): void {
    if (this.busy()) return;
    this.busy.set(true);
    const remember = this.rememberChecked ? "always" : undefined;
    this.finishWithMinSpinner({ decision: "transfer", rememberChoice: remember });
  }

  onSkip(): void {
    if (this.busy()) return;
    const remember = this.rememberChecked ? "never" : undefined;
    this.activeModal.close({ decision: "skip", rememberChoice: remember });
  }

  onCancel(): void {
    if (this.busy()) return;
    this.activeModal.close({ decision: "cancel" });
  }

  /**
   * Wait for min-spinner (anti-flash) OR for an external `completed()` call,
   * whichever is later. Called via `@Input` property when done.
   */
  private finishWithMinSpinner(result: ContextTransferModalResult): void {
    const start = performance.now();
    const wait = () => {
      const elapsed = performance.now() - start;
      const remaining = ContextTransferModalComponent.MIN_SPINNER_MS - elapsed;
      if (remaining > 0) {
        setTimeout(() => this.activeModal.close(result), remaining);
      } else {
        this.activeModal.close(result);
      }
    };
    // Small kick so the spinner is visible even if close happens immediately
    setTimeout(wait, 0);
  }
}

function providerLabel(id: string): string {
  switch (id) {
    case "claude-code-cli":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "gemini-cli":
      return "Gemini";
    case "antigravity":
      return "Antigravity";
    case "copilot":
      return "Copilot";
    case "cursor":
      return "Cursor";
    case "generic-shell":
      return "Shell";
    default:
      return id;
  }
}

function providerIcon(id: string): string {
  switch (id) {
    case "claude-code-cli":
      return "simple-icons:anthropic";
    case "codex":
      return "simple-icons:openai";
    case "gemini-cli":
      return "simple-icons:googlegemini";
    case "antigravity":
      return "simple-icons:google";
    case "copilot":
      return "simple-icons:githubcopilot";
    case "cursor":
      return "simple-icons:cursor";
    default:
      return "solar:file-terminal-bold";
  }
}
