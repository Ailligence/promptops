import { Injectable, computed, signal } from '@angular/core';
import { GuideController, SessionsGuideStep } from '../sessions/sessions-guide/sessions-guide.model';

const SEEN_KEY = 'po.plugins.guideSeen';

/**
 * First-visit guide of the Plugins page. Same spotlight overlay and look as the
 * Sessions first-run guide, but it walks the REAL page (no mock): header, tabs,
 * a card, install/switch, search, layout, then hands off to "Create plugin".
 * Shown once per device (localStorage); the page's "Tour" button replays it.
 */
export const PLUGINS_GUIDE_STEPS: SessionsGuideStep[] = [
  { target: '.hp-header h1', titleKey: 'PLUGINS_GUIDE.intro.title', descriptionKey: 'PLUGINS_GUIDE.intro.desc', position: 'bottom' },
  { target: '.hp-tabs', titleKey: 'PLUGINS_GUIDE.tabs.title', descriptionKey: 'PLUGINS_GUIDE.tabs.desc', position: 'bottom' },
  { target: '.hp-grid .hp-card', titleKey: 'PLUGINS_GUIDE.card.title', descriptionKey: 'PLUGINS_GUIDE.card.desc', position: 'right' },
  {
    target: '.hp-grid .hp-card .hp-card-actions', titleKey: 'PLUGINS_GUIDE.install.title', descriptionKey: 'PLUGINS_GUIDE.install.desc',
    position: 'bottom', hero: true, heroFlagKey: 'PLUGINS_GUIDE.heroFlag',
  },
  { target: '.hp-toolbar', titleKey: 'PLUGINS_GUIDE.search.title', descriptionKey: 'PLUGINS_GUIDE.search.desc', position: 'bottom' },
  { target: '.hp-layout', titleKey: 'PLUGINS_GUIDE.layout.title', descriptionKey: 'PLUGINS_GUIDE.layout.desc', position: 'left' },
  {
    target: '.hp-header .hp-primary', titleKey: 'PLUGINS_GUIDE.create.title', descriptionKey: 'PLUGINS_GUIDE.create.desc',
    position: 'left', actionKey: 'PLUGINS_GUIDE.create.action', action: 'createPlugin',
  },
];

@Injectable({ providedIn: 'root' })
export class PluginsGuideService implements GuideController {
  private readonly steps = signal<SessionsGuideStep[]>(PLUGINS_GUIDE_STEPS);
  private readonly _active = signal(false);
  private readonly _currentStep = signal(0);

  readonly skipKey = 'PLUGINS_GUIDE.skip';
  readonly active = this._active.asReadonly();
  readonly currentStep = this._currentStep.asReadonly();
  readonly totalSteps = computed(() => this.steps().length);
  readonly currentStepData = computed(() => this.steps()[this._currentStep()] ?? null);
  readonly isFirstStep = computed(() => this._currentStep() === 0);
  readonly isLastStep = computed(() => this._currentStep() === this.totalSteps() - 1);
  readonly dotIndexes = computed(() => Array.from({ length: this.totalSteps() }, (_, i) => i));

  /** Last step payoff: the page opens its "Create plugin" flow. */
  private readonly _createReq = signal(0);
  readonly createPluginRequest = this._createReq.asReadonly();

  seen(): boolean {
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
  }

  /** Auto-start on the first visit only. */
  maybeStart(): void {
    if (!this.seen()) this.start();
  }

  start(): void {
    if (this._active()) return;
    this._currentStep.set(0);
    this._active.set(true);
  }

  next(): void {
    if (!this._active()) return;
    if (this._currentStep() < this.totalSteps() - 1) this._currentStep.update(s => s + 1);
    else this.complete();
  }

  prev(): void {
    if (this._active() && this._currentStep() > 0) this._currentStep.update(s => s - 1);
  }

  goTo(i: number): void {
    if (this._active() && i >= 0 && i < this.totalSteps()) this._currentStep.set(i);
  }

  skip(): void { this.complete(); }

  complete(): void {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: shows again next visit */ }
    this._active.set(false);
    this._currentStep.set(0);
  }

  runAction(step: SessionsGuideStep): void {
    if (step.action === 'createPlugin') this._createReq.update(n => n + 1);
    this.complete();
  }

  /** Leaving the page mid-tour: close without marking it seen. */
  close(): void {
    this._active.set(false);
    this._currentStep.set(0);
  }
}
