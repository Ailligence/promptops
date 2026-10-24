import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { appTestProviders } from '@/app/testing/app-test-providers';
import { SwalService } from '@core/services/swal.service';
import { QuickAccessService } from '@/app/layouts/sidebar/quick-access/quick-access.service';
import { PromptQueryService } from '../services/prompt-query.service';
import { PromptFormComponent } from './prompt-form.component';

describe('PromptFormComponent in this edition', () => {
  let component: PromptFormComponent;
  let navigate: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...appTestProviders,
        { provide: SwalService, useValue: { success: () => {}, error: () => {} } },
        { provide: QuickAccessService, useValue: { loadShortcuts: () => {} } },
        {
          provide: PromptQueryService,
          useValue: { promptSelected: null, addEntity: () => Promise.resolve({ id: 42 }) },
        },
      ],
    });
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    component = TestBed.runInInjectionContext(() => new PromptFormComponent());
  });

  it('does not promise publication in Explore, which needs PromptOps Desktop', () => {
    expect((component as any).showPublicationHint).toBeFalse();
  });

  it('returns to the library after saving a public prompt instead of opening the locked Explore page', async () => {
    (component as any).form = (component as any).initForm(null);
    (component as any).form.patchValue({ title: 'Release notes', body: 'Write {{topic}}', visibility: 'public', status: 'published' });
    await component.handleSaveEntity();
    expect(navigate).toHaveBeenCalledWith(['/admin/prompt-library']);
  });
});
