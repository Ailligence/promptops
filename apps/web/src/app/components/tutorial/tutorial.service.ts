import { Injectable, inject, signal, computed } from '@angular/core';
import { TutorialStep, TutorialState } from './tutorial.model';
import { APP_TUTORIAL_STEPS } from './tutorial-steps';
import { Router } from '@angular/router';
import { SessionsGuideService } from '@/app/views/admin-core/sessions/sessions-guide/sessions-guide.service';

const STORAGE_KEY = 'tutorial_completed';

@Injectable({ providedIn: 'root' })
export class TutorialService {
  private router = inject(Router);
  private sessionsGuide = inject(SessionsGuideService);

  private steps = signal<TutorialStep[]>([]);
  private state = signal<TutorialState>({
    active: false,
    currentStep: 0,
    totalSteps: 0,
  });

  /** Kept for the overlay: no step needs async preparation any more. */
  readonly preparing = signal(false);

  readonly active = computed(() => this.state().active);
  readonly currentStep = computed(() => this.state().currentStep);
  readonly totalSteps = computed(() => this.state().totalSteps);
  readonly currentStepData = computed(() => this.steps()[this.state().currentStep] ?? null);
  readonly isFirstStep = computed(() => this.state().currentStep === 0);
  readonly isLastStep = computed(() => this.state().currentStep === this.state().totalSteps - 1);
  readonly hasCompleted = computed(() => localStorage.getItem(STORAGE_KEY) === 'true');

  start(customSteps?: TutorialStep[]): void {
    const all = customSteps ?? APP_TUTORIAL_STEPS;
    // Only what this interface style actually shows; never an empty tour.
    const visible = all.filter(s => this.isVisible(s.target));
    const stepsToUse = visible.length ? visible : all;
    this.steps.set(stepsToUse);
    this.state.set({
      active: true,
      currentStep: 0,
      totalSteps: stepsToUse.length,
    });
  }

  /** First selector of the list that matches a rendered (non-zero) element. */
  private isVisible(target: string): boolean {
    return target.split(',').some(sel => {
      const el = document.querySelector<HTMLElement>(sel.trim());
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  next(): void {
    const s = this.state();
    if (!s.active) return;
    if (s.currentStep < s.totalSteps - 1) {
      this.state.update(v => ({ ...v, currentStep: v.currentStep + 1 }));
    } else {
      this.complete();
    }
  }

  prev(): void {
    const s = this.state();
    if (!s.active || s.currentStep <= 0) return;
    this.state.update(v => ({ ...v, currentStep: v.currentStep - 1 }));
  }

  goTo(step: number): void {
    const s = this.state();
    if (!s.active || step < 0 || step >= s.totalSteps) return;
    this.state.update(v => ({ ...v, currentStep: step }));
  }

  close(): void {
    this.state.update(v => ({ ...v, active: false, currentStep: 0 }));
  }

  complete(): void {
    localStorage.setItem(STORAGE_KEY, 'true');
    this.close();
  }

  /** Last step: hand off to the Sessions guide, which demos a session on a mock. */
  async runAction(step: TutorialStep): Promise<void> {
    this.complete();
    if (step.action !== 'sessionsTour') return;
    if (!this.router.url.startsWith('/admin/sessions')) {
      await this.router.navigate(['/admin/sessions']);
    }
    setTimeout(() => this.sessionsGuide.start(), 400);
  }
}
