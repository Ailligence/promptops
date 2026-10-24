import { TestBed } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateService } from '@ngx-translate/core';
import { PromptQueryService } from '../../prompt-library/services/prompt-query.service';
import { ActionSlotService } from '../services/action-slot.service';
import { SubAgentService } from '../services/sub-agent.service';
import { readCommandAction } from '../services/quick-action-command';
import { CommandActionModalComponent } from './command-action-modal.component';

describe('CommandActionModalComponent decision flow', () => {
  let component: CommandActionModalComponent;
  let prompts: jasmine.SpyObj<PromptQueryService>;
  let agents: jasmine.SpyObj<SubAgentService>;
  let slots: { addSlot: jasmine.Spy; context: () => null };
  let modal: jasmine.SpyObj<NgbActiveModal>;

  beforeEach(() => {
    prompts = jasmine.createSpyObj('prompts', ['addEntity']);
    agents = jasmine.createSpyObj('agents', ['spawnCustom']);
    slots = { addSlot: jasmine.createSpy('addSlot'), context: () => null };
    modal = jasmine.createSpyObj('modal', ['close', 'dismiss']);
    TestBed.configureTestingModule({ providers: [
      { provide: PromptQueryService, useValue: prompts },
      { provide: ActionSlotService, useValue: slots },
      { provide: SubAgentService, useValue: agents },
      { provide: NgbActiveModal, useValue: modal },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ] });
    component = TestBed.runInInjectionContext(() => new CommandActionModalComponent());
    component.command = 'npm run test';
    component.directory = '/workspace/nested project';
    component.sessionId = 'session-1';
    component.title = 'Run tests';
  });

  it('selecting a choice does not run or save anything', () => {
    component.action.set('save');
    component.action.set('run');
    expect(agents.spawnCustom).not.toHaveBeenCalled();
    expect(prompts.addEntity).not.toHaveBeenCalled();
  });

  it('runs a shell agent in the original command folder only after confirmation', async () => {
    agents.spawnCustom.and.resolveTo({ id: 'agent-1' } as any);
    await component.submit();
    expect(agents.spawnCustom).toHaveBeenCalledWith(
      'session-1', 'custom', 'npm run test', 'npm run test', 'generic-shell',
      'clean', undefined, '/workspace/nested project', undefined, undefined, 'interactive',
    );
    expect(prompts.addEntity).not.toHaveBeenCalled();
    expect(modal.close).toHaveBeenCalledWith({ executed: true });
  });

  it('saves command metadata in the original session without running it', async () => {
    component.action.set('save');
    prompts.addEntity.and.resolveTo({ id: 12 });
    slots.addSlot.and.resolveTo({ id: 34 });
    await component.submit();
    const payload = prompts.addEntity.calls.mostRecent().args[0];
    expect(payload.body).toBe('npm run test');
    expect(payload.visibility).toBe('private');
    expect(readCommandAction(payload.notes)?.directory).toBe('/workspace/nested project');
    expect(slots.addSlot).toHaveBeenCalledWith(12, 'Run tests', 'ti-terminal-2', 'session-1', { throwOnError: true, scope: 'session' });
    expect(agents.spawnCustom).not.toHaveBeenCalled();
  });

  it('retries a failed slot save without creating duplicate prompts', async () => {
    component.action.set('save');
    prompts.addEntity.and.resolveTo({ id: 12 });
    slots.addSlot.and.resolveTo(null);
    await component.submit();
    expect(component.error()).toBe('QUICK_ACTION_BUILDER.Add failed');
    expect(modal.close).not.toHaveBeenCalled();
    slots.addSlot.and.resolveTo({ id: 34 });
    await component.submit();
    expect(prompts.addEntity).toHaveBeenCalledTimes(1);
    expect(slots.addSlot).toHaveBeenCalledTimes(2);
  });

  it('blocks double submission while a launch is pending', async () => {
    let resolve!: (value: any) => void;
    agents.spawnCustom.and.returnValue(new Promise(done => resolve = done));
    const first = component.submit();
    await component.submit();
    expect(agents.spawnCustom).toHaveBeenCalledTimes(1);
    resolve({ id: 'agent-1' });
    await first;
  });
});
