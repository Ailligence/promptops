import { Injectable, inject, OnDestroy } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription, distinctUntilChanged } from 'rxjs';
import { getActiveSessionId } from '@/store/sessions/session.selectors';

interface BackendFocusState {
  sessionId: string | null;
  subAgentSlot: number | null;
  subAgentId: string | null;
}

/**
 * Pushes Angular's Redux active session into the native `FocusTracker`
 * so that voice commands and other main-side consumers know where to inject.
 *
 * Reverse direction (main → Redux) is consumed by VoiceCommandRouterService
 * directly — we only listen here to expose the current backend focus to any
 * component that wants the resolved sub-agent ID.
 */
@Injectable({ providedIn: 'root' })
export class FocusSyncService implements OnDestroy {
  private store = inject(Store);
  private subs = new Subscription();
  private unsubscribeBackend: (() => void) | null = null;
  private latestBackend: BackendFocusState = { sessionId: null, subAgentSlot: null, subAgentId: null };
  private suppressOutbound = false;
  private started = false;

  /** Call once at app bootstrap. Idempotent. */
  init(): void {
    if (this.started) return;
    this.started = true;
    const api = (window as any).promptops;

    // Outbound: Redux active session → main FocusTracker
    this.subs.add(
      this.store
        .select(getActiveSessionId)
        .pipe(distinctUntilChanged())
        .subscribe((sessionId) => {
          if (this.suppressOutbound) return;
          if (!api?.setActiveFocus) return;
          // Setting only sessionId clears sub-agent slot in the tracker
          api.setActiveFocus({ sessionId: sessionId ?? null, subAgentSlot: null, subAgentId: null }).catch(() => undefined);
        }),
    );

    // Inbound: main FocusTracker → keep latest snapshot (used by router service)
    if (api?.onActiveFocusChanged) {
      this.unsubscribeBackend = api.onActiveFocusChanged((state: BackendFocusState) => {
        this.latestBackend = state;
      });
    }
  }

  getLatestBackendFocus(): BackendFocusState {
    return { ...this.latestBackend };
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.unsubscribeBackend?.();
  }
}
