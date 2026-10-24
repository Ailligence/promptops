import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { DesktopUpdateService } from './desktop-update.service';
import { FolderAccessService } from './folder-access.service';

describe('desktop bridge calls never leave a rejection behind', () => {
  let saved: unknown;
  beforeEach(() => {
    saved = (window as any).promptops;
    TestBed.configureTestingModule({ providers: [{ provide: Store, useValue: { select: () => of(null) } }] });
  });
  afterEach(() => { (window as any).promptops = saved; });

  it('a refused update check or download ends in the error state, not stuck', async () => {
    (window as any).promptops = {
      checkForUpdates: () => Promise.reject(new Error('offline')),
      downloadUpdate: () => Promise.reject('This edition does not download updates.'),
      openManualDownload: () => Promise.reject(new Error('no browser')),
    };
    const service = TestBed.inject(DesktopUpdateService);
    await service.checkForUpdates();
    expect(service.info().state).toBe('error');
    expect(service.info().error).toBe('offline');
    await service.downloadUpdate();
    expect(service.info().state).toBe('error');
    expect(service.info().error).toContain('does not download');
    await expectAsync(service.openManualDownload()).toBeResolved();
  });

  it('opening System Settings or relaunching swallows a refused call', async () => {
    const rejections: unknown[] = [];
    const listener = (e: PromiseRejectionEvent) => { rejections.push(e.reason); e.preventDefault(); };
    window.addEventListener('unhandledrejection', listener);
    (window as any).promptops = {
      openFolderAccessSettings: () => Promise.reject(new Error('denied')),
      relaunchAppForFolderAccess: () => Promise.reject(new Error('denied')),
    };
    const service = TestBed.inject(FolderAccessService);
    service.openSettings();
    service.relaunch();
    await new Promise((r) => setTimeout(r, 20));
    window.removeEventListener('unhandledrejection', listener);
    expect(rejections).toEqual([]);
  });
});
