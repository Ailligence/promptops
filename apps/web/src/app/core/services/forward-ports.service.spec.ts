import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ForwardPortsService, forwardedPortUrl, sanitizeForwardedPort } from './forward-ports.service';

describe('ForwardPortsService stored rows', () => {
  const good = { port: 3000, host: 'localhost', localPort: 3000, origin: 'user', visibility: 'private', protocol: 'http', tunneled: false };

  it('keeps well-formed rows and drops tampered ones', () => {
    expect(sanitizeForwardedPort(good)).toEqual(good as any);
    expect(sanitizeForwardedPort({ ...good, port: 70000 })).toBeNull();
    expect(sanitizeForwardedPort({ ...good, host: 'evil.com/x?' })).toBeNull();
    expect(sanitizeForwardedPort({ ...good, protocol: 'javascript' })!.protocol).toBe('http');
    expect(sanitizeForwardedPort({ ...good, localPort: '1@evil.com' as any })!.localPort).toBe(3000);
  });

  it('builds browser URLs only from a known protocol and a valid port', () => {
    expect(forwardedPortUrl({ protocol: 'https', localPort: 8443 })).toBe('https://localhost:8443');
    expect(forwardedPortUrl({ protocol: 'file' as any, localPort: 80 })).toBeNull();
    expect(forwardedPortUrl({ protocol: 'http', localPort: '80@evil.com' as any })).toBeNull();
  });

  it('never opens a URL built from a malformed row', async () => {
    const devLinksOpen = jasmine.createSpy('devLinksOpen').and.resolveTo(undefined);
    (window as any).promptops = { devLinksOpen };
    TestBed.configureTestingModule({ imports: [TranslateModule.forRoot()] });
    const svc = TestBed.inject(ForwardPortsService);
    await svc.openInBrowser({ ...good, protocol: 'javascript', localPort: 1, address: '' } as any);
    expect(devLinksOpen).not.toHaveBeenCalled();
    await svc.openInBrowser({ ...good, address: '' } as any);
    expect(devLinksOpen).toHaveBeenCalledWith('http://localhost:3000');
    delete (window as any).promptops;
  });

  it('reads only valid rows back from localStorage', () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('po.forwardPorts.v1');
      localStorage.setItem('po.forwardPorts.v1', JSON.stringify({
        '/w': { ports: [good, { ...good, port: 'x' }], ignored: [5000, -1, 'a'] },
        '/bad': 'nope',
      }));
      TestBed.configureTestingModule({ imports: [TranslateModule.forRoot()] });
      const svc: any = TestBed.inject(ForwardPortsService);
      const store = svc.store();
      expect(store['/w'].ports.length).toBe(1);
      expect(store['/w'].ignored).toEqual([5000]);
      expect(store['/bad']).toBeUndefined();
    } finally {
      if (saved === null) localStorage.removeItem('po.forwardPorts.v1');
      else localStorage.setItem('po.forwardPorts.v1', saved);
    }
  });
});
