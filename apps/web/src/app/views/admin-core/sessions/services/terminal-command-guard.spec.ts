import { TerminalCommandGuard } from './terminal-command-guard';

describe('TerminalCommandGuard', () => {
  let guard: TerminalCommandGuard;

  beforeEach(() => {
    guard = new TerminalCommandGuard();
  });

  it('intercepts a typed shell command on Enter', () => {
    const chars = 'npm run deploy:test'.split('');
    let lastResult;
    for (const c of chars) {
      lastResult = guard.processOutbound(c);
      expect(lastResult.intercept).toBeUndefined();
      expect(lastResult.forward).toBe(c);
    }
    const enterResult = guard.processOutbound('\r');
    expect(enterResult.forward).toBe('');
    expect(enterResult.intercept).toEqual({
      command: 'npm run deploy:test',
      isPaste: false,
    });
  });

  it('resets typing buffer on backspace', () => {
    for (const c of 'npm') guard.processOutbound(c);
    guard.processOutbound('\x7f'); // Backspace
    for (const c of 'ciao') guard.processOutbound(c);
    const r = guard.processOutbound('\r');
    expect(r.intercept).toBeUndefined();
    expect(r.forward).toBe('\r');
  });

  it('resets typing buffer on Esc and arrow keys', () => {
    for (const c of 'npm') guard.processOutbound(c);
    guard.processOutbound('\x1b[A'); // Up arrow
    for (const c of 'foo') guard.processOutbound(c);
    const r = guard.processOutbound('\r');
    expect(r.intercept).toBeUndefined();
  });

  it('does not start buffering for non-shell first char', () => {
    for (const c of 'ciao come stai') guard.processOutbound(c);
    const r = guard.processOutbound('\r');
    expect(r.intercept).toBeUndefined();
    expect(r.forward).toBe('\r');
  });

  it('intercepts a bracketed-paste single-line shell command', () => {
    const r = guard.processOutbound('\x1b[200~npm run build\x1b[201~');
    expect(r.forward).toBe('');
    expect(r.intercept).toEqual({ command: 'npm run build', isPaste: true });
  });

  it('does NOT intercept a multiline paste', () => {
    const r = guard.processOutbound('\x1b[200~npm run build\nrm -rf node_modules\x1b[201~');
    expect(r.intercept).toBeUndefined();
    // Forward should preserve the original paste so the PTY sees it intact.
    expect(r.forward).toBe('\x1b[200~npm run build\nrm -rf node_modules\x1b[201~');
  });

  it('does NOT intercept a paste that is not a shell command', () => {
    const r = guard.processOutbound('\x1b[200~ciao mondo\x1b[201~');
    expect(r.intercept).toBeUndefined();
    expect(r.forward).toBe('\x1b[200~ciao mondo\x1b[201~');
  });
});
