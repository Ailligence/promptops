import { SessionHeaderComponent } from './session-header.component';

/**
 * Enter inside the breadcrumb navigator popover: it must only mean "Go" when
 * the popover itself has focus. On a folder/session button the button's own
 * click must run alone, otherwise Enter jumps to the previously selected
 * session before the focused one is picked.
 */
describe('SessionHeaderComponent.onCrumbNavEnter', () => {
  function setup() {
    const popover = document.createElement('div');
    popover.tabIndex = -1;
    const folderBtn = document.createElement('button');
    const icon = document.createElement('span');
    folderBtn.appendChild(icon);
    popover.appendChild(folderBtn);
    document.body.appendChild(popover);
    const ctx = { goCrumbSession: jasmine.createSpy('goCrumbSession') };
    const fire = (target: HTMLElement) => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      popover.addEventListener('keydown', (e) => SessionHeaderComponent.prototype.onCrumbNavEnter.call(ctx, e), { once: true });
      target.dispatchEvent(ev);
      return ev;
    };
    return { popover, folderBtn, icon, ctx, fire, cleanup: () => popover.remove() };
  }

  it('goes to the selected session when Enter is pressed on the popover itself', () => {
    const t = setup();
    const ev = t.fire(t.popover);
    expect(t.ctx.goCrumbSession).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBeTrue();
    t.cleanup();
  });

  it('leaves Enter on a folder/session button to the button (no navigation)', () => {
    const t = setup();
    const ev = t.fire(t.folderBtn);
    expect(t.ctx.goCrumbSession).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBeFalse();
    t.cleanup();
  });

  it('also ignores Enter coming from an element inside a button', () => {
    const t = setup();
    t.fire(t.icon);
    expect(t.ctx.goCrumbSession).not.toHaveBeenCalled();
    t.cleanup();
  });
});
