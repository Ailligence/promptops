import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Shared state of the session canvas (the full-bleed session screen): the
 * ⌘K palette, the slide-over session tree and the requests the bottom dock
 * sends to the session view, which owns the real selection logic.
 */
@Injectable({ providedIn: 'root' })
export class SessionCanvasService {
  readonly paletteOpen = signal(false);
  readonly sessionsSheetOpen = signal(false);

  private readonly selectRequests$ = new Subject<string>();
  private readonly createRequests$ = new Subject<void>();
  readonly selectRequests = this.selectRequests$.asObservable();
  readonly createRequests = this.createRequests$.asObservable();

  requestSelect(sessionId: string): void {
    this.sessionsSheetOpen.set(false);
    this.selectRequests$.next(sessionId);
  }

  requestCreate(): void {
    this.sessionsSheetOpen.set(false);
    this.createRequests$.next();
  }

  togglePalette(open = !this.paletteOpen()): void {
    this.paletteOpen.set(open);
    if (open) this.sessionsSheetOpen.set(false);
  }

  toggleSessionsSheet(open = !this.sessionsSheetOpen()): void {
    this.sessionsSheetOpen.set(open);
  }
}
