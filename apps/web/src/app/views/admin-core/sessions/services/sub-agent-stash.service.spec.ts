import { SubAgentStashService, ParkedSubAgentEntry } from './sub-agent-stash.service';

const KEY_PREFIX = 'promptops_parked_subagents_';

function entry(overrides: Partial<ParkedSubAgentEntry> = {}): ParkedSubAgentEntry {
  return {
    role: 'dev',
    title: 'Fix login',
    prompt: 'fix the login flow',
    icon: 'solar:bug-bold',
    status: 'active',
    sessionId: 'child-1',
    ...overrides,
  };
}

function writeEnvelope(key: string, subAgents: ParkedSubAgentEntry[], extra: Partial<{ frozen: boolean; sessionName: string; dbId: string | null; sessionId: string | null }> = {}): void {
  localStorage.setItem(KEY_PREFIX + key, JSON.stringify({
    v: 1,
    dbId: extra.dbId !== undefined ? extra.dbId : key,
    sessionId: extra.sessionId ?? null,
    sessionName: extra.sessionName ?? 'My session',
    savedAt: new Date().toISOString(),
    frozen: extra.frozen ?? false,
    subAgents,
  }));
}

function readEnvelope(key: string): { frozen: boolean; subAgents: ParkedSubAgentEntry[] } | null {
  const raw = localStorage.getItem(KEY_PREFIX + key);
  return raw ? JSON.parse(raw) : null;
}

