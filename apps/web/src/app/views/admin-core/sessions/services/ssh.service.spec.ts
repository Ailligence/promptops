import { SshService } from './ssh.service';

/**
 * The desktop SSH commands answer with plain values and reject with an error
 * string. The panel used to read `res.ok` / `res.connections` from them, so
 * the list never loaded, a saved connection showed "Save failed", a good
 * test showed "Test failed" and a terminal never opened.
 */
describe('SshService', () => {
  let api: Record<string, jasmine.Spy>;
  let svc: SshService;

  const conn = {
    id: 'c1', sessionId: 's1', name: 'prod', host: 'example.com', port: 22,
    username: 'deploy', authType: 'key' as const, hasPassphrase: false,
    createdAt: '1', updatedAt: '1',
  };

  beforeEach(() => {
    api = {
      sshList: jasmine.createSpy('sshList').and.resolveTo([conn]),
      sshSave: jasmine.createSpy('sshSave').and.resolveTo(conn),
      sshDelete: jasmine.createSpy('sshDelete').and.resolveTo(true),
      sshTest: jasmine.createSpy('sshTest').and.resolveTo(true),
      sshSpawn: jasmine.createSpy('sshSpawn').and.resolveTo('sess-1'),
    };
    (window as any).promptops = api;
    svc = new SshService();
  });

  afterEach(() => {
    delete (window as any).promptops;
  });

  it('loads the plain array returned by ssh_list', async () => {
    await svc.refresh('s1');
    expect(svc.connections()).toEqual([conn]);
    expect(svc.error()).toBeNull();
    expect(svc.loading()).toBeFalse();
  });

  it('still accepts an { ok, connections } envelope', async () => {
    api['sshList'].and.resolveTo({ ok: true, connections: [conn] });
    await svc.refresh('s1');
    expect(svc.connections()).toEqual([conn]);
  });

  it('reports a rejected list call instead of throwing', async () => {
    api['sshList'].and.rejectWith('local store not ready');
    await svc.refresh('s1');
    expect(svc.error()).toBe('local store not ready');
    expect(svc.loading()).toBeFalse();
  });

  it('returns the saved connection and refreshes', async () => {
    const saved = await svc.save({
      sessionId: 's1', name: 'prod', host: 'example.com', username: 'deploy',
      authType: 'password', secret: 'pw',
    });
    expect(saved).toEqual(conn);
    expect(svc.error()).toBeNull();
    expect(api['sshList']).toHaveBeenCalled();
  });

  it('shows the validation error of a refused save', async () => {
    api['sshSave'].and.rejectWith('host is required');
    const saved = await svc.save({
      sessionId: 's1', name: 'x', host: '', username: 'u', authType: 'password', secret: 'pw',
    });
    expect(saved).toBeNull();
    expect(svc.error()).toBe('host is required');
  });

  it('maps test results and failures', async () => {
    expect(await svc.test('c1')).toEqual({ ok: true });
    api['sshTest'].and.rejectWith('ssh authentication failed');
    expect(await svc.test('c1')).toEqual({ ok: false, error: 'ssh authentication failed' });
  });

  it('turns the spawned session id into a result, and a refusal into an error', async () => {
    const target = { kind: 'terminal' as const, terminalId: 't1' };
    expect(await svc.spawn({ connId: 'c1', target })).toEqual({ ok: true, sessionId: 'sess-1' });
    api['sshSpawn'].and.rejectWith('SSH connection to example.com:22 timed out');
    expect(await svc.spawn({ connId: 'c1', target })).toEqual({
      ok: false,
      error: 'SSH connection to example.com:22 timed out',
    });
  });

  it('treats a true delete as success', async () => {
    expect(await svc.delete('c1', 's1')).toBeTrue();
    api['sshDelete'].and.resolveTo(false);
    expect(await svc.delete('c1', 's1')).toBeFalse();
  });
});
