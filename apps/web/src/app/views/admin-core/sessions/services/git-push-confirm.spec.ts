import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SwalService } from '@core/services/swal.service';
import { GitService } from './git.service';

/** "Confirm before push" must ask with the app's dialog: window.confirm() is a no-op in the macOS webview. */
describe('GitService push confirmation', () => {
  let showConfirm: jasmine.Spy;
  let gitPush: jasmine.Spy;

  beforeEach(() => {
    showConfirm = jasmine.createSpy('showConfirm');
    gitPush = jasmine.createSpy('gitPush').and.resolveTo({ ok: true, output: '' });
    (window as any).promptops = { gitPush, getGitStatus: async () => ({ ok: true, files: [], branch: 'main' }), gitConflicts: async () => ({ ok: true, files: [] }) };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [{ provide: SwalService, useValue: { showConfirm } }],
    });
  });

  afterEach(() => {
    delete (window as any).promptops;
    try { localStorage.removeItem('po:git:confirmBeforePush'); } catch { /* ignore */ }
  });

  it('does not push when the user cancels, pushes when the user confirms', async () => {
    const git = TestBed.inject(GitService);
    git.confirmBeforePush.set(true);
    git.autoPullBeforePush.set(false);
    git.branch.set('feat/x');
    const confirmSpy = spyOn(window, 'confirm');

    showConfirm.and.resolveTo({ isConfirmed: false });
    await git.push('/repo');
    expect(gitPush).not.toHaveBeenCalled();
    expect(showConfirm.calls.mostRecent().args[1]).toContain('feat/x');

    showConfirm.and.resolveTo({ isConfirmed: true });
    await git.push('/repo');
    expect(gitPush).toHaveBeenCalledWith('/repo');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('falls back to readable English messages when no translation is loaded', async () => {
    const git = TestBed.inject(GitService);
    git.workspaceRoot.set('/repo');
    git.confirmBeforePush.set(false);
    git.autoPullBeforePush.set(false);
    gitPush.and.resolveTo({ ok: true, output: '' });
    await git.push('/repo');
    expect(git.syncSuccess()).toBe('Push successful');
  });
});
