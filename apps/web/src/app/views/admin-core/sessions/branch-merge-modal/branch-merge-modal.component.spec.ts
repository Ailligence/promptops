import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { GitService } from '../services/git.service';
import { BranchMergeModalComponent } from './branch-merge-modal.component';

describe('BranchMergeModalComponent', () => {
  let fixture: ComponentFixture<BranchMergeModalComponent>;
  let component: BranchMergeModalComponent;
  let git: {
    merging: ReturnType<typeof signal<boolean>>;
    mergeError: ReturnType<typeof signal<string | null>>;
    mergeResults: ReturnType<typeof signal<any[]>>;
    merge: jasmine.Spy;
    mergeAbort: jasmine.Spy;
  };

  function key(target: EventTarget, k: 'Enter' | 'Escape'): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
  }

  beforeEach(async () => {
    git = {
      merging: signal(false),
      mergeError: signal<string | null>(null),
      mergeResults: signal<any[]>([]),
      merge: jasmine.createSpy('merge').and.resolveTo({ ok: false }),
      mergeAbort: jasmine.createSpy('mergeAbort'),
    };
    await TestBed.configureTestingModule({
      imports: [BranchMergeModalComponent, TranslateModule.forRoot()],
      providers: [{ provide: GitService, useValue: git }],
    }).compileComponents();
    fixture = TestBed.createComponent(BranchMergeModalComponent);
    component = fixture.componentInstance;
    component.cwd = '/repo';
    component.currentBranch = 'main';
    component.branches = ['main', 'feat/a'];
    component.open = true;
    fixture.detectChanges();
    component.ngOnChanges({ open: { currentValue: true } as any });
    fixture.detectChanges();
  });

  afterEach(() => {
    component.open = false;
    fixture.detectChanges();
  });

  it('recomputes the branch lists when the parent passes new branches', () => {
    expect(component.filteredLocal()).toEqual(['main', 'feat/a']);
    component.branches = ['main', 'feat/a', 'feat/b', 'origin/main'];
    expect(component.filteredLocal()).toEqual(['main', 'feat/a', 'feat/b']);
    expect(component.filteredRemote()).toEqual(['origin/main']);
  });

  it('Enter on a focused button does not start the merge', () => {
    component.toggleSource('feat/a');
    fixture.detectChanges();
    const cancel = fixture.nativeElement.querySelector('.bm-btn.ghost') as HTMLButtonElement;
    key(cancel, 'Enter');
    expect(git.merge).not.toHaveBeenCalled();
  });

  it('Enter elsewhere in the modal merges when possible', () => {
    component.toggleSource('feat/a');
    fixture.detectChanges();
    const search = fixture.nativeElement.querySelector('.bm-search') as HTMLInputElement;
    const ev = key(search, 'Enter');
    expect(ev.defaultPrevented).toBe(true);
    expect(git.merge).toHaveBeenCalledWith('/repo', ['feat/a'], 'main', 'default', undefined, false);
  });

  it('Enter does nothing while nothing is selected', () => {
    key(document.body, 'Enter');
    expect(git.merge).not.toHaveBeenCalled();
  });

  it('Esc closes through the shared overlay stack, not while merging', () => {
    const closed = jasmine.createSpy('closed');
    component.closed.subscribe(closed);
    git.merging.set(true);
    key(document, 'Escape');
    expect(closed).not.toHaveBeenCalled();
    git.merging.set(false);
    key(document, 'Escape');
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed abort instead of dropping it', async () => {
    git.mergeAbort.and.resolveTo({ ok: false, error: 'abort exploded' });
    await component.abort();
    expect(git.mergeError()).toBe('abort exploded');
  });

  it('cancels the success auto-close timer on destroy', async () => {
    jasmine.clock().install();
    try {
      git.merge.and.resolveTo({ ok: true });
      const closed = jasmine.createSpy('closed');
      component.closed.subscribe(closed);
      component.toggleSource('feat/a');
      await component.runMerge();
      component.ngOnDestroy();
      jasmine.clock().tick(1000);
      expect(closed).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
