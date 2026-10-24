import { InjectionToken } from '@angular/core';

/**
 * Local kill switch for the agents model: `localStorage['promptops_agents_v2'] = 'off'`
 * goes back to the classic flow without a rebuild.
 */
export const AGENTS_MODEL_KILL_SWITCH_KEY = 'promptops_agents_v2';

/**
 * The agents model is active ONLY inside Tauri (desktop app). On the web it's always
 * false: every branch gated on this token is invisible there, which keeps
 * living with main + sub-agent.
 */
export function agentsModelEnabled(): boolean {
  try {
    return !!(window as any).__TAURI__ && localStorage.getItem(AGENTS_MODEL_KILL_SWITCH_KEY) !== 'off';
  } catch {
    return false;
  }
}

export const AGENTS_MODEL = new InjectionToken<boolean>('AGENTS_MODEL', {
  providedIn: 'root',
  factory: agentsModelEnabled,
});
