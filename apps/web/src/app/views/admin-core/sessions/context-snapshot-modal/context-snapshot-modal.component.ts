import { Component, inject, signal, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { SessionService } from '../services/session.service';

interface SnapshotStep {
  label: string;
  icon: string;
  status: 'pending' | 'active' | 'done';
}

@Component({
  selector: 'app-context-snapshot-modal',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <!-- Standard modal structure matching the app theme -->
    <div class="modal-header border-0 pb-0">
      <div class="w-100 text-center pt-2">
        <div class="cs-icon-ring" [class.cs-done]="completed()" [class.cs-fail]="failed()">
          @if (completed()) {
            <iconify-icon icon="solar:check-circle-bold" width="36" style="color: #34d399"></iconify-icon>
          } @else if (failed()) {
            <iconify-icon icon="solar:danger-triangle-bold" width="36" style="color: #f87171"></iconify-icon>
          } @else {
            <iconify-icon icon="solar:map-arrow-square-bold-duotone" width="36" style="color: var(--po-accent-text)"></iconify-icon>
          }
        </div>
      </div>
    </div>

    <div class="modal-body pt-3 pb-2">
      <!-- Title -->
      <h5 class="text-center mb-1 cs-title" aria-live="polite">
        @if (completed()) {
          {{ 'CONTEXT_SNAPSHOT.Context ready' | translate }}
        } @else if (failed()) {
          {{ 'CONTEXT_SNAPSHOT.Mapping failed' | translate }}
        } @else {
          {{ 'CONTEXT_SNAPSHOT.Preparing project context' | translate }}
        }
      </h5>

      <!-- Subtitle -->
      <p class="text-center cs-subtitle mb-4">
        @if (completed()) {
          {{ 'CONTEXT_SNAPSHOT.Context ready description' | translate }}
        } @else if (failed()) {
          {{ 'CONTEXT_SNAPSHOT.Mapping failed description' | translate }}
          @if (failedError()) {
            <br><code class="cs-error-detail">{{ failedError() }}</code>
          }
        } @else {
          {{ 'CONTEXT_SNAPSHOT.Preparing description' | translate }}
        }
      </p>

      <!-- Progress bar -->
      <div class="cs-progress-track mb-4" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="progressPercent()" [attr.aria-label]="'CONTEXT_SNAPSHOT.Preparing project context' | translate">
        <div class="cs-progress-fill" [style.width.%]="progressPercent()"></div>
      </div>

      <!-- Steps list -->
      <div class="cs-steps">
        @for (step of steps(); track step.label; let i = $index) {
          <div class="cs-step" [class.cs-step-active]="step.status === 'active'" [class.cs-step-done]="step.status === 'done'">
            <div class="cs-step-num">
              @if (step.status === 'done') {
                <iconify-icon icon="solar:check-read-bold" width="16" style="color: #34d399"></iconify-icon>
              } @else if (step.status === 'active') {
                <div class="cs-step-spin"></div>
              } @else {
                <span>{{ i + 1 }}</span>
              }
            </div>
            <span class="cs-step-text">{{ step.label | translate }}</span>
          </div>
        }
      </div>

      <!-- Background notice -->
      @if (backgroundMode()) {
        <div class="cs-bg-notice mt-3">
          <iconify-icon icon="solar:bolt-circle-bold" width="18"></iconify-icon>
          <span>{{ 'CONTEXT_SNAPSHOT.Background notice' | translate }}</span>
        </div>
      }

      <!-- Provider + token note -->
      <div class="cs-meta mt-3">
        <iconify-icon icon="solar:cpu-bolt-bold-duotone" width="15"></iconify-icon>
        <span>{{ providerLabel }}</span>
        <span class="cs-meta-sep">·</span>
        <span>{{ 'CONTEXT_SNAPSHOT.Token optimization note' | translate }}</span>
      </div>
    </div>

    <div class="modal-footer border-0 pt-0 justify-content-center">
      @if (canContinue()) {
        <button class="btn btn-primary btn-sm px-4" (click)="modal.close({ status: resultStatus })">
          {{ 'SESSIONS.Continue' | translate }}
        </button>
      } @else {
        <button class="btn btn-outline-secondary btn-sm px-3" disabled>
          <span class="cs-btn-spin me-1"></span>
          {{ 'CONTEXT_SNAPSHOT.Preparing project context' | translate }}...
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    /* ── Icon ring ── */
    .cs-icon-ring {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(167, 139, 250, 0.1);
      border: 2px solid rgba(167, 139, 250, 0.2);
      animation: cs-pulse 2.4s ease-in-out infinite;
      transition: all 0.4s ease;
    }
    .cs-icon-ring.cs-done {
      background: rgba(52, 211, 153, 0.1);
      border-color: rgba(52, 211, 153, 0.25);
      animation: none;
    }
    .cs-icon-ring.cs-fail {
      background: rgba(248, 113, 113, 0.1);
      border-color: rgba(248, 113, 113, 0.2);
      animation: none;
    }

    /* ── Text ── */
    .cs-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--bs-body-color, #dee2e6);
    }
    .cs-subtitle {
      font-size: 0.88rem;
      color: var(--bs-secondary-color, #adb5bd);
      line-height: 1.55;
      max-width: 360px;
      margin-left: auto;
      margin-right: auto;
    }

    /* ── Progress bar ── */
    .cs-progress-track {
      height: 4px;
      background: var(--bs-secondary-bg, #2b2f38);
      border-radius: 4px;
      overflow: hidden;
    }
    .cs-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--po-accent-text), var(--po-accent-text));
      border-radius: 4px;
      transition: width 0.4s ease;
    }

    /* ── Steps ── */
    .cs-steps {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .cs-step {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 8px;
      background: transparent;
      transition: background 0.25s, opacity 0.25s;
      opacity: 0.4;
    }
    .cs-step-active {
      opacity: 1;
      background: rgba(167, 139, 250, 0.06);
    }
    .cs-step-done {
      opacity: 0.7;
    }

    .cs-step-num {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      font-weight: 700;
      background: var(--bs-secondary-bg, #2b2f38);
      color: var(--po-text-secondary);
      flex-shrink: 0;
    }
    .cs-step-done .cs-step-num {
      background: rgba(52, 211, 153, 0.1);
    }
    .cs-step-active .cs-step-num {
      background: rgba(167, 139, 250, 0.15);
      color: var(--po-accent-text);
    }

    .cs-step-spin {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(167, 139, 250, 0.2);
      border-top-color: var(--po-accent-text);
      border-radius: 50%;
      animation: cs-spin 0.7s linear infinite;
    }

    .cs-step-text {
      font-size: 0.85rem;
      color: var(--bs-body-color, #dee2e6);
    }
    .cs-step:not(.cs-step-active):not(.cs-step-done) .cs-step-text {
      color: var(--po-text-secondary);
    }

    /* ── Background notice ── */
    .cs-bg-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(251, 191, 36, 0.06);
      border: 1px solid rgba(251, 191, 36, 0.12);
      color: #fbbf24;
      font-size: 0.82rem;
      animation: cs-fade-in 0.35s ease;
    }

    /* ── Meta footer ── */
    .cs-meta {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 5px;
      font-size: 0.75rem;
      color: var(--bs-secondary-color, #6c757d);
      text-align: center;
      line-height: 1.5;
    }
    .cs-meta-sep {
      opacity: 0.4;
    }

    /* ── Button spinner ── */
    .cs-btn-spin {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top-color: rgba(255, 255, 255, 0.6);
      border-radius: 50%;
      animation: cs-spin 0.7s linear infinite;
      vertical-align: middle;
    }

    /* ── Error detail ── */
    .cs-error-detail {
      display: inline-block;
      margin-top: 6px;
      font-size: 0.72rem;
      color: #f87171;
      background: rgba(248, 113, 113, 0.08);
      padding: 4px 10px;
      border-radius: 4px;
      word-break: break-all;
      max-width: 100%;
    }

    /* ── Keyframes ── */
    @keyframes cs-pulse {
      0%, 100% { transform: scale(1); border-color: rgba(167, 139, 250, 0.2); }
      50% { transform: scale(1.05); border-color: rgba(167, 139, 250, 0.35); }
    }
    @keyframes cs-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes cs-fade-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `],
})
export class ContextSnapshotModalComponent implements OnInit, OnDestroy {
  modal = inject(NgbActiveModal);
  private sessionService = inject(SessionService);
  private translate = inject(TranslateService);
  /** Set in ngOnDestroy: the snapshot call can resolve after the modal is gone. */
  private destroyed = false;

  /** Set via componentInstance */
  workspacePath = '';
  provider = 'claude-code-cli';

  steps = signal<SnapshotStep[]>([
    { label: 'CONTEXT_SNAPSHOT.Scanning directories', icon: 'solar:folder-bold', status: 'pending' },
    { label: 'CONTEXT_SNAPSHOT.Detecting frameworks', icon: 'solar:code-bold', status: 'pending' },
    { label: 'CONTEXT_SNAPSHOT.Identifying entry points', icon: 'solar:pin-bold', status: 'pending' },
    { label: 'CONTEXT_SNAPSHOT.Preparing project map', icon: 'solar:map-bold', status: 'pending' },
  ]);

  completed = signal(false);
  failed = signal(false);
  failedError = signal<string | null>(null);
  backgroundMode = signal(false);
  canContinue = signal(false);
  progressPercent = signal(0);
  resultStatus = 'ready';

  private progressUnsub?: () => void;
  private completeUnsub?: () => void;
  private timeoutId?: ReturnType<typeof setTimeout>;
  private minDisplayId?: ReturnType<typeof setTimeout>;

  get providerLabel(): string {
    const labels: Record<string, string> = {
      'claude-code-cli': 'Claude Code CLI',
      'codex': 'Codex',
      'gemini-cli': 'Gemini CLI',
      'antigravity': 'Antigravity',
      'copilot': 'Copilot',
      'cursor': 'Cursor',
    };
    if (this.provider === 'generic-shell') return this.translate.instant('SESSIONS.Generic Shell');
    return labels[this.provider] ?? this.provider;
  }

  async ngOnInit(): Promise<void> {
    if (!this.workspacePath) {
      this.modal.close({ status: 'skipped' });
      return;
    }

    // Listen for progress events
    if (this.sessionService.isDesktop) {
      this.progressUnsub = this.sessionService.onContextSnapshotProgress((data) => {
        if (data.workspacePath !== this.workspacePath) return;
        this.updateStep(data.step, data.totalSteps);
        this.progressPercent.set(Math.round((data.step / data.totalSteps) * 100));
      });

      this.completeUnsub = this.sessionService.onContextSnapshotComplete((data) => {
        if (data.workspacePath !== this.workspacePath) return;
        this.backgroundMode.set(false);
      });
    }

    // 3s timeout: if snapshot not done, switch to background mode
    this.timeoutId = setTimeout(() => {
      if (!this.completed() && !this.failed()) {
        this.backgroundMode.set(true);
        this.resultStatus = 'background';
        this.canContinue.set(true);
        this.progressPercent.set(100);
        // Mark visible steps as done
        this.steps.set(this.steps().map(s =>
          s.status === 'active' ? { ...s, status: 'done' as const } : s,
        ));
      }
    }, 3000);

    // Start snapshot generation
    try {
      const result = await this.sessionService.generateContextSnapshot(this.workspacePath);
      if (this.destroyed) return;

      if (result.ok) {
        this.steps.set(this.steps().map(s => ({ ...s, status: 'done' as const })));
        this.progressPercent.set(100);
        this.completed.set(true);
        this.resultStatus = 'ready';

        if (this.timeoutId) clearTimeout(this.timeoutId);

        // Minimum display time: let the user see the success for at least 1.5s
        this.minDisplayId = setTimeout(() => {
          this.canContinue.set(true);
        }, 1500);
      } else {
        this.handleFailure(result.error);
      }
    } catch (err) {
      if (this.destroyed) return;
      this.handleFailure(String(err));
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.progressUnsub?.();
    this.completeUnsub?.();
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.minDisplayId) clearTimeout(this.minDisplayId);
  }

  private handleFailure(errorMessage?: string): void {
    this.failed.set(true);
    this.failedError.set(errorMessage ?? null);
    this.resultStatus = 'failed';
    this.progressPercent.set(100);
    if (this.timeoutId) clearTimeout(this.timeoutId);
    // Show failure briefly, then allow continue
    this.minDisplayId = setTimeout(() => {
      this.canContinue.set(true);
    }, 1200);
  }

  private updateStep(currentStep: number, _totalSteps: number): void {
    this.steps.set(
      this.steps().map((step, i) => ({
        ...step,
        status: i < currentStep - 1
          ? 'done' as const
          : i === currentStep - 1
            ? 'active' as const
            : 'pending' as const,
      })),
    );
  }
}
