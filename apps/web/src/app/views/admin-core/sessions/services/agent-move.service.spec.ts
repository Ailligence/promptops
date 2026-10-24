import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { Actions } from '@ngrx/effects';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { AgentMoveService } from './agent-move.service';
import { SubAgentService } from './sub-agent.service';
import { SwalService } from '@core/services/swal.service';
import { OrgPolicyService } from '@core/services/org-policy.service';
import { createSession, createSessionFailure, createSessionSuccess, setActiveSession } from '../../../../../store/sessions/session.actions';

describe('AgentMoveService (MCP "move me to a new session")', () => {
  let actions$: Subject<any>;
  let dispatched: any[];
  let errors: string[];
  let onMove: (e: unknown, r: any) => void;
  let locked = false;
  let allowed = true;
  const destroy = jasmine.createSpy('destroy').and.resolveTo(undefined);

  beforeEach(() => {
    actions$ = new Subject();
    dispatched = [];
    errors = [];
    locked = false;
    allowed = true;
    destroy.calls.reset();
    (window as any).promptops = { onCtlAgentMove: (h: any) => (onMove = h) };
    TestBed.configureTestingModule({
      providers: [
        AgentMoveService,
        { provide: Actions, useValue: actions$ },
        { provide: Router, useValue: { url: '/admin/sessions', navigate: async () => true } },
        { provide: SubAgentService, useValue: { isLocked: () => locked, destroy } },
        { provide: SwalService, useValue: { error: (m: string) => errors.push(m) } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        { provide: OrgPolicyService, useValue: { isProviderAllowed: () => allowed, deniedMessage: () => 'denied' } },
        {
          provide: Store,
          useValue: {
            dispatch: (a: any) => dispatched.push(a),
            select: () => of([{ id: 'p', name: 'Next', workspace: { path: '/w' } }]),
          },
        },
      ],
    });
    TestBed.inject(AgentMoveService).init();
  });

  afterEach(() => delete (window as any).promptops);

  const request = { subAgentId: 'sa1', parentSessionId: 'p', name: 'Next', provider: 'claude-code-cli', providerSessionId: 'conv-1' };

  it('never reuses the name of an existing session and opens only its own new session', fakeAsync(() => {
    onMove(null, request);
    tick(1300);
    flushMicrotasks();
    const create = dispatched.find((a) => a.type === createSession.type);
    expect(create.name).toBe('Next (2)');
    expect(create.requestId).toBeTruthy();
    actions$.next(createSessionSuccess({ session: { id: 'other', name: 'Untitled' } as any }));
    actions$.next(createSessionSuccess({ session: { id: 'same-name', name: 'Next (2)' } as any, requestId: 'someone-else' }));
    actions$.next(createSessionSuccess({ session: { id: 'moved', name: 'Next (2)' } as any, requestId: create.requestId }));
    flushMicrotasks();
    const active = dispatched.filter((a) => a.type === setActiveSession.type).map((a) => a.sessionId);
    expect(active).toEqual(['moved']);
  }));

  it('tells the user how to resume the conversation when the new session fails', fakeAsync(() => {
    onMove(null, request);
    tick(1300);
    flushMicrotasks();
    const create = dispatched.find((a) => a.type === createSession.type);
    // Another create failing meanwhile is not ours.
    actions$.next(createSessionFailure({ error: 'other', requestId: 'someone-else' }));
    flushMicrotasks();
    expect(errors.length).toBe(0);
    actions$.next(createSessionFailure({ error: 'boom', requestId: create.requestId }));
    flushMicrotasks();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('SUBAGENTS.Move failed resume');
  }));

  it('keeps a locked agent, or one whose provider is not allowed, and says so', fakeAsync(() => {
    locked = true;
    onMove(null, request);
    flushMicrotasks();
    allowed = false;
    locked = false;
    onMove(null, { ...request, subAgentId: 'sa2' });
    flushMicrotasks();
    tick(1300);
    expect(destroy).not.toHaveBeenCalled();
    expect(errors).toEqual(['SUBAGENTS.Move locked', 'denied']);
  }));
});
