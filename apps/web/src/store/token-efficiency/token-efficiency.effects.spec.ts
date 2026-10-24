import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { TokenEfficiencyEffects } from './token-efficiency.effects';
import { probeProviderUsage } from './token-efficiency.actions';
import { TokenEfficiencyApiService } from '../../app/views/admin-core/sessions/services/token-efficiency-api.service';
import { SessionService } from '../../app/views/admin-core/sessions/services/session.service';

describe('TokenEfficiencyEffects probeProviderUsage$', () => {
  let actions$: Subject<any>;
  let probe: jasmine.Spy;
  let saved: any;

  beforeEach(() => {
    saved = (window as any).promptops;
    probe = jasmine.createSpy('probeProviderUsage').and.returnValue(Promise.resolve(null));
    (window as any).promptops = { probeProviderUsage: probe };
    actions$ = new Subject<any>();
    TestBed.configureTestingModule({
      providers: [
        TokenEfficiencyEffects,
        { provide: Actions, useValue: new Actions(actions$) },
        { provide: Store, useValue: { dispatch: () => {} } },
        { provide: TokenEfficiencyApiService, useValue: {} },
        { provide: SessionService, useValue: { isDesktop: true, onTokenUsageUpdated: () => () => {} } },
      ],
    });
  });

  afterEach(() => {
    (window as any).promptops = saved;
  });

  it('launches the provider CLI only for an explicit refresh', () => {
    const effects = TestBed.inject(TokenEfficiencyEffects);
    const sub = effects.probeProviderUsage$.subscribe();
    actions$.next(probeProviderUsage({ sessionId: 's1', provider: 'claude' }));
    expect(probe).toHaveBeenCalledWith('s1', 'claude', false);
    actions$.next(probeProviderUsage({ sessionId: 's1', provider: 'claude', userInitiated: true }));
    expect(probe).toHaveBeenCalledWith('s1', 'claude', true);
    sub.unsubscribe();
  });
});
