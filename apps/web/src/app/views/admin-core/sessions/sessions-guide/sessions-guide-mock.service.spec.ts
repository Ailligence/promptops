import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { SessionsGuideMockService, escapeHtml } from './sessions-guide-mock.service';

describe('SessionsGuideMockService markup', () => {
  const EVIL = '<img src=x onerror="window.__sgPwned=1">';
  let translations: Record<string, string>;
  let service: SessionsGuideMockService;

  beforeEach(() => {
    translations = {};
    TestBed.configureTestingModule({ providers: [
      { provide: TranslateService, useValue: { instant: (k: string) => translations[k] ?? k } },
    ] });
    service = TestBed.inject(SessionsGuideMockService);
  });

  afterEach(() => {
    service.cleanup();
    delete (window as any).__sgPwned;
  });

  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('renders the visible strings from translations', () => {
    translations['SESSIONS.New workspace'] = 'Nuovo workspace';
    translations['SESSIONS_GUIDE.mock.Code Review'] = 'Revue de code';
    const html = service.html();
    expect(html).toContain('Nuovo workspace');
    expect(html).toContain('Revue de code');
    expect(html).not.toContain('No workspace yet');
  });

  it('never injects markup coming from a translation', () => {
    for (const key of [
      'SESSIONS_GUIDE.mock.Empty', 'SESSIONS.New workspace', 'SESSIONS_GUIDE.mock.Running',
      'SESSIONS_GUIDE.mock.Placeholder', 'SESSIONS_GUIDE.mock.File Search', 'SESSIONS.Spawn',
    ]) translations[key] = EVIL;
    const host = document.createElement('div');
    host.innerHTML = service.html();
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x');
    expect(host.querySelector<HTMLTextAreaElement>('.sg-mock-input')!.placeholder).toBe(EVIL);
    expect((window as any).__sgPwned).toBeUndefined();
  });
});
