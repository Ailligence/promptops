import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { appTestProviders } from '@/app/testing/app-test-providers';
import { CloudFeatureModalComponent } from '@components/cloud-feature-modal/cloud-feature-modal.component';
import { PromptDetailComponent } from './prompt-detail.component';

describe('PromptDetailComponent in this edition', () => {
  let component: PromptDetailComponent;
  let open: jasmine.Spy;
  let navigate: jasmine.Spy;

  beforeEach(() => {
    open = jasmine.createSpy('open').and.returnValue({ componentInstance: {}, result: new Promise(() => {}) });
    TestBed.configureTestingModule({
      providers: [...appTestProviders, { provide: NgbModal, useValue: { open, hasOpenModals: () => false } }],
    });
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    component = TestBed.runInInjectionContext(() => new PromptDetailComponent());
    (component as any).promptId = 7;
  });

  it('shows the PromptOps Desktop lock for Share instead of a sharing dialog that cannot work', () => {
    (component as any).openShareModal();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.calls.mostRecent().args[0]).toBe(CloudFeatureModalComponent);
    expect(open.calls.mostRecent().returnValue.componentInstance.feature).toBe('explore');
  });

  it('shows the lock for Fork Map and stays on the prompt', () => {
    (component as any).goForkMap();
    expect(open.calls.mostRecent().args[0]).toBe(CloudFeatureModalComponent);
    expect(navigate).not.toHaveBeenCalled();
  });
});
