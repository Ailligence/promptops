import { Component, EventEmitter, HostListener, Input, Output, signal, ChangeDetectionStrategy } from '@angular/core';
import { ProviderType } from '@/store/sessions/session.state';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-generate-ai-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    @if (isOpen()) {
    <div class="modal-backdrop" (click)="close()"></div>
    <div class="modal-container">
      <div class="modal-card">
        <div class="modal-header-custom">
          <div class="d-flex align-items-center gap-2">
            <div class="modal-icon">
              <i class="ti ti-sparkles"></i>
            </div>
            <div>
              <h5 class="mb-0 fw-bold">{{ 'AI_GENERATE.Title' | translate }}</h5>
              <p class="mb-0 text-muted" style="font-size: 0.78rem;">{{ 'AI_GENERATE.Subtitle' | translate }}</p>
            </div>
          </div>
          <button type="button" class="btn-close-custom" (click)="close()">
            <i class="ti ti-x"></i>
          </button>
        </div>

        <div class="modal-body-custom">
          <!-- Title (optional) -->
          <div class="mb-3">
            <label class="form-label fw-semibold" style="font-size: 0.85rem;">
              {{ 'AI_GENERATE.Prompt title' | translate }}
              <span class="text-muted fw-normal">({{ 'AI_GENERATE.Optional' | translate }})</span>
            </label>
            <input
              type="text"
              class="form-control"
              [(ngModel)]="title"
              [placeholder]="'AI_GENERATE.Title placeholder' | translate"
            />
          </div>

          <!-- Description (required) -->
          <div class="mb-3">
            <label class="form-label fw-semibold" style="font-size: 0.85rem;">
              {{ 'AI_GENERATE.Description' | translate }}
              <span class="text-danger">*</span>
            </label>
            <textarea
              class="form-control"
              rows="4"
              [(ngModel)]="description"
              [placeholder]="'AI_GENERATE.Description placeholder' | translate"
              [class.is-invalid]="showError() && !description.trim()"
            ></textarea>
            @if (showError() && !description.trim()) {
            <div class="text-danger mt-1" style="font-size: 0.8rem;">
              {{ 'AI_GENERATE.Description required' | translate }}
            </div>
            }
          </div>

          <!-- Provider -->
          <div class="mb-3">
            <label class="form-label fw-semibold" style="font-size: 0.85rem;">
              {{ 'AI_GENERATE.Provider' | translate }}
            </label>
            <div class="provider-grid">
              @for (p of providers; track p.value) {
              <div
                class="provider-card"
                [class.selected]="selectedProvider() === p.value"
                (click)="selectedProvider.set(p.value)"
              >
                <i class="ti" [ngClass]="p.icon"></i>
                <span>{{ p.label }}</span>
              </div>
              }
            </div>
          </div>

          <!-- Error message -->
          @if (errorMessage()) {
          <div class="alert alert-danger d-flex align-items-center py-2 px-3" style="font-size: 0.82rem;">
            <i class="ti ti-alert-circle me-2"></i>
            {{ errorMessage() }}
          </div>
          }
        </div>

        <div class="modal-footer-custom">
          <button type="button" class="btn btn-outline-secondary btn-sm" (click)="close()">
            {{ 'BUTTONS.Cancel' | translate }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm d-flex align-items-center gap-1"
            (click)="generate()"
            [disabled]="isLoading()"
          >
            @if (isLoading()) {
            <span class="spinner-border spinner-border-sm"></span>
            {{ 'AI_GENERATE.Generating' | translate }}
            } @else {
            <i class="ti ti-sparkles"></i>
            {{ 'AI_GENERATE.Generate' | translate }}
            }
          </button>
        </div>
      </div>
    </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1050;
      backdrop-filter: blur(4px);
    }

    .modal-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1051;
      padding: 1rem;
    }

    .modal-card {
      background: var(--bs-body-bg, #fff);
      border: 1px solid rgba(var(--bs-secondary-rgb), 0.15);
      border-radius: 16px;
      width: 100%;
      max-width: 520px;
      overflow: hidden;
      animation: modalSlideIn 0.2s ease-out;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }

    @keyframes modalSlideIn {
      from { opacity: 0; transform: translateY(-10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .modal-header-custom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid rgba(var(--bs-secondary-rgb), 0.1);
    }

    .modal-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--po-accent), var(--po-accent));
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 1.2rem;
    }

    .btn-close-custom {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--bs-secondary-color);
      font-size: 1.1rem;
      padding: 0.3rem;
      border-radius: 6px;
      transition: all 0.15s;
    }

    .btn-close-custom:hover {
      background: rgba(var(--bs-secondary-rgb), 0.1);
      color: var(--bs-body-color);
    }

    .modal-body-custom {
      padding: 1.5rem;
    }

    .modal-footer-custom {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid rgba(var(--bs-secondary-rgb), 0.1);
    }

    .provider-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.5rem;
    }

    .provider-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.4rem;
      padding: 0.75rem 0.5rem;
      border: 2px solid rgba(var(--bs-secondary-rgb), 0.12);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.82rem;
      font-weight: 600;
    }

    .provider-card:hover {
      border-color: oklch(from var(--po-accent) l c h / 30%);
      background: oklch(from var(--po-accent) l c h / 3%);
    }

    .provider-card.selected {
      border-color: var(--po-accent);
      background: oklch(from var(--po-accent) l c h / 6%);
      color: var(--po-accent);
    }

    .provider-card i {
      font-size: 1.3rem;
    }
  `,
})
export class GenerateAiModalComponent {
  @Input() sessionProvider: ProviderType | null = null;
  @Output() generated = new EventEmitter<string>();

  isOpen = signal(false);
  isLoading = signal(false);
  showError = signal(false);
  errorMessage = signal('');
  selectedProvider = signal<string>('claude-code-cli');

  title = '';
  description = '';

  providers = [
    { value: 'claude-code-cli', label: 'Claude', icon: 'ti-brand-prisma' },
    { value: 'codex', label: 'Codex', icon: 'ti-brand-openai' },
    { value: 'gemini-cli', label: 'Gemini', icon: 'ti-diamond' },
    { value: 'antigravity', label: 'Antigravity', icon: 'ti-rocket' },
  ];

  constructor(private translate: TranslateService) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) this.close();
  }

  open(currentTitle?: string, currentBody?: string): void {
    this.title = currentTitle || '';
    this.description = currentBody || '';
    this.errorMessage.set('');
    this.showError.set(false);

    if (this.sessionProvider) {
      this.selectedProvider.set(this.sessionProvider);
    }

    this.isOpen.set(true);
  }

  close(): void {
    if (this.isLoading()) return;
    this.isOpen.set(false);
  }

  async generate(): Promise<void> {
    if (!this.description.trim()) {
      this.showError.set(true);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const api = (window as any).promptops;
      if (!api?.aiGenerateText) {
        throw new Error('AI generation requires the desktop app');
      }

      const prompt = `You are a prompt engineering expert. Your task is to generate high-quality, structured prompts optimized for developer usage in terminal sessions with AI coding assistants.

Rules:
- Be direct and actionable
- Include context instructions when needed
- Avoid generic wording
- The prompt must be usable immediately
- Use this structure:
  "You are working on...
   Your task is to...
   Constraints:
   ...
   Output:
   ..."
- Output ONLY the generated prompt text, no explanations or markdown wrappers

Generate a high-quality prompt for the following goal:
${this.title.trim() ? `Title: ${this.title.trim()}\n` : ''}Description: ${this.description.trim()}`;

      const result = await api.aiGenerateText(prompt, this.selectedProvider());
      if (!result.ok) {
        throw new Error(result.error || 'Generation failed');
      }

      this.generated.emit(result.text);
      this.isOpen.set(false);
    } catch (err: any) {
      this.errorMessage.set(
        err?.message || this.translate.instant('AI_GENERATE.Error')
      );
    } finally {
      this.isLoading.set(false);
    }
  }
}
