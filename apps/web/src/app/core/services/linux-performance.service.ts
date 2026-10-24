import { Injectable } from '@angular/core';

/**
 * Performance fallbacks for WebKitGTK (Linux desktop app). Active ONLY if
 * index.html has marked `html.po-webkitgtk`: on Windows/macOS/browser
 * `init()` is a no-op and nothing changes.
 *
 * WebKitGTK composites on the GPU only opacity/transform: infinite animations
 * that touch box-shadow, text-shadow, filter, background or border-color
 * (~30 keyframes: badge pulses, glow, shimmer) repaint the layer on the CPU
 * on every frame, for the whole lifetime of the element. With a few sessions open
 * they are enough to saturate the main thread and make typing and scrolling stutter.
 * Here those animations are canceled: the element goes back to its static
 * style (the badge stays visible, it just stops pulsing). Spinners and
 * transform/opacity animations — already smooth — are not touched; nor
 * width/height/left/top, which are usually indeterminate progress bars.
 *
 * Support kill-switch: localStorage `promptops.linux-perf` = `off`
 * (read by index.html: without the class everything stays as it was, CSS included).
 */
const HEAVY_PROPS = [
  'boxShadow', 'textShadow', 'filter', 'backdropFilter',
  'background', 'backgroundColor', 'backgroundPosition', 'backgroundImage',
  'borderColor', 'outlineColor',
];

@Injectable({ providedIn: 'root' })
export class LinuxPerformanceService {
  private started = false;
  /** Verdict per keyframes name: the same animations restart continuously. */
  private readonly heavyByName = new Map<string, boolean>();

  get active(): boolean {
    const c = document.documentElement.classList;
    return c.contains('po-webkitgtk') || c.contains('po-lite-gfx');
  }

  init(): void {
    if (this.started || !this.active) return;
    if (typeof document.getAnimations !== 'function') return;
    this.started = true;
    document.addEventListener('animationstart', this.onAnimationStart, true);
    // Animations already started before the Angular bootstrap.
    for (const a of document.getAnimations()) this.maybeCancel(a);
  }

  private readonly onAnimationStart = (e: AnimationEvent): void => {
    const el = e.target as Element | null;
    if (!el?.getAnimations) return;
    for (const a of el.getAnimations()) {
      if ((a as CSSAnimation).animationName === e.animationName) this.maybeCancel(a);
    }
  };

  private maybeCancel(a: Animation): void {
    const name = (a as CSSAnimation).animationName;
    if (!name) return; // transition or Web Animation created via JS: not ours
    const effect = a.effect as KeyframeEffect | null;
    if (!effect || effect.getTiming().iterations !== Infinity) return;
    let heavy = this.heavyByName.get(name);
    if (heavy === undefined) {
      heavy = effect.getKeyframes().some(k => HEAVY_PROPS.some(p => p in k));
      this.heavyByName.set(name, heavy);
    }
    // cancel() on a CSSAnimation stays valid as long as animation-name does not
    // change: no restarts, and if the class changes it is re-evaluated here.
    if (heavy) a.cancel();
  }
}