describe('SubAgentStashService — removeEntry', () => {
  let service: SubAgentStashService;
  const session = { id: 'ulid-1', dbId: 'ulid-1', name: 'My session' } as any;

  beforeEach(() => {
    localStorage.clear();
    service = new SubAgentStashService();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('drops the entry matching by sessionId', () => {
    writeEnvelope('ulid-1', [entry(), entry({ role: 'qa', title: 'Write tests', sessionId: 'child-2' })]);
    service.removeEntry(session, { sessionId: 'child-1', role: 'dev', title: 'Fix login' });
    const env = readEnvelope('ulid-1');
    expect(env!.subAgents.length).toBe(1);
    expect(env!.subAgents[0].sessionId).toBe('child-2');
  });

  it('falls back to role+title when sessionId is missing on the stash entry', () => {
    writeEnvelope('ulid-1', [
      entry({ sessionId: undefined }),
      entry({ role: 'qa', title: 'Write tests', sessionId: undefined }),
    ]);
    service.removeEntry(session, { sessionId: 'child-9', role: 'dev', title: 'Fix login' });
    const env = readEnvelope('ulid-1');
    expect(env!.subAgents.length).toBe(1);
    expect(env!.subAgents[0].role).toBe('qa');
  });

  it('removes the key entirely when the last entry goes', () => {
    writeEnvelope('ulid-1', [entry()]);
    service.removeEntry(session, { sessionId: 'child-1', role: 'dev', title: 'Fix login' });
    expect(localStorage.getItem(KEY_PREFIX + 'ulid-1')).toBeNull();
  });

  it('preserves the frozen flag when rewriting the envelope', () => {
    writeEnvelope('ulid-1', [entry(), entry({ role: 'qa', title: 'Write tests', sessionId: 'child-2' })], { frozen: true });
    service.removeEntry(session, { sessionId: 'child-1', role: 'dev', title: 'Fix login' });
    const env = readEnvelope('ulid-1');
    expect(env!.frozen).toBeTrue();
    expect(env!.subAgents.length).toBe(1);
  });

  it('is a no-op when nothing matches', () => {
    writeEnvelope('ulid-1', [entry()]);
    const before = localStorage.getItem(KEY_PREFIX + 'ulid-1');
    service.removeEntry(session, { sessionId: 'nope', role: 'ghost', title: 'Not there' });
    expect(localStorage.getItem(KEY_PREFIX + 'ulid-1')).toBe(before);
  });

  it('is a no-op when the session has no envelope', () => {
    expect(() => service.removeEntry(session, { sessionId: 'x', role: 'dev', title: 'Fix login' })).not.toThrow();
  });

  it('finds a name-keyed envelope written before the dbId was known', () => {
    writeEnvelope('My session', [entry()], { dbId: null, sessionName: 'My session' });
    service.removeEntry(session, { sessionId: 'child-1', role: 'dev', title: 'Fix login' });
    expect(localStorage.getItem(KEY_PREFIX + 'My session')).toBeNull();
  });

  it('finds its own envelope via the sessionName scan when keys do not match', () => {
    writeEnvelope('other-key', [entry()], { dbId: 'other-key', sessionId: 'ulid-1', sessionName: 'My session' });
    service.removeEntry(session, { sessionId: 'child-1', role: 'dev', title: 'Fix login' });
    expect(localStorage.getItem(KEY_PREFIX + 'other-key')).toBeNull();
  });

  it('leaves alone a same-name envelope owned by another session', () => {
    writeEnvelope('other-key', [entry()], { dbId: 'other-key', sessionName: 'My session' });
    service.removeEntry(session, { sessionId: 'child-1', role: 'dev', title: 'Fix login' });
    expect(localStorage.getItem(KEY_PREFIX + 'other-key')).not.toBeNull();
  });
});

describe('SubAgentStashService — read ownership (a reused name must not inherit a stash)', () => {
  let service: SubAgentStashService;

  beforeEach(() => {
    localStorage.clear();
    service = new SubAgentStashService();
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as any).promptops;
  });

  it('ignores the envelope of a deleted session that shares the name (dbId mismatch)', () => {
    writeEnvelope('ulid-old', [entry()], { dbId: 'ulid-old', sessionName: 'CESENA FC Fe 2' });
    const newcomer = { id: 'local-new', dbId: 'ulid-new', name: 'CESENA FC Fe 2' } as any;
    expect(service.read(newcomer)).toEqual([]);
  });

  it('ignores a name-keyed never-synced envelope written by another run', () => {
    writeEnvelope('CESENA FC Fe 2', [entry()], { dbId: null, sessionId: 'local-old', sessionName: 'CESENA FC Fe 2' });
    const newcomer = { id: 'local-new', dbId: undefined, name: 'CESENA FC Fe 2' } as any;
    expect(service.read(newcomer)).toEqual([]);
  });

  it('ignores a legacy name-keyed envelope without ownership proof', () => {
    writeEnvelope('CESENA FC Fe 2', [entry()], { dbId: null, sessionName: 'CESENA FC Fe 2' });
    const newcomer = { id: 'local-new', dbId: undefined, name: 'CESENA FC Fe 2' } as any;
    expect(service.read(newcomer)).toEqual([]);
  });

  it('accepts the envelope keyed by the session dbId', () => {
    writeEnvelope('ulid-1', [entry()], { dbId: 'ulid-1', sessionName: 'Old name' });
    const session = { id: 'local-1', dbId: 'ulid-1', name: 'Renamed' } as any;
    expect(service.read(session).length).toBe(1);
  });

  it('accepts a backend-sourced summary whose id IS the ULID', () => {
    writeEnvelope('ulid-1', [entry()], { dbId: 'ulid-1' });
    const summary = { id: 'ulid-1', dbId: undefined, name: 'My session' } as any;
    expect(service.read(summary).length).toBe(1);
  });

  it('accepts a never-synced envelope from the same run via the local session id', () => {
    writeEnvelope('My session', [entry()], { dbId: null, sessionId: 'local-1', sessionName: 'My session' });
    const session = { id: 'local-1', dbId: undefined, name: 'My session' } as any;
    expect(service.read(session).length).toBe(1);
  });

  it('finds a dbId-keyed envelope by local id when the renderer does not know the dbId yet', () => {
    writeEnvelope('ulid-1', [entry()], { dbId: 'ulid-1', sessionId: 'local-1', sessionName: 'My session' });
    const session = { id: 'local-1', dbId: undefined, name: 'Renamed' } as any;
    expect(service.read(session).length).toBe(1);
  });

  it('persists the local session id of the push as ownership proof', () => {
    (service as any).write({ sessionId: 'local-1', dbId: null, sessionName: 'My session', frozen: false, subAgents: [entry()] });
    const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + 'My session')!);
    expect(raw.sessionId).toBe('local-1');
    expect(service.read({ id: 'local-1', dbId: undefined, name: 'My session' } as any).length).toBe(1);
    expect(service.read({ id: 'local-2', dbId: undefined, name: 'My session' } as any)).toEqual([]);
  });

  it('retires only its OWN name-keyed envelope once the dbId is known', () => {
    writeEnvelope('My session', [entry({ title: 'Foreign' })], { dbId: null, sessionId: 'local-other', sessionName: 'My session' });
    (service as any).write({ sessionId: 'local-1', dbId: 'ulid-1', sessionName: 'My session', frozen: false, subAgents: [entry()] });
    expect(localStorage.getItem(KEY_PREFIX + 'My session')).not.toBeNull();
    expect(service.read({ id: 'local-other', dbId: undefined, name: 'My session' } as any)[0].title).toBe('Foreign');
    (service as any).write({ sessionId: 'local-other', dbId: 'ulid-other', sessionName: 'My session', frozen: false, subAgents: [entry()] });
    expect(localStorage.getItem(KEY_PREFIX + 'My session')).toBeNull();
  });

  it('seedRestore never hands a foreign same-name stash to main', () => {
    const restore = jasmine.createSpy('restoreSubAgentStash').and.returnValue(Promise.resolve());
    (window as any).promptops = { restoreSubAgentStash: restore };
    writeEnvelope('ulid-old', [entry()], { dbId: 'ulid-old', sessionName: 'CESENA FC Fe 2' });
    writeEnvelope('ulid-mine', [entry({ title: 'Mine' })], { dbId: 'ulid-mine', sessionName: 'Other' });
    service.seedRestore([
      { id: 'local-new', dbId: 'ulid-new', name: 'CESENA FC Fe 2' } as any,
      { id: 'local-mine', dbId: 'ulid-mine', name: 'Other' } as any,
    ]);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.calls.mostRecent().args[0]).toBe('local-mine');
  });

  it('remove() never wipes the parked roster of another session with the same name', () => {
    writeEnvelope('ulid-2', [entry()], { dbId: 'ulid-2', sessionName: 'My session' });
    writeEnvelope('My session', [entry()], { dbId: null, sessionId: 'local-2', sessionName: 'My session' });
    service.remove({ id: 'local-1', dbId: 'ulid-1', name: 'My session' } as any);
    expect(localStorage.getItem(KEY_PREFIX + 'ulid-2')).not.toBeNull();
    expect(localStorage.getItem(KEY_PREFIX + 'My session')).not.toBeNull();
  });

  it('removeEntry() drops only the closed twin when both carry their own id', () => {
    writeEnvelope('ulid-1', [entry({ sessionId: 'pty-a' }), entry({ sessionId: 'pty-b' })], { dbId: 'ulid-1', sessionName: 'S' });
    const session = { id: 'local-1', dbId: 'ulid-1', name: 'S' } as any;
    service.removeEntry(session, { sessionId: 'pty-a', role: entry().role, title: entry().title });
    expect(service.read(session).map((e: any) => e.sessionId)).toEqual(['pty-b']);
  });

  it('remove() stays liberal: a deliberate close wipes name-matched leftovers too', () => {
    writeEnvelope('ulid-1', [entry()], { dbId: 'ulid-1', sessionName: 'My session' });
    writeEnvelope('My session', [entry()], { dbId: null, sessionName: 'My session' });
    service.remove({ id: 'local-1', dbId: 'ulid-1', name: 'My session' } as any);
    expect(localStorage.getItem(KEY_PREFIX + 'ulid-1')).toBeNull();
    expect(localStorage.getItem(KEY_PREFIX + 'My session')).toBeNull();
  });
});
