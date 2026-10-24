import { isImeComposing } from './action-center.component';

describe('action-center Enter handling', () => {
  it('treats Enter during IME composition as the IME\'s, not a spawn/commit', () => {
    expect(isImeComposing(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).toBeTrue();
    expect(isImeComposing(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 } as KeyboardEventInit))).toBeTrue();
    expect(isImeComposing(new KeyboardEvent('keydown', { key: 'Enter' }))).toBeFalse();
  });
});
