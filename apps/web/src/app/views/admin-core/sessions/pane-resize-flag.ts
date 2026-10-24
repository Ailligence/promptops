/**
 * Global "a manual pane resize is in progress" flag (grid borders,
 * column splitters). While it is on, terminals do NOT re-fit() on every
 * frame — the canvas stays as is, clipped by the pane — and they realign once
 * the gesture is over (scheduleSettledRepaint). That is what makes the
 * drag smooth: fit() + xterm reflow for every pane at 60 fps is the bottleneck.
 */
const ATTR = 'data-po-pane-resizing';

export function setPaneResizing(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute(ATTR, on);
}

export function isPaneResizing(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(ATTR);
}
