import { DISMISSED_MAINS_KEY, readDismissedMains, writeDismissedMains } from './dismissed-mains';

describe('dismissed mains storage', () => {
  afterEach(() => localStorage.removeItem(DISMISSED_MAINS_KEY));

  it('round-trips the list', () => {
    writeDismissedMains(new Set(['a', 'b']));
    expect(readDismissedMains()).toEqual(['a', 'b']);
  });

  it('survives a corrupt or wrong-shaped value instead of throwing', () => {
    localStorage.setItem(DISMISSED_MAINS_KEY, '{not json');
    expect(readDismissedMains()).toEqual([]);
    localStorage.setItem(DISMISSED_MAINS_KEY, '{"a":1}');
    expect(readDismissedMains()).toEqual([]);
    localStorage.setItem(DISMISSED_MAINS_KEY, '["ok", 3, null]');
    expect(readDismissedMains()).toEqual(['ok']);
  });
});
