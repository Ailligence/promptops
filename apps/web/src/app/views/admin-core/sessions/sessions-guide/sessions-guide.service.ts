import { Injectable, computed, inject, signal } from '@angular/core';
import { SessionsGuideMockService } from './sessions-guide-mock.service';
import { SESSIONS_GUIDE_STEPS } from './sessions-guide.steps';
import { GuideController, SessionsGuideStep } from './sessions-guide.model';

/**
 * Owns the state of the dedicated Sessions First-Run Guide.
 *
 * Intentionally independent from the global topbar tutorial. It drives a
 * dedicated, choreographed mock session (see SessionsGuideMockService) so the
 * walkthrough can demonstrate how things actually work — new workspace, main
 * session, typing into the spawn composer, and a squad of sub-agents — even
 * before the user has created anything.
 */
@Injectable({ providedIn: 'root' })
export class SessionsGuideService implements GuideController {
  private readonly mock = inject(SessionsGuideMockService);

  private readonly steps = signal<SessionsGuideStep[]>(SESSIONS_GUIDE_STEPS);
  private readonly _active = signal(false);
  private readonly _currentStep = signal(0);
  /** Set when a guest upgrades to a full account: the freshly-converted user
   *  has already been using the app, so the first-run guide must not pop up
   *  for the rest of this app session (it resets on reload). */
  private readonly _suppressed = signal(false);

  readonly active = this._active.asReadonly();
  readonly suppressed = this._suppressed.asReadonly();
  readonly currentStep = this._currentStep.asReadonly();
  readonly totalSteps = computed(() => this.steps().length);
  readonly currentStepData = computed(() => this.steps()[this._currentStep()] ?? null);
  readonly isFirstStep = computed(() => this._currentStep() === 0);
  readonly isLastStep = computed(() => this._currentStep() === this.totalSteps() - 1);
  readonly dotIndexes = computed(() => Array.from({ length: this.totalSteps() }, (_, i) => i));

  /** Act 3 payoff: request the host to open the "create session" modal. */
  private readonly _createReq = signal(0);
  readonly createSessionRequest = this._createReq.asReadonly();

  /** Begin the guide. Shown every time the user lands on the empty state.
   *  Bails if suppressed, so a pending auto-start timer can't revive it after
   *  a guest upgrade. */
  start(): void {
    if (this._active() || this._suppressed()) return;
    this._currentStep.set(0);
    this._active.set(true);
    // Inject the dedicated, choreographed mock session.
    this.mock.inject();
    this.mock.applyStep(0);
  }

  next(): void {
    if (!this._active()) return;
    if (this._currentStep() < this.totalSteps() - 1) {
      this._currentStep.update(s => s + 1);
      this.mock.applyStep(this._currentStep());
    } else {
      this.complete();
    }
  }

  prev(): void {
    if (!this._active() || this._currentStep() <= 0) return;
    this._currentStep.update(s => s - 1);
    this.mock.applyStep(this._currentStep());
  }

  goTo(i: number): void {
    if (!this._active() || i < 0 || i >= this.totalSteps()) return;
    this._currentStep.set(i);
    this.mock.applyStep(i);
  }

  /** Explicit user dismissal — still marks the guide as seen. */
  skip(): void {
    this.complete();
  }

  complete(): void {
    this.mock.cleanup();
    this._active.set(false);
    this._currentStep.set(0);
  }

  /** Act 3 payoff: close the guide (cleaning up the mock) and ask the host to
   *  open the real "create session" flow so the user starts for real. */
  requestCreateSession(): void {
    this._createReq.update(n => n + 1);
    this.complete();
  }

  runAction(step: SessionsGuideStep): void {
    if (step.action === 'createSession') this.requestCreateSession();
  }

  /** Close + tear down without leaving any state behind. */
  reset(): void {
    this.mock.cleanup();
    this._active.set(false);
    this._currentStep.set(0);
  }

  /** Permanently disable the auto first-run guide for this app session and
   *  dismiss it if it is currently showing. Called when a guest converts to a
   *  full account. */
  suppress(): void {
    this._suppressed.set(true);
    if (this._active()) {
      this.complete();
    }
  }
}
