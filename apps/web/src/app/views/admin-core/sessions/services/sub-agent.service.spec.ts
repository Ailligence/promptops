import { TestBed } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { Actions } from '@ngrx/effects';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Observable, Subject, of } from 'rxjs';
import { wakeSession, wakeSessionFailure, wakeSessionSuccess } from '../../../../../store/sessions/session.actions';
import {
  SubAgentService,
  SubAgent,
  ArchivedSubAgentEntry,
  archivedEntryKey,
  mergeArchivedEntries,
} from './sub-agent.service';
import { SessionHistoryService } from './session-history.service';
import { SessionEventService } from './session-event.service';
import { SmartActionService } from './smart-action.service';
import { DesktopSessionApiService } from './desktop-session-api.service';

function makeAgent(id: string, createdAt: string, title = id): SubAgent {
  return {
    id,
    role: 'custom',
    title,
    parentSessionId: 'p1',
    sessionId: `sess-${id}`,
    status: 'running',
    autoPrompt: '',
    provider: 'claude-code-cli',
    icon: 'solar:cpu-bolt-bold-duotone',
    createdAt,
  };
}

describe('SubAgentService — activeSubAgentsBySlot', () => {
  let service: SubAgentService;

  beforeEach(() => {
    delete (window as any).promptops;

    TestBed.configureTestingModule({
      providers: [
        SubAgentService,
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        { provide: NgbModal, useValue: { open: () => ({ result: Promise.reject() }) } },
        { provide: SessionHistoryService, useValue: { logSpawn: () => {}, logMerge: () => {} } },
        { provide: SessionEventService, useValue: {
            setSession: () => {},
            recordSpawn: () => {},
            recordStatus: () => {},
            recordError: () => {},
            recordMerge: () => {},
        } },
        { provide: SmartActionService, useValue: { isDesktop: false, detect: () => Promise.resolve(null) } },
        { provide: DesktopSessionApiService, useValue: {
            listSubAgentArchive: () => of([]),
            updateSubAgentsOrder: () => of(undefined),
        } },
      ],
    });
    service = TestBed.inject(SubAgentService);
  });

  it('falls back to createdAt ASC when no custom order is set', () => {
    service.activeSubAgents.set([
      makeAgent('a', '2026-01-03T00:00:00Z'),
      makeAgent('b', '2026-01-01T00:00:00Z'),
      makeAgent('c', '2026-01-02T00:00:00Z'),
    ]);
    const list = service.activeSubAgentsBySlot();
    expect(list.map(s => s.id)).toEqual(['b', 'c', 'a']);
    expect(list.map(s => s.slot)).toEqual([1, 2, 3]);
  });

  it('respects customOrder when set, then appends new agents by createdAt', () => {
    service.activeSubAgents.set([
      makeAgent('a', '2026-01-03T00:00:00Z'),
      makeAgent('b', '2026-01-01T00:00:00Z'),
      makeAgent('c', '2026-01-02T00:00:00Z'),
      makeAgent('d', '2026-01-05T00:00:00Z'),
    ]);
    (service as any).customOrder.set(['c', 'a', 'b']);
    const list = service.activeSubAgentsBySlot();
    expect(list.map(s => s.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(list.map(s => s.slot)).toEqual([1, 2, 3, 4]);
  });

  it('skips IDs in customOrder that no longer exist', () => {
    service.activeSubAgents.set([
      makeAgent('a', '2026-01-01T00:00:00Z'),
      makeAgent('b', '2026-01-02T00:00:00Z'),
    ]);
    (service as any).customOrder.set(['ghost', 'b', 'a']);
    const list = service.activeSubAgentsBySlot();
    expect(list.map(s => s.id)).toEqual(['b', 'a']);
    expect(list.map(s => s.slot)).toEqual([1, 2]);
  });
});

describe('SubAgentService — reorderSubAgents', () => {
  let service: SubAgentService;
  let apiSpy: jasmine.SpyObj<DesktopSessionApiService>;

  beforeEach(() => {
    delete (window as any).promptops;
    apiSpy = jasmine.createSpyObj('DesktopSessionApiService', ['listSubAgentArchive', 'updateSubAgentsOrder']);
    apiSpy.listSubAgentArchive.and.returnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        SubAgentService,
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        { provide: NgbModal, useValue: { open: () => ({ result: Promise.reject() }) } },
        { provide: SessionHistoryService, useValue: { logSpawn: () => {}, logMerge: () => {} } },
        { provide: SessionEventService, useValue: {
            setSession: () => {}, recordSpawn: () => {}, recordStatus: () => {},
            recordError: () => {}, recordMerge: () => {},
        } },
        { provide: SmartActionService, useValue: { isDesktop: false, detect: () => Promise.resolve(null) } },
        { provide: DesktopSessionApiService, useValue: apiSpy },
      ],
    });
    service = TestBed.inject(SubAgentService);
  });

  it('updates customOrder optimistically and persists via API on success', async () => {
    apiSpy.updateSubAgentsOrder.and.returnValue(of(undefined));

    await service.reorderSubAgents('parent-1', ['c', 'a', 'b']);

    expect(apiSpy.updateSubAgentsOrder).toHaveBeenCalledWith('parent-1', ['c', 'a', 'b']);
    expect((service as any).customOrder()).toEqual(['c', 'a', 'b']);
  });

  it('keeps customOrder locally when the API call fails', async () => {
    (service as any).customOrder.set(['x', 'y']);
    apiSpy.updateSubAgentsOrder.and.returnValue(
      new Observable<undefined>((sub) => sub.error(new Error('500'))),
    );

    await service.reorderSubAgents('parent-1', ['a', 'b']);

    expect(apiSpy.updateSubAgentsOrder).toHaveBeenCalledWith('parent-1', ['a', 'b']);
    expect((service as any).customOrder()).toEqual(['a', 'b']);
  });
});

