import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { isDetachedWindow, tauri } from './detached-window';
import { SessionWindowsService } from '../views/admin-core/sessions/services/session-windows.service';

/**
 * Main window: a detached window asks to open a page that isn't its own
 * (links from Teams to sessions, settings…). It opens here.
 */
@Injectable({ providedIn: 'root' })
export class DetachedBridgeService {
  private router = inject(Router);
  private sessionWindows = inject(SessionWindowsService);
  private started = false;

  async init(): Promise<void> {
    const t = tauri();
    if (!t || this.started || isDetachedWindow()) return;
    this.started = true;
    // Sessions open in their own window: state goes to the windows, requests (resume) go to the store.
    void this.sessionWindows.init();
    await t.event.listen<{ url?: unknown }>('detached:navigate', (e) => {
      const url = typeof e.payload?.url === 'string' ? e.payload.url : '';
      // App-internal paths only.
      if (url.startsWith('/') && !url.startsWith('//')) void this.router.navigateByUrl(url);
    });
  }
}
