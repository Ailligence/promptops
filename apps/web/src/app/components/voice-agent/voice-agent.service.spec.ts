import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { VoiceAgentService } from './voice-agent.service';
import { SessionService } from '@/app/views/admin-core/sessions/services/session.service';
import { VoiceCommandRouterService } from '@/app/core/services/voice-command-router.service';

/**
 * "Close session" asks for a confirmation. Confirming it closed the session
 * but left the mic in 'processing': the orb ignored every click (it starts
 * only from 'idle') until the app was reloaded.
 */
describe('VoiceAgentService confirmation', () => {
  let svc: VoiceAgentService;
  let destroySession: jasmine.Spy;

  beforeEach(() => {
    destroySession = jasmine.createSpy('destroySession').and.resolveTo(undefined);
    (window as any).promptops = { destroySession };
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { select: () => of(null), dispatch: () => undefined } },
        { provide: SessionService, useValue: { isDesktop: true, writeSession: () => undefined } },
        { provide: VoiceCommandRouterService, useValue: { route: () => Promise.resolve({ ok: false }) } },
      ],
    });
    svc = TestBed.inject(VoiceAgentService);
  });

  afterEach(() => {
    delete (window as any).promptops;
  });

  it('returns to idle after a confirmed session close', () => {
    svc.state.set('processing');
    svc.pendingActionType.set('session.close');
    svc.pendingActionData.set({ sessionId: 's1' });
    svc.showConfirm.set(true);

    svc.confirmDangerous();

    expect(destroySession).toHaveBeenCalledWith('s1');
    expect(svc.showConfirm()).toBeFalse();
    expect(svc.state()).toBe('idle');
  });

  it('returns to idle when the confirmation has nothing left to run', () => {
    svc.state.set('processing');
    svc.pendingActionType.set('session.close');
    svc.pendingActionData.set({ sessionId: null });

    svc.confirmDangerous();

    expect(destroySession).not.toHaveBeenCalled();
    expect(svc.state()).toBe('idle');
  });
});
