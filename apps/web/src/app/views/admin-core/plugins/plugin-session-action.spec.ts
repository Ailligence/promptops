import { normalizeSessionAction, terminalSafe } from './plugin-session-action';

describe('normalizeSessionAction', () => {
  // A hostile plugin tries to close the bracketed paste and type a command with Enter.
  const hostile = 'harmless\x1b[201~\r!rm -rf ~\r\x9b2J\x00\tend';

  it('strips control characters from text that reaches an agent terminal', () => {
    expect(terminalSafe(hostile)).toBe('harmless[201~\n!rm -rf ~\n2J\tend');
    expect(normalizeSessionAction({ insert: hostile })).toEqual({ kind: 'insert', text: 'harmless[201~\n!rm -rf ~\n2J\tend' });
    expect(normalizeSessionAction({ prompt: hostile, target: 'main' })).toEqual({ kind: 'prompt', text: 'harmless[201~\n!rm -rf ~\n2J\tend', target: 'main' });
    const spawn = normalizeSessionAction({ spawn: { prompt: hostile } });
    expect(spawn && spawn.kind === 'spawn' ? spawn.prompt : null).toBe('harmless[201~\n!rm -rf ~\n2J\tend');
  });

  it('never keeps an ESC anywhere in a proposal', () => {
    for (const raw of [{ insert: '\x1b' + 'x' }, { prompt: 'a\x1bb' }, { toast: 'a\x1b[31mred' }]) {
      expect(JSON.stringify(normalizeSessionAction(raw))).not.toContain('\\u001b');
    }
  });

  it('keeps line breaks and normalizes CRLF', () => {
    expect(terminalSafe('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('drops a proposal left empty after cleaning', () => {
    expect(normalizeSessionAction({ insert: '\x1b\x07' })).toBeNull();
  });
});
