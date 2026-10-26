import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import { getSessions } from '../../../store/sessions/session.selectors';
import { loadSessions } from '../../../store/sessions/session.actions';
import { SessionSummary } from '../../../store/sessions/session.state';
import { CreateSessionModalComponent } from '../../views/admin-core/sessions/create-session-modal/create-session-modal.component';

const LIVE_STATUSES: string[] = ['running', 'in_progress', 'waiting_input', 'idle'];

export type PromptInjectTarget =
  | { type: 'session'; session: SessionSummary }
  | { type: 'new'; createResult: any };

@Component({
  selector: 'app-prompt-inject-session-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <h5 class="modal-title">
        <iconify-icon icon="solar:play-bold" width="16"></iconify-icon>
        {{ 'PROMPTS.Send to Session' | translate }}
      </h5>
      <button type="button" class="btn-close" (click)="modal.dismiss()" [attr.aria-label]="'BUTTONS.Close' | translate"></button>
    </div>
    <div class="modal-body">
      <!-- Prompt preview -->
      <div class="prompt-preview">
        <div class="prompt-preview-title">
          <iconify-icon icon="solar:document-text-bold" width="15"></iconify-icon>
          {{ promptTitle }}
        </div>
        @if (promptBody) {
          <div class="prompt-preview-body">{{ promptBody | slice:0:150 }}{{ promptBody.length > 150 ? '...' : '' }}</div>
        }
      </div>

      <!-- Target selection -->
      <label class="form-label">{{ 'PROMPTS.Select target' | translate }}</label>
      <div class="target-tabs">
        <button class="target-tab" [class.active]="selectedType === 'session'" [attr.aria-pressed]="selectedType === 'session'" (click)="selectType('session')">
          <iconify-icon icon="solar:monitor-bold" width="15"></iconify-icon>
          {{ 'BOARD.Session' | translate }}
        </button>
        <button class="target-tab" [class.active]="selectedType === 'new'" [attr.aria-pressed]="selectedType === 'new'" (click)="selectType('new')">
          <iconify-icon icon="solar:add-circle-bold" width="15"></iconify-icon>
          {{ 'BOARD.New Session' | translate }}
        </button>
      </div>

      <!-- Session select -->
      @if (selectedType === 'session') {
        <div class="select-section">
          <label class="form-label">{{ 'BOARD.Select session' | translate }}</label>
          @if (sessions().length > 0) {
            <div class="session-list" role="radiogroup" [attr.aria-label]="'BOARD.Select session' | translate">
              @for (s of sessions(); track s.id) {
                <div
                  class="session-item"
                  role="radio"
                  tabindex="0"
                  [attr.aria-checked]="selectedSessionId === s.id"
                  [class.selected]="selectedSessionId === s.id"
                  (click)="selectSession(s.id)"
                  (keydown.space)="selectSession(s.id); $event.preventDefault()"
                  (keydown.enter)="selectSession(s.id)"
                >
                  <div class="session-item-info">
                    <span class="session-name">{{ s.name }}</span>
                    <span class="session-meta">{{ s.provider }} · {{ s.workspace?.name || ('INJECT.No workspace' | translate) }}</span>
                  </div>
                  <span class="session-status" [class]="'status-' + statusOf(s)">{{ 'SESSIONS.Status ' + statusOf(s) | translate }}</span>
                </div>
              }
            </div>
          } @else {
            <div class="empty-hint">{{ 'BOARD.No active sessions' | translate }}</div>
          }
        </div>
      }

      <!-- New session -->
      @if (selectedType === 'new') {
        <div class="select-section">
          <div class="new-session-hint">{{ 'PROMPTS.New session with prompt' | translate }}</div>
        </div>
      }
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline-secondary btn-sm" (click)="modal.dismiss()">{{ 'SESSIONS.Cancel' | translate }}</button>
      <button class="btn btn-primary btn-sm" [disabled]="!canConfirm()" (click)="confirm()">
        <iconify-icon icon="solar:play-bold" width="14" class="me-1"></iconify-icon>
        {{ 'PROMPTS.Inject Prompt' | translate }}
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .prompt-preview {
      padding: 0.6rem 0.75rem; margin-bottom: 0.75rem;
      background: rgba(99,102,241,0.04); border: 1px solid rgba(99,102,241,0.1);
      border-radius: 8px;
    }
    .prompt-preview-title {
      font-size: 0.82rem; font-weight: 700;
      display: flex; align-items: center; gap: 0.4rem;
    }
    .prompt-preview-body {
      font-size: 0.72rem; color: rgba(100,116,139,0.6); margin-top: 0.25rem;
      font-family: 'JetBrains Mono', monospace; line-height: 1.5;
    }

    .form-label { font-size: 0.78rem; font-weight: 600; margin-bottom: 0.3rem; }

    .target-tabs {
      display: flex; gap: 0.35rem; margin-bottom: 0.85rem;
    }
    .target-tab {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 0.35rem;
      padding: 0.5rem 0.5rem; font-size: 0.75rem; font-weight: 600;
      border-radius: 8px; border: 1px solid rgba(100,116,139,0.12);
      background: transparent; color: rgba(100,116,139,0.6);
      cursor: pointer; transition: all 0.15s;
    }
    .target-tab:hover { background: rgba(99,102,241,0.04); border-color: rgba(99,102,241,0.15); color: #6366f1; }
    .target-tab.active {
      background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.3);
      color: var(--po-accent);
    }

    .select-section { margin-top: 0.25rem; }

    .session-list {
      display: flex; flex-direction: column; gap: 0.35rem;
      max-height: 240px; overflow-y: auto;
    }
    .session-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.55rem 0.75rem; border-radius: 8px;
      border: 1px solid rgba(100,116,139,0.12);
      cursor: pointer; transition: all 0.15s;
    }
    .session-item:hover {
      background: rgba(99,102,241,0.04); border-color: rgba(99,102,241,0.15);
    }
    .session-item.selected {
      background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.3);
    }
    .session-item-info { display: flex; flex-direction: column; gap: 0.1rem; }
    .session-name { font-size: 0.8rem; font-weight: 600; }
    .session-meta { font-size: 0.7rem; color: rgba(100,116,139,0.6); }
    .session-status {
      font-size: 0.65rem; font-weight: 600; padding: 0.1rem 0.4rem;
      border-radius: 4px;
    }
    .status-running { background: rgba(34,197,94,0.1); color: #15803d; }
    .status-in_progress { background: rgba(139,92,246,0.12); color: #7c3aed; }
    .status-waiting_input { background: rgba(234,179,8,0.1); color: #b45309; }
    .status-idle, .status-standby, .status-exited, .status-completed { background: rgba(var(--bs-secondary-rgb),0.1); color: var(--bs-secondary-color); }

    .empty-hint {
      font-size: 0.78rem; color: rgba(100,116,139,0.5);
      padding: 0.6rem 0.75rem; text-align: center;
      background: rgba(248,250,252,0.5); border: 1px dashed rgba(100,116,139,0.15);
      border-radius: 8px;
    }
    :host-context([data-bs-theme="dark"]) .empty-hint { background: rgba(15,23,42,0.3); }

    .new-session-hint {
      font-size: 0.78rem; color: rgba(100,116,139,0.6);
      padding: 0.6rem 0.75rem;
      background: rgba(99,102,241,0.04); border: 1px solid rgba(99,102,241,0.1);
      border-radius: 8px;
    }
  `,
})
export class PromptInjectSessionModalComponent implements OnInit, OnDestroy {
  modal = inject(NgbActiveModal);
  private store = inject(Store);
  private modalService = inject(NgbModal);
  private subs: Subscription[] = [];

  /** Set via componentInstance */
  promptTitle = '';
  promptBody = '';

  selectedType: 'session' | 'new' | null = null;
  selectedSessionId: string | null = null;
  private createResult: any = null;

  allSessions = signal<SessionSummary[]>([]);

  /**
   * Every session, live ones first. After a restart all sessions are parked
   * (standby): sending to one wakes it first (PromptInjectionService).
   */
  sessions = computed(() => {
    const live = (s: SessionSummary) => !s.standbyAt && LIVE_STATUSES.includes(s.status);
    return [...this.allSessions()].sort((a, b) => Number(live(b)) - Number(live(a)));
  });

  /** Enter sends, like the primary button (a focused button keeps its own Enter). */
  @HostListener('keydown.enter', ['$event'])
  onEnter(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, textarea, input, select')) return;
    if (!this.canConfirm()) return;
    event.preventDefault();
    this.confirm();
  }

  statusOf(s: SessionSummary): string {
    return s.standbyAt ? 'standby' : s.status;
  }

  ngOnInit(): void {
    this.store.dispatch(loadSessions());
    this.subs.push(
      this.store.select(getSessions).subscribe(ss => this.allSessions.set(ss)),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  selectType(type: 'session' | 'new'): void {
    this.selectedType = type;
    this.selectedSessionId = null;
    this.createResult = null;

    if (type === 'new') {
      this.openCreateSessionModal();
    }
  }

  selectSession(sessionId: string): void {
    this.selectedSessionId = sessionId;
  }

  private openCreateSessionModal(): void {
    const ref = this.modalService.open(CreateSessionModalComponent, {
      centered: true,
      size: 'lg',
    });

    ref.result.then(
      (result: any) => {
        if (result) {
          this.createResult = result;
          this.confirm();
        }
      },
      () => {
        this.selectedType = null;
      },
    );
  }

  canConfirm(): boolean {
    if (this.selectedType === 'session') return !!this.selectedSessionId;
    if (this.selectedType === 'new') return !!this.createResult;
    return false;
  }

  confirm(): void {
    let target: PromptInjectTarget | null = null;

    if (this.selectedType === 'session' && this.selectedSessionId) {
      const s = this.allSessions().find(s => s.id === this.selectedSessionId);
      if (s) target = { type: 'session', session: s };
    } else if (this.selectedType === 'new' && this.createResult) {
      target = { type: 'new', createResult: this.createResult };
    }

    if (target) {
      this.modal.close(target);
    }
  }
}
