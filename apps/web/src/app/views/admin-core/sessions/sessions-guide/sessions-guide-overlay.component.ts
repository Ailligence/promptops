import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { SessionsGuideService } from './sessions-guide.service';
import { GuideController, SessionsGuideStep } from './sessions-guide.model';

interface SpotlightRect { top: number; left: number; width: number; height: number; }
interface TooltipPosition { top: string; left: string; transformOrigin: string; }

/**
 * Spotlight overlay for the dedicated Sessions First-Run Guide.
 *
 * Mirrors the look of the global tutorial overlay but is a separate, self-contained
 * component so the two never interfere. Key difference: when a target isn't in the
 * DOM yet (e.g. the terminal right after the workspace is created) it RETRIES rather
 * than skipping forward — the progressive flow must never jump an act by accident.
 */
@Component({
  selector: 'app-sessions-guide-overlay',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (guide.active()) {
      <div class="sg-backdrop">
        <svg class="sg-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <mask id="sg-mask">
              <rect width="100%" height="100%" fill="white" />
              @if (spotlight()) {
                <rect
                  [attr.x]="spotlight()!.left - 8"
                  [attr.y]="spotlight()!.top - 8"
                  [attr.width]="spotlight()!.width + 16"
                  [attr.height]="spotlight()!.height + 16"
                  rx="10" fill="black" />
              }
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(8,6,20,0.72)" mask="url(#sg-mask)" />
        </svg>

        @if (spotlight()) {
          <div class="sg-spotlight"
               [class.hero]="guide.currentStepData()?.hero"
               [style.top.px]="spotlight()!.top - 8"
               [style.left.px]="spotlight()!.left - 8"
               [style.width.px]="spotlight()!.width + 16"
               [style.height.px]="spotlight()!.height + 16"></div>
        }

        @if (guide.currentStepData(); as step) {
          @if (tooltipPos()) {
            <div class="sg-tooltip" [class.hero]="step.hero"
                 [style.top]="tooltipPos()!.top"
                 [style.left]="tooltipPos()!.left"
                 [style.transformOrigin]="tooltipPos()!.transformOrigin">
              <div class="sg-header">
                <span class="sg-badge">{{ guide.currentStep() + 1 }} / {{ guide.totalSteps() }}</span>
                <button type="button" class="sg-close" (click)="guide.skip()" [title]="'TUTORIAL.close' | translate" [attr.aria-label]="'TUTORIAL.close' | translate">
                  <i class="ti ti-x"></i>
                </button>
              </div>

              @if (step.hero) {
                <div class="sg-hero-flag">{{ (step.heroFlagKey || 'SESSIONS_GUIDE.heroFlag') | translate }}</div>
              }

              <h4 class="sg-title">{{ step.titleKey | translate }}</h4>
              <p class="sg-desc">{{ step.descriptionKey | translate }}</p>

              <div class="sg-dots">
                @for (i of guide.dotIndexes(); track i) {
                  <button type="button" class="sg-dot" [class.active]="i === guide.currentStep()"
                          [attr.aria-label]="'TUTORIAL.Go to step' | translate: { n: i + 1 }"
                          [attr.aria-current]="i === guide.currentStep() ? 'step' : null"
                          (click)="guide.goTo(i)"></button>
                }
              </div>

              @if (step.action && step.actionKey) {
                <button class="sg-cta" (click)="runAction(step)">
                  {{ step.actionKey | translate }}
                </button>
              }

              <div class="sg-nav">
                <button class="sg-btn sg-btn-ghost" (click)="guide.skip()">
                  {{ (guide.skipKey || 'SESSIONS_GUIDE.skip') | translate }}
                </button>
                <div class="sg-nav-right">
                  <button class="sg-btn sg-btn-secondary" (click)="guide.prev()"
                          [disabled]="guide.isFirstStep()">
                    {{ 'TUTORIAL.prev' | translate }}
                  </button>
                  @if (!guide.isLastStep()) {
                    <button class="sg-btn sg-btn-primary" (click)="guide.next()">
                      {{ 'TUTORIAL.next' | translate }}
                    </button>
                  } @else if (!step.action) {
                    <button class="sg-btn sg-btn-primary" (click)="guide.complete()">
                      {{ 'TUTORIAL.finish' | translate }}
                    </button>
                  }
                </div>
              </div>
            </div>
          }
        }
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .sg-backdrop { position: fixed; inset: 0; z-index: 99980; cursor: default; }
    .sg-svg { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }

    .sg-spotlight {
      position: fixed; border-radius: 10px; pointer-events: none; z-index: 99981;
      box-shadow: 0 0 0 3px oklch(from var(--po-accent) l c h / 65%), 0 0 26px 6px oklch(from var(--po-accent) l c h / 28%);
      transition: all 0.4s cubic-bezier(0.4,0,0.2,1);
    }
    .sg-spotlight.hero {
      box-shadow: 0 0 0 3px oklch(from var(--po-accent) l c h / 85%), 0 0 34px 8px oklch(from var(--po-accent) l c h / 40%);
      animation: sgPulse 1.8s ease-in-out infinite;
    }
    @keyframes sgPulse {
      0%,100% { box-shadow: 0 0 0 3px rgba(168,85,247,0.85), 0 0 30px 6px rgba(168,85,247,0.32); }
      50% { box-shadow: 0 0 0 4px rgba(168,85,247,1), 0 0 44px 12px rgba(168,85,247,0.5); }
    }

    .sg-tooltip {
      position: fixed; z-index: 99982;
      background: var(--bs-body-bg, #fff);
      border: 1px solid var(--bs-border-color, #dee2e6);
      border-radius: 14px; padding: 20px; min-width: 300px; max-width: 380px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.28);
      animation: sgIn 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .sg-tooltip.hero { border-color: rgba(168,85,247,0.55); }
    @keyframes sgIn { from { opacity: 0; transform: scale(0.92) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }

    .sg-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .sg-badge {
      font-size: 0.75rem; font-weight: 600; color: var(--bs-secondary-color, #6c757d);
      background: var(--bs-tertiary-bg, #f8f9fa); padding: 2px 10px; border-radius: 20px;
    }
    .sg-close {
      background: none; border: none; color: var(--bs-secondary-color, #6c757d);
      cursor: pointer; padding: 2px 6px; border-radius: 6px; font-size: 1.1rem; line-height: 1;
      transition: background 0.15s, color 0.15s;
    }
    .sg-close:hover { background: var(--bs-tertiary-bg, #f8f9fa); color: var(--bs-body-color, #212529); }

    .sg-hero-flag {
      display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: #a855f7;
      background: rgba(168,85,247,0.12); padding: 3px 9px; border-radius: 6px; margin-bottom: 8px;
    }
    .sg-title { font-size: 1.05rem; font-weight: 700; margin: 0 0 6px; color: var(--bs-body-color, #212529); }
    .sg-desc { font-size: 0.875rem; color: var(--bs-secondary-color, #6c757d); margin: 0 0 16px; line-height: 1.5; }

    .sg-dots { display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 14px; }
    .sg-dot {
      width: 8px; height: 8px; border-radius: 50%; border: none; padding: 0; cursor: pointer;
      background: var(--bs-border-color, #dee2e6); transition: background 0.2s, transform 0.2s;
    }
    .sg-dot.active { background: #6366f1; transform: scale(1.3); }

    .sg-cta {
      width: 100%; border: none; cursor: pointer; margin-bottom: 14px;
      padding: 11px 16px; border-radius: 10px; font-size: 0.9rem; font-weight: 700; color: #fff;
      background: linear-gradient(135deg, var(--po-accent) 0%, #a855f7 100%);
      box-shadow: 0 6px 18px rgba(124,58,237,0.4);
      transition: transform 0.12s, box-shadow 0.15s;
    }
    .sg-cta:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(124,58,237,0.5); }

    .sg-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sg-nav-right { display: flex; align-items: center; gap: 8px; }
    .sg-btn {
      padding: 7px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
      cursor: pointer; border: none; transition: background 0.15s, opacity 0.15s;
    }
    .sg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .sg-btn-primary { background: #6366f1; color: #fff; }
    .sg-btn-primary:hover:not(:disabled) { background: #4f46e5; }
    .sg-btn-secondary { background: var(--bs-tertiary-bg, #f0f0f0); color: var(--bs-body-color, #333); }
    .sg-btn-secondary:hover:not(:disabled) { background: var(--bs-border-color, #ddd); }
    .sg-btn-ghost { background: none; color: var(--bs-secondary-color, #6c757d); padding-inline-start: 0; padding-inline-end: 8px; }
    .sg-btn-ghost:hover { color: var(--bs-body-color, #212529); }

    @media (max-width: 576px) {
      .sg-tooltip { min-width: 260px; max-width: calc(100vw - 32px); padding: 16px; }
    }
  `,
})
export class SessionsGuideOverlayComponent implements OnDestroy {
  /** Guide to render; defaults to the Sessions first-run guide. */
  readonly controller = input<GuideController | null>(null);
  private readonly sessionsGuide = inject(SessionsGuideService);
  get guide(): GuideController { return this.controller() ?? this.sessionsGuide; }

  spotlight = signal<SpotlightRect | null>(null);
  tooltipPos = signal<TooltipPosition | null>(null);

  private animFrame: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private readonly MAX_RETRY = 25; // ~5s of retries at 200ms

  constructor() {
    effect(() => {
      const step = this.guide.currentStepData();
      const active = this.guide.active();
      if (active && step) {
        this.retryCount = 0;
        this.positionForStep(step);
      } else {
        this.clearRetry();
        this.spotlight.set(null);
        this.tooltipPos.set(null);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.guide.active()) this.guide.skip(); }

  @HostListener('document:keydown.arrowRight')
  onRight(): void { if (this.guide.active()) this.guide.next(); }

  @HostListener('document:keydown.arrowLeft')
  onLeft(): void { if (this.guide.active()) this.guide.prev(); }

  @HostListener('window:resize')
  onResize(): void {
    const step = this.guide.currentStepData();
    if (this.guide.active() && step) this.positionForStep(step);
  }

  runAction(step: SessionsGuideStep): void {
    this.guide.runAction(step);
  }

  private clearRetry(): void {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  private positionForStep(step: SessionsGuideStep): void {
    this.clearRetry();
    const el = this.resolveTarget(step.target);

    if (!el) {
      // Target not in the DOM yet (e.g. terminal mid-render) — retry, never skip ahead.
      if (this.retryCount < this.MAX_RETRY && this.guide.active()) {
        this.retryCount++;
        this.retryTimer = setTimeout(() => {
          if (this.guide.currentStepData() === step) this.positionForStep(step);
        }, 200);
      } else {
        // Give up locating the target — show a centered tooltip so Next/Skip stay reachable.
        this.spotlight.set(null);
        this.centerTooltip();
      }
      return;
    }

    this.retryCount = 0;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = requestAnimationFrame(() => this.updatePosition(el, step.position ?? 'bottom'));
  }

  private centerTooltip(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.tooltipPos.set({
      top: `${Math.max(16, vh / 2 - 160)}px`,
      left: `${Math.max(16, vw / 2 - 170)}px`,
      transformOrigin: 'center',
    });
  }

  private resolveTarget(target: string): HTMLElement | null {
    for (const sel of target.split(',').map(s => s.trim())) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) return el;
    }
    return null;
  }

  private updatePosition(el: HTMLElement, position: string): void {
    const rect = el.getBoundingClientRect();
    this.spotlight.set({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });

    const TOOLTIP_W = 340;
    const GAP = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Card height as rendered (the previous step's copy is a close enough proxy).
    const tipH = document.querySelector<HTMLElement>('.sg-tooltip')?.offsetHeight || 260;

    let top = '';
    let left = '';
    let origin = 'top left';

    switch (position) {
      case 'bottom':
        top = `${rect.bottom + GAP}px`;
        left = `${Math.max(16, Math.min(rect.left, vw - TOOLTIP_W - 16))}px`;
        origin = 'top left';
        break;
      case 'top':
        top = `${rect.top - GAP}px`;
        left = `${Math.max(16, Math.min(rect.left, vw - TOOLTIP_W - 16))}px`;
        origin = 'bottom left';
        break;
      case 'right':
        top = `${Math.max(16, rect.top)}px`;
        left = `${rect.right + GAP}px`;
        origin = 'top left';
        if (rect.right + GAP + TOOLTIP_W > vw) {
          left = `${Math.max(16, rect.left - TOOLTIP_W - GAP)}px`;
          origin = 'top right';
          // Wide target on a narrow window: neither side fits, so the card
          // would sit on top of what it explains — stack it vertically instead.
          if (rect.left - TOOLTIP_W - GAP < 16) position = this.stackVertically(rect, vh, tipH);
        }
        break;
      case 'left':
        top = `${Math.max(16, rect.top)}px`;
        left = `${Math.max(16, rect.left - TOOLTIP_W - GAP)}px`;
        origin = 'top right';
        if (rect.left - TOOLTIP_W - GAP < 16) {
          left = `${rect.right + GAP}px`;
          origin = 'top left';
          if (rect.right + GAP + TOOLTIP_W > vw) position = this.stackVertically(rect, vh, tipH);
        }
        break;
    }

    if (position === 'below' || position === 'above') {
      left = `${Math.max(16, Math.min(rect.left, vw - TOOLTIP_W - 16))}px`;
      top = position === 'below' ? `${rect.bottom + GAP}px` : `${Math.max(16, rect.top - GAP - tipH)}px`;
      origin = position === 'below' ? 'top left' : 'bottom left';
    }

    const topPx = parseFloat(top);
    if (position === 'top') {
      top = `${Math.max(16, topPx - tipH)}px`;
    } else if (position !== 'above' && topPx + tipH + 16 > vh) {
      // No room under the target: flip above it when that fits, rather than
      // clamping the card up onto the element it points at.
      const above = rect.top - GAP - tipH;
      if ((position === 'bottom' || position === 'below') && above >= 16) {
        top = `${above}px`;
        origin = 'bottom left';
      } else {
        top = `${Math.max(16, vh - tipH - 16)}px`;
      }
    }

    this.tooltipPos.set({ top, left, transformOrigin: origin });
  }

  /** Side placement impossible: below the target when the card fits, else above. */
  private stackVertically(rect: DOMRect, vh: number, tipH: number): 'below' | 'above' {
    return rect.bottom + 16 + tipH <= vh || rect.top < tipH + 32 ? 'below' : 'above';
  }

  ngOnDestroy(): void {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.clearRetry();
  }
}
