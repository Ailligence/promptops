import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { GoalLoopService } from '../services/goal-loop.service';
import { WorkerChatComponent } from './worker-chat.component';

describe('WorkerChatComponent robustness', () => {
  let api: Record<string, jasmine.Spy>;
  let component: WorkerChatComponent;
  let originalApi: unknown;

  beforeEach(() => {
    originalApi = (window as any).promptops;
    api = {
      getWorkerTranscript: jasmine.createSpy('getWorkerTranscript'),
      onWorkerItem: jasmine.createSpy('onWorkerItem'),
      sendWorkerMessage: jasmine.createSpy('sendWorkerMessage'),
      cancelWorkerTurn: jasmine.createSpy('cancelWorkerTurn'),
    };
    (window as any).promptops = api;
    TestBed.configureTestingModule({ providers: [
      { provide: GoalLoopService, useValue: {
        states: signal({}),
        hydrate: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ] });
    component = TestBed.runInInjectionContext(() => new WorkerChatComponent());
    component.subAgentId = 'w1';
  });

  afterEach(() => {
    component.ngOnDestroy();
    (window as any).promptops = originalApi;
  });

  it('does not subscribe to the live stream when destroyed while the transcript loads', async () => {
    let resolveTranscript!: (v: unknown) => void;
    api['getWorkerTranscript'].and.returnValue(new Promise(r => { resolveTranscript = r; }));
    const init = component.ngOnInit();
    component.ngOnDestroy();
    resolveTranscript({ ok: true, items: [] });
    await init;
    expect(api['onWorkerItem']).not.toHaveBeenCalled();
  });

  it('unsubscribes the live stream on destroy', async () => {
    const unsub = jasmine.createSpy('unsub');
    api['getWorkerTranscript'].and.resolveTo({ ok: true, items: [] });
    api['onWorkerItem'].and.returnValue(unsub);
    await component.ngOnInit();
    component.ngOnDestroy();
    expect(unsub).toHaveBeenCalled();
  });

  it('surfaces a rejected send instead of leaking an unhandled rejection', fakeAsync(() => {
    api['sendWorkerMessage'].and.rejectWith(new Error('bridge down'));
    component.draft.set('hello');
    let done = false;
    component.send().then(() => { done = true; });
    tick();
    expect(done).toBeTrue();
    expect(component.sendError()).toBe('bridge down');
    expect(component.draft()).toBe('hello');
    tick(3000);
    expect(component.sendError()).toBeNull();
  }));

  it('falls back to a translated message when the send fails without an error text', async () => {
    api['sendWorkerMessage'].and.resolveTo({ ok: false });
    component.draft.set('hello');
    await component.send();
    expect(component.sendError()).toBe('SUBAGENTS.WORKER.Message not sent');
  });

  it('catches a rejected stop', async () => {
    api['cancelWorkerTurn'].and.rejectWith(new Error('nope'));
    await expectAsync(component.stop()).toBeResolved();
    expect(component.sendError()).toBe('nope');
  });

  it('translates the goal phase label', () => {
    expect(component.phaseLabel('done')).toBe('SUBAGENTS.WORKER.Phase.done');
  });
});
