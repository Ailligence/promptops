import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';
import { TitleService } from './title.service';

describe('TitleService', () => {
  it('uses the PAGE_TITLE translation when there is one, the route title otherwise', () => {
    TestBed.configureTestingModule({ imports: [TranslateModule.forRoot()], providers: [provideRouter([])] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('it', { PAGE_TITLE: { Sessions: 'Sessioni' } });
    translate.use('it');
    const svc = TestBed.inject(TitleService);
    expect(svc.titleFor('Sessions')).toBe('Sessioni | PromptOps');
    expect(svc.titleFor('Unknown page')).toBe('Unknown page | PromptOps');
  });
});
