import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject } from 'rxjs';
import { getSessions } from '@/store/sessions/session.selectors';
import { DataBackend } from '@core/data/data-backend';
import { ActionSlotService } from './action-slot.service';

const scope = (id: string) => id.startsWith('w1-')
  ? { type: 'workspace', id: 'w1' } : { type: 'session', id };
const slot = (id: number, sessionId: string) => ({ id, session_id: sessionId, prompt_id: id, label: `Action ${id}`, sort_order: 0 });

describe('ActionSlotService context isolation', () => {
  let active: BehaviorSubject<any>;
  let sessions: BehaviorSubject<any[]>;
  let data: { call: jasmine.Spy };
  let service: ActionSlotService;

  beforeEach(() => {
    localStorage.removeItem('po-quick-action-scope');
    active = new BehaviorSubject<any>(null);
    sessions = new BehaviorSubject<any[]>([]);
    data = jasmine.createSpyObj('data', ['call']);
    data.call.and.callFake((method: string, params: any) => Promise.resolve(
      method === 'actionSlots.list' ? { scope: scope(params.session_id), slots: [] } : {}));
    TestBed.configureTestingModule({ providers: [
      ActionSlotService, { provide: Store, useValue: { select: (selector: unknown) => selector === getSessions ? sessions : active } },
      { provide: DataBackend, useValue: data },
    ] });
    service = TestBed.inject(ActionSlotService);
    TestBed.flushEffects();
  });

  afterEach(() => localStorage.removeItem('po-quick-action-scope'));

  it('remembers the scope and keeps global and session lists separate', async () => {
    await select('a');
    data.call.and.resolveTo({ scope: { type: 'global', id: 'global' }, slots: [slot(99, '')] });
    service.setScopeMode('global');
    TestBed.flushEffects();
    await Promise.resolve();
    expect(service.context()?.key).toBe('global:global');
    expect(service.slots().map(item => item.id)).toEqual([99]);
    expect(localStorage.getItem('po-quick-action-scope')).toBe('global');
    service.setScopeMode('session');
    TestBed.flushEffects();
    await Promise.resolve();
    expect(service.slots()).toEqual([]);
    expect(service.loadError()).toBeTrue();
  });

  async function select(id: string): Promise<void> {
    active.next({ id, workspaceId: id.startsWith('w1-') ? 'w1' : null, workspace: { path: '/same/path' } });
    TestBed.flushEffects();
    await Promise.resolve();
  }

  it('does not load global slots without an active session', () => {
    expect(data.call).not.toHaveBeenCalled();
    expect(service.slots()).toEqual([]);
  });

  it('uses the database ID for standalone scope and all persistence requests', async () => {
    const session = { id: 'local-uuid', dbId: 'db-ulid', workspaceId: null };
    sessions.next([session]);
    active.next(session);
    TestBed.flushEffects();
    await Promise.resolve();
    expect(service.context()?.key).toBe('session:db-ulid');
    expect(data.call).toHaveBeenCalledWith('actionSlots.list', { session_id: 'db-ulid', scope: 'session' });
    expect(service.loadError()).toBeFalse();
    await service.addSlot(1, 'Task', 'ti-bolt', 'local-uuid');
    expect(data.call).toHaveBeenCalledWith('actionSlots.create', {
      prompt_id: 1, label: 'Task', icon: 'ti-bolt', session_id: 'db-ulid', scope: 'session',
    });
    await service.removeSlot(1);
    expect(data.call).toHaveBeenCalledWith('actionSlots.delete', { id: 1, session_id: 'db-ulid', scope: 'session' });
    await service.reorder([]);
    expect(data.call).toHaveBeenCalledWith('actionSlots.reorder', { order: [], session_id: 'db-ulid', scope: 'session' });
  });

  it('resolves a captured local ID after switching to another session', async () => {
    sessions.next([{ id: 'local-a', dbId: 'db-a' }, { id: 'b' }]);
    await select('b');
    await service.addSlot(1, 'Task', 'ti-bolt', 'local-a');
    expect(data.call).toHaveBeenCalledWith('actionSlots.create', {
      prompt_id: 1, label: 'Task', icon: 'ti-bolt', session_id: 'db-a', scope: 'session',
    });
  });

  it('preserves failures for callers that display the error', async () => {
    await select('a');
    const error = { code: 'not_found', message: 'Prompt not found.' };
    data.call.and.rejectWith(error);
    await expectAsync(service.addSlot(1, 'Task', 'ti-bolt', 'a', { throwOnError: true })).toBeRejectedWith(error);
    expect(await service.addSlot(1, 'Task')).toBeNull();
  });

  it('uses workspace IDs and never groups standalone sessions by their path', async () => {
    await select('standalone-a');
    expect(service.context()?.key).toBe('session:standalone-a');
    await select('standalone-b');
    expect(service.context()?.key).toBe('session:standalone-b');
    await select('w1-a');
    expect(service.context()?.key).toBe('workspace:w1');
    await select('w1-b');
    expect(service.context()?.key).toBe('workspace:w1');
  });

  it('ignores a late list response from the previous session', async () => {
    let resolveA!: (value: any) => void;
    data.call.and.callFake((_method: string, params: any) => params.session_id === 'a'
      ? new Promise(done => resolveA = done)
      : Promise.resolve({ scope: scope('b'), slots: [slot(2, 'b')] }));
    await select('a');
    await select('b');
    resolveA({ scope: scope('a'), slots: [slot(1, 'a')] });
    await Promise.resolve();
    expect(service.slots().map(item => item.id)).toEqual([2]);
  });

  it('does not select or flash a create response after switching contexts', async () => {
    let resolveCreate!: (value: any) => void;
    data.call.and.callFake((method: string, params: any) => {
      if (method === 'actionSlots.create') return new Promise(done => resolveCreate = done);
      return Promise.resolve({ scope: scope(params.session_id), slots: [] });
    });
    await select('a');
    const save = service.addSlot(1, 'Task');
    await select('b');
    resolveCreate({ scope: scope('a'), slot: slot(1, 'a') });
    await save;
    expect(data.call).toHaveBeenCalledWith('actionSlots.create', {
      prompt_id: 1, label: 'Task', icon: 'ti-bolt', session_id: 'a', scope: 'session',
    });
    expect(service.slots()).toEqual([]);
    expect(service.selectedSlotId()).toBeNull();
    expect(service.lastAddedSlotId()).toBeNull();
  });

  it('selects a new action when the user moved to a sibling in the same workspace', async () => {
    await select('w1-b');
    data.call.and.callFake((method: string) => Promise.resolve(method === 'actionSlots.create'
      ? { scope: scope('w1-a'), slot: slot(7, 'w1-a') }
      : { scope: scope('w1-b'), slots: [slot(7, 'w1-a')] }));
    await service.addSlot(7, 'Task', 'ti-bolt', 'w1-a');
    expect(service.selectedSlotId()).toBe(7);
    expect(service.lastAddedSlotId()).toBe(7);
  });

  it('remembers selection separately for each context', async () => {
    data.call.and.callFake((_method: string, params: any) => {
      const id = params.session_id;
      return Promise.resolve({ scope: scope(id), slots: id === 'a' ? [slot(1, id), slot(2, id)] : [slot(3, id)] });
    });
    await select('a'); service.selectedSlotId.set(2);
    await select('b'); expect(service.selectedSlotId()).toBe(3);
    await select('a'); expect(service.selectedSlotId()).toBe(2);
  });

  it('rejects responses without a scope rather than leaking their actions', async () => {
    data.call.and.resolveTo({ slots: [slot(99, 'other')] });
    await select('a');
    expect(service.slots()).toEqual([]);
    expect(service.loadError()).toBeTrue();
  });
});
