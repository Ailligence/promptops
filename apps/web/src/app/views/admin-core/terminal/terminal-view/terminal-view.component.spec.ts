import { TestBed, ComponentFixture } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Subject } from 'rxjs';
import { TerminalViewComponent } from './terminal-view.component';
import { TerminalManagerService } from '../services/terminal-manager.service';
import { DesktopBridgeService } from '../services/desktop-bridge.service';
import { SwalService } from '@core/services/swal.service';

describe('TerminalViewComponent (modal & route modes)', () => {
  let fixture: ComponentFixture<TerminalViewComponent>;
  let component: TerminalViewComponent;
  let managerSpy: jasmine.SpyObj<TerminalManagerService>;
  let swalSpy: jasmine.SpyObj<SwalService>;
  let queryParams$: Subject<Record<string, string>>;

  function buildComponent(opts: { withModal?: boolean } = {}): void {
    const bridgeStub: Partial<DesktopBridgeService> = {
      get isDesktop() {
        return true;
      },
    };

    queryParams$ = new Subject<Record<string, string>>();
    const routeStub: Partial<ActivatedRoute> = {
      queryParams: queryParams$.asObservable() as any,
    };

    const providers: any[] = [
      { provide: TerminalManagerService, useValue: managerSpy },
      { provide: DesktopBridgeService, useValue: bridgeStub },
      { provide: ActivatedRoute, useValue: routeStub },
      { provide: SwalService, useValue: swalSpy },
    ];
    if (opts.withModal) {
      providers.push({
        provide: NgbActiveModal,
        useValue: jasmine.createSpyObj('NgbActiveModal', ['close', 'dismiss']),
      });
    }

    TestBed.configureTestingModule({
      imports: [TerminalViewComponent, TranslateModule.forRoot()],
      providers,
    });

    fixture = TestBed.createComponent(TerminalViewComponent);
    component = fixture.componentInstance;
  }

  beforeEach(() => {
    managerSpy = jasmine.createSpyObj<TerminalManagerService>(
      'TerminalManagerService',
      ['init', 'destroy', 'create', 'close', 'closeAll', 'closeSession', 'activate', 'tabsForSession', 'activeIdForSession'],
    );
    managerSpy.create.and.resolveTo('term-1');
    managerSpy.tabsForSession.and.returnValue([]);
    managerSpy.activeIdForSession.and.returnValue(null);

    swalSpy = jasmine.createSpyObj<SwalService>('SwalService', ['confirmDanger', 'error']);
    // Simulate the user confirming the destructive dialog.
    swalSpy.confirmDanger.and.callFake((_t, _m, onConfirm) => onConfirm());
  });

  describe('per-session creation', () => {
    it('passes sessionId and initialCwd when auto-creating the first terminal', async () => {
      buildComponent({ withModal: true });
      component.sessionId = 'session-A';
      component.initialCwd = '/Users/dev/repo';

      component.ngOnInit();
      await Promise.resolve();

      expect(managerSpy.init).toHaveBeenCalled();
      expect(managerSpy.create).toHaveBeenCalledOnceWith({
        sessionId: 'session-A',
        cwd: '/Users/dev/repo',
      });
    });

    it('does NOT auto-create a terminal when the session already has tabs', async () => {
      buildComponent({ withModal: true });
      managerSpy.tabsForSession.and.returnValue([
        { id: 't1', label: 'Terminal 1', createdAt: new Date() },
      ]);
      component.sessionId = 'session-A';
      component.initialCwd = '/some/path';

      component.ngOnInit();
      await Promise.resolve();

      expect(managerSpy.create).not.toHaveBeenCalled();
    });

    it('newTerminal() spawns with sessionId and inherits initialCwd as default', async () => {
      buildComponent({ withModal: true });
      component.sessionId = 'session-A';
      component.initialCwd = '/Users/dev/repo';

      await component.newTerminal();

      expect(managerSpy.create).toHaveBeenCalledWith({
        sessionId: 'session-A',
        cwd: '/Users/dev/repo',
      });
    });

    it('newTerminal() shows why the terminal could not open instead of failing silently', async () => {
      buildComponent({ withModal: true });
      managerSpy.create.and.rejectWith(new Error('This session runs on a remote host'));

      await component.newTerminal();

      expect(swalSpy.error).toHaveBeenCalledOnceWith('This session runs on a remote host');
    });

    it('close/activate are scoped by sessionId', () => {
      buildComponent({ withModal: true });
      component.sessionId = 'session-A';

      component.activate('t1');
      component.close('t1');

      expect(managerSpy.activate).toHaveBeenCalledOnceWith('session-A', 't1');
      expect(managerSpy.close).toHaveBeenCalledOnceWith('session-A', 't1');
    });

    it('killAll() confirms before terminating, then closes all scoped by sessionId', () => {
      buildComponent({ withModal: true });
      component.sessionId = 'session-A';

      component.killAll();

      expect(swalSpy.confirmDanger).toHaveBeenCalledTimes(1);
      expect(managerSpy.closeAll).toHaveBeenCalledOnceWith('session-A');
    });

    it('killAll() does NOT terminate anything when the user cancels the dialog', () => {
      buildComponent({ withModal: true });
      component.sessionId = 'session-A';
      // User dismisses the confirm dialog: onConfirm is never invoked.
      swalSpy.confirmDanger.and.stub();

      component.killAll();

      expect(swalSpy.confirmDanger).toHaveBeenCalledTimes(1);
      expect(managerSpy.closeAll).not.toHaveBeenCalled();
    });
  });

  describe('legacy route mode (no modal, no sessionId override)', () => {
    it('creates a terminal in the default bucket when a cwd query param arrives', async () => {
      buildComponent({ withModal: false });
      // sessionId stays at its 'default' fallback
      component.ngOnInit();
      await Promise.resolve();
      expect(managerSpy.create).not.toHaveBeenCalled();

      queryParams$.next({ cwd: '/from/query' });
      await Promise.resolve();
      expect(managerSpy.create).toHaveBeenCalledOnceWith({
        sessionId: 'default',
        cwd: '/from/query',
      });
    });

    it('ignores query params without a cwd', async () => {
      buildComponent({ withModal: false });
      component.ngOnInit();
      queryParams$.next({ other: 'x' });
      await Promise.resolve();
      expect(managerSpy.create).not.toHaveBeenCalled();
    });
  });

  describe('cleanup on destroy', () => {
    it('does NOT call manager.destroy() — the singleton must outlive the modal', () => {
      buildComponent({ withModal: true });
      component.ngOnInit();
      component.ngOnDestroy();
      expect(managerSpy.destroy).not.toHaveBeenCalled();
    });
  });

  describe('modal close', () => {
    it('dismisses the active modal when closeModal() is called', () => {
      buildComponent({ withModal: true });
      const modal = TestBed.inject(NgbActiveModal) as jasmine.SpyObj<NgbActiveModal>;
      component.closeModal();
      expect(modal.dismiss).toHaveBeenCalledOnceWith('user');
    });

    it('closeModal() is a no-op when no modal is active (route mode)', () => {
      buildComponent({ withModal: false });
      expect(() => component.closeModal()).not.toThrow();
    });
  });
});
