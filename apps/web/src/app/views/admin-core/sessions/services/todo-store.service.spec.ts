import { TodoStoreService, TodoItem } from './todo-store.service';

const KEY_PREFIX = 'promptops_todos_';

function item(text = 'do it'): TodoItem {
  return { id: 'i1', text, done: false, createdAt: 1 };
}

function writeEnvelope(key: string, items: TodoItem[], extra: Partial<{ sessionId: string | null; sessionName: string }> = {}): void {
  localStorage.setItem(KEY_PREFIX + key, JSON.stringify({
    v: 1,
    key: KEY_PREFIX + key,
    sessionId: extra.sessionId ?? null,
    sessionName: extra.sessionName ?? 'My session',
    savedAt: new Date().toISOString(),
    items,
    link: null,
  }));
}

describe('TodoStoreService — ownership (a reused name must not inherit a list)', () => {
  let service: TodoStoreService;

  beforeEach(() => {
    localStorage.clear();
    service = new TodoStoreService();
  });

  afterEach(() => localStorage.clear());

  it('reads the list keyed by the session dbId, whatever the name', () => {
    writeEnvelope('ulid-1', [item()], { sessionName: 'Old' });
    expect(service.read({ id: 'local-1', dbId: 'ulid-1', name: 'Renamed' } as any).length).toBe(1);
  });

  it('reads a backend-sourced summary whose id IS the ULID', () => {
    writeEnvelope('ulid-1', [item()]);
    expect(service.read({ id: 'ulid-1', dbId: undefined, name: 'My session' } as any).length).toBe(1);
  });

  it('ignores a legacy name-keyed envelope of a deleted same-named session', () => {
    writeEnvelope('CESENA FC Fe 2', [item('old stuff')], { sessionName: 'CESENA FC Fe 2' });
    const newcomer = { id: 'local-new', dbId: 'ulid-new', name: 'CESENA FC Fe 2' } as any;
    expect(service.read(newcomer)).toEqual([]);
    expect(service.readLink(newcomer)).toBeNull();
  });

  it('save() never seeds from a foreign same-named envelope', () => {
    writeEnvelope('CESENA FC Fe 2', [item('old stuff')], { sessionName: 'CESENA FC Fe 2' });
    const newcomer = { id: 'local-new', dbId: undefined, name: 'CESENA FC Fe 2' } as any;
    service.save(newcomer, [item('mine')]);
    const mine = JSON.parse(localStorage.getItem(KEY_PREFIX + 'local-new')!);
    expect(mine.items.map((i: TodoItem) => i.text)).toEqual(['mine']);
    expect(mine.sessionId).toBe('local-new');
    // the foreign legacy envelope is left alone (not ours to delete)
    expect(localStorage.getItem(KEY_PREFIX + 'CESENA FC Fe 2')).not.toBeNull();
  });

  it('migrates the never-synced envelope to the dbId key once known', () => {
    const session = { id: 'local-1', dbId: undefined, name: 'My session' } as any;
    service.save(session, [item('early')]);
    const synced = { ...session, dbId: 'ulid-1' };
    expect(service.read(synced).length).toBe(1);
    service.save(synced, [item('early'), item('later')]);
    expect(localStorage.getItem(KEY_PREFIX + 'local-1')).toBeNull();
    expect(service.read(synced).length).toBe(2);
  });

  it('remove() wipes dbId, runtime-id and legacy name keys', () => {
    writeEnvelope('ulid-1', [item()]);
    writeEnvelope('local-1', [item()]);
    writeEnvelope('My session', [item()]);
    service.remove({ id: 'local-1', dbId: 'ulid-1', name: 'My session' } as any);
    expect(localStorage.getItem(KEY_PREFIX + 'ulid-1')).toBeNull();
    expect(localStorage.getItem(KEY_PREFIX + 'local-1')).toBeNull();
    expect(localStorage.getItem(KEY_PREFIX + 'My session')).toBeNull();
  });
});
