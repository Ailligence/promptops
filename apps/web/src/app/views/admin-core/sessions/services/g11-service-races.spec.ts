import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { DataBackend } from '@core/data/data-backend';
import { GitService } from './git.service';
import { InteractionService } from './interaction.service';
import { WorkspaceApiService } from './workspace-api.service';
import { SessionProfilesService } from './session-profiles.service';

/** Async answers that arrive late, or twice, must not land on the wrong state. */
describe('session services: late and duplicate answers', () => {
  afterEach(() => delete (window as any).promptops);

  it('GitService.refresh drops the status of a repo the user already left', async () => {
    let answerA!: (v: any) => void;
    (window as any).promptops = {
      getGitStatus: (cwd: string) => cwd === '/a'
        ? new Promise((r) => (answerA = r))
        : Promise.resolve({ ok: true, files: [{ path: 'b.txt' }], branch: 'b' }),
    };
    const git = TestBed.inject(GitService);
    git.workspaceRoot.set('/a');
    const a = git.refresh('/a');
    git.workspaceRoot.set('/b');
    await git.refresh('/b');
    answerA({ ok: true, files: [{ path: 'a.txt' }], branch: 'a' });
    await a;
    expect(git.files().map((f: any) => f.path)).toEqual(['b.txt']);
    expect(git.branch()).toBe('b');
    expect(git.loading()).toBeFalse();
  });

  it('InteractionService.init registers its listeners once and never lists an interaction twice', () => {
    const handlers: Array<(e: unknown, d: any) => void> = [];
    const off = () => () => {};
    (window as any).promptops = {
      onInteractionCreated: (h: any) => { handlers.push(h); return () => {}; },
      onInteractionResolved: off, onAutoApproveChanged: off, onInteractionAutoApproved: off,
      onAutoApproveFlags: off, onInteractionsCleared: off, getAutoApproveFlags: async () => ({}),
      autoApproveGetAll: async () => ({}),
    };
    const svc = TestBed.inject(InteractionService);
    svc.init();
    svc.init();
    expect(handlers.length).toBe(1);
    handlers[0](null, { interaction: { id: 'i1' } });
    handlers[0](null, { interaction: { id: 'i1' } });
    expect(svc.pendingCount()).toBe(1);
  });

  it('WorkspaceApiService.list reports a failure instead of an empty list', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DataBackend, useValue: { call: () => Promise.reject({ code: 'storage', message: 'busy' }) } },
        { provide: SessionProfilesService, useValue: { getActiveProfileIdSync: () => null } },
      ],
    });
    const api = TestBed.inject(WorkspaceApiService);
    await expectAsync(firstValueFrom(api.list())).toBeRejectedWith(jasmine.objectContaining({ code: 'storage' }));
  });
});
