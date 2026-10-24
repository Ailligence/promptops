import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { SessionEffects } from './session.effects';
import { createSession, createSessionFailure, createSessionSuccess, sessionNameKey } from './session.actions';
import { SessionService } from '../../app/views/admin-core/sessions/services/session.service';
import { PromptInjectionService } from '../../app/views/admin-core/sessions/services/prompt-injection.service';
import { SubAgentStashService } from '../../app/views/admin-core/sessions/services/sub-agent-stash.service';
import { TodoStoreService } from '../../app/views/admin-core/sessions/services/todo-store.service';
import { DesktopSessionApiService } from '../../app/views/admin-core/sessions/services/desktop-session-api.service';
import { SessionHistoryService } from '../../app/views/admin-core/sessions/services/session-history.service';
import { WorkspaceApiService } from '../../app/views/admin-core/sessions/services/workspace-api.service';
import { SidebarFoldersService } from '../../app/views/admin-core/sessions/services/sidebar-folders.service';
import { PtyDimsRegistry } from '../../app/views/admin-core/sessions/services/pty-dims-registry.service';
import { SwalService } from '../../app/core/services/swal.service';

/** Saving a session upserts by name: a create must never take over another session's record. */
describe('SessionEffects createSession$', () => {
  let actions$: Subject<any>;
  let sessions$: BehaviorSubject<any[]>;
  let spawn: jasmine.Spy;
  let save: jasmine.Spy;
  let out: any[];

  beforeEach(() => {
    actions$ = new Subject<any>();
    sessions$ = new BehaviorSubject<any[]>([{ id: 'a', name: 'Backend API', provider: 'claude-code-cli' }]);
    spawn = jasmine.createSpy('createSession').and.callFake(async (r: any) => ({
      ok: true, session: { id: 'new-' + r.name, name: r.name, provider: r.provider, status: 'idle', createdAt: '', pendingInteractionCount: 0 },
    }));
    save = jasmine.createSpy('create').and.callFake((d: any) => of({ id: 'db-' + d.name }));
    const stub = {} as any;
    TestBed.configureTestingModule({
      providers: [
        SessionEffects,
        { provide: Actions, useValue: new Actions(actions$) },
        { provide: Store, useValue: { select: () => sessions$, dispatch: () => {} } },
        { provide: SessionService, useValue: { createSession: spawn, isDesktop: false } },
        { provide: DesktopSessionApiService, useValue: { create: save } },
        { provide: SessionHistoryService, useValue: { setCategory: () => {}, logStart: () => {} } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        ...[PromptInjectionService, SubAgentStashService, TodoStoreService, WorkspaceApiService,
          SidebarFoldersService, PtyDimsRegistry, SwalService].map((provide) => ({ provide, useValue: stub })),
      ],
    });
    out = [];
    TestBed.inject(SessionEffects).createSession$.subscribe((a) => out.push(a));
  });

  it('refuses a name another session already uses (case/accent-insensitive), before spawning', async () => {
    actions$.next(createSession({ name: 'backend api ', provider: 'codex', requestId: 'r1' }));
    await Promise.resolve();
    expect(spawn).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(out.length).toBe(1);
    expect(out[0].type).toBe(createSessionFailure.type);
    expect(out[0].requestId).toBe('r1');
    expect(out[0].code).toBe('session_name_taken');
  });

  it('creates a free name and echoes the request id', async () => {
    actions$.next(createSession({ name: 'Frontend', provider: 'codex', requestId: 'r2' }));
    await new Promise((r) => setTimeout(r));
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(out.map((a) => a.type)).toEqual([createSessionSuccess.type]);
    expect(out[0].requestId).toBe('r2');
  });

  it('lets only one of two simultaneous creates with the same name through', async () => {
    actions$.next(createSession({ name: 'Twin', provider: 'codex', requestId: 'x' }));
    actions$.next(createSession({ name: 'twin', provider: 'codex', requestId: 'y' }));
    await new Promise((r) => setTimeout(r));
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(out.find((a) => a.requestId === 'y').type).toBe(createSessionFailure.type);
    expect(out.find((a) => a.requestId === 'x').type).toBe(createSessionSuccess.type);
  });

  it('reports a name the store refuses after the spawn, and tells the store which terminal it is', async () => {
    save.and.callFake(() => throwError(() => ({ code: 'session_name_taken', message: 'taken' })));
    actions$.next(createSession({ name: 'Racing', provider: 'codex', requestId: 'z' }));
    await new Promise((r) => setTimeout(r));
    expect(save.calls.mostRecent().args[0].local_session_id).toBe('new-Racing');
    expect(save.calls.mostRecent().args[1]).toEqual({ rethrowNameTaken: true });
    expect(out[0].type).toBe(createSessionFailure.type);
    expect(out[0].code).toBe('session_name_taken');
  });

  it('matches names like the local store does', () => {
    expect(sessionNameKey('Café ')).toBe(sessionNameKey('cafe'));
    expect(sessionNameKey('A')).not.toBe(sessionNameKey('B'));
  });
});
