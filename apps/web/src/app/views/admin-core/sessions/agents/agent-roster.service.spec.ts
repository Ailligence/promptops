import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { AGENTS_MODEL } from './agents-model.token';
import { AgentRosterService } from './agent-roster.service';

describe('AgentRosterService', () => {
  let service: AgentRosterService;

  beforeEach(() => {
    (window as any).promptops = { agentsMetaGet: () => Promise.resolve({ leadClosed: false, order: [] }) };
    TestBed.configureTestingModule({ providers: [
      { provide: AGENTS_MODEL, useValue: true },
      { provide: TranslateService, useValue: { instant: (key: string) => `t:${key}` } },
    ] });
    service = TestBed.inject(AgentRosterService);
  });

  afterEach(() => { delete (window as any).promptops; });

  it('titles an unnamed lead with the translated label', async () => {
    await service.load('s1');
    const roster = service.rosterFor({ id: 's1', name: '' }, [{ id: 'a1' } as any]);
    expect(roster[0].id).toBe(AgentRosterService.LEAD_PANE_ID);
    expect(roster[0].title).toBe('t:SUBAGENTS.Lead');
  });

  it('keeps the session name when there is one', async () => {
    await service.load('s1');
    const roster = service.rosterFor({ id: 's1', name: 'api' }, [{ id: 'a1' } as any]);
    expect(roster[0].title).toBe('api');
  });
  it('reports a failed close or reopen of the lead (and rolls the tile back)', async () => {
    (window as any).promptops.agentsCloseLead = () => Promise.reject('ipc down');
    (window as any).promptops.agentsReopenLead = () => Promise.reject('ipc down');
    expect(await service.closeLead('s1')).toBeFalse();
    expect(service.leadClosed('s1')).toBeFalse();
    (window as any).promptops.agentsCloseLead = () => Promise.resolve({ leadClosed: true, order: [] });
    expect(await service.closeLead('s1')).toBeTrue();
    expect(await service.reopenLead('s1')).toBeFalse();
    expect(service.leadClosed('s1')).toBeTrue();
  });
});
