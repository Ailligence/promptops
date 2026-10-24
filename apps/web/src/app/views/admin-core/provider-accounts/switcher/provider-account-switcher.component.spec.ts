import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ProviderAccountsService } from '../services/provider-accounts.service';
import { ProviderAccountSwitcherComponent } from './provider-account-switcher.component';

/** The tooltip and the support badge follow a live language switch. */
describe('ProviderAccountSwitcherComponent language switch', () => {
  it('re-translates the tooltip and the support badge', () => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), ProviderAccountSwitcherComponent],
      providers: [
        { provide: NgbModal, useValue: {} },
        {
          provide: ProviderAccountsService,
          useValue: {
            init: async () => {},
            accountsFor: () => [],
            activeFor: () => null,
            capabilityFor: () => ({ support: 'native' }),
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      PROVIDER_ACCOUNTS: { SWITCHER: { Native: 'Native', 'Tip inherit': '{{provider}}: standard account' } },
    });
    translate.setTranslation('it', {
      PROVIDER_ACCOUNTS: { SWITCHER: { Native: 'Nativo', 'Tip inherit': '{{provider}}: account standard' } },
    });
    translate.use('en');

    const fixture = TestBed.createComponent(ProviderAccountSwitcherComponent);
    fixture.componentRef.setInput('provider', 'codex');
    const cmp = fixture.componentInstance;
    expect(cmp.supportLabel()?.label).toBe('Native');
    expect(cmp.tooltip()).toContain('standard account');

    translate.use('it');
    expect(cmp.supportLabel()?.label).toBe('Nativo');
    expect(cmp.tooltip()).toContain('account standard');
  });
});