function makeArchived(overrides: Partial<ArchivedSubAgentEntry> = {}): ArchivedSubAgentEntry {
  return {
    index: 0,
    role: 'custom',
    title: 'Refactorer',
    userPrompt: '',
    icon: 'solar:cpu-bolt-bold-duotone',
    provider: 'claude-code-cli',
    archivedAt: '2026-01-01T00:00:00Z',
    parentSessionId: 'p1',
    canResume: true,
    ...overrides,
  };
}

describe('mergeArchivedEntries (hybrid archive)', () => {
  it('lets the IPC entry win on archiveId collision', () => {
    const stored = [makeArchived({ archiveId: 'id-1', title: 'Stale', parentSessionId: 'db-ulid' })];
    const ipc = [makeArchived({ archiveId: 'id-1', title: 'Fresh', parentSessionId: 'runtime-1' })];

    const merged = mergeArchivedEntries(stored, ipc);

    expect(merged.length).toBe(1);
    expect(merged[0].title).toBe('Fresh');
    expect(merged[0].parentSessionId).toBe('runtime-1');
    expect(merged[0].source).toBe('ipc');
  });

  it('dedups by claudeSessionId when archiveId is missing', () => {
    const stored = [makeArchived({ claudeSessionId: 'c1', title: 'From the store' })];
    const ipc = [makeArchived({ claudeSessionId: 'c1', title: 'From ipc' })];

    const merged = mergeArchivedEntries(stored, ipc);

    expect(merged.length).toBe(1);
    expect(merged[0].source).toBe('ipc');
  });

  it('falls back to role|title|workspace identity for legacy entries', () => {
    const stored = [makeArchived({ workspacePath: '/ws' })];
    const ipc = [makeArchived({ workspacePath: '/ws' })];
    const other = makeArchived({ workspacePath: '/other-ws' });

    const merged = mergeArchivedEntries([...stored, other], ipc);

    expect(merged.length).toBe(2);
    expect(archivedEntryKey(stored[0])).toBe(archivedEntryKey(ipc[0]));
    expect(archivedEntryKey(other)).not.toBe(archivedEntryKey(ipc[0]));
  });

  it('keeps distinct entries from both stores, sorted by archivedAt desc', () => {
    const stored = [makeArchived({ archiveId: 'old', archivedAt: '2026-01-01T00:00:00Z' })];
    const ipc = [makeArchived({ archiveId: 'new', archivedAt: '2026-01-02T00:00:00Z' })];

    const merged = mergeArchivedEntries(stored, ipc);

    expect(merged.map((e) => e.archiveId)).toEqual(['new', 'old']);
    expect(merged.map((e) => e.source)).toEqual(['ipc', 'stored']);
  });
});

