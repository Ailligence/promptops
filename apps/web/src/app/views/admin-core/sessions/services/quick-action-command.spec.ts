import { commandActionNotes, readCommandAction } from './quick-action-command';

describe('quick action command persistence', () => {
  it('preserves the exact source directory without interpolating shell characters', () => {
    const directory = "/Users/me/Client's app/$(example)/project";
    expect(readCommandAction(commandActionNotes(directory))).toEqual({ version: 1, kind: 'command', directory });
  });

  it('keeps ordinary prompts on the AI path', () => {
    for (const notes of [undefined, '', 'Human notes', '{invalid', '{"other":true}', 'null']) {
      expect(readCommandAction(notes)).toBeNull();
    }
  });

  it('rejects incomplete or unsupported command metadata instead of executing it as a prompt', () => {
    for (const action of [null, { version: 2, kind: 'command', directory: '/tmp' }, { version: 1, kind: 'command', directory: '' }]) {
      expect(() => readCommandAction(JSON.stringify({ promptopsQuickAction: action }))).toThrow();
    }
    expect(() => commandActionNotes(' ')).toThrow();
  });
});
