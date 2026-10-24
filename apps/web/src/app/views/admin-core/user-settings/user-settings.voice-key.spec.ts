import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { UiPreferencesService } from '@core/services/ui-preferences.service';
import { SwalService } from '@core/services/swal.service';
import { ClaudeHookService } from '@/app/views/admin-core/sessions/services/claude-hook.service';
import { SessionService } from '@/app/views/admin-core/sessions/services/session.service';
import { UserSettingsComponent } from './user-settings.component';

/** voice_set_api_key answers {ok:false} when the key could not be stored: it must not look saved. */
describe('UserSettingsComponent voice key', () => {
  let setVoiceApiKey: jasmine.Spy;

  beforeEach(() => {
    jasmine.clock().install();
    setVoiceApiKey = jasmine.createSpy('setVoiceApiKey');
    (window as any).promptops = { setVoiceApiKey, getVoiceApiKey: async () => ({ masked: null, source: null }) };
    const stub = {} as any;
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { select: () => of(null), dispatch: () => {} } },
        { provide: TranslateService, useValue: { instant: (k: string, p?: any) => (p?.error ? `${k}:${p.error}` : k) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } }, queryParamMap: of({ get: () => null }) } },
        ...[UiPreferencesService, SwalService, ClaudeHookService, SessionService, Router, NgbModal].map((provide) => ({ provide, useValue: stub })),
      ],
    });
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    delete (window as any).promptops;
  });

  it('shows the store error and keeps the typed key when saving failed', async () => {
    setVoiceApiKey.and.resolveTo({ ok: false, error: 'disk full' });
    const c: any = TestBed.runInInjectionContext(() => new UserSettingsComponent());
    c.voiceApiKey = 'gsk_test';
    await c.saveVoiceKey();
    expect(c.voiceFeedbackKind()).toBe('err');
    expect(c.voiceFeedback()).toBe('SETTINGS.Voice Key Save Failed:disk full');
    expect(c.voiceApiKey).toBe('gsk_test');
  });

  it('says saved only when the store accepted the key', async () => {
    setVoiceApiKey.and.resolveTo({ ok: true });
    const c: any = TestBed.runInInjectionContext(() => new UserSettingsComponent());
    c.voiceApiKey = 'gsk_test';
    await c.saveVoiceKey();
    expect(c.voiceFeedbackKind()).toBe('ok');
    expect(c.voiceApiKey).toBe('');
  });
});
