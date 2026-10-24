import { of } from 'rxjs';
import { openSessionTarget } from './open-session-target';
import { setActiveSession } from '@/store/sessions/session.actions';
import { setActiveWorkspace } from '@/store/workspaces/workspace.actions';
import { TopbarComponent } from './topbar/topbar.component';
import { QuickAccessComponent } from './sidebar/quick-access/quick-access.component';

/**
 * Topbar search results and Quick Access shortcuts used to navigate to
 * /admin/sessions?session=<id> (or ?workspace=<id>): the Sessions view acts only on
 * `session` + `focus` and ignores `workspace`, so the click landed on whatever
 * session was open before.
 */
describe('openSessionTarget', () => {
  function fakes(sessions: any[] = []) {
    const dispatched: any[] = [];
    const store: any = { dispatch: (a: any) => dispatched.push(a), select: () => of(sessions) };
    const router: any = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
    return { store, router, dispatched };
  }

  afterEach(() => localStorage.removeItem('promptops_active_session'));

  it('opens a session: active in the store, saved for the view restore, focus in the URL', async () => {
    const { store, router, dispatched } = fakes();
    await openSessionTarget(router, store, 'session', 's-42');
    expect(dispatched).toContain(setActiveSession({ sessionId: 's-42' }));
    expect(localStorage.getItem('promptops_active_session')).toBe('s-42');
    expect(router.navigate).toHaveBeenCalledWith(['/admin/sessions'], { queryParams: { session: 's-42', focus: true } });
  });

  it('opens the oldest session of a workspace', async () => {
    const { store, router, dispatched } = fakes([
      { id: 'b', createdAt: '2026-10-02T00:00:00Z' },
      { id: 'a', createdAt: '2026-10-01T00:00:00Z' },
    ]);
    await openSessionTarget(router, store, 'workspace', 'w-1');
    expect(dispatched).toContain(setActiveWorkspace({ workspaceId: 'w-1' }));
    expect(dispatched).toContain(setActiveSession({ sessionId: 'a' }));
    expect(router.navigate).toHaveBeenCalledWith(['/admin/sessions'], { queryParams: { session: 'a', focus: true } });
  });

  it('a workspace without sessions just opens the Sessions view', async () => {
    const { store, router, dispatched } = fakes([]);
    await openSessionTarget(router, store, 'workspace', 'w-1');
    expect(dispatched.some((a) => a.type === setActiveSession.type)).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/sessions']);
  });

  it('the topbar search uses it for sessions and workspaces', async () => {
    const { store, router, dispatched } = fakes();
    const ctx: any = { router, store, showSearchDropdown: true, searchQuery: 'x', searchResults: [{}] };
    TopbarComponent.prototype.navigateToResult.call(ctx, { type: 'session', id: 's-7', name: 'n', icon: '' });
    await Promise.resolve();
    expect(dispatched).toContain(setActiveSession({ sessionId: 's-7' }));
    expect(router.navigate).toHaveBeenCalledWith(['/admin/sessions'], { queryParams: { session: 's-7', focus: true } });
    expect(ctx.searchQuery).toBe('');
  });

  it('Quick Access session shortcuts use it, prompt shortcuts do not', async () => {
    const { store, router, dispatched } = fakes();
    const ctx: any = { router, store };
    QuickAccessComponent.prototype.openTarget.call(ctx, { id: -1, type: 'session', target_id: 's-9' } as any);
    await Promise.resolve();
    expect(dispatched).toContain(setActiveSession({ sessionId: 's-9' }));
    QuickAccessComponent.prototype.openTarget.call(ctx, { id: 3, type: 'prompt', prompt_id: 3 } as any);
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});

/** Round A fixes without a test: null names in the search, Support opening GitHub issues. */
describe('Topbar search with records from older versions', () => {
  it('a session or workspace without a name does not drop the other result groups', async () => {
    const ctx: any = {
      searchQuery: 'ap',
      workspaceApi: { list: () => of([{ id: 'w', name: null, projectPath: '/x/app' }]) },
      desktopSessionApi: { list: () => of([{ id: 's', name: null }, { id: 't', name: 'api', provider: 'claude' }]) },
      localData: { call: async () => ({ prompts: [{ id: 1, title: 'apply' }] }) },
    };
    await (TopbarComponent.prototype as any).performSearch.call(ctx, 'ap');
    const types = ctx.searchResults.map((r: any) => r.type);
    expect(types).toEqual(['workspace', 'session', 'prompt']);
  });
});
