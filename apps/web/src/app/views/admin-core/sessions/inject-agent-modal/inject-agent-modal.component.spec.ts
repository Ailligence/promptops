import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { AgentInjectService } from '../services/agent-inject.service';
import { InjectAgentModalComponent } from './inject-agent-modal.component';

describe('InjectAgentModalComponent (logic)', () => {
  it('ignores a catalog load that finishes after the provider changed', async () => {
    let releaseOld!: () => void;
    const oldGate = new Promise<void>(r => (releaseOld = r));
    const fetchCatalog = jasmine.createSpy('fetchCatalog').and.callFake(async (kind: string, provider: string) => {
      if (provider === 'claude-code-cli') await oldGate;
      return [{ itemId: `${provider}.${kind}`, kind, name: provider }];
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: NgbActiveModal, useValue: jasmine.createSpyObj('NgbActiveModal', ['close', 'dismiss']) },
        { provide: AgentInjectService, useValue: { fetchCatalog, loadingCatalog: signal(false), importingSkill: signal(false), importError: signal(null) } },
      ],
    });
    const component = TestBed.runInInjectionContext(() => new InjectAgentModalComponent());

    const stale = (component as any).loadCatalogs('claude-code-cli');
    component.provider.set('codex');
    await (component as any).loadCatalogs('codex');
    releaseOld();
    await stale;

    expect(component.mcpItems().map(i => i.itemId)).toEqual(['codex.mcp']);
  });
});
