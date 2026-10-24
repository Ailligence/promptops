import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { PromptSubAgentInterface } from '@core/interfaces/prompt.interface';
import { ActionSlotService } from '../services/action-slot.service';
import { PromptQueryService } from '../../prompt-library/services/prompt-query.service';

@Component({
  selector: 'app-quick-create-prompt-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <h5 class="modal-title d-flex align-items-center gap-2">
        <i class="ti ti-bolt"></i>
        {{ 'QUICK_ACTION_BUILDER.Create title' | translate }}
      </h5>
      <button type="button" class="btn-close" [disabled]="saving()" (click)="modal.dismiss()" [attr.aria-label]="'BUTTONS.Cancel' | translate"></button>
    </div>

    <div class="modal-body">
      <p class="text-muted mb-3" style="font-size: 0.82rem;">
        {{ 'QUICK_ACTION_BUILDER.Create intro' | translate }}
      </p>

      <div class="builder-options">
        <button type="button" class="builder-option" [disabled]="saving()" (click)="chooseCommand()">
          <i class="ti ti-terminal-2"></i>
          <strong>{{ 'QUICK_ACTION_BUILDER.Choose command' | translate }}</strong>
          <span>{{ 'QUICK_ACTION_BUILDER.Choose description' | translate }}</span>
        </button>
        <button type="button" class="builder-option" [disabled]="saving()" (click)="choosePrompt()">
          <i class="ti ti-books"></i>
          <strong>{{ 'QUICK_ACTION_BUILDER.Choose prompt' | translate }}</strong>
          <span>{{ 'QUICK_ACTION_BUILDER.Choose prompt description' | translate }}</span>
        </button>
        <button type="button" class="builder-option" [class.selected]="manualMode()" [attr.aria-expanded]="manualMode()" aria-controls="quick-action-manual-form" [disabled]="saving()" (click)="openManual()">
          <i class="ti ti-pencil"></i>
          <strong>{{ 'QUICK_ACTION_BUILDER.Write prompt' | translate }}</strong>
          <span>{{ 'QUICK_ACTION_BUILDER.Prompt description' | translate }}</span>
        </button>
      </div>
      @if (manualMode()) {
      <fieldset id="quick-action-manual-form" [disabled]="saving()">
      @if (draftRestored()) {
        <div class="draft-restored-banner">
          <span>
            <i class="ti ti-file-text me-1"></i>
            {{ 'PROMPTS.Draft restored' | translate }}
          </span>
          <button type="button" class="btn btn-sm btn-link text-danger p-0 text-decoration-none" (click)="discardDraft()" style="font-size: 0.75rem;">
            {{ 'BUTTONS.Discard' | translate }}
          </button>
        </div>
      }

      <!-- Title -->
      <div class="mb-3">
        <label for="quick-action-title" class="form-label fw-semibold">
          {{ 'QUICK_ACTION_BUILDER.Action name' | translate }}
          <span class="text-danger">*</span>
        </label>
        <input
          type="text"
          id="quick-action-title"
          ngbAutofocus
          maxlength="100"
          class="form-control"
          [ngModel]="title"
          (ngModelChange)="title = $event; saveDraft()"
          (keydown.enter)="onTitleEnter($event)"
          [placeholder]="'QUICK_ACTION_BUILDER.Name example' | translate"
        />
      </div>

      <!-- Body -->
      <div class="mb-3">
        <label for="quick-action-body" class="form-label fw-semibold">
          {{ 'QUICK_ACTION_BUILDER.Instructions' | translate }}
          <span class="text-danger">*</span>
        </label>
        <textarea
          id="quick-action-body"
          class="form-control prompt-body"
          [ngModel]="body"
          (ngModelChange)="body = $event; saveDraft()"
          rows="6"
          [placeholder]="'QUICK_ACTION_BUILDER.Prompt example' | translate"
        ></textarea>
      </div>

      <p class="builder-hint"><i class="ti ti-player-play me-1"></i>{{ 'QUICK_ACTION_BUILDER.Play hint' | translate }}</p>
      <details class="builder-advanced" [open]="subAgents().length > 0">
        <summary>{{ 'QUICK_ACTION_BUILDER.Advanced' | translate }}</summary>
      <!-- Sub-Agents -->
      <div class="mb-3">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <label class="form-label fw-semibold mb-0">
            <i class="ti ti-robot me-1"></i>
            {{ 'PROMPTS.Sub-Agents' | translate }}
          </label>
          @if (subAgents().length > 0) {
            <span class="badge bg-primary bg-opacity-10 text-primary" style="font-size: 0.72rem;">
              {{ subAgents().length }}
            </span>
          }
        </div>

        @for (agent of subAgents(); track $index; let i = $index) {
          <div class="sub-agent-item mb-2">
            <div class="d-flex align-items-center gap-2 mb-1">
              <span class="sa-order">{{ i + 1 }}</span>
              <input
                type="text"
                class="form-control form-control-sm flex-grow-1"
                [ngModel]="agent.name"
                (ngModelChange)="updateAgent(i, 'name', $event)"
                [placeholder]="'PROMPTS.Sub-agent name' | translate"
              />
              <input
                type="text"
                class="form-control form-control-sm"
                style="max-width: 120px;"
                [ngModel]="agent.role"
                (ngModelChange)="updateAgent(i, 'role', $event)"
                [placeholder]="'PROMPTS.Role' | translate"
              />
              <button type="button" class="btn btn-sm btn-outline-danger po-btn-square" (click)="removeAgent(i)"
                [title]="'PROMPTS.Remove' | translate" [attr.aria-label]="'PROMPTS.Remove' | translate">
                <i class="ti ti-trash"></i>
              </button>
            </div>
            <textarea
              class="form-control form-control-sm sa-prompt-textarea"
              rows="3"
              [ngModel]="agent.system_prompt"
              (ngModelChange)="updateAgent(i, 'system_prompt', $event)"
              [placeholder]="'PROMPTS.Enter the prompt for this sub-agent' | translate"
            ></textarea>
          </div>
        }

        <button type="button" class="btn-add-agent" (click)="addAgent()">
          <i class="ti ti-plus"></i>
          {{ 'PROMPTS.Add Sub-Agent' | translate }}
        </button>
      </div>

      </details>

      <!-- Add to Quick Actions toggle -->
      <div class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          id="addToQuickActions"
          [ngModel]="addToQuickActions"
          (ngModelChange)="addToQuickActions = $event; saveDraft()"
        />
        <label class="form-check-label" for="addToQuickActions">
          {{ 'QUICK_ACTION_BUILDER.Show in sidebar' | translate }}
        </label>
      </div>

      <p class="builder-hint mt-2">{{ (scopeType === 'workspace' ? 'QUICK_ACTION_SCOPE.Workspace hint' : 'QUICK_ACTION_SCOPE.Session hint') | translate }}</p>
      </fieldset>
      }

      @if (errorMessage()) {
        <div class="error-banner">
          <i class="ti ti-alert-triangle me-1"></i>
          {{ errorMessage() }}
          <button type="button" class="btn-close btn-close-sm ms-auto" style="font-size: 0.6rem;" (click)="errorMessage.set('')" [attr.aria-label]="'BUTTONS.Close' | translate"></button>
        </div>
      }
    </div>

    <div class="modal-footer">
      <button type="button" class="btn btn-outline-secondary" [disabled]="saving()" (click)="modal.dismiss()">
        {{ 'BUTTONS.Cancel' | translate }}
      </button>
      @if (manualMode()) {
      <button
        type="button"
        class="btn btn-primary d-flex align-items-center gap-2"
        [disabled]="saving() || !title.trim() || !body.trim()"
        (click)="save()"
      >
        @if (saving()) {
          <span class="spinner-border spinner-border-sm"></span>
        }
        <i class="ti ti-device-floppy"></i>
        {{ (addToQuickActions ? 'QUICK_ACTION_BUILDER.Save action' : 'BUTTONS.Save') | translate }}
      </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .modal-title { font-size: 1rem; }
    .builder-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
    .builder-option { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px; text-align: start; border: 1px solid var(--po-border-subtle); border-radius: 10px; background: var(--po-bg-2); color: var(--po-text-primary); }
    .builder-option.selected { border-color: var(--po-info); background: var(--po-bg-3); }
    .builder-option i { color: var(--po-info); font-size: 20px; }
    .builder-option strong { font-size: .85rem; }
    .builder-option span, .builder-hint { font-size: .78rem; line-height: 1.55; color: var(--po-text-secondary); }
    button.builder-option:hover { background: var(--po-bg-3); }
    button.builder-option:focus-visible { outline: 2px solid var(--po-info); outline-offset: 2px; }
    .builder-advanced { border-top: 1px solid var(--po-border-subtle); margin-bottom: 18px; padding-top: 12px; }
    .builder-advanced summary { color: var(--po-text-secondary); font-size: .8rem; cursor: pointer; margin-bottom: 12px; }
    @media (max-width: 520px) { .builder-options { grid-template-columns: 1fr; } }

    .prompt-body {
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.85rem;
      line-height: 1.6;
    }

    .sub-agent-item {
      background: rgba(99, 102, 241, 0.03);
      border: 1px solid rgba(99, 102, 241, 0.12);
      border-radius: 8px;
      padding: 0.5rem;
    }

    .sa-order {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: rgba(99, 102, 241, 0.12);
      color: var(--po-accent);
      font-size: 0.72rem;
      font-weight: 700;
      flex-shrink: 0;
    }

    .sa-prompt-textarea {
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
    }

    .btn-add-agent {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      width: 100%;
      padding: 0.5rem;
      border: 2px dashed rgba(99, 102, 241, 0.2);
      border-radius: 8px;
      background: transparent;
      color: var(--po-accent);
      opacity: 0.85;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-add-agent:hover {
      border-color: rgba(99, 102, 241, 0.4);
      background: rgba(99, 102, 241, 0.04);
      color: var(--po-accent);
      opacity: 1;
    }

    .po-btn-square {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      flex-shrink: 0;
    }

    .error-banner {
      display: flex;
      align-items: center;
      padding: 0.5rem 0.65rem;
      margin-top: 0.75rem;
      background: var(--po-error-bg);
      border: 1px solid rgba(248, 81, 73, 0.3);
      border-radius: 6px;
      font-size: 0.8rem;
      color: var(--po-error);
    }

    .draft-restored-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.4rem 0.65rem;
      margin-bottom: 0.75rem;
      background: rgba(88, 166, 255, 0.08);
      border: 1px solid rgba(88, 166, 255, 0.2);
      border-radius: 6px;
      font-size: 0.78rem;
      color: var(--po-info);
    }
  `,
})
export class QuickCreatePromptModalComponent implements OnInit {
  protected modal = inject(NgbActiveModal);
  private queryService = inject(PromptQueryService);
  private translateService = inject(TranslateService);

  private static readonly DRAFT_KEY = 'po-quick-create-prompt-draft';

  readonly scopeType = inject(ActionSlotService).context()?.scope.type ?? 'session';
  title = '';
  body = '';
  addToQuickActions = true;
  saving = signal(false);
  errorMessage = signal('');
  subAgents = signal<PromptSubAgentInterface[]>([]);
  draftRestored = signal(false);
  manualMode = signal(false);

  ngOnInit(): void {
    this.restoreDraft();
  }

  addAgent(): void {
    this.subAgents.update(agents => [
      ...agents,
      {
        name: '',
        role: '',
        system_prompt: '',
        execution_order: agents.length,
        auto_run: false,
        enabled: true,
      },
    ]);
    this.saveDraft();
  }

  removeAgent(index: number): void {
    this.subAgents.update(agents => {
      const updated = [...agents];
      updated.splice(index, 1);
      updated.forEach((a, i) => (a.execution_order = i));
      return updated;
    });
    this.saveDraft();
  }

  updateAgent(index: number, field: string, value: any): void {
    this.subAgents.update(agents => {
      const updated = [...agents];
      (updated[index] as any)[field] = value;
      return updated;
    });
    this.saveDraft();
  }

  hasDraftContent(): boolean {
    return !!(this.title.trim() || this.body.trim() || this.subAgents().length > 0);
  }

  saveDraft(): void {
    try {
      localStorage.setItem(
        QuickCreatePromptModalComponent.DRAFT_KEY,
        JSON.stringify({
          title: this.title,
          body: this.body,
          addToQuickActions: this.addToQuickActions,
          subAgents: this.subAgents(),
        }),
      );
    } catch { /* storage full/blocked: the draft is a convenience, typing must keep working */ }
  }

  /** "Write a prompt": show the form and put the cursor in the name field. */
  openManual(): void {
    this.manualMode.set(true);
    setTimeout(() => document.getElementById('quick-action-title')?.focus());
  }

  /**
   * Enter in the name field = primary action (save), only when it is enabled:
   * name + instructions filled and not already saving. Never from the
   * instructions textarea (Enter there is a newline) nor mid-IME composition.
   */
  onTitleEnter(event: Event): void {
    const ke = event as KeyboardEvent;
    if (ke.isComposing) return;
    event.preventDefault();
    if (this.saving() || !this.title.trim() || !this.body.trim()) return;
    void this.save();
  }

  private restoreDraft(): void {
    try {
      const raw = localStorage.getItem(QuickCreatePromptModalComponent.DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft.title && !draft.body && !draft.subAgents?.length) return;
      this.title = draft.title || '';
      this.body = draft.body || '';
      this.addToQuickActions = draft.addToQuickActions ?? true;
      if (draft.subAgents?.length) {
        this.subAgents.set(draft.subAgents);
      }
      this.draftRestored.set(true);
      this.manualMode.set(true);
    } catch { /* ignore corrupt draft */ }
  }

  private clearDraft(): void {
    try { localStorage.removeItem(QuickCreatePromptModalComponent.DRAFT_KEY); } catch { /* ignore */ }
  }

  discardDraft(): void {
    this.title = '';
    this.body = '';
    this.addToQuickActions = true;
    this.subAgents.set([]);
    this.clearDraft();
    this.draftRestored.set(false);
  }

  choosePrompt(): void {
    this.saveDraft();
    this.modal.close({ choosePrompt: true });
  }

  chooseCommand(): void {
    this.saveDraft();
    this.modal.close({ chooseCommand: true });
  }

  async save(): Promise<void> {
    if (this.saving() || !this.title.trim() || !this.body.trim()) return;

    this.saving.set(true);
    this.errorMessage.set('');
    try {
      const payload: any = {
        title: this.title.trim(),
        body: this.body.trim(),
        status: 'published',
        visibility: 'private',
      };

      const agents = this.subAgents();
      if (agents.length > 0) {
        payload.sub_agents = agents;
      }

      const prompt = await this.queryService.addEntity(payload);
      this.clearDraft();

      this.modal.close({
        promptId: prompt?.id,
        title: this.title.trim(),
        addToQuickActions: this.addToQuickActions,
      });
    } catch (err: any) {
      this.errorMessage.set(
        err?.message ||
          this.translateService.instant('MESSAGE.Generic error'),
      );
    } finally {
      this.saving.set(false);
    }
  }
}
