import { Terminal } from '@xterm/xterm';
import { captureExpandedSubAgentEscape } from './expanded-sub-agent-escape';

describe('expanded sub-agent Escape with a focused terminal', () => {
  let terminal: Terminal;
  let container: HTMLDivElement;
  let expanded: boolean;
  let close: jasmine.Spy;
  let writeToPty: jasmine.Spy;
  let cleanup: () => void;

  function key(type: string, repeat = false, name = 'Escape'): KeyboardEvent {
    const event = new KeyboardEvent(type, {
      key: name, keyCode: name === 'Escape' ? 27 : 13,
      bubbles: true, cancelable: true, repeat,
    });
    terminal.textarea!.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    terminal = new Terminal();
    terminal.open(container);
    terminal.focus();
    writeToPty = jasmine.createSpy('writeToPty');
    terminal.onData(writeToPty);
    expanded = true;
    close = jasmine.createSpy('close').and.callFake(() => { expanded = false; });
    cleanup = captureExpandedSubAgentEscape(() => expanded, close);
  });

  afterEach(() => {
    cleanup();
    terminal.dispose();
    container.remove();
    document.querySelectorAll('ngb-modal-window').forEach(el => el.remove());
  });

  it('closes the expanded pane before Escape reaches the focused xterm or document handlers', () => {
    const bubbling = jasmine.createSpy('document keydown');
    document.addEventListener('keydown', bubbling);
    try {
      expect(key('keydown').defaultPrevented).toBeTrue();
      expect(close).toHaveBeenCalledTimes(1);
      expect(writeToPty).not.toHaveBeenCalled();
      expect(bubbling).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', bubbling);
    }
  });

  it('consumes repeats and release after collapse, then allows a new Escape through', () => {
    key('keydown');
    key('keydown', true);
    key('keydown', true);
    key('keyup');
    expect(close).toHaveBeenCalledTimes(1);
    expect(writeToPty).not.toHaveBeenCalled();
    key('keydown');
    expect(writeToPty).toHaveBeenCalledWith('\x1b');
  });

  it('preserves normal terminal Escape when no pane is expanded', () => {
    expanded = false;
    key('keydown');
    expect(close).not.toHaveBeenCalled();
    expect(writeToPty).toHaveBeenCalledWith('\x1b');
  });

  it('leaves other terminal keys alone', () => {
    key('keydown', false, 'Enter');
    expect(close).not.toHaveBeenCalled();
    expect(writeToPty).toHaveBeenCalledWith('\r');
  });

  it('gives a Bootstrap modal precedence', () => {
    document.body.appendChild(document.createElement('ngb-modal-window'));
    key('keydown');
    expect(close).not.toHaveBeenCalled();
  });

  it('resets the held key when the window loses focus', () => {
    key('keydown');
    window.dispatchEvent(new Event('blur'));
    key('keydown');
    expect(writeToPty).toHaveBeenCalledWith('\x1b');
  });

  it('removes interception when the view is destroyed', () => {
    cleanup();
    key('keydown');
    expect(close).not.toHaveBeenCalled();
    expect(writeToPty).toHaveBeenCalledWith('\x1b');
  });
});
