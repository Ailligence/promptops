import { signal } from '@angular/core';
import { QuickCreatePromptModalComponent } from './quick-create-prompt-modal.component';

/** Plain-class tests: Enter in the name field and draft persistence. */
describe('QuickCreatePromptModalComponent', () => {
  const proto = QuickCreatePromptModalComponent.prototype;

  function ctx(over: Partial<{ title: string; body: string; saving: boolean }> = {}) {
    return {
      title: over.title ?? 'Deploy',
      body: over.body ?? 'run the deploy',
      saving: signal(over.saving ?? false),
      save: jasmine.createSpy('save').and.resolveTo(),
    };
  }

  function enter(isComposing = false): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, isComposing });
  }

  describe('onTitleEnter', () => {
    it('saves when name and instructions are filled', () => {
      const c = ctx();
      const ev = enter();
      proto.onTitleEnter.call(c, ev);
      expect(c.save).toHaveBeenCalledTimes(1);
      expect(ev.defaultPrevented).toBeTrue();
    });

    it('does nothing while the primary button is disabled (missing instructions)', () => {
      const c = ctx({ body: '  ' });
      proto.onTitleEnter.call(c, enter());
      expect(c.save).not.toHaveBeenCalled();
    });

    it('does not save twice while a save is in flight', () => {
      const c = ctx({ saving: true });
      proto.onTitleEnter.call(c, enter());
      expect(c.save).not.toHaveBeenCalled();
    });

    it('ignores Enter that confirms an IME composition', () => {
      const c = ctx();
      proto.onTitleEnter.call(c, enter(true));
      expect(c.save).not.toHaveBeenCalled();
    });
  });

  describe('saveDraft', () => {
    it('does not throw when storage is unavailable', () => {
      spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
      const c = { title: 't', body: 'b', addToQuickActions: true, subAgents: signal([]) };
      expect(() => proto.saveDraft.call(c)).not.toThrow();
    });
  });
});
