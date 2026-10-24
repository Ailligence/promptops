import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { PromptQueryService } from '../../prompt-library/services/prompt-query.service';
import { ActionSlotService } from '../services/action-slot.service';
import { SubAgentService } from '../services/sub-agent.service';
import { commandActionNotes } from '../services/quick-action-command';

@Component({
  selector: 'app-command-action-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    <div class="modal-header">
      <h5 class="modal-title"><i class="ti ti-terminal-2 me-2"></i>{{ 'QUICK_ACTION_BUILDER.Command title' | translate }}</h5>
      <button type="button" class="btn-close" [disabled]="busy()" (click)="modal.dismiss()" [attr.aria-label]="'BUTTONS.Cancel' | translate"></button>
    </div>
    <div class="modal-body">
      <p class="intro">{{ 'QUICK_ACTION_BUILDER.Command intro' | translate }}</p>
      <div class="command-preview">
        <code>{{ command }}</code>
        <span>{{ 'QUICK_ACTION_BUILDER.Directory' | translate }}</span>
        <p>{{ directory }}</p>
      </div>
      <fieldset [disabled]="busy()">
        <legend class="visually-hidden">{{ 'QUICK_ACTION_BUILDER.Command title' | translate }}</legend>
        <div class="choices">
          <button type="button" class="choice" ngbAutofocus [class.selected]="action() === 'run'" [attr.aria-pressed]="action() === 'run'" [disabled]="createdPromptId !== null" (click)="action.set('run')">
            <i class="ti ti-player-play"></i><strong>{{ 'QUICK_ACTION_BUILDER.Run now' | translate }}</strong>
            <span>{{ 'QUICK_ACTION_BUILDER.Run description' | translate }}</span>
          </button>
          <button type="button" class="choice" [class.selected]="action() === 'save'" [attr.aria-pressed]="action() === 'save'" (click)="action.set('save')">
            <i class="ti ti-bolt"></i><strong>{{ 'QUICK_ACTION_BUILDER.Save action' | translate }}</strong>
            <span>{{ 'QUICK_ACTION_BUILDER.Save description' | translate }}</span>
          </button>
        </div>
        @if (action() === 'save') {
          <p class="hint">{{ (scopeType === 'global' ? 'QUICK_ACTION_SCOPE.Global hint' : scopeType === 'workspace' ? 'QUICK_ACTION_SCOPE.Workspace hint' : 'QUICK_ACTION_SCOPE.Session hint') | translate }}</p>
          <label for="command-action-name" class="form-label fw-semibold">{{ 'QUICK_ACTION_BUILDER.Action name' | translate }}</label>
          <input id="command-action-name" class="form-control" [(ngModel)]="title" maxlength="100" [disabled]="createdPromptId !== null" (keydown.enter)="$event.preventDefault(); submit()" [placeholder]="'QUICK_ACTION_BUILDER.Name example' | translate" />
          <p class="hint">{{ 'QUICK_ACTION_BUILDER.Command saved hint' | translate }}</p>
        }
      </fieldset>
      @if (error()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div> }
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline-secondary" [disabled]="busy()" (click)="modal.dismiss()">{{ 'BUTTONS.Cancel' | translate }}</button>
      <button type="button" class="btn btn-primary" [disabled]="busy() || !command.trim() || !directory.trim() || (action() === 'save' && !title.trim())" (click)="submit()">
        @if (busy()) { <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span> }
        {{ (action() === 'run' ? 'QUICK_ACTION_BUILDER.Run now' : 'QUICK_ACTION_BUILDER.Save action') | translate }}
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .modal-title { font-size: 1rem; }
    .intro, .hint { color: var(--po-text-secondary); font-size: .84rem; line-height: 1.6; }
    .command-preview { border: 1px solid var(--po-border-subtle); background: var(--po-bg-1); border-radius: 10px; padding: 16px; margin-bottom: 18px; }
    .command-preview code { display: block; color: var(--po-text-primary); white-space: pre-wrap; overflow-wrap: anywhere; font-size: .88rem; margin-bottom: 14px; }
    .command-preview span { font-size: .7rem; color: var(--po-text-tertiary); }
    .command-preview p { margin: 3px 0 0; overflow-wrap: anywhere; font-size: .78rem; color: var(--po-text-secondary); }
    .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
    .choice { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; text-align: start; padding: 16px; border: 1px solid var(--po-border-subtle); border-radius: 10px; background: var(--po-bg-2); color: var(--po-text-primary); }
    .choice.selected { border-color: var(--po-info); background: var(--po-bg-3); }
    .choice i { color: var(--po-info); font-size: 20px; }
    .choice strong { font-size: .85rem; }
    .choice span { color: var(--po-text-secondary); font-size: .78rem; line-height: 1.55; }
    .choice:focus-visible { outline: 2px solid var(--po-info); outline-offset: 2px; }
    .choice:disabled { opacity: .55; }
    .hint { margin: 8px 0 0; font-size: .77rem; }
    @media (max-width: 520px) { .choices { grid-template-columns: 1fr; } }
  `,
})
export class CommandActionModalComponent {
  protected modal = inject(NgbActiveModal);
  private prompts = inject(PromptQueryService);
  private slots = inject(ActionSlotService);
  private agents = inject(SubAgentService);
  private translate = inject(TranslateService);

  readonly scopeType = this.slots.context()?.scope.type ?? 'session';
  command = '';
  directory = '';
  sessionId = '';
  title = '';
  action = signal<'run' | 'save'>('run');
  busy = signal(false);
  error = signal('');
  // Retain a successfully created prompt when adding the slot fails: Retry must
  // not create another prompt or accidentally launch the command.
  createdPromptId: number | null = null;

  async submit(): Promise<void> {
    if (this.busy() || !this.command.trim() || !this.directory.trim()) return;
    if (this.action() === 'save' && !this.title.trim()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.action() === 'run') {
        if (!this.sessionId) throw new Error(this.translate.instant('SESSIONS.No active session'));
        const agent = await this.agents.spawnCustom(
          this.sessionId, 'custom', this.command, this.command,
          'generic-shell', 'clean', undefined, this.directory,
          undefined, undefined, 'interactive',
        );
        if (!agent) throw new Error(this.translate.instant('MESSAGE.Generic error'));
        this.modal.close({ executed: true });
      } else {
        if (this.createdPromptId === null) {
          const prompt = await this.prompts.addEntity({
            title: this.title.trim(), body: this.command,
            notes: commandActionNotes(this.directory),
            status: 'published', visibility: 'private',
          });
          if (!prompt?.id) throw new Error(this.translate.instant('MESSAGE.Generic error'));
          this.createdPromptId = prompt.id;
        }
        const slot = await this.slots.addSlot(this.createdPromptId!, this.title.trim(), 'ti-terminal-2', this.sessionId, { throwOnError: true, scope: this.scopeType === 'global' ? 'global' : 'session' });
        if (!slot) throw new Error(this.translate.instant('QUICK_ACTION_BUILDER.Add failed'));
        this.modal.close({ slotId: slot.id });
      }
    } catch (error: any) {
      this.error.set(error?.message || this.translate.instant('MESSAGE.Generic error'));
    } finally {
      this.busy.set(false);
    }
  }
}
