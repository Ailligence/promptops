import {
  Component,
  inject,
  effect,
  signal,
  HostListener,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { TutorialService } from './tutorial.service';
import { TutorialStep } from './tutorial.model';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPosition {
  top: string;
  left: string;
  transformOrigin: string;
}

@Component({
  selector: 'app-tutorial-overlay',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tutorial.active()) {
      <div class="tutorial-backdrop" (click)="onBackdropClick($event)">
        <!-- SVG overlay with cutout -->
        <svg class="tutorial-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <mask id="tutorial-mask">
              <rect width="100%" height="100%" fill="white" />
              @if (spotlight()) {
                <rect
                  [attr.x]="spotlight()!.left - 8"
                  [attr.y]="spotlight()!.top - 8"
                  [attr.width]="spotlight()!.width + 16"
                  [attr.height]="spotlight()!.height + 16"
                  rx="8"
                  fill="black"
                />
              }
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.65)"
            mask="url(#tutorial-mask)"
          />
        </svg>

        <!-- Spotlight highlight border -->
        @if (spotlight()) {
          <div
            class="tutorial-spotlight"
            [style.top.px]="spotlight()!.top - 8"
            [style.left.px]="spotlight()!.left - 8"
            [style.width.px]="spotlight()!.width + 16"
            [style.height.px]="spotlight()!.height + 16"
          ></div>
        }

        <!-- Tooltip -->
        @if (tutorial.currentStepData() && tooltipPos()) {
          <div
            class="tutorial-tooltip"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="tutorial.currentStepData()!.titleKey | translate"
            [style.top]="tooltipPos()!.top"
            [style.left]="tooltipPos()!.left"
            [style.transformOrigin]="tooltipPos()!.transformOrigin"
            (click)="$event.stopPropagation()"
          >
            <div class="tutorial-tooltip-header">
              <span class="tutorial-step-badge">
                {{ tutorial.currentStep() + 1 }} / {{ tutorial.totalSteps() }}
              </span>
              <button class="tutorial-close-btn" (click)="tutorial.close()" [title]="'TUTORIAL.close' | translate" [attr.aria-label]="'TUTORIAL.close' | translate">
                <i class="ti ti-x"></i>
              </button>
            </div>

            <h4 class="tutorial-tooltip-title">
              {{ tutorial.currentStepData()!.titleKey | translate }}
            </h4>
            <p class="tutorial-tooltip-desc">
              {{ tutorial.currentStepData()!.descriptionKey | translate }}
            </p>

            <!-- Step dots -->
            <div class="tutorial-dots">
              @for (step of dotArray(); track $index) {
                <button
                  class="tutorial-dot"
                  [class.active]="$index === tutorial.currentStep()"
                  [attr.aria-current]="$index === tutorial.currentStep() ? 'step' : null"
                  [attr.aria-label]="'TUTORIAL.Go to step' | translate: { n: $index + 1 }"
                  (click)="tutorial.goTo($index)"
                ></button>
              }
            </div>

            <div class="tutorial-tooltip-nav">
              <button
                class="tutorial-btn tutorial-btn-secondary"
                (click)="tutorial.prev()"
                [disabled]="tutorial.isFirstStep()"
              >
                {{ 'TUTORIAL.prev' | translate }}
              </button>
              @if (tutorial.currentStepData()!.action && tutorial.currentStepData()!.actionKey) {
                <button class="tutorial-btn tutorial-btn-primary" (click)="tutorial.runAction(tutorial.currentStepData()!)">
                  {{ tutorial.currentStepData()!.actionKey! | translate }}
                </button>
              } @else if (tutorial.isLastStep()) {
                <button class="tutorial-btn tutorial-btn-primary" (click)="tutorial.complete()">
                  {{ 'TUTORIAL.finish' | translate }}
                </button>
              } @else {
                <button class="tutorial-btn tutorial-btn-primary" (click)="tutorial.next()">
                  {{ 'TUTORIAL.next' | translate }}
                </button>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: contents; }

    .tutorial-backdrop {
      position: fixed;
      inset: 0;
      z-index: 99990;
      cursor: default;
    }

    .tutorial-svg {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .tutorial-spotlight {
      position: fixed;
      border-radius: 8px;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.6), 0 0 20px 4px rgba(99, 102, 241, 0.25);
      pointer-events: none;
      transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 99991;
    }

    .tutorial-tooltip {
      position: fixed;
      z-index: 99992;
      background: var(--bs-body-bg, #fff);
      border: 1px solid var(--bs-border-color, #dee2e6);
      border-radius: 12px;
      padding: 20px;
      min-width: 300px;
      max-width: 380px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
      animation: tutorialTooltipIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes tutorialTooltipIn {
      from {
        opacity: 0;
        transform: scale(0.92) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .tutorial-tooltip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .tutorial-step-badge {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--bs-secondary-color, #6c757d);
      background: var(--bs-tertiary-bg, #f8f9fa);
      padding: 2px 10px;
      border-radius: 20px;
    }

    .tutorial-close-btn {
      background: none;
      border: none;
      color: var(--bs-secondary-color, #6c757d);
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 1.1rem;
      line-height: 1;
      transition: background 0.15s, color 0.15s;
    }
    .tutorial-close-btn:hover {
      background: var(--bs-tertiary-bg, #f8f9fa);
      color: var(--bs-body-color, #212529);
    }

    .tutorial-tooltip-title {
      font-size: 1rem;
      font-weight: 600;
      margin: 0 0 6px;
      color: var(--bs-body-color, #212529);
    }

    .tutorial-tooltip-desc {
      font-size: 0.875rem;
      color: var(--bs-secondary-color, #6c757d);
      margin: 0 0 16px;
      line-height: 1.5;
    }

    .tutorial-dots {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-bottom: 16px;
    }

    .tutorial-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: none;
      padding: 0;
      cursor: pointer;
      background: var(--bs-border-color, #dee2e6);
      transition: background 0.2s, transform 0.2s;
    }
    .tutorial-dot.active {
      background: #6366f1;
      transform: scale(1.3);
    }
    .tutorial-dot:hover:not(.active) {
      background: var(--bs-secondary-color, #adb5bd);
    }

    .tutorial-tooltip-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .tutorial-btn {
      padding: 7px 18px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: background 0.15s, opacity 0.15s;
    }
    .tutorial-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .tutorial-btn-primary {
      background: #6366f1;
      color: #fff;
    }
    .tutorial-btn-primary:hover:not(:disabled) {
      background: #4f46e5;
    }

    .tutorial-btn-secondary {
      background: var(--bs-tertiary-bg, #f0f0f0);
      color: var(--bs-body-color, #333);
    }
    .tutorial-btn-secondary:hover:not(:disabled) {
      background: var(--bs-border-color, #ddd);
    }

    @media (max-width: 576px) {
      .tutorial-tooltip {
        min-width: 260px;
        max-width: calc(100vw - 32px);
        padding: 16px;
      }
    }
  `,
})
export class TutorialOverlayComponent implements OnDestroy {
  tutorial = inject(TutorialService);

  spotlight = signal<SpotlightRect | null>(null);
  tooltipPos = signal<TooltipPosition | null>(null);
  dotArray = signal<number[]>([]);

  private animFrame: number | null = null;
  private skipCount = 0;
  private readonly MAX_SKIP = 3;

  constructor() {
    effect(() => {
      const step = this.tutorial.currentStepData();
      const active = this.tutorial.active();
      const total = this.tutorial.totalSteps();
      const preparing = this.tutorial.preparing();

      this.dotArray.set(Array.from({ length: total }, (_, i) => i));

      // Don't position while service is preparing (navigating/injecting mock)
      if (preparing) return;

      if (active && step) {
        this.skipCount = 0;
        this.positionForStep(step);
      } else {
        this.spotlight.set(null);
        this.tooltipPos.set(null);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscKey(): void {
    if (this.tutorial.active()) {
      this.tutorial.close();
    }
  }

  @HostListener('document:keydown.arrowRight')
  onArrowRight(): void {
    if (this.tutorial.active()) {
      this.tutorial.next();
    }
  }

  @HostListener('document:keydown.arrowLeft')
  onArrowLeft(): void {
    if (this.tutorial.active()) {
      this.tutorial.prev();
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.tutorial.active() && this.tutorial.currentStepData()) {
      this.positionForStep(this.tutorial.currentStepData()!);
    }
  }

  onBackdropClick(e: MouseEvent): void {
    // Do nothing — user must use controls
  }

  private positionForStep(step: TutorialStep): void {
    const selectors = step.target.split(',').map(s => s.trim());
    let el: HTMLElement | null = null;

    // First match that is actually rendered: a display:none hit (e.g. the
    // topbar in the rail UI) would anchor the card to an empty 0×0 box.
    for (const sel of selectors) {
      const hit = document.querySelector<HTMLElement>(sel);
      if (!hit) continue;
      const r = hit.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { el = hit; break; }
    }

    if (!el) {
      // Element not found — skip (with guard to prevent infinite loop)
      this.skipCount++;
      if (this.skipCount < this.MAX_SKIP) {
        this.tutorial.next();
      }
      return;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = requestAnimationFrame(() => {
      if (!el) return;
      this.updatePosition(el, step.position ?? 'bottom');
    });
  }

  private updatePosition(el: HTMLElement, position: string): void {
    const rect = el.getBoundingClientRect();
    const spot: SpotlightRect = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
    this.spotlight.set(spot);

    const TOOLTIP_W = 340;
    const TOOLTIP_GAP = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = '';
    let left = '';
    let origin = 'top left';

    switch (position) {
      case 'bottom':
        top = `${rect.bottom + TOOLTIP_GAP}px`;
        left = `${Math.max(16, Math.min(rect.left, vw - TOOLTIP_W - 16))}px`;
        origin = 'top left';
        break;
      case 'top':
        top = `${rect.top - TOOLTIP_GAP}px`;
        left = `${Math.max(16, Math.min(rect.left, vw - TOOLTIP_W - 16))}px`;
        origin = 'bottom left';
        break;
      case 'right':
        top = `${Math.max(16, rect.top)}px`;
        left = `${rect.right + TOOLTIP_GAP}px`;
        origin = 'top left';
        if (rect.right + TOOLTIP_GAP + TOOLTIP_W > vw) {
          left = `${Math.max(16, rect.left - TOOLTIP_W - TOOLTIP_GAP)}px`;
          origin = 'top right';
        }
        break;
      case 'left':
        top = `${Math.max(16, rect.top)}px`;
        left = `${Math.max(16, rect.left - TOOLTIP_W - TOOLTIP_GAP)}px`;
        origin = 'top right';
        if (rect.left - TOOLTIP_W - TOOLTIP_GAP < 16) {
          left = `${rect.right + TOOLTIP_GAP}px`;
          origin = 'top left';
        }
        break;
    }

    const topPx = parseFloat(top);
    if (position === 'top') {
      const estimatedTop = topPx - 220;
      top = `${Math.max(16, estimatedTop)}px`;
    } else if (topPx + 220 > vh) {
      top = `${Math.max(16, vh - 240)}px`;
    }

    this.tooltipPos.set({ top, left, transformOrigin: origin });
  }

  ngOnDestroy(): void {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }
}
