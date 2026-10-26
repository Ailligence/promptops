import { Component, OnDestroy, input, signal, ChangeDetectionStrategy } from '@angular/core';

/**
 * Terminal boot overlay: spinner + "promptops", the same one used by sessions
 * (sub-agent spawn and resume after standby). To be placed inside a
 * `position: relative` container: it covers the terminal until the CLI is ready.
 */
@Component({
  selector: 'app-terminal-boot-loader',
  standalone: true,
  template: `
    <div class="spawn-overlay" [class.soft]="soft()" role="status" aria-live="polite">
      <div class="spawn-box">
        <span class="spawn-spinner" aria-hidden="true">{{ frames[frame()] }}</span>
        <pre class="spawn-brand">promptops</pre>
        @if (label()) { <span class="spawn-label">{{ label() }}</span> }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { position: absolute; inset: 0; z-index: 50; }
    .spawn-overlay {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(120% 90% at 50% 45%, oklch(from var(--po-accent) l c h / 10%) 0%, transparent 60%), rgba(6, 7, 12, 0.94);
      backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); cursor: wait;
    }
    .spawn-overlay.soft { background: rgba(6, 7, 12, 0.55); }
    .spawn-box { display: flex; flex-direction: column; align-items: center; gap: 6px; user-select: none; }
    .spawn-spinner {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace; font-size: 26px; line-height: 1;
      color: #c084fc; text-shadow: 0 0 12px rgba(168, 85, 247, 0.55);
    }
    .spawn-brand {
      margin: 0; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace; font-size: 13px;
      letter-spacing: 4px; text-transform: lowercase; color: rgba(210, 168, 255, 0.85);
    }
    .spawn-label { font-size: 11px; color: rgba(210, 168, 255, 0.6); }
  `],
})
export class TerminalBootLoaderComponent implements OnDestroy {
  readonly soft = input(false);
  readonly label = input('');
  readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  readonly frame = signal(0);
  private timer = setInterval(() => this.frame.update((f) => (f + 1) % this.frames.length), 90);

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
