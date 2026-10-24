import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ForwardPortsService, PortRow } from '../../../../core/services/forward-ports.service';
import { ForwardPortsPanelComponent, previewUrl } from './forward-ports-panel.component';

function row(partial: Partial<PortRow>): PortRow {
  return {
    port: 3000, host: 'localhost', localPort: 3000, origin: 'user',
    visibility: 'private', protocol: 'http', tunneled: false, address: 'localhost:3000',
    ...partial,
  } as PortRow;
}

describe('previewUrl', () => {
  it('builds http(s) localhost URLs from a valid row', () => {
    expect(previewUrl(row({}))).toBe('http://localhost:3000');
    expect(previewUrl(row({ protocol: 'https', localPort: 8443 }))).toBe('https://localhost:8443');
  });

  it('rejects any other scheme or a non numeric / out of range port', () => {
    expect(previewUrl(row({ protocol: 'javascript' as any }))).toBeNull();
    expect(previewUrl(row({ protocol: 'file' as any }))).toBeNull();
    expect(previewUrl(row({ localPort: '3000@evil.com' as any }))).toBeNull();
    expect(previewUrl(row({ localPort: 0 }))).toBeNull();
    expect(previewUrl(row({ localPort: 70000 }))).toBeNull();
    expect(previewUrl(row({ localPort: 1.5 }))).toBeNull();
  });
});

describe('ForwardPortsPanelComponent', () => {
  let component: ForwardPortsPanelComponent;

  beforeEach(() => {
    const stub = {
      attach: jasmine.createSpy('attach'),
      detach: jasmine.createSpy('detach'),
      workspace: signal<string | null>(null),
      provider: signal<string | null>(null),
      addRequests: signal(0),
      lastAutoForwarded: signal<PortRow | null>(null),
      rows: signal<PortRow[]>([]),
      aiSuggestions: signal([]),
      listening: signal([]),
      url: (r: PortRow) => `${r.protocol}://localhost:${r.localPort}`,
    };
    TestBed.configureTestingModule({
      imports: [ForwardPortsPanelComponent, TranslateModule.forRoot()],
      providers: [{ provide: ForwardPortsService, useValue: stub }],
    });
    component = TestBed.createComponent(ForwardPortsPanelComponent).componentInstance;
  });

  it('opens the preview only for a validated localhost URL', () => {
    component.openPreview(row({ protocol: 'javascript' as any }));
    expect(component.preview()).toBeNull();

    component.openPreview(row({ localPort: 5173 }));
    expect(component.preview()?.url).toBe('http://localhost:5173');
  });

  it('does not leak a rejected clipboard write', async () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    const spy = spyOn(clipboard, 'writeText').and.returnValue(Promise.reject(new Error('denied')));
    const unhandled = jasmine.createSpy('unhandled');
    window.addEventListener('unhandledrejection', unhandled);
    component.copy(row({}));
    component.copyText('npm run dev');
    await new Promise(r => setTimeout(r, 0));
    window.removeEventListener('unhandledrejection', unhandled);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
