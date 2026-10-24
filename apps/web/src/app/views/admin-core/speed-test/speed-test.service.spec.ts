import {
  SpeedTestLiveState,
  SpeedTestModelResult,
  SpeedTestService,
} from './speed-test.service';

/**
 * Regression specs for the sequential-queue Speed Test state machine:
 *  - the cumulative model timer (modelElapsedMs) NEVER resets across rounds
 *    (the old per-round timer reset was the "the timer is not the same" bug);
 *  - the finished badge uses the runner's true wallMs, not a sum of medians;
 *  - queue events drive pending/running/done/skipped/cli-missing states;
 *  - the raw log never grows an "undefined" prefix from the first CLI chunk.
 *
 * Run only this spec:
 *   npx ng test --watch=false --browsers=ChromeHeadless
 *     --include='<glob>/speed-test/<glob>.spec.ts'
 *   (globs spelled out: two asterisks slash ... — a literal star-slash can't
 *   appear inside this comment)
 */
describe('SpeedTestService', () => {
  let svc: SpeedTestService;
  let progressCb: ((e: unknown, evt: unknown) => void) | null;
  let resolveRun: (v: unknown) => void;

  const emit = (evt: Record<string, unknown>) => progressCb!(null, evt);

  const result = (over: Partial<SpeedTestModelResult> = {}): SpeedTestModelResult => ({
    modelId: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'claude-code-cli',
    ok: true,
    rounds: [],
    wallMs: 123456,
    avgTtftMs: 0, avgTotalMs: 0, totalChars: 0, avgCharsPerSec: 0,
    accuracyPct: 100,
    ...over,
  });

  beforeEach(() => {
    progressCb = null;
    (window as any).promptops = {
      speedTestRun: jasmine.createSpy('speedTestRun').and.callFake(
        () => new Promise((res) => { resolveRun = res; }),
      ),
      speedTestListModels: () => Promise.resolve({ ok: false }),
      speedTestAbort: () => Promise.resolve({ ok: true }),
      onSpeedTestProgress: (cb: (e: unknown, evt: unknown) => void) => {
        progressCb = cb;
        return () => { progressCb = null; };
      },
    };
    svc = new SpeedTestService();
    svc.setSlot(0, 'claude-haiku-4-5');
    svc.setSlot(1, 'claude-sonnet-5');
    void svc.run(); // synchronous part seeds live state and registers the listener
  });

  afterEach(() => {
    resolveRun?.({ ok: true, results: [] });
    delete (window as any).promptops;
  });

  const live = (id: string): SpeedTestLiveState => svc.live()[id];

  it('keeps the cumulative model timer monotonic across rounds and samples', () => {
    emit({ type: 'model-start', modelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', position: 0, totalModels: 2 });
    emit({ type: 'round-start', modelId: 'claude-haiku-4-5', round: 'speed', prompt: 'p' });
    emit({ type: 'progress', modelId: 'claude-haiku-4-5', round: 'speed', elapsedMs: 9000, timeoutMs: 120000, modelElapsedMs: 9000, phase: { kind: 'speed', sample: 1, samplesTotal: 3 } });

    // Sample 2 restarts the per-round clock (ring), NOT the model clock.
    emit({ type: 'progress', modelId: 'claude-haiku-4-5', round: 'speed', elapsedMs: 1000, timeoutMs: 120000, modelElapsedMs: 10000, phase: { kind: 'speed', sample: 2, samplesTotal: 3 } });
    expect(live('claude-haiku-4-5').elapsedMs).toBe(1000);
    expect(live('claude-haiku-4-5').modelElapsedMs).toBe(10000);

    // New round: the old bug reset the visible timer here.
    emit({ type: 'round-start', modelId: 'claude-haiku-4-5', round: 'analysis', prompt: 'p' });
    expect(live('claude-haiku-4-5').modelElapsedMs).toBe(10000);

    emit({ type: 'progress', modelId: 'claude-haiku-4-5', round: 'analysis', elapsedMs: 2000, timeoutMs: 600000, modelElapsedMs: 12000, phase: { kind: 'analysis' } });
    expect(live('claude-haiku-4-5').modelElapsedMs).toBe(12000);
    expect(live('claude-haiku-4-5').phase).toEqual({ kind: 'analysis' });
  });

  it('sets the finished badge from the runner-computed true wall time', () => {
    emit({ type: 'model-done', modelId: 'claude-haiku-4-5', result: result({ wallMs: 98765 }) });
    expect(live('claude-haiku-4-5').status).toBe('done');
    expect(live('claude-haiku-4-5').wallMs).toBe(98765);
    expect(svc.results().length).toBe(1);
  });

  it('mirrors queue transitions including skipped and cli-missing', () => {
    emit({
      type: 'queue',
      entries: [
        { modelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', position: 0, status: 'done' },
        { modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', position: 1, status: 'skipped' },
      ],
    });
    expect(live('claude-haiku-4-5').status).toBe('done');
    expect(live('claude-sonnet-5').status).toBe('skipped');
    expect(live('claude-sonnet-5').queuePosition).toBe(1);

    emit({
      type: 'queue',
      entries: [
        { modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', position: 1, status: 'cli-missing' },
      ],
    });
    expect(live('claude-sonnet-5').status).toBe('cli-missing');
  });

  it('settles leftover cards defensively on aborted', () => {
    // Race mode: every contender is on track from the gun, so an abort turns
    // all still-running cards into failed.
    emit({ type: 'model-start', modelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', position: 0, totalModels: 2 });
    emit({ type: 'aborted', results: [] });
    expect(live('claude-haiku-4-5').status).toBe('failed');
    expect(live('claude-sonnet-5').status).toBe('failed');
  });

  it('ignores progress about models that are not in this run', () => {
    emit({ type: 'progress', modelId: 'gpt-5.5', round: 'speed', elapsedMs: 500, timeoutMs: 120000, modelElapsedMs: 500 });
    emit({ type: 'model-start', modelId: 'gpt-5.5', label: 'GPT-5.5', position: 0, totalModels: 1 });
    expect(svc.live()['gpt-5.5']).toBeUndefined();
    expect(Object.keys(svc.live()).sort()).toEqual(['claude-haiku-4-5', 'claude-sonnet-5']);
  });

  it('never prefixes the raw log with "undefined" on the first output chunk', () => {
    emit({ type: 'output', modelId: 'claude-haiku-4-5', round: 'analysis', chunk: 'first chunk' });
    expect(svc.logLines()[0]).toBe('first chunk');
    expect(svc.logLines().join('\n')).not.toContain('undefined');
  });

  it('stamps the clocks that drive the wait/celebration animations', () => {
    expect(svc.runStartedAt()).toBeGreaterThan(0);
    emit({ type: 'output', modelId: 'claude-haiku-4-5', round: 'analysis', chunk: 'x' });
    expect(live('claude-haiku-4-5').lastOutputAt).toBeGreaterThan(0);
    emit({ type: 'model-done', modelId: 'claude-haiku-4-5', result: result() });
    expect(live('claude-haiku-4-5').finishedAt).toBeGreaterThan(0);
  });

  it('can run with models only: no codebase is needed for the speed round', async () => {
    resolveRun({ ok: true, results: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(svc.running()).toBeFalse();
    expect(svc.target()).toBeNull();
    expect(svc.canRun()).toBeTrue();
  });

  it('exposes the estimated-tokens flag through accumulated results', () => {
    emit({
      type: 'model-done',
      modelId: 'claude-haiku-4-5',
      result: result({
        rounds: [{
          round: 'speed', ok: true, ttftMs: 100, totalMs: 10000,
          outputChars: 2000, charsPerSec: 200,
          outputTokens: 500, tokensPerSec: 50,
          tokensEstimated: true, speedSamples: 3, samplesWallMs: 31000,
        }],
      }),
    });
    const speed = svc.results()[0].rounds[0];
    expect(speed.tokensEstimated).toBeTrue();
    expect(speed.samplesWallMs).toBe(31000);
  });
});
