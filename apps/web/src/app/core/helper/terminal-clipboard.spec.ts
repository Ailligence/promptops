import { decideTerminalClipboardAction } from './terminal-clipboard';

/**
 * Decision matrix for terminal keyboard → clipboard mapping.
 *
 * Pure function, so no TestBed / zone.js: we feed real KeyboardEvent instances
 * and assert the action. This pins the Windows/Linux "plain Ctrl+C copies only
 * when there is a selection, else SIGINT (null)" convention and guarantees macOS
 * stays untouched — without needing a real terminal or a Windows box.
 */
describe('decideTerminalClipboardAction', () => {
  const sel = () => true;   // there is a selection
  const noSel = () => false; // no selection

  function key(init: KeyboardEventInit): KeyboardEvent {
    return new KeyboardEvent('keydown', init);
  }

  describe('cross-platform explicit shortcuts (any platform)', () => {
    for (const platform of ['win32', 'linux', 'darwin', undefined]) {
      it(`Ctrl/Cmd+Shift+C → copy · Ctrl/Cmd+Shift+V → paste (platform=${platform})`, () => {
        expect(decideTerminalClipboardAction(key({ ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C' }), platform, noSel)).toBe('copy');
        expect(decideTerminalClipboardAction(key({ metaKey: true, shiftKey: true, code: 'KeyC', key: 'C' }), platform, noSel)).toBe('copy');
        expect(decideTerminalClipboardAction(key({ ctrlKey: true, shiftKey: true, code: 'KeyV', key: 'V' }), platform, noSel)).toBe('paste');
        expect(decideTerminalClipboardAction(key({ metaKey: true, shiftKey: true, code: 'KeyV', key: 'V' }), platform, noSel)).toBe('paste');
      });

      it(`Ctrl+Insert → copy · Shift+Insert → paste (platform=${platform})`, () => {
        expect(decideTerminalClipboardAction(key({ ctrlKey: true, key: 'Insert' }), platform, noSel)).toBe('copy');
        expect(decideTerminalClipboardAction(key({ shiftKey: true, key: 'Insert' }), platform, noSel)).toBe('paste');
      });
    }
  });

  describe('Windows / Linux plain Ctrl+C / Ctrl+V', () => {
    for (const platform of ['win32', 'linux']) {
      it(`Ctrl+C copies only with a selection, else null=SIGINT (platform=${platform})`, () => {
        expect(decideTerminalClipboardAction(key({ ctrlKey: true, code: 'KeyC', key: 'c' }), platform, sel)).toBe('copy');
        expect(decideTerminalClipboardAction(key({ ctrlKey: true, code: 'KeyC', key: 'c' }), platform, noSel)).toBeNull();
      });

      it(`Ctrl+V always pastes (platform=${platform})`, () => {
        expect(decideTerminalClipboardAction(key({ ctrlKey: true, code: 'KeyV', key: 'v' }), platform, noSel)).toBe('paste');
      });

      it(`AltGr combos (ctrl+alt) are not hijacked (platform=${platform})`, () => {
        expect(decideTerminalClipboardAction(key({ ctrlKey: true, altKey: true, code: 'KeyC', key: 'c' }), platform, sel)).toBeNull();
        expect(decideTerminalClipboardAction(key({ ctrlKey: true, altKey: true, code: 'KeyV', key: 'v' }), platform, noSel)).toBeNull();
      });

      it(`Win-key (metaKey) + C/V is not hijacked (platform=${platform})`, () => {
        expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyC', key: 'c' }), platform, sel)).toBeNull();
        expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyV', key: 'v' }), platform, noSel)).toBeNull();
      });
    }
  });

  describe('macOS keeps plain Ctrl untouched (SIGINT / raw) and Cmd to the app menu', () => {
    it('plain Ctrl+C / Ctrl+V → null', () => {
      expect(decideTerminalClipboardAction(key({ ctrlKey: true, code: 'KeyC', key: 'c' }), 'darwin', sel)).toBeNull();
      expect(decideTerminalClipboardAction(key({ ctrlKey: true, code: 'KeyV', key: 'v' }), 'darwin', noSel)).toBeNull();
    });

    it('plain Cmd+C / Cmd+V → null (handled by the app menu, not us)', () => {
      expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyC', key: 'c' }), 'darwin', sel)).toBeNull();
      expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyV', key: 'v' }), 'darwin', noSel)).toBeNull();
    });
  });

  describe('metaClipboard (Tauri/WKWebView)', () => {
    it('plain Cmd+C copies only with a selection, Cmd+V pastes', () => {
      expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyC', key: 'c' }), 'darwin', sel, true)).toBe('copy');
      expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyC', key: 'c' }), 'darwin', noSel, true)).toBeNull();
      expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyV', key: 'v' }), 'darwin', noSel, true)).toBe('paste');
    });

    it('stays off by default (default path unchanged)', () => {
      expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyC', key: 'c' }), 'darwin', sel)).toBeNull();
      expect(decideTerminalClipboardAction(key({ metaKey: true, code: 'KeyV', key: 'v' }), 'darwin', noSel)).toBeNull();
    });

    it('does not fire with extra modifiers (Cmd+Alt+V, Cmd+Ctrl+C)', () => {
      expect(decideTerminalClipboardAction(key({ metaKey: true, altKey: true, code: 'KeyV', key: 'v' }), 'darwin', noSel, true)).toBeNull();
      expect(decideTerminalClipboardAction(key({ metaKey: true, ctrlKey: true, code: 'KeyC', key: 'c' }), 'darwin', sel, true)).toBeNull();
    });
  });

  describe('unrelated keys fall through', () => {
    it('plain letters and non-clipboard combos → null', () => {
      expect(decideTerminalClipboardAction(key({ code: 'KeyA', key: 'a' }), 'win32', sel)).toBeNull();
      expect(decideTerminalClipboardAction(key({ ctrlKey: true, code: 'KeyA', key: 'a' }), 'win32', sel)).toBeNull();
    });

    it('ignores repeat/keyup is caller responsibility — this fn assumes keydown', () => {
      // Sanity: the function itself does not inspect ev.type, callers gate on keydown.
      expect(decideTerminalClipboardAction(key({ ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C' }), 'win32', noSel)).toBe('copy');
    });
  });

  describe('hasSelection is evaluated lazily', () => {
    it('is NOT called for paste or explicit shortcuts, only for the plain Ctrl+C branch', () => {
      const spy = jasmine.createSpy('hasSelection').and.returnValue(true);

      decideTerminalClipboardAction(key({ ctrlKey: true, code: 'KeyV', key: 'v' }), 'win32', spy);
      decideTerminalClipboardAction(key({ ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C' }), 'win32', spy);
      decideTerminalClipboardAction(key({ ctrlKey: true, key: 'Insert' }), 'win32', spy);
      expect(spy).not.toHaveBeenCalled();

      decideTerminalClipboardAction(key({ ctrlKey: true, code: 'KeyC', key: 'c' }), 'win32', spy);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
