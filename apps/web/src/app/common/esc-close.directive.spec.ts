import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EscCloseDirective } from './esc-close.directive';

@Component({
  standalone: true,
  imports: [EscCloseDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (outerOpen()) {
      <div class="outer" appEscClose (escClose)="outerOpen.set(false)">outer</div>
    }
    @if (innerOpen()) {
      <div class="inner" appEscClose (escClose)="innerOpen.set(false)">inner</div>
    }
  `,
})
class HostComponent {
  outerOpen = signal(false);
  innerOpen = signal(false);
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe('EscCloseDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    host.outerOpen.set(false);
    host.innerOpen.set(false);
    fixture.detectChanges();
    document.querySelectorAll('ngb-modal-window').forEach(el => el.remove());
  });

  it('closes the overlay on Escape', () => {
    host.outerOpen.set(true);
    fixture.detectChanges();

    pressEscape();

    expect(host.outerOpen()).toBe(false);
  });

  it('closes only the top-most overlay, one Escape at a time', () => {
    host.outerOpen.set(true);
    fixture.detectChanges();
    host.innerOpen.set(true);
    fixture.detectChanges();

    pressEscape();
    expect(host.innerOpen()).toBe(false);
    expect(host.outerOpen()).toBe(true);

    fixture.detectChanges();
    pressEscape();
    expect(host.outerOpen()).toBe(false);
  });

  it('marks the key as handled so NgbModal leaves it alone', () => {
    host.outerOpen.set(true);
    fixture.detectChanges();

    expect(pressEscape().defaultPrevented).toBe(true);
  });

  it('ignores a key press another handler already dealt with', () => {
    host.outerOpen.set(true);
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);

    expect(host.outerOpen()).toBe(true);
  });

  it('lets a Bootstrap modal on top win the key press', () => {
    host.outerOpen.set(true);
    fixture.detectChanges();
    document.body.appendChild(document.createElement('ngb-modal-window'));

    pressEscape();

    expect(host.outerOpen()).toBe(true);
  });

  it('ignores keys other than Escape', () => {
    host.outerOpen.set(true);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));

    expect(host.outerOpen()).toBe(true);
  });

  it('stops listening once every overlay is gone', () => {
    const addSpy = spyOn(document, 'addEventListener').and.callThrough();
    const removeSpy = spyOn(document, 'removeEventListener').and.callThrough();

    host.outerOpen.set(true);
    fixture.detectChanges();
    expect(addSpy.calls.allArgs().some(([type]) => type === 'keydown')).toBe(true);

    host.outerOpen.set(false);
    fixture.detectChanges();
    expect(removeSpy.calls.allArgs().some(([type]) => type === 'keydown')).toBe(true);
  });
});
