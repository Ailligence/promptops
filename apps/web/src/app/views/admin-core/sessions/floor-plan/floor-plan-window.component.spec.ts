import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FloorPlanWindowComponent } from './floor-plan-window.component';
import { FloorPlanViewComponent } from './floor-plan-view.component';
import { FloorPlanService } from './floor-plan.service';

describe('Floor plan detached window robustness', () => {
  let original: unknown;
  let resolveListen!: (off: () => void) => void;
  let listen: jasmine.Spy;
  let emit: jasmine.Spy;

  beforeEach(() => {
    original = (window as any).__TAURI__;
    listen = jasmine.createSpy('listen').and.callFake(() => new Promise(r => { resolveListen = r; }));
    emit = jasmine.createSpy('emit').and.resolveTo(undefined);
    (window as any).__TAURI__ = { core: { invoke: () => Promise.resolve() }, event: { emit, listen } };
  });

  afterEach(() => {
    (window as any).__TAURI__ = original;
  });

  it('unlistens when the window is destroyed before listen() resolves', async () => {
    await TestBed.configureTestingModule({ imports: [FloorPlanWindowComponent, TranslateModule.forRoot()] }).compileComponents();
    const fixture = TestBed.createComponent(FloorPlanWindowComponent);
    const init = fixture.componentInstance.ngOnInit();
    fixture.destroy();
    const off = jasmine.createSpy('off');
    resolveListen(off);
    await expectAsync(init).toBeResolved();
    expect(off).toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith('floor-plan:action', { type: 'ready' });
  });

  it('does not reject when listen() fails', async () => {
    listen.and.rejectWith(new Error('no ipc'));
    await TestBed.configureTestingModule({ imports: [FloorPlanWindowComponent, TranslateModule.forRoot()] }).compileComponents();
    const fixture = TestBed.createComponent(FloorPlanWindowComponent);
    await expectAsync(fixture.componentInstance.ngOnInit()).toBeResolved();
    fixture.destroy();
  });
});

describe('FloorPlanViewComponent pop-out', () => {
  it('reports a failed pop-out instead of leaking the rejection', async () => {
    const fp = {
      popOut: jasmine.createSpy('popOut').and.rejectWith(new Error('no window')),
      rooms: signal([]), stats: signal({ projects: 0, sessions: 0, parked: 0, working: 0, waiting: 0 }),
      hideInactive: signal(false), openable: signal(new Set<string>()),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: FloorPlanService, useValue: fp },
      { provide: TranslateService, useValue: { instant: (k: string) => k, onLangChange: { subscribe: () => ({ unsubscribe() {} }) } } },
    ] });
    const view = TestBed.runInInjectionContext(() => new FloorPlanViewComponent());
    view.popOut();
    await Promise.resolve();
    await Promise.resolve();
    expect(view.popOutError()).toBeTrue();
    expect(view.block().empty).toBe('SESSIONS.FLOOR_PLAN.Empty');
  });
});

describe('Floor plan bridge after a main-window reload', () => {
  let original: unknown;
  afterEach(() => { (window as any).__TAURI__ = original; });

  it('the detached window answers the main window\'s hello with ready', async () => {
    original = (window as any).__TAURI__;
    const handlers: Record<string, (e: any) => void> = {};
    const emit = jasmine.createSpy('emit').and.resolveTo(undefined);
    const listen = jasmine.createSpy('listen').and.callFake(async (name: string, h: any) => { handlers[name] = h; return () => {}; });
    (window as any).__TAURI__ = { core: { invoke: () => Promise.resolve() }, event: { emit, listen } };
    await TestBed.configureTestingModule({ imports: [FloorPlanWindowComponent, TranslateModule.forRoot()] }).compileComponents();
    const fixture = TestBed.createComponent(FloorPlanWindowComponent);
    await fixture.componentInstance.ngOnInit();
    emit.calls.reset();
    handlers['floor-plan:hello']({ payload: null });
    expect(emit).toHaveBeenCalledWith('floor-plan:action', { type: 'ready' });
    fixture.destroy();
  });
});
