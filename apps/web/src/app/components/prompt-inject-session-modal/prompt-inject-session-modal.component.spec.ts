import { TestBed } from '@angular/core/testing';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Store } from '@ngrx/store';
import { PromptInjectSessionModalComponent } from './prompt-inject-session-modal.component';

describe('PromptInjectSessionModalComponent session list', () => {
  let modal: PromptInjectSessionModalComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      { provide: NgbActiveModal, useValue: {} },
      { provide: NgbModal, useValue: {} },
      { provide: Store, useValue: {} },
    ] });
    modal = TestBed.runInInjectionContext(() => new PromptInjectSessionModalComponent());
  });

  it('keeps parked sessions (all of them after a restart), live ones first', () => {
    modal.allSessions.set([
      { id: 'a', name: 'parked', status: 'idle', standbyAt: '2026-10-22T10:00:00Z' },
      { id: 'b', name: 'exited', status: 'exited' },
      { id: 'c', name: 'live', status: 'running' },
    ] as any);
    expect(modal.sessions().map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(modal.statusOf(modal.sessions()[1])).toBe('standby');
  });
});

describe('PromptInjectSessionModalComponent keyboard', () => {
  let modal: PromptInjectSessionModalComponent;
  let close: jasmine.Spy;

  beforeEach(() => {
    close = jasmine.createSpy('close');
    TestBed.configureTestingModule({ providers: [
      { provide: NgbActiveModal, useValue: { close } },
      { provide: NgbModal, useValue: {} },
      { provide: Store, useValue: {} },
    ] });
    modal = TestBed.runInInjectionContext(() => new PromptInjectSessionModalComponent());
    modal.allSessions.set([{ id: 'a', name: 'one', status: 'idle' }] as any);
    modal.selectedType = 'session';
  });

  const enterOn = (target: HTMLElement) => {
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(event, 'target', { value: target });
    modal.onEnter(event);
  };

  it('sends with Enter once a session is chosen, never before', () => {
    enterOn(document.createElement('div'));
    expect(close).not.toHaveBeenCalled();
    modal.selectSession('a');
    enterOn(document.createElement('div'));
    expect(close).toHaveBeenCalledWith(jasmine.objectContaining({ type: 'session' }));
  });

  it('leaves Enter on a focused button to that button', () => {
    modal.selectSession('a');
    enterOn(document.createElement('button'));
    expect(close).not.toHaveBeenCalled();
  });
});
