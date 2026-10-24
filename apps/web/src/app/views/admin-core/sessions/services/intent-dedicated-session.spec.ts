import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { Actions } from '@ngrx/effects';
import { Subject, of } from 'rxjs';
import { IntentService, IntentPlan } from './intent.service';
import { SubAgentService } from './sub-agent.service';
import { createSession, createSessionSuccess } from '../../../../../store/sessions/session.actions';

describe('IntentService.executeInDedicatedSession', () => {
  const plan: IntentPlan = {
    summary: 'Ship it',
    agents: [{ name: 'A', role: 'backend', goal: 'g', description: 'd' }],
  };
  let actions$: Subject<any>;
  let dispatched: any[];
  let spawn: jasmine.Spy;

  beforeEach(() => {
    actions$ = new Subject();
    dispatched = [];
    spawn = jasmine.createSpy('spawnCustom').and.resolveTo(null);
    TestBed.configureTestingModule({
      providers: [
        IntentService,
        { provide: SubAgentService, useValue: { spawnCustom: spawn, activeSubAgents: () => [], allSubAgents: () => [] } },
        {
          provide: Store,
          useValue: {
            dispatch: (a: any) => dispatched.push(a),
            select: () => of([{ id: 'trig', name: 'Intent · Ship it', workspace: { path: '/w' } }]),
          },
        },
        { provide: Actions, useValue: actions$ },
      ],
    });
  });

  it('picks a free name and spawns only into its own new session', fakeAsync(() => {
    const svc = TestBed.inject(IntentService);
    void svc.executeInDedicatedSession('trig', plan, 'claude-code-cli' as any, false);
    flushMicrotasks();
    const create = dispatched.find((a) => a.type === createSession.type);
    expect(create.name).toBe('Intent · Ship it (2)');
    // Someone else's session is created first: it must be ignored.
    // Outcomes are matched by request id, not by name.
    expect(create.requestId).toBeTruthy();
    actions$.next(createSessionSuccess({ session: { id: 'other', name: 'Untitled' } as any }));
    actions$.next(createSessionSuccess({ session: { id: 'same-name', name: create.name } as any, requestId: 'someone-else' }));
    actions$.next(createSessionSuccess({ session: { id: 'mine', name: create.name } as any, requestId: create.requestId }));
    flushMicrotasks();
    tick(1000);
    flushMicrotasks();
    expect(spawn).toHaveBeenCalled();
    expect(spawn.calls.argsFor(0)[0]).toBe('mine');
  }));
});
