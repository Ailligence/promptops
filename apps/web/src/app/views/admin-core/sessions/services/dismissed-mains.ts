/** Sessions whose main pane the user closed (classic flow, agents model off). */
export const DISMISSED_MAINS_KEY = 'promptops_dismissed_mains';

/**
 * Reads the closed-main list. Never throws: a corrupt value or blocked
 * storage must not take down the Sessions view or the sidebar.
 */
export function readDismissedMains(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DISMISSED_MAINS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Saves the closed-main list (best effort). */
export function writeDismissedMains(ids: Iterable<string>): void {
  try {
    localStorage.setItem(DISMISSED_MAINS_KEY, JSON.stringify([...ids]));
  } catch { /* storage full or blocked: the UI state still applies for this run */ }
}
