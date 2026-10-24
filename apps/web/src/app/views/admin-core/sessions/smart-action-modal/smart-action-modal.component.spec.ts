import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { SmartActionModalComponent } from './smart-action-modal.component';

function enterOn(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

function button(cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  return b;
}

describe('SmartActionModalComponent Enter handling', () => {
  let modal: jasmine.SpyObj<NgbActiveModal>;
  let component: SmartActionModalComponent;

  beforeEach(() => {
    modal = jasmine.createSpyObj('modal', ['close', 'dismiss']);
    component = new SmartActionModalComponent(modal);
    component.command = 'npm run deploy';
  });

  it('runs the command when Enter is pressed outside any button', () => {
    const event = enterOn(document.createElement('div'));
    component.onEnter(event);
    expect(modal.close).toHaveBeenCalledWith({ action: 'terminal', command: 'npm run deploy' });
    expect(event.defaultPrevented).toBeTrue();
  });

  it('runs the command when Enter is pressed on the primary button', () => {
    component.onEnter(enterOn(button('btn btn-sm btn-warning sa-primary')));
    expect(modal.close).toHaveBeenCalledWith({ action: 'terminal', command: 'npm run deploy' });
  });

  it('does not run the command when Enter is pressed on Cancel', () => {
    const event = enterOn(button('btn btn-sm btn-ghost'));
    component.onEnter(event);
    expect(modal.close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBeFalse();
  });

  it('does not run the command when Enter is pressed on "Use AI anyway" or the close button', () => {
    component.onEnter(enterOn(button('btn btn-sm btn-outline-secondary')));
    component.onEnter(enterOn(button('btn-close')));
    expect(modal.close).not.toHaveBeenCalled();
  });

  it('runs the selected folder alternative when Enter is pressed on a folder option', () => {
    component.alternatives = [
      { folderName: 'a', fullCommand: 'cd a && npm run deploy' } as any,
      { folderName: 'b', fullCommand: 'cd b && npm run deploy' } as any,
    ];
    component.selectedAlternativeIndex = 1;
    component.onEnter(enterOn(button('folder-option')));
    expect(modal.close).toHaveBeenCalledWith({ action: 'terminal', command: 'cd b && npm run deploy' });
  });
});
