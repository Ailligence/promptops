import { quoteArg, withRenameSources } from './session-git-explorer.component';

describe('git explorer helpers', () => {
  it('quotes discard paths as single words with no shell meaning', () => {
    expect(quoteArg('sp ace.txt')).toBe(`'sp ace.txt'`);
    expect(quoteArg(`single'q.txt`)).toBe(`'single'"'"'q.txt'`);
    expect(quoteArg('dollar$(touch X).txt')).toBe(`'dollar$(touch X).txt'`);
  });

  it('unstages the source of a staged rename too', () => {
    expect(withRenameSources([{ path: 'new.txt', origPath: 'old.txt' }, { path: 'a.txt' }])).toEqual(['new.txt', 'old.txt', 'a.txt']);
    expect(withRenameSources([], 'x.txt')).toEqual(['x.txt']);
  });
});
