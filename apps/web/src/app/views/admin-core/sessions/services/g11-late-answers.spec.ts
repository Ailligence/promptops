import { TestBed, fakeAsync, flushMicrotasks, tick, discardPeriodicTasks } from '@angular/core/testing';
import { SessionAssetsService } from './session-assets.service';
import { DockerService } from './docker.service';
import { RemoteBridgeService } from './remote-bridge.service';
import { SubAgentReviewService } from './sub-agent-review.service';

/** Late answers and failing polls in the per-session panels. */
describe('session panels: stale answers and polls', () => {
  afterEach(() => delete (window as any).promptops);

  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it('assets: the previous session\'s late list never replaces the current one', async () => {
    const a = deferred<any>();
    (window as any).promptops = {
      listAssets: (cwd: string) => (cwd === '/a' ? a.promise : Promise.resolve({ ok: true, assets: [{ name: 'b.png' }] })),
    };
    const svc = TestBed.inject(SessionAssetsService);
    const first = svc.loadAssets('/a');
    await svc.loadAssets('/b');
    a.resolve({ ok: true, assets: [{ name: 'a.png' }] });
    await first;
    expect(svc.assets().map((x) => x.name)).toEqual(['b.png']);
    expect(svc.loading()).toBeFalse();
  });

  it('assets: a failed delete is reported instead of looking done', async () => {
    (window as any).promptops = { deleteAsset: async () => ({ ok: false, error: 'locked' }) };
    const svc = TestBed.inject(SessionAssetsService);
    svc.assets.set([{ name: 'x.png' } as any]);
    await expectAsync(svc.deleteAsset('/a', 'x.png')).toBeRejectedWithError('locked');
    expect(svc.assets().length).toBe(1);
  });

  it('docker: the previous folder\'s late answer is dropped', async () => {
    const a = deferred<any>();
    (window as any).promptops = {
      dockerPs: (cwd: string) => (cwd === '/a' ? a.promise : Promise.resolve({ ok: true, containers: [{ name: 'b' }], allContainers: [] })),
    };
    const svc = TestBed.inject(DockerService);
    const first = svc.loadContainers('/a');
    await svc.loadContainers('/b');
    a.resolve({ ok: true, containers: [{ name: 'a' }], allContainers: [] });
    await first;
    expect(svc.containers().map((c: any) => c.name)).toEqual(['b']);
  });

  it('remote bridge keeps polling the new session when the old collect is still running', fakeAsync(() => {
    const calls: string[] = [];
    const slow = deferred<any>();
    (window as any).promptops = {
      remoteBridgeSetup: async () => ({ ok: true }),
      remoteOutboxCollect: (cwd: string) => { calls.push(cwd); return cwd === 'ssh://a' ? slow.promise : Promise.resolve({ ok: true, files: [] }); },
    };
    const bridge = TestBed.inject(RemoteBridgeService);
    bridge.watch('ssh://a');
    tick(0);
    bridge.watch('ssh://b');
    tick(0);
    slow.resolve({ ok: true, files: [] });
    flushMicrotasks();
    tick(1000);
    expect(calls).toContain('ssh://b');
    bridge.stop();
    discardPeriodicTasks();
  }));

  it('review history poll stops after repeated failures', fakeAsync(() => {
    let calls = 0;
    (window as any).promptops = {
      listSubAgentReviews: async () => {
        calls++;
        return calls === 1 ? { ok: true, runs: [{ id: 'r1', status: 'running', subAgentId: 'sa' }] } : { ok: false };
      },
    };
    const svc = TestBed.inject(SubAgentReviewService);
    void svc.hydrateTask('sa');
    flushMicrotasks();
    tick(10_000);
    flushMicrotasks();
    const after = calls;
    tick(10_000);
    flushMicrotasks();
    expect(calls).toBe(after);
    expect(after).toBeLessThanOrEqual(7);
  }));
});
