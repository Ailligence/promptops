import { isOpenableTerminalLink, joinWrappedUrl, openTerminalLink } from './terminal-link-handler';

describe('terminal links', () => {
  it('opens only http(s) and mailto links printed by a program', () => {
    expect(isOpenableTerminalLink('https://example.com/a')).toBeTrue();
    expect(isOpenableTerminalLink('HTTP://example.com')).toBeTrue();
    expect(isOpenableTerminalLink('mailto:a@b.c')).toBeTrue();
    expect(isOpenableTerminalLink('javascript:alert(1)')).toBeFalse();
    expect(isOpenableTerminalLink('file:///etc/passwd')).toBeFalse();
    expect(isOpenableTerminalLink('/admin/settings')).toBeFalse();
  });

  it('does not call window.open for a refused link', () => {
    const open = spyOn(window, 'open');
    openTerminalLink(new MouseEvent('click'), 'javascript:alert(1)');
    expect(open).not.toHaveBeenCalled();
    openTerminalLink(new MouseEvent('click'), 'https://example.com');
    expect(open).toHaveBeenCalledOnceWith('https://example.com', '_blank', 'noopener,noreferrer');
  });

  it('joins a URL wrapped over several lines and leaves other text alone', () => {
    expect(joinWrappedUrl('https://exa\nmple.com/x')).toBe('https://example.com/x');
    expect(joinWrappedUrl('hello\nworld')).toBe('hello\nworld');
  });
});
