import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateService } from '@ngx-translate/core';
import { SessionService } from '../services/session.service';
import { ContextSnapshotModalComponent } from './context-snapshot-modal.component';

describe('ContextSnapshotModalComponent', () => {
  let resolveSnapshot: (v: { ok: boolean; error?: string }) => void;
  let rejectSnapshot: (e: unknown) => void;
  let unsubProgress: jasmine.Spy;
  let unsubComplete: jasmine.Spy;

  function create(): ContextSnapshotModalComponent {
    unsubProgress = jasmine.createSpy('unsubProgress');
    unsubComplete = jasmine.createSpy('unsubComplete');
    const sessionService = {
      isDesktop: true,
      onContextSnapshotProgress: () => unsubProgress,
      onContextSnapshotComplete: () => unsubComplete,
      generateContextSnapshot: () => new Promise((res, rej) => { resolveSnapshot = res; rejectSnapshot = rej; }),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: SessionService, useValue: sessionService },
      { provide: NgbActiveModal, useValue: jasmine.createSpyObj('modal', ['close', 'dismiss']) },
      { provide: TranslateService, useValue: { instant: (key: string) => `t:${key}` } },
    ] });
    const c = TestBed.runInInjectionContext(() => new ContextSnapshotModalComponent());
    c.workspacePath = '/repo';
    return c;
  }

  it('does not touch state or schedule timers when the snapshot resolves after destroy', fakeAsync(() => {
    const c = create();
    void c.ngOnInit();
    c.ngOnDestroy();
    expect(unsubProgress).toHaveBeenCalled();
    expect(unsubComplete).toHaveBeenCalled();

    resolveSnapshot({ ok: true });
    flushMicrotasks();
    tick(5000);

    expect(c.completed()).toBe(false);
    expect(c.canContinue()).toBe(false);
  }));

  it('ignores a rejection that arrives after destroy', fakeAsync(() => {
    const c = create();
    void c.ngOnInit();
    c.ngOnDestroy();

    rejectSnapshot(new Error('boom'));
    flushMicrotasks();
    tick(5000);

    expect(c.failed()).toBe(false);
  }));

  it('still shows the failure while open', fakeAsync(() => {
    const c = create();
    void c.ngOnInit();
    rejectSnapshot(new Error('boom'));
    flushMicrotasks();
    expect(c.failed()).toBe(true);
    tick(1200);
    expect(c.canContinue()).toBe(true);
    c.ngOnDestroy();
  }));

  it('translates the plain shell label', () => {
    const c = create();
    c.provider = 'generic-shell';
    expect(c.providerLabel).toBe('t:SESSIONS.Generic Shell');
    c.provider = 'codex';
    expect(c.providerLabel).toBe('Codex');
  });
});
