export interface TutorialStep {
  /** CSS selector(s), comma-separated. First match wins; a step whose target is missing is skipped. */
  target: string;
  titleKey: string;
  descriptionKey: string;
  position?: 'top' | 'right' | 'bottom' | 'left';
  /** Optional CTA shown in the tooltip instead of "Finish". */
  actionKey?: string;
  action?: 'sessionsTour';
}

export interface TutorialState {
  active: boolean;
  currentStep: number;
  totalSteps: number;
}
