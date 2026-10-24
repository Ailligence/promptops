import { Signal } from '@angular/core';

/**
 * Sessions First-Run Guide — dedicated, separate from the global topbar tutorial.
 *
 * A 3-act spotlight walkthrough that fires ONCE for brand-new users who land on
 * the sessions section without a workspace yet. It demonstrates how a session
 * works on a mock (or real) session, and is built to make SUB-AGENTS the hero.
 */

/** Optional in-tooltip CTA behavior. */
export type SessionsGuideAction = 'createSession' | 'createPlugin';

export interface SessionsGuideStep {
  /** CSS selector(s), comma-separated. First match wins; others are fallbacks. */
  target: string;
  titleKey: string;
  descriptionKey: string;
  position?: 'top' | 'right' | 'bottom' | 'left';
  /** Visual emphasis — the climax (sub-agents) step renders as a hero. */
  hero?: boolean;
  /** Optional primary CTA shown in the tooltip (e.g. atto 3 payoff). */
  actionKey?: string;
  action?: SessionsGuideAction;
  /** Label key for the hero flag; defaults to SESSIONS_GUIDE.heroFlag. */
  heroFlagKey?: string;
}

/**
 * What the spotlight overlay needs from a guide. SessionsGuideService is the
 * default; other first-visit guides (e.g. Plugins) implement the same shape
 * and pass themselves to the overlay via its `controller` input.
 */
export interface GuideController {
  active: Signal<boolean>;
  currentStep: Signal<number>;
  totalSteps: Signal<number>;
  currentStepData: Signal<SessionsGuideStep | null>;
  isFirstStep: Signal<boolean>;
  isLastStep: Signal<boolean>;
  dotIndexes: Signal<number[]>;
  next(): void;
  prev(): void;
  goTo(i: number): void;
  skip(): void;
  complete(): void;
  runAction(step: SessionsGuideStep): void;
  /** i18n key of the "skip" label. */
  skipKey?: string;
}