describe('SubAgentService — hybrid listArchived', () => {
  let service: SubAgentService;
  let apiSpy: jasmine.SpyObj<DesktopSessionApiService>;

  beforeEach(() => {
    delete (window as any).promptops;
    apiSpy = jasmine.createSpyObj('DesktopSessionApiService', ['listSubAgentArchive', 'updateSubAgentsOrder']);

    TestBed.configureTestingModule({
      providers: [
        SubAgentService,
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        { provide: NgbModal, useValue: { open: () => ({ result: Promise.reject() }) } },
        { provide: SessionHistoryService, useValue: { logSpawn: () => {}, logMerge: () => {} } },
        { provide: SessionEventService, useValue: {
            setSession: () => {}, recordSpawn: () => {}, recordStatus: () => {},
            recordError: () => {}, recordMerge: () => {},
        } },
        { provide: SmartActionService, useValue: { isDesktop: false, detect: () => Promise.resolve(null) } },
        { provide: DesktopSessionApiService, useValue: apiSpy },
      ],
    });
    service = TestBed.inject(SubAgentService);
  });

  afterEach(() => {
    delete (window as any).promptops;
  });

  it('merges stored + IPC entries, filters non-archived stored rows', async () => {
    apiSpy.listSubAgentArchive.and.returnValue(of([
      { archive_id: 'id-1', status: 'archived', title: 'Stale title', role: 'custom', archived_at: '2026-01-01T00:00:00Z', parent_session_id: 'db-ulid', provider: 'gemini-cli', can_resume: true, claude_session_id: 'c1' },
      { status: 'running', title: 'Still active', role: 'custom', archived_at: '2026-01-03T00:00:00Z' },
      { archive_id: 'id-2', status: 'archived', title: 'Stored only', role: 'custom', archived_at: '2026-01-02T00:00:00Z', can_resume: false },
    ]));
    (window as any).promptops = {
      listArchivedSubAgents: async () => ({
        ok: true,
        archived: [makeArchived({ archiveId: 'id-1', title: 'Fresh title', parentSessionId: 'runtime-1', provider: 'gemini-cli', claudeSessionId: 'c1' })],
      }),
    };

    const entries = await service.listArchived();

    expect(entries.length).toBe(2);
    const collided = entries.find((e) => e.archiveId === 'id-1')!;
    expect(collided.source).toBe('ipc');
    expect(collided.title).toBe('Fresh title');
    expect(collided.parentSessionId).toBe('runtime-1');
    expect(entries.find((e) => e.archiveId === 'id-2')!.source).toBe('stored');
    expect(entries[0].archiveId).toBe('id-2');
  });

  it('degrades to stored-only entries without window.promptops', async () => {
    apiSpy.listSubAgentArchive.and.returnValue(of([
      { archive_id: 'id-9', status: 'archived', title: 'Remote', role: 'custom', archived_at: '2026-01-01T00:00:00Z' },
    ]));

    const entries = await service.listArchived();

    expect(entries.length).toBe(1);
    expect(entries[0].source).toBe('stored');
    expect(entries[0].provider).toBe('claude-code-cli');
  });
});

