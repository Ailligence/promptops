import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { VoiceCommandRouterService } from './voice-command-router.service';
import { SessionService } from '@/app/views/admin-core/sessions/services/session.service';
import { SubAgentService } from '@/app/views/admin-core/sessions/services/sub-agent.service';
import { SpawnSelectionService } from '../../views/admin-core/sessions/services/spawn-selection.service';

/**
 * A dangerous command needed a confirmation only when spoken as "run …":
 * "send rm -rf …" went straight to the focused agent or terminal.
 */
describe('VoiceCommandRouterService dangerous commands', () => {
  let router: VoiceCommandRouterService;
  let writeSubAgent: jasmine.Spy;

  beforeEach(() => {
    writeSubAgent = jasmine.createSpy('writeSubAgent').and.resolveTo(undefined);
    (window as any).promptops = { writeSubAgent };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: Location, useValue: { back: () => undefined, forward: () => undefined } },
        { provide: Store, useValue: { select: () => of('session-1'), dispatch: () => undefined } },
        { provide: SessionService, useValue: { isDesktop: true, writeSession: jasmine.createSpy('writeSession') } },
        {
          provide: SubAgentService,
          useValue: {
            voiceFocusedSubAgentId: () => 'agent-1',
            setVoiceFocus: () => undefined,
            activeSubAgentsBySlot: () => [],
          },
        },
        { provide: SpawnSelectionService, useValue: {} },
      ],
    });
    router = TestBed.inject(VoiceCommandRouterService);
  });

  afterEach(() => {
    delete (window as any).promptops;
  });

  it('asks before sending a dangerous command, whatever the verb', async () => {
    for (const phrase of ['send rm -rf ~/work', 'tell it git reset --hard', 'run rm -rf ~/work']) {
      writeSubAgent.calls.reset();
      const res = await router.route(phrase, null);
      expect(res.needsConfirmation).withContext(phrase).toBeTrue();
      expect(res.pending?.type).toBe('prompt.run');
      expect(res.pending?.data.target).toEqual({ type: 'subagent', id: 'agent-1' });
      expect(writeSubAgent).not.toHaveBeenCalled();
    }
  });

  it('sends ordinary text straight to the focused agent', async () => {
    const res = await router.route('send fix the failing test', null);
    expect(res.ok).toBeTrue();
    expect(res.needsConfirmation).toBeFalsy();
    expect(writeSubAgent).toHaveBeenCalledWith('agent-1', 'fix the failing test\n');
  });
});
