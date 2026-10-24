import { DevLinksService, isLocalDevUrl } from './dev-links.service';

describe('DevLinksService AI links', () => {
  it('accepts only dev servers on this machine', () => {
    expect(isLocalDevUrl('http://localhost:4200')).toBeTrue();
    expect(isLocalDevUrl('https://127.0.0.1:8443/docs')).toBeTrue();
    expect(isLocalDevUrl('http://[::1]:3000')).toBeTrue();
    expect(isLocalDevUrl('http://app.localhost:5173')).toBeTrue();
    expect(isLocalDevUrl('https://example.com')).toBeFalse();
    expect(isLocalDevUrl('http://localhost.example.com')).toBeFalse();
    expect(isLocalDevUrl('http://user:pw@localhost:3000')).toBeFalse();
    expect(isLocalDevUrl('javascript:alert(1)')).toBeFalse();
    expect(isLocalDevUrl('file:///etc/passwd')).toBeFalse();
  });

  it('drops links a repository steered off this machine', async () => {
    const service = new DevLinksService();
    (window as any).promptops = {
      aiGenerateText: async () => ({
        ok: true,
        text: '```json\n[{"label":"App","url":"http://localhost:4200"},{"label":"Docs","url":"https://evil.example/phish"}]\n```',
      }),
    };
    try {
      const links = await service.generateAiLinks('claude-code-cli', '/tmp/p', '');
      expect(links.map((l) => l.url)).toEqual(['http://localhost:4200']);
    } finally {
      delete (window as any).promptops;
    }
  });
});