describe('SubAgentService — spawnCustom failure propagation', () => {
  let service: SubAgentService;

  beforeEach(() => {
    delete (window as any).promptops;

    TestBed.configureTestingModule({
      providers: [
        SubAgentService,
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        { provide: NgbModal, useValue: { open: () => ({ result: Promise.reject() }) } },
        { provide: SessionHistoryService, useValue: { logSpawn: () => {}, logMerge: () => {} } },
        { provide: SessionEventService, useValue: {
            setSession: () => {}, recordSpawn: () => {}, recordStatus: () => {},
            recordError: () => {}, recordMerge: () => {},
        } },
        { provide: SmartActionService, useValue: { isDesktop: false, detect: () => Promise.resolve(null) } },
        { provide: DesktopSessionApiService, useValue: {
            listSubAgentArchive: () => of([]),
            updateSubAgentsOrder: () => of(undefined),
        } },
      ],
    });
    service = TestBed.inject(SubAgentService);
  });

  afterEach(() => {
    delete (window as any).promptops;
  });

  it('spawning into a background session keeps the tracked session, its bench and locks', async () => {
    (window as any).promptops = {
      requestSpawnSubAgent: async () => ({ ok: true, subAgent: { id: 'sa-bg', role: 'custom', title: 'Title' } }),
    };
    (service as any).currentParentId.set('p1');
    service.benchedKeys.set(['k-bench']);
    service.lockedKeys.set(['k-lock']);
    await service.spawnCustom('p2', 'custom', 'Title', 'do something', 'generic-shell');
    expect((service as any).currentParentId()).toBe('p1');
    expect(service.benchedKeys()).toEqual(['k-bench']);
    expect(service.lockedKeys()).toEqual(['k-lock']);
  });

  // provider 'generic-shell' skips the pre-spawn execution guard (no modal).
  it('throws when the main process reports {ok:false, error}', async () => {
    (window as any).promptops = {
      requestSpawnSubAgent: async () => ({ ok: false, error: 'binary not found' }),
    };

    await expectAsync(
      service.spawnCustom('p1', 'custom', 'Title', 'do something', 'generic-shell'),
    ).toBeRejectedWithError(/binary not found/);
  });

  it('throws a generic message when {ok:false} carries no error text', async () => {
    (window as any).promptops = {
      requestSpawnSubAgent: async () => ({ ok: false }),
    };

    await expectAsync(
      service.spawnCustom('p1', 'custom', 'Title', 'do something', 'generic-shell'),
    ).toBeRejectedWithError(/Agent spawn failed/);
  });

  it('resolves null when the context-transfer modal owns the decision (pendingSpawnId)', async () => {
    (window as any).promptops = {
      requestSpawnSubAgent: async () => ({ ok: true, pendingSpawnId: 'pending-1' }),
    };

    await expectAsync(
      service.spawnCustom('p1', 'custom', 'Title', 'do something', 'generic-shell'),
    ).toBeResolvedTo(null);
  });

  it('resolves the sub-agent on success', async () => {
    const agent = makeAgent('a', '2026-01-01T00:00:00Z');
    (window as any).promptops = {
      requestSpawnSubAgent: async () => ({ ok: true, subAgent: agent }),
    };

    await expectAsync(
      service.spawnCustom('p1', 'custom', 'Title', 'do something', 'generic-shell'),
    ).toBeResolvedTo(agent);
  });

  it('resolves null outside the desktop app (no window.promptops)', async () => {
    await expectAsync(
      service.spawnCustom('p1', 'custom', 'Title', 'do something', 'generic-shell'),
    ).toBeResolvedTo(null);
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('SubAgentService — trackSession (synchronous seed + reconciliation)', () => {
  let service: SubAgentService;

  beforeEach(() => {
    delete (window as any).promptops;

    TestBed.configureTestingModule({
      providers: [
        SubAgentService,
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        { provide: NgbModal, useValue: { open: () => ({ result: Promise.reject() }) } },
        { provide: SessionHistoryService, useValue: { logSpawn: () => {}, logMerge: () => {} } },
        { provide: SessionEventService, useValue: {
            setSession: () => {}, recordSpawn: () => {}, recordStatus: () => {},
            recordError: () => {}, recordMerge: () => {},
        } },
        { provide: SmartActionService, useValue: { isDesktop: false, detect: () => Promise.resolve(null) } },
        { provide: DesktopSessionApiService, useValue: {
            listSubAgentArchive: () => of([]),
            updateSubAgentsOrder: () => of(undefined),
            show: () => of({ subAgentsOrder: null } as any),
        } },
      ],
    });
    service = TestBed.inject(SubAgentService);
  });

  afterEach(() => {
    delete (window as any).promptops;
  });

  function fakeApi(listSubAgents: (id: string) => Promise<any>): void {
    (window as any).promptops = {
      getSubAgentSuggestions: async () => ({ ok: true, suggestions: [] }),
      listSubAgents,
    };
  }

  it('seeds the roster synchronously from the cross-session cache on switch', async () => {
    const cachedP1 = makeAgent('cached-1', '2026-01-01T00:00:00Z');
    const cachedOther = { ...makeAgent('other-1', '2026-01-01T00:00:00Z'), parentSessionId: 'p2' };
    service.allSubAgents.set([cachedP1, cachedOther]);

    const listDef = deferred<any>();
    fakeApi(() => listDef.promise);

    const p = service.trackSession('p1');

    // The whole point of the seed: the roster is visible BEFORE the IPC
    // round-trip resolves, so cover-main renders in the same CD cycle.
    expect(service.activeSubAgents().map(sa => sa.id)).toEqual(['cached-1']);
    expect(service.hasActiveSubAgents()).toBeTrue();

    listDef.resolve({ ok: true, subAgents: [cachedP1] });
    await p;
  });

  it('replaces the seed with live desktop data once IPC resolves', async () => {
    const stale = { ...makeAgent('stale-1', '2026-01-01T00:00:00Z'), title: 'Stale' };
    service.allSubAgents.set([stale]);

    const fresh = { ...makeAgent('fresh-1', '2026-01-02T00:00:00Z'), title: 'Fresh' };
    fakeApi(async () => ({ ok: true, subAgents: [fresh] }));

    await service.trackSession('p1');

    expect(service.activeSubAgents().map(sa => sa.id)).toEqual(['fresh-1']);
    expect(service.allSubAgents().filter(sa => sa.parentSessionId === 'p1').map(sa => sa.id))
      .toEqual(['fresh-1']);
  });

  it('surgically drops only seeded ids when the desktop reports zero live agents', async () => {
    const s1 = makeAgent('seed-1', '2026-01-01T00:00:00Z');
    const s2 = makeAgent('seed-2', '2026-01-02T00:00:00Z');
    service.allSubAgents.set([s1, s2]);

    const listDef = deferred<any>();
    fakeApi(() => listDef.promise);

    const p = service.trackSession('p1');

    // An agent spawned while the round-trip is in flight carries a fresh id
    // (pushed via the SUBAGENT_CREATED listener) and must survive the cleanup.
    const spawned = makeAgent('spawned-later', '2026-01-03T00:00:00Z');
    service.activeSubAgents.update(l => [...l, spawned]);
    service.allSubAgents.update(l => [...l, spawned]);

    listDef.resolve({ ok: true, subAgents: [] });
    await p;

    expect(service.activeSubAgents().map(sa => sa.id)).toEqual(['spawned-later']);
    expect(service.allSubAgents().map(sa => sa.id)).toEqual(['spawned-later']);
  });

  it('discards a stale response when the user switched again mid-flight', async () => {
    const agentB = { ...makeAgent('b-1', '2026-01-01T00:00:00Z'), parentSessionId: 'B' };
    const defs: Record<string, Deferred<any>> = { A: deferred(), B: deferred() };
    (window as any).promptops = {
      getSubAgentSuggestions: async (id: string) => ({ ok: true, suggestions: [{ id: 'sug-' + id }] }),
      listSubAgents: (id: string) => defs[id].promise,
    };

    const pA = service.trackSession('A');
    const pB = service.trackSession('B');

    defs['B'].resolve({ ok: true, subAgents: [agentB] });
    await pB;
    defs['A'].resolve({ ok: true, subAgents: [makeAgent('a-1', '2026-01-01T00:00:00Z')] });
    await pA;

    expect(service.activeSubAgents().map(sa => sa.id)).toEqual(['b-1']);
    expect(service.suggestions() as any[]).toEqual([{ id: 'sug-B' } as any]);
  });

  it('keeps the seed when the IPC answers ok:false', async () => {
    const cached = makeAgent('cached-1', '2026-01-01T00:00:00Z');
    service.allSubAgents.set([cached]);
    fakeApi(async () => ({ ok: false, subAgents: [] }));

    await service.trackSession('p1');

    expect(service.activeSubAgents().map(sa => sa.id)).toEqual(['cached-1']);
    expect(service.allSubAgents().map(sa => sa.id)).toEqual(['cached-1']);
  });

  it('schedules reconciliation and keeps the seed when IPC rejects', async () => {
    const cached = makeAgent('cached-1', '2026-01-01T00:00:00Z');
    service.allSubAgents.set([cached]);

    const reconcileSpy = spyOn(service as any, 'scheduleReconciliation');
    const listDef = deferred<any>();
    fakeApi(() => listDef.promise);

    const p = service.trackSession('p1');
    listDef.reject(new Error('ipc down'));
    await p;

    expect(reconcileSpy).toHaveBeenCalledWith('p1', undefined);
    expect(service.activeSubAgents().map(sa => sa.id)).toEqual(['cached-1']);
  });

  it('leaves the hadStoredData flow untouched (stored data kept + reconciliation)', async () => {
    service.populateFromStore([{ id: 'bk1', role: 'custom', title: 'Stored' }], 'p1');

    const reconcileSpy = spyOn(service as any, 'scheduleReconciliation');
    fakeApi(async () => ({ ok: true, subAgents: [] }));

    await service.trackSession('p1');

    expect(service.activeSubAgents().map(sa => sa.id)).toEqual(['bk1']);
    expect(reconcileSpy).toHaveBeenCalledWith('p1', undefined);
  });
});

describe('SubAgentService — lock (stable identity + lead + guard on destroy)', () => {
  let service: SubAgentService;
  let destroyed: string[];

  beforeEach(() => {
    localStorage.clear();
    destroyed = [];
    (window as any).promptops = {
      destroySubAgent: async (id: string) => { destroyed.push(id); return { ok: true }; },
    };

    TestBed.configureTestingModule({
      providers: [
        SubAgentService,
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        { provide: NgbModal, useValue: { open: () => ({ result: Promise.reject() }) } },
        { provide: SessionHistoryService, useValue: { logSpawn: () => {}, logMerge: () => {} } },
        { provide: SessionEventService, useValue: {
            setSession: () => {}, recordSpawn: () => {}, recordStatus: () => {},
            recordError: () => {}, recordMerge: () => {},
        } },
        { provide: SmartActionService, useValue: { isDesktop: false, detect: () => Promise.resolve(null) } },
        { provide: DesktopSessionApiService, useValue: {
            listSubAgentArchive: () => of([]),
            updateSubAgentsOrder: () => of(undefined),
            show: () => of({ subAgentsOrder: null } as any),
        } },
      ],
    });
    service = TestBed.inject(SubAgentService);
  });

  afterEach(() => {
    delete (window as any).promptops;
    localStorage.clear();
  });

  it('locks a sub-agent by identity and exposes it by runtime id', () => {
    const a = makeAgent('a1', '2026-01-01T00:00:00Z', 'Reviewer');
    service.activeSubAgents.set([a]);

    service.toggleLock('a1');

    expect(service.isLocked('a1')).toBeTrue();
    expect(service.lockedIds().has('a1')).toBeTrue();
    expect(service.lockedKeys()).toEqual(['custom|Reviewer']);

    service.toggleLock('a1');
    expect(service.isLocked('a1')).toBeFalse();
    expect(service.lockedIds().size).toBe(0);
  });

  it('keeps the lock across a respawn that mints a new id (same role|title)', () => {
    service.activeSubAgents.set([makeAgent('old-id', '2026-01-01T00:00:00Z', 'Reviewer')]);
    service.toggleLock('old-id');

    service.activeSubAgents.set([makeAgent('new-id', '2026-01-02T00:00:00Z', 'Reviewer')]);

    expect(service.lockedIds().has('new-id')).toBeTrue();
    expect(service.isLocked('new-id')).toBeTrue();
  });

  it('locks the lead pane (__main__) even though it is not a sub-agent', () => {
    service.activeSubAgents.set([makeAgent('a1', '2026-01-01T00:00:00Z')]);

    service.toggleLock(SubAgentService.MAIN_PANE_ID);

    expect(service.isLocked(SubAgentService.MAIN_PANE_ID)).toBeTrue();
    expect(service.lockedIds().has(SubAgentService.MAIN_PANE_ID)).toBeTrue();
    expect(service.lockedIds().has('a1')).toBeFalse();
    expect(service.lockedKeys()).toEqual([SubAgentService.MAIN_LOCK_KEY]);
  });

  it('ignores toggleLock for an unknown id', () => {
    service.activeSubAgents.set([makeAgent('a1', '2026-01-01T00:00:00Z')]);
    service.toggleLock('ghost');
    expect(service.lockedKeys()).toEqual([]);
  });

  it('destroy() is a no-op on a locked agent, from any caller', async () => {
    const a = makeAgent('a1', '2026-01-01T00:00:00Z', 'Reviewer');
    service.activeSubAgents.set([a]);
    service.allSubAgents.set([a]);
    service.toggleLock('a1');

    await service.destroy('a1');

    expect(destroyed).toEqual([]);
    expect(service.activeSubAgents().map(sa => sa.id)).toEqual(['a1']);
  });

  it('destroy() still removes an unlocked agent', async () => {
    const a = makeAgent('a1', '2026-01-01T00:00:00Z', 'Reviewer');
    service.activeSubAgents.set([a]);
    service.allSubAgents.set([a]);

    await service.destroy('a1');

    expect(service.activeSubAgents()).toEqual([]);
  });

  it('persists locks per tracked session and reloads them on switch', async () => {
    (window as any).promptops.getSubAgentSuggestions = async () => ({ ok: true, suggestions: [] });
    (window as any).promptops.listSubAgents = async () => ({ ok: true, subAgents: [] });

    await service.trackSession('p1');
    service.activeSubAgents.set([makeAgent('a1', '2026-01-01T00:00:00Z', 'Reviewer')]);
    service.toggleLock('a1');
    expect(service.loadLockedKeys('p1')).toEqual(['custom|Reviewer']);

    await service.trackSession('p2');
    expect(service.lockedKeys()).toEqual([]);

    // An inactive session is queried by passing its dbId (delete from sidebar).
    localStorage.setItem('promptops_locked_subagents_ULID9', JSON.stringify(['main|__main__']));
    expect(service.loadLockedKeys('p3', 'ULID9')).toEqual(['main|__main__']);
    // Legacy entries (runtime id without "|") do not count.
    localStorage.setItem('promptops_locked_subagents_p4', JSON.stringify(['runtime-id']));
    expect(service.loadLockedKeys('p4')).toEqual([]);
  });
});

describe('SubAgentService — spawn into a parked (standby) session', () => {
  let service: SubAgentService;
  let actions$: Subject<Action>;
  let dispatched: Action[];
  const parked = { id: 'p1', name: 'Parked', standbyAt: '2026-01-01T00:00:00Z' };

  beforeEach(() => {
    delete (window as any).promptops;
    actions$ = new Subject<Action>();
    dispatched = [];
    TestBed.configureTestingModule({
      providers: [
        SubAgentService,
        { provide: Actions, useValue: new Actions(actions$) },
        { provide: Store, useValue: { select: () => of([parked]), dispatch: (a: Action) => dispatched.push(a) } },
        { provide: NgbModal, useValue: { open: () => ({ result: Promise.reject() }) } },
        { provide: SessionHistoryService, useValue: { logSpawn: () => {}, logMerge: () => {} } },
        { provide: SessionEventService, useValue: {
            setSession: () => {}, recordSpawn: () => {}, recordStatus: () => {},
            recordError: () => {}, recordMerge: () => {},
        } },
        { provide: SmartActionService, useValue: { isDesktop: false, detect: () => Promise.resolve(null) } },
        { provide: DesktopSessionApiService, useValue: {
            listSubAgentArchive: () => of([]),
            updateSubAgentsOrder: () => of(undefined),
        } },
      ],
    });
    service = TestBed.inject(SubAgentService);
  });

  afterEach(() => {
    delete (window as any).promptops;
  });

  it('wakes the parked parent first and spawns once the wake succeeded', async () => {
    const agent = makeAgent('a', '2026-01-01T00:00:00Z');
    const spawn = jasmine.createSpy('requestSpawnSubAgent').and.resolveTo({ ok: true, subAgent: agent });
    (window as any).promptops = { requestSpawnSubAgent: spawn };

    const pending = service.spawnCustom('p1', 'custom', 'Title', 'echo hi', 'generic-shell');
    await new Promise((r) => setTimeout(r));
    expect(dispatched.map((a) => a.type)).toContain(wakeSession.type);
    expect(spawn).not.toHaveBeenCalled();

    actions$.next(wakeSessionSuccess({ sessionId: 'p1' }));
    await expectAsync(pending).toBeResolvedTo(agent);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('does not spawn when the wake fails, and flags the error', async () => {
    const spawn = jasmine.createSpy('requestSpawnSubAgent');
    (window as any).promptops = { requestSpawnSubAgent: spawn };

    const pending = service.spawnCustom('p1', 'custom', 'Title', 'echo hi', 'generic-shell');
    await new Promise((r) => setTimeout(r));
    actions$.next(wakeSessionFailure({ sessionId: 'p1', error: 'folder gone' }));

    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ wakeFailed: true }));
    expect(spawn).not.toHaveBeenCalled();
  });
});
