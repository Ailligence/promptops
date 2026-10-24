import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { ClaudeHookService, HookEvent, loadToastPrefs } from './claude-hook.service';
import { SessionService } from './session.service';
import { UiStyleService } from '../../../../core/services/ui-style.service';

const TOAST_PREFS_KEY = 'promptops_toast_prefs';

function makeHookEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    type: 'notification',
    sessionId: 's1',
    workspace: '/tmp/ws',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('ClaudeHookService — toast preferences', () => {
  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        ClaudeHookService,
        { provide: SessionService, useValue: {
            isDesktop: false,
            getSession: () => Promise.resolve(null),
            onNavigateSession: () => () => {},
            onHookEvent: () => () => {},
            onTailerAutoApproveDisabled: () => () => {},
        } },
        { provide: Router, useValue: { url: '/', navigate: () => Promise.resolve(true) } },
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        { provide: UiStyleService, useValue: { style: () => 'minimal' } },
      ],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  function createService(): ClaudeHookService {
    return TestBed.inject(ClaudeHookService);
  }

  function enqueue(service: ClaudeHookService, overrides: Partial<HookEvent> = {}): void {
    void (service as any).enqueueInteraction(makeHookEvent(overrides));
    tick(); // flush the getSession microtask so the timer is armed
  }

  describe('loadToastPrefs', () => {
    it('returns defaults when localStorage is empty', () => {
      expect(loadToastPrefs()).toEqual({ durationMs: 5000, pinned: false, pauseOnHover: false, compactSuggestions: true });
    });

    it('returns defaults on corrupt JSON', () => {
      localStorage.setItem(TOAST_PREFS_KEY, 'not-json{{{');
      expect(loadToastPrefs()).toEqual({ durationMs: 5000, pinned: false, pauseOnHover: false, compactSuggestions: true });
    });

    it('clamps durationMs to [3000, 30000] and coerces bad types to defaults', () => {
      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 100, pinned: true, pauseOnHover: true }));
      expect(loadToastPrefs()).toEqual({ durationMs: 3000, pinned: true, pauseOnHover: true, compactSuggestions: true });

      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 999999 }));
      expect(loadToastPrefs().durationMs).toBe(30000);

      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 'fast', pinned: 'yes', pauseOnHover: 1 }));
      expect(loadToastPrefs()).toEqual({ durationMs: 5000, pinned: false, pauseOnHover: false, compactSuggestions: true });
    });
  });

  describe('defaults', () => {
    it('exposes 5000/false/false with no stored prefs', () => {
      const service = createService();
      expect(service.toastDurationMs()).toBe(5000);
      expect(service.toastPinned()).toBeFalse();
      expect(service.toastPauseOnHover()).toBeFalse();
    });

    it('auto-dismisses a toast after exactly 5000ms', fakeAsync(() => {
      const service = createService();
      enqueue(service);
      expect(service.pendingQueue().length).toBe(1);
      tick(4999);
      expect(service.pendingQueue().length).toBe(1);
      tick(1);
      expect(service.pendingQueue().length).toBe(0);
    }));
  });

  describe('custom duration', () => {
    it('uses the stored duration for new toasts', fakeAsync(() => {
      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 12000, pinned: false, pauseOnHover: false }));
      const service = createService();
      enqueue(service);
      tick(5000);
      expect(service.pendingQueue().length).toBe(1);
      tick(6999);
      expect(service.pendingQueue().length).toBe(1);
      tick(1);
      expect(service.pendingQueue().length).toBe(0);
    }));
  });

  describe('pinned mode', () => {
    it('never auto-dismisses; manual dismiss still works and clears timers', fakeAsync(() => {
      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 5000, pinned: true, pauseOnHover: false }));
      const service = createService();
      enqueue(service);
      expect(service.pendingQueue().length).toBe(1);
      expect(service.pendingQueue()[0].durationMs).toBeUndefined();
      tick(60000);
      expect(service.pendingQueue().length).toBe(1);

      service.dismissModal(service.pendingQueue()[0].id);
      expect(service.pendingQueue().length).toBe(0);
      expect((service as any).autoDismissTimers.size).toBe(0);
    }));

    it('dismissAll clears pinned toasts', fakeAsync(() => {
      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 5000, pinned: true, pauseOnHover: false }));
      const service = createService();
      enqueue(service);
      tick(60000);
      service.dismissAll();
      expect(service.pendingQueue().length).toBe(0);
      expect((service as any).autoDismissTimers.size).toBe(0);
    }));
  });

  describe('pause on hover', () => {
    it('pauses and resumes with the remaining time only', fakeAsync(() => {
      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 5000, pinned: false, pauseOnHover: true }));
      const service = createService();
      enqueue(service);
      const id = service.pendingQueue()[0].id;

      tick(2000);
      service.pauseAutoDismiss(id);
      tick(60000);
      expect(service.pendingQueue().length).toBe(1);

      service.resumeAutoDismiss(id);
      tick(2999);
      expect(service.pendingQueue().length).toBe(1);
      tick(1);
      expect(service.pendingQueue().length).toBe(0);
    }));

    it('pause is a no-op when the preference is off', fakeAsync(() => {
      const service = createService();
      enqueue(service);
      const id = service.pendingQueue()[0].id;
      tick(2000);
      service.pauseAutoDismiss(id);
      tick(3000);
      expect(service.pendingQueue().length).toBe(0);
    }));

    it('resume is a no-op on a running timer', fakeAsync(() => {
      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 5000, pinned: false, pauseOnHover: true }));
      const service = createService();
      enqueue(service);
      const id = service.pendingQueue()[0].id;
      service.resumeAutoDismiss(id);
      tick(4999);
      expect(service.pendingQueue().length).toBe(1);
      tick(1);
      expect(service.pendingQueue().length).toBe(0);
    }));

    it('pause after expiry is a safe no-op', fakeAsync(() => {
      localStorage.setItem(TOAST_PREFS_KEY, JSON.stringify({ durationMs: 5000, pinned: false, pauseOnHover: true }));
      const service = createService();
      enqueue(service);
      const id = service.pendingQueue()[0].id;
      tick(5000);
      expect(service.pendingQueue().length).toBe(0);
      expect(() => service.pauseAutoDismiss(id)).not.toThrow();
      expect(() => service.resumeAutoDismiss(id)).not.toThrow();
    }));
  });

  describe('setters', () => {
    it('persist the full prefs blob to localStorage', () => {
      const service = createService();
      service.setToastDurationMs(12000);
      service.setToastPinned(true);
      service.setToastPauseOnHover(true);

      const stored = JSON.parse(localStorage.getItem(TOAST_PREFS_KEY)!);
      expect(stored).toEqual({ durationMs: 12000, pinned: true, pauseOnHover: true, compactSuggestions: true });
    });

    it('setToastDurationMs clamps out-of-range values', () => {
      const service = createService();
      service.setToastDurationMs(50);
      expect(service.toastDurationMs()).toBe(3000);
      service.setToastDurationMs(999999);
      expect(service.toastDurationMs()).toBe(30000);
    });
  });
});
