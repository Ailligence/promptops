import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { SessionProfilesService } from './session-profiles.service';
import { SessionProfileApiService } from './session-profile-api.service';
import { clearSessions } from '@/store/sessions/session.actions';

describe('SessionProfilesService.switchTo', () => {
  let dispatched: any[];
  let changed: (ev: unknown, d: { activeProfileId: string | null }) => void;
  let deleted: string[];

  async function setup(setActive: (id: string | null) => Promise<any>) {
    dispatched = [];
    deleted = [];
    (window as any).promptops = {
      getActiveSessionProfile: async () => 'p1',
      setActiveSessionProfile: setActive,
      onSessionProfileChanged: (cb: any) => { changed = cb; return () => {}; },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { dispatch: (a: any) => dispatched.push(a) } },
        {
          provide: SessionProfileApiService,
          useValue: { list: () => of([]), delete: (id: string) => { deleted.push(id); return of(null); } },
        },
      ],
    });
    const svc = TestBed.inject(SessionProfilesService);
    await svc.init();
    return svc;
  }

  afterEach(() => delete (window as any).promptops);

  it('reloads the lists once even though the desktop also emits a change event', async () => {
    const svc = await setup(async (id) => { changed(null, { activeProfileId: id }); return { ok: true }; });
    await svc.switchTo('p2');
    expect(dispatched.filter((a) => a.type === clearSessions.type).length).toBe(1);
    expect(svc.activeProfileId()).toBe('p2');
  });

  it('does not delete the active profile when switching away from it failed', async () => {
    const svc = await setup(async () => { throw new Error('busy'); });
    expect(await svc.deleteProfile('p1')).toBeFalse();
    expect(deleted).toEqual([]);
  });

  it('reports a refused switch instead of pretending it happened', async () => {
    const svc = await setup(async () => ({ ok: false }));
    expect(await svc.switchTo('p2')).toBeFalse();
    expect(svc.activeProfileId()).toBe('p1');
    expect(await svc.switchTo('p1')).toBeTrue();
  });
});
