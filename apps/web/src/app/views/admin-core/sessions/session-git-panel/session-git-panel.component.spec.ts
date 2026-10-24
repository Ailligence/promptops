import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { GitService } from '../services/git.service';
import { GitSetupService } from '../services/git-setup.service';
import { GitSettingsService } from '../services/git-settings.service';
import { SessionGitPanelComponent } from './session-git-panel.component';

describe('SessionGitPanelComponent (logic)', () => {
  let component: SessionGitPanelComponent;
  let git: any;
  const savedApi = (window as any).promptops;

  beforeEach(() => {
    git = {
      diffViewContent: signal('a\n+b\n-c'),
      commitViewDiff: signal(''),
      effectiveCwd: signal<string | null>(null),
      reset: jasmine.createSpy('reset'),
      scopeToWorkspace: jasmine.createSpy('scopeToWorkspace').and.resolveTo(),
      refresh: jasmine.createSpy('refresh'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: GitService, useValue: git },
        { provide: GitSetupService, useValue: {} },
        { provide: GitSettingsService, useValue: {} },
        { provide: Store, useValue: { select: () => of(null) } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new SessionGitPanelComponent());
  });

  afterEach(() => {
    (window as any).promptops = savedApi;
  });

  it('memoizes the diff lines per content change', () => {
    const first = component.diffLines();
    expect(first).toEqual(['a', '+b', '-c']);
    expect(component.diffLines()).toBe(first);
    git.diffViewContent.set('x');
    expect(component.diffLines()).toEqual(['x']);
  });

  it('swallows a rejected git_watch_stop on destroy instead of leaking it', async () => {
    const stop = jasmine.createSpy('gitWatchStop').and.returnValue(Promise.reject(new Error('not watched')));
    (window as any).promptops = { gitWatchStop: stop };
    (component as any).watchedCwd = '/repo';
    const unhandled = jasmine.createSpy('unhandled');
    window.addEventListener('unhandledrejection', unhandled);

    expect(() => component.ngOnDestroy()).not.toThrow();
    await new Promise(r => setTimeout(r, 0));
    window.removeEventListener('unhandledrejection', unhandled);

    expect(stop).toHaveBeenCalledWith('/repo');
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('does not throw on destroy when the bridge has no watcher API', () => {
    (window as any).promptops = undefined;
    (component as any).watchedCwd = '/repo';
    expect(() => component.ngOnDestroy()).not.toThrow();
  });
});
