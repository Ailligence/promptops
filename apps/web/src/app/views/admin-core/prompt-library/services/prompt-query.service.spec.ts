import { TestBed } from '@angular/core/testing';
import { DataBackend } from '@core/data/data-backend';
import { PromptQueryService } from './prompt-query.service';

describe('PromptQueryService stars', () => {
  let data: { call: jasmine.Spy };
  let service: PromptQueryService;

  beforeEach(() => {
    data = jasmine.createSpyObj('data', ['call']);
    TestBed.configureTestingModule({ providers: [PromptQueryService, { provide: DataBackend, useValue: data }] });
    service = TestBed.inject(PromptQueryService);
  });

  it('toggles a star locally and reports the new state', async () => {
    data.call.and.resolveTo({ id: 4, is_starred: true, stars_count: 1 });
    expect(await service.toggleStar(4)).toEqual({ starred: true, stars_count: 1 });
    expect(data.call).toHaveBeenCalledWith('prompts.toggleStar', { id: 4 });
  });

  it('lists starred prompts through the starred filter', async () => {
    data.call.and.resolveTo({ prompts: [{ id: 4 }], pagination: { total: 1 } });
    const res = await service.getStarredPrompts();
    expect(res.prompts.length).toBe(1);
    expect(data.call.calls.mostRecent().args[0]).toBe('prompts.list');
    expect(data.call.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ starred: true }));
  });
});
