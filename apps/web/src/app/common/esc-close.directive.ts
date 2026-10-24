import { Directive, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';

/**
 * Esc-to-close for hand-made overlays/modals (not NgbModal).
 *
 * Hand-rolled modals (backdrop + panel inside an @if) have no keyboard
 * handling at all: this directive keeps a static LIFO stack
 * of the open instances, so with several stacked overlays Esc closes ONLY
 * the topmost one. If an NgbModal is open it takes precedence (Ngb
 * already handles its own Esc) and the directive does nothing.
 *
 * Usage:
 *   <div class="backdrop" (click)="open = false"></div>
 *   <div class="panel" appEscClose (escClose)="open = false">…</div>
 */
@Directive({
  selector: '[appEscClose]',
  standalone: true,
})
export class EscCloseDirective implements OnInit, OnDestroy {
  @Output() escClose = new EventEmitter<void>();

  /** LIFO stack of mounted instances: the last one opened responds to Esc. */
  private static stack: EscCloseDirective[] = [];

  private static listener: ((event: KeyboardEvent) => void) | null = null;

  ngOnInit(): void {
    EscCloseDirective.stack.push(this);

    if (!EscCloseDirective.listener) {
      EscCloseDirective.listener = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // An open NgbModal takes precedence: it handles its own Esc.
        if (document.querySelector('ngb-modal-window')) return;
        const top = EscCloseDirective.stack[EscCloseDirective.stack.length - 1];
        if (top) {
          event.preventDefault();
          top.escClose.emit();
        }
      };
      document.addEventListener('keydown', EscCloseDirective.listener);
    }
  }

  ngOnDestroy(): void {
    const index = EscCloseDirective.stack.indexOf(this);
    if (index >= 0) {
      EscCloseDirective.stack.splice(index, 1);
    }
    if (!EscCloseDirective.stack.length && EscCloseDirective.listener) {
      document.removeEventListener('keydown', EscCloseDirective.listener);
      EscCloseDirective.listener = null;
    }
  }
}
