import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateService } from '@ngx-translate/core';
import { SwalService } from './swal.service';

describe('SwalService closeWith', () => {
  let dismiss: jasmine.Spy;
  let service: SwalService;

  beforeEach(() => {
    dismiss = jasmine.createSpy('dismiss');
    const ref = { componentInstance: {}, dismiss, result: new Promise(() => {}) };
    TestBed.configureTestingModule({ providers: [
      SwalService,
      { provide: NgbModal, useValue: { open: () => ref } },
      { provide: TranslateService, useValue: { instant: (k: string) => k } },
    ] });
    service = TestBed.inject(SwalService);
  });

  it('dismisses an open confirmation when its owner is destroyed', () => {
    const callbacks: (() => void)[] = [];
    const owner = { onDestroy: (cb: () => void) => { callbacks.push(cb); return () => {}; } } as unknown as DestroyRef;
    service.confirm('t', 'm', () => {}, owner);
    expect(dismiss).not.toHaveBeenCalled();
    callbacks.forEach((cb) => cb());
    expect(dismiss).toHaveBeenCalled();
  });
});
