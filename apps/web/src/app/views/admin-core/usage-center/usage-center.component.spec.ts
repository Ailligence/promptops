import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SwalService } from '@core/services/swal.service';
import { UsageCenterComponent } from './usage-center.component';

describe('UsageCenterComponent export and clear', () => {
  let confirmDanger: jasmine.Spy;
  let api: any;

  beforeEach(() => {
    confirmDanger = jasmine.createSpy('confirmDanger');
    api = {
      exportUsage: jasmine.createSpy('exportUsage').and.resolveTo({ ok: true, path: '/data/promptops-usage-7d.json' }),
      clearUsage: jasmine.createSpy('clearUsage').and.resolveTo({ ok: true }),
      getUsageSummary: async () => null,
    };
    (window as any).promptops = api;
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [{ provide: SwalService, useValue: { confirmDanger } }],
    });
  });

  afterEach(() => delete (window as any).promptops);

  const make = () => TestBed.runInInjectionContext(() => new UsageCenterComponent());

  it('says where the export landed, or why it failed', async () => {
    const c = make();
    await c.onExport('json');
    expect(c.exportNotice()).toEqual({ ok: true, path: '/data/promptops-usage-7d.json' });
    api.exportUsage.and.resolveTo({ ok: false, error: 'disk full' });
    await c.onExport('csv');
    expect(c.exportNotice()).toEqual({ ok: false, error: 'disk full' });
  });

  it('clears only after the in-app confirmation (window.confirm is a no-op on macOS)', async () => {
    const confirmSpy = spyOn(window, 'confirm');
    const c = make();
    c.onClear();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(api.clearUsage).not.toHaveBeenCalled();
    const onConfirm = confirmDanger.calls.mostRecent().args[2];
    await onConfirm();
    await Promise.resolve();
    expect(api.clearUsage).toHaveBeenCalled();
  });
});
