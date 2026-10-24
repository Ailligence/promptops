import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  Input,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';

import { ProviderPickerComponent } from '../../../../common/provider-picker/provider-picker.component';
import { ProviderId } from '@core/providers/provider-capability';
import { SubAgent } from '../services/sub-agent.service';
import {
  SubAgentReviewService,
  ReviewFocus,
  ReviewRun,
} from '../services/sub-agent-review.service';

@Component({
  selector: 'app-check-with-provider-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule, ProviderPickerComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <h5 class="modal-title">
        <iconify-icon icon="solar:shield-check-bold-duotone" width="18"></iconify-icon>
        {{ 'SUBAGENTS.REVIEW.Check with another provider' | translate }}
      </h5>
      <button type="button" class="btn-close" (click)="activeModal.dismiss()" [attr.aria-label]="'COMMON.Close' | translate"></button>
    </div>

    <div class="modal-body">
      <!-- Original task summary -->
      <div class="original-card">
        <div class="original-row">
          <iconify-icon [icon]="task.icon" width="18"></iconify-icon>
          <span class="original-title">{{ task.title }}</span>
          <span class="original-meta">{{ task.provider }} · {{ task.mode ?? '—' }}</span>
        </div>
        @if (task.userPrompt) {
          <p class="original-prompt">{{ task.userPrompt }}</p>
        }
      </div>

      <!-- History chips -->
      @if (runs().length > 0) {
        <div class="history-row">
          <span class="history-label">{{ 'SUBAGENTS.REVIEW.History' | translate }}:</span>
          <div class="history-chips">
            @for (r of runs(); track r.id) {
              <button
                type="button"
                class="chip"
                [class.selected]="selectedRunId() === r.id"
                [class.status-running]="r.status === 'running'"
                [class.status-done]="r.status === 'done'"
                [class.status-error]="r.status === 'error'"
                [class.status-canceled]="r.status === 'canceled'"
                (click)="selectRun(r.id)"
              >
                <span class="chip-idx">#{{ $index + 1 }}</span>
                @if (r.status === 'running') {
                  <iconify-icon icon="solar:refresh-bold" width="11" class="spin"></iconify-icon>
                } @else if (r.verdict === 'PASS') {
                  <iconify-icon icon="solar:check-circle-bold" width="11"></iconify-icon>
                } @else if (r.verdict === 'ISSUES') {
                  <iconify-icon icon="solar:danger-triangle-bold" width="11"></iconify-icon>
                } @else if (r.verdict === 'FAIL') {
                  <iconify-icon icon="solar:close-circle-bold" width="11"></iconify-icon>
                } @else if (r.status === 'error') {
                  <iconify-icon icon="solar:close-circle-bold" width="11"></iconify-icon>
                } @else if (r.status === 'canceled') {
                  <iconify-icon icon="solar:stop-bold" width="11"></iconify-icon>
                }
                <span class="chip-provider">{{ r.reviewerProviderId }}</span>
                @if (r.durationMs) {
                  <span class="chip-duration">{{ formatDuration(r.durationMs) }}</span>
                }
              </button>
            }
          </div>
        </div>
      }

      <!-- Config (only when no run is selected or starting a new one) -->
      @if (!viewingPast()) {
        <div class="config-section">
          <label class="config-label">{{ 'SUBAGENTS.REVIEW.Review with' | translate }}</label>
          <app-provider-picker
            [value]="selectedReviewer()"
            (valueChange)="selectedReviewer.set($event)"
            [disabled]="isRunning()"
          ></app-provider-picker>
          @if (sameAsOriginal()) {
            <p class="hint warn">
              <iconify-icon icon="solar:info-circle-bold" width="12"></iconify-icon>
              {{ 'SUBAGENTS.REVIEW.Pick a different provider than the original' | translate }}
            </p>
          }

          <label class="config-label">{{ 'SUBAGENTS.REVIEW.Focus' | translate }}</label>
          <div class="focus-row">
            @for (f of focusOptions; track f) {
              <button
                type="button"
                class="focus-chip"
                [class.selected]="selectedFocus() === f"
                [disabled]="isRunning()"
                (click)="selectedFocus.set(f)"
              >
                {{ ('SUBAGENTS.REVIEW.FOCUS.' + f) | translate }}
              </button>
            }
          </div>
        </div>
      }

      <!-- Output -->
      <div class="output-wrap">
        <div class="output-header">
          @if (currentRun(); as r) {
            <span class="output-label">
              <iconify-icon icon="solar:document-text-bold-duotone" width="14"></iconify-icon>
              {{ 'SUBAGENTS.REVIEW.Review output' | translate }}
              @if (r.verdict; as v) {
                <span class="verdict-pill" [class]="'verdict-' + v.toLowerCase()">{{ v }}</span>
              }
              @if (r.status === 'running') {
                <span class="status-pill running">
                  <iconify-icon icon="solar:refresh-bold" width="11" class="spin"></iconify-icon>
                  {{ 'SUBAGENTS.REVIEW.Streaming' | translate }}
                </span>
              } @else if (r.status === 'error') {
                <span class="status-pill error">{{ 'SUBAGENTS.REVIEW.Failed' | translate }}</span>
              } @else if (r.status === 'canceled') {
                <span class="status-pill canceled">{{ 'SUBAGENTS.REVIEW.Canceled' | translate }}</span>
              }
            </span>
            @if (r.output && r.status !== 'running') {
              <button
                type="button"
                class="btn-copy"
                (click)="copyOutput()"
                [title]="'SUBAGENTS.REVIEW.Copy report' | translate"
              >
                <iconify-icon icon="solar:copy-bold" width="13"></iconify-icon>
                {{ 'SUBAGENTS.REVIEW.Copy' | translate }}
              </button>
            }
          } @else {
            <span class="output-label muted">{{ 'SUBAGENTS.REVIEW.No review yet' | translate }}</span>
          }
        </div>
        <pre #outputBox class="output-box" [class.empty]="!currentRun()?.output">{{ currentRun()?.output || ('SUBAGENTS.REVIEW.Run a review to see the report here' | translate) }}</pre>
        @if (currentRun()?.errorMessage; as err) {
          <p class="output-error">{{ err }}</p>
        }
      </div>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn btn-ghost" (click)="activeModal.dismiss()">
        {{ 'COMMON.Close' | translate }}
      </button>

      @if (isRunning()) {
        <button type="button" class="btn btn-stop" (click)="stop()">
          <iconify-icon icon="solar:stop-bold" width="13"></iconify-icon>
          {{ 'SUBAGENTS.REVIEW.Stop' | translate }}
        </button>
      } @else {
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="sameAsOriginal() || !selectedReviewer()"
          (click)="runReview()"
        >
          <iconify-icon
            [icon]="runs().length > 0 ? 'solar:restart-bold' : 'solar:play-bold'"
            width="13"
          ></iconify-icon>
          {{ (runs().length > 0 ? 'SUBAGENTS.REVIEW.New review' : 'SUBAGENTS.REVIEW.Run review') | translate }}
          <kbd>⏎</kbd>
        </button>
      }
    </div>
  `,
  host: { '(keydown.enter)': 'onEnter($event)' },
  styles: `
    :host { display: block; }

    .modal-header {
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .modal-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1rem;
      color: var(--po-text-primary);
    }

    .modal-body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
    }

    .original-card {
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: 8px;
      padding: 0.5rem 0.625rem;
    }
    .original-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }
    .original-title {
      font-weight: 600;
      font-size: 0.85rem;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .original-meta {
      font-size: 0.65rem;
      color: var(--po-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      flex-shrink: 0;
    }
    .original-prompt {
      margin: 0.3rem 0 0;
      font-size: 0.75rem;
      color: var(--po-text-secondary);
      line-height: 1.35;
      max-height: 3.6em;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }

    .history-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .history-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--po-text-secondary);
    }
    .history-chips {
      display: flex;
      gap: 0.3rem;
      flex-wrap: wrap;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.45rem;
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: 999px;
      font-size: 0.7rem;
      color: var(--po-text-secondary);
      cursor: pointer;
      transition: all 0.12s;
    }
    .chip:hover { border-color: rgba(99, 102, 241, 0.4); color: var(--po-text-primary); }
    .chip.selected { border-color: #6366f1; background: rgba(99, 102, 241, 0.08); color: var(--po-text-primary); }
    .chip-idx { font-weight: 700; color: #818cf8; }
    .chip-provider { font-family: var(--bs-font-monospace, monospace); font-size: 0.62rem; }
    .chip-duration { color: var(--po-text-tertiary); }
    .chip.status-error { border-color: rgba(248, 81, 73, 0.4); }
    .chip.status-canceled { opacity: 0.7; }

    .config-section {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .config-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--po-text-secondary);
      margin: 0.15rem 0 0;
    }
    .focus-row {
      display: flex;
      gap: 0.3rem;
      flex-wrap: wrap;
    }
    .focus-chip {
      padding: 0.28rem 0.6rem;
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: 6px;
      font-size: 0.75rem;
      color: var(--po-text-secondary);
      cursor: pointer;
      transition: all 0.12s;
    }
    .focus-chip:hover:not(:disabled) { border-color: rgba(99, 102, 241, 0.4); color: var(--po-text-primary); }
    .focus-chip.selected {
      background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.18));
      border-color: #6366f1;
      color: var(--po-text-primary);
    }
    .focus-chip:disabled { opacity: 0.5; cursor: not-allowed; }

    .hint {
      font-size: 0.7rem;
      color: var(--po-text-secondary);
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      margin: -0.15rem 0 0;
    }
    .hint.warn { color: var(--po-warning); }

    .output-wrap {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .output-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .output-label {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--po-text-secondary);
    }
    .output-label.muted { color: var(--po-text-tertiary); }

    .verdict-pill {
      font-size: 0.65rem;
      font-weight: 800;
      padding: 1px 6px;
      border-radius: 4px;
      letter-spacing: 0.04em;
    }
    .verdict-pass { background: var(--po-success-bg); color: var(--po-success); }
    .verdict-issues { background: rgba(255, 176, 32, 0.18); color: var(--po-warning); }
    .verdict-fail { background: var(--po-error-bg); color: var(--po-error); }

    .status-pill {
      font-size: 0.62rem;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      letter-spacing: 0.03em;
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
    }
    .status-pill.running { background: rgba(99,102,241,0.18); color: #818cf8; }
    .status-pill.error { background: var(--po-error-bg); color: var(--po-error); }
    .status-pill.canceled { background: var(--po-bg-2); color: var(--po-text-secondary); }

    .btn-copy {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.5rem;
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: 4px;
      font-size: 0.7rem;
      color: var(--po-text-secondary);
      cursor: pointer;
    }
    .btn-copy:hover { border-color: #6366f1; color: var(--po-text-primary); }

    .output-box {
      background: var(--po-bg-0);
      border: 1px solid var(--po-border-subtle);
      border-radius: 8px;
      padding: 0.7rem 0.85rem;
      max-height: 420px;
      min-height: 220px;
      overflow-y: auto;
      font-family: var(--bs-font-monospace, monospace);
      font-size: 0.78rem;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--po-text-primary);
      margin: 0;
    }
    .output-box.empty {
      color: var(--po-text-tertiary);
      font-style: italic;
      font-family: inherit;
    }

    .output-error {
      margin: 0;
      font-size: 0.75rem;
      color: var(--po-error);
    }

    .modal-footer {
      border-top: 1px solid var(--po-border-subtle);
      gap: 0.5rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.4rem 0.85rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.12s;
    }
    .btn-ghost {
      background: transparent;
      color: var(--po-text-secondary);
      border-color: var(--po-border-subtle);
    }
    .btn-ghost:hover { border-color: var(--po-border-strong); color: var(--po-text-primary); }
    .btn-primary {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      border-color: transparent;
    }
    .btn-primary:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .btn-primary kbd {
      font-size: 0.62rem;
      padding: 1px 4px;
      background: rgba(255,255,255,0.18);
      border-radius: 3px;
      margin-left: 0.25rem;
    }
    .btn-stop {
      background: var(--po-error-bg);
      color: var(--po-error);
      border-color: rgba(248, 81, 73, 0.4);
    }
    .btn-stop:hover { background: rgba(248, 81, 73, 0.2); }

    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `,
})
export class CheckWithProviderModalComponent implements OnInit, AfterViewInit {
  readonly activeModal = inject(NgbActiveModal);
  private readonly reviewService = inject(SubAgentReviewService);

  /** The sub-agent task being reviewed (set by the caller via componentInstance). */
  @Input({ required: true }) task!: SubAgent;

  @ViewChild('outputBox') outputBox?: ElementRef<HTMLPreElement>;

  protected readonly focusOptions: ReviewFocus[] = ['correctness', 'security', 'style', 'free'];

  protected readonly selectedReviewer = signal<ProviderId>('claude-code-cli');
  protected readonly selectedFocus = signal<ReviewFocus>('free');
  protected readonly selectedRunId = signal<string | null>(null);
  private readonly taskId = signal<string>('');

  protected readonly runs = computed(() => {
    const id = this.taskId();
    return id ? this.reviewService.runsForTask(id)() : [];
  });

  protected readonly latestRun = computed(() => {
    const list = this.runs();
    return list.length > 0 ? list[list.length - 1] : undefined;
  });

  protected readonly currentRun = computed<ReviewRun | undefined>(() => {
    const selected = this.selectedRunId();
    const list = this.runs();
    if (selected) {
      const found = list.find((r) => r.id === selected);
      if (found) return found;
    }
    return this.latestRun();
  });

  protected readonly starting = signal(false);
  protected readonly isRunning = computed(() => this.starting() || this.runs().some(r => r.status === 'running'));
  protected readonly viewingPast = computed(() => {
    const sel = this.selectedRunId();
    return sel !== null && sel !== this.latestRun()?.id;
  });
  protected readonly sameAsOriginal = computed(
    () => this.selectedReviewer() === (this.task?.provider as ProviderId),
  );

  constructor() {
    // Auto-scroll to bottom while streaming.
    effect(() => {
      const r = this.currentRun();
      if (!r || r.status !== 'running') return;
      // Touch output so the effect re-runs as chunks arrive
      void r.output;
      queueMicrotask(() => {
        const el = this.outputBox?.nativeElement;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        if (nearBottom) el.scrollTop = el.scrollHeight;
      });
    });
  }

  ngOnInit(): void {
    this.taskId.set(this.task.id);
    void this.reviewService.hydrateTask(this.task.id);

    // Pre-fill reviewer/focus from last session, defaulting to a different provider than the original.
    const lastR = this.reviewService.lastReviewer();
    const lastF = this.reviewService.lastFocus();
    const originalProvider = this.task.provider as ProviderId;
    const desired = lastR && lastR !== originalProvider
      ? lastR
      : (originalProvider === 'claude-code-cli' ? 'codex' : 'claude-code-cli');
    this.selectedReviewer.set(desired);
    this.selectedFocus.set(lastF);
  }

  ngAfterViewInit(): void {
    this.reviewService.startListening();
  }

  // ── Actions ──────────────────────────────────────────────────

  selectRun(runId: string): void {
    this.selectedRunId.set(runId);
  }

  async runReview(): Promise<void> {
    if (this.sameAsOriginal() || this.isRunning()) return;
    this.starting.set(true);

    const task = this.task;
    const reviewer = this.selectedReviewer();
    const focus = this.selectedFocus();
    try {
      const runId = await this.reviewService.start(task.id, reviewer, focus);
      if (runId) {
        this.reviewService.registerOptimistic({
          id: runId,
          subAgentId: task.id,
          parentSessionId: task.parentSessionId,
          reviewerProviderId: reviewer,
          focus,
          status: 'running',
          startedAt: Date.now(),
          output: '',
        });
        this.selectedRunId.set(runId);
      }
    } catch (err) {
      this.selectedRunId.set(null);
      // Surface error inline via a synthetic failed run
      this.reviewService.registerOptimistic({
        id: `local-${Date.now()}`,
        subAgentId: task.id,
        parentSessionId: task.parentSessionId,
        reviewerProviderId: reviewer,
        focus,
        status: 'error',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 0,
        output: '',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.starting.set(false);
    }
  }

  async stop(): Promise<void> {
    const r = this.runs().find(run => run.status === 'running');
    if (!r || r.status !== 'running') return;
    await this.reviewService.cancel(r.id);
  }

  copyOutput(): void {
    const r = this.currentRun();
    if (!r?.output) return;
    void navigator.clipboard?.writeText(r.output);
  }

  onEnter(ev: KeyboardEvent): void {
    if (this.isRunning()) return;
    if (this.sameAsOriginal() || !this.selectedReviewer()) return;
    ev.preventDefault();
    void this.runReview();
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 100) / 10;
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rest = Math.round(s - m * 60);
    return `${m}m${rest}s`;
  }
}
