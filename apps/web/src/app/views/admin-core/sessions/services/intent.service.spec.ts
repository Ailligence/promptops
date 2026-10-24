import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { Actions } from '@ngrx/effects';
import { of } from 'rxjs';
import { IntentService, IntentPlan } from './intent.service';
import { SubAgentService } from './sub-agent.service';

describe('IntentService', () => {
  let service: IntentService;
  let subAgentServiceSpy: jasmine.SpyObj<SubAgentService>;
  let mockApi: any;

  beforeEach(() => {
    subAgentServiceSpy = jasmine.createSpyObj('SubAgentService', ['spawnCustom']);
    subAgentServiceSpy.spawnCustom.and.resolveTo(null);

    mockApi = {};
    (window as any).promptops = mockApi;

    const storeStub = {
      dispatch: jasmine.createSpy('dispatch'),
      select: jasmine.createSpy('select').and.returnValue(of([])),
    };
    const actionsStub = of();

    TestBed.configureTestingModule({
      providers: [
        IntentService,
        { provide: SubAgentService, useValue: subAgentServiceSpy },
        { provide: Store, useValue: storeStub },
        { provide: Actions, useValue: actionsStub },
      ],
    });

    service = TestBed.inject(IntentService);
  });

  afterEach(() => {
    delete (window as any).promptops;
  });

  // ── reset ──────────────────────────────────────────────────────
  describe('reset', () => {
    it('should set phase to input, clear plan and error', () => {
      // Dirty the state first
      service.phase.set('error');
      service.currentPlan.set({ summary: 'x', agents: [] });
      service.error.set('something broke');

      service.reset();

      expect(service.phase()).toBe('input');
      expect(service.currentPlan()).toBeNull();
      expect(service.error()).toBeNull();
    });
  });

  // ── generatePlan ───────────────────────────────────────────────
  describe('generatePlan', () => {
    it('should set phase to generating then review on AI success', async () => {
      const fakePlan = {
        summary: 'Test plan',
        agents: [
          { name: 'A1', role: 'backend', goal: 'g1', description: 'd1' },
          { name: 'A2', role: 'frontend', goal: 'g2', description: 'd2' },
        ],
      };
      mockApi.generateIntentPlan = jasmine.createSpy().and.resolveTo({ ok: true, plan: fakePlan });

      const result = await service.generatePlan('build a thing', 'claude-code-cli');

      expect(mockApi.generateIntentPlan).toHaveBeenCalledTimes(1);
      expect(result).toBeTruthy();
      expect(result!.agents.length).toBe(2);
      expect(service.phase()).toBe('review');
      expect(service.currentPlan()).toEqual(result);
    });

    it('should fall back to local plan when AI returns ok:false', async () => {
      mockApi.generateIntentPlan = jasmine.createSpy().and.resolveTo({ ok: false, error: 'nope' });

      const result = await service.generatePlan('fix the backend api', 'claude-code-cli');

      expect(result).toBeTruthy();
      expect(result!.agents.length).toBeGreaterThanOrEqual(2);
      expect(service.phase()).toBe('review');
    });

    it('should fall back to local plan when API is not available', async () => {
      // No generateIntentPlan on the api
      const result = await service.generatePlan('add a frontend component', 'claude-code-cli');

      expect(result).toBeTruthy();
      expect(result!.agents.length).toBeGreaterThanOrEqual(2);
      expect(service.phase()).toBe('review');
    });

    it('should fall back to local plan when AI call throws', async () => {
      mockApi.generateIntentPlan = jasmine.createSpy().and.rejectWith(new Error('network error'));

      const result = await service.generatePlan('do something', 'claude-code-cli');

      expect(result).toBeTruthy();
      expect(service.phase()).toBe('review');
    });

    it('should fall back to local plan when AI resolves with null (simulating timeout)', async () => {
      // The service uses Promise.race with a 5s timeout that resolves null.
      // We simulate the timeout branch directly by returning null.
      mockApi.generateIntentPlan = jasmine.createSpy().and.resolveTo(null);

      const result = await service.generatePlan('timeout test', 'claude-code-cli');

      // null result from race → falls through to local plan
      expect(result).toBeTruthy();
      expect(service.phase()).toBe('review');
    });

    it('should include sessionContext and projectStructure in the AI call', async () => {
      mockApi.generateIntentPlan = jasmine.createSpy().and.resolveTo({
        ok: true,
        plan: {
          summary: 's',
          agents: [
            { name: 'A', role: 'backend', goal: 'g', description: 'd' },
            { name: 'B', role: 'test', goal: 'g', description: 'd' },
          ],
        },
      });

      await service.generatePlan('intent', 'claude-code-cli', 'ctx', 'proj');

      const callArgs = mockApi.generateIntentPlan.calls.mostRecent().args[0];
      expect(callArgs.userMessage).toContain('ctx');
      expect(callArgs.userMessage).toContain('proj');
    });
  });

  // ── validatePlan (tested indirectly through generatePlan) ──────
  describe('plan validation', () => {
    it('should enforce max 5 agents', async () => {
      const sixAgents = Array.from({ length: 6 }, (_, i) => ({
        name: `Agent${i}`,
        role: 'backend',
        goal: `goal${i}`,
        description: `desc${i}`,
      }));
      mockApi.generateIntentPlan = jasmine.createSpy().and.resolveTo({
        ok: true,
        plan: { summary: 'big plan', agents: sixAgents },
      });

      const result = await service.generatePlan('big', 'claude-code-cli');

      expect(result!.agents.length).toBeLessThanOrEqual(5);
    });

    it('should ensure at least 2 agents by adding Support Agent', async () => {
      mockApi.generateIntentPlan = jasmine.createSpy().and.resolveTo({
        ok: true,
        plan: {
          summary: 'single agent',
          agents: [{ name: 'Solo', role: 'backend', goal: 'g', description: 'd' }],
        },
      });

      const result = await service.generatePlan('solo', 'claude-code-cli');

      expect(result!.agents.length).toBe(2);
      expect(result!.agents[1].name).toBe('Support Agent');
      expect(result!.agents[1].role).toBe('debug');
    });

    it('should default missing fields in agents', async () => {
      mockApi.generateIntentPlan = jasmine.createSpy().and.resolveTo({
        ok: true,
        plan: {
          agents: [{}, { name: 'X' }],
        },
      });

      const result = await service.generatePlan('defaults', 'claude-code-cli');

      expect(result!.summary).toBe('Execution plan');
      expect(result!.agents[0].name).toBe('Agent');
      expect(result!.agents[0].role).toBe('backend');
      expect(result!.agents[1].name).toBe('X');
    });

    it('should handle non-array agents gracefully', async () => {
      mockApi.generateIntentPlan = jasmine.createSpy().and.resolveTo({
        ok: true,
        plan: { summary: 'broken', agents: 'not-an-array' },
      });

      const result = await service.generatePlan('broken', 'claude-code-cli');

      // Should have gotten the Support Agent added to reach minimum 2
      expect(result!.agents.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── generateLocalPlan (tested indirectly) ──────────────────────
  describe('local plan generation', () => {
    beforeEach(() => {
      // No AI api available → local fallback
      delete mockApi.generateIntentPlan;
    });

    it('should detect frontend keywords', async () => {
      const plan = await service.generatePlan('add a new UI component', 'claude-code-cli');
      const roles = plan!.agents.map(a => a.role);
      expect(roles).toContain('frontend');
    });

    it('should detect backend keywords', async () => {
      const plan = await service.generatePlan('create a new API endpoint', 'claude-code-cli');
      const roles = plan!.agents.map(a => a.role);
      expect(roles).toContain('backend');
    });

    it('should detect test keywords', async () => {
      const plan = await service.generatePlan('improve test coverage', 'claude-code-cli');
      const roles = plan!.agents.map(a => a.role);
      expect(roles).toContain('test');
    });

    it('should detect debug keywords', async () => {
      const plan = await service.generatePlan('fix the login bug', 'claude-code-cli');
      const roles = plan!.agents.map(a => a.role);
      expect(roles).toContain('debug');
    });

    it('should detect refactor keywords', async () => {
      const plan = await service.generatePlan('refactor the auth module', 'claude-code-cli');
      const roles = plan!.agents.map(a => a.role);
      expect(roles).toContain('refactor');
    });

    it('should create a 3-wave architect→worker→integrator plan for unrecognized intents', async () => {
      const plan = await service.generatePlan('do something amazing', 'claude-code-cli');
      const roles = plan!.agents.map(a => a.role);
      expect(plan!.agents.length).toBe(3);
      expect(roles[0]).toBe('devops');   // Contract Architect
      expect(roles[1]).toBe('backend');  // Implementation Worker
      expect(roles[2]).toBe('debug');    // Integrator
      expect(plan!.agents[0].wave).toBe(1);
      expect(plan!.agents[1].wave).toBe(2);
      expect(plan!.agents[2].wave).toBe(3);
    });

    it('should cap local plan at 5 agents', async () => {
      const plan = await service.generatePlan(
        'refactor the frontend ui component, fix backend api bug, add test coverage',
        'claude-code-cli',
      );
      expect(plan!.agents.length).toBeLessThanOrEqual(5);
    });

    it('should ensure minimum 2 agents in local plan', async () => {
      const plan = await service.generatePlan('refactor something', 'claude-code-cli');
      expect(plan!.agents.length).toBeGreaterThanOrEqual(2);
    });

    it('should truncate long intents in summary', async () => {
      const longIntent = 'a'.repeat(200);
      const plan = await service.generatePlan(longIntent, 'claude-code-cli');
      expect(plan!.summary.length).toBeLessThan(200);
      expect(plan!.summary).toContain('...');
    });
  });

  // ── executePlan ────────────────────────────────────────────────
  describe('executePlan', () => {
    const testPlan: IntentPlan = {
      summary: 'Test execution',
      agents: [
        { name: 'Backend Agent', role: 'backend', goal: 'implement api', description: 'do backend stuff' },
        { name: 'Test Agent', role: 'test', goal: 'write tests', description: 'do test stuff' },
      ],
    };

    it('should set phase to executing then done on success', async () => {
      await service.executePlan('session-1', testPlan, 'claude-code-cli', false);

      expect(service.phase()).toBe('done');
    });

    it('should call spawnCustom for each agent', async () => {
      await service.executePlan('session-1', testPlan, 'claude-code-cli', false);

      expect(subAgentServiceSpy.spawnCustom).toHaveBeenCalledTimes(2);
    });

    it('should map roles to correct modes', async () => {
      await service.executePlan('session-1', testPlan, 'claude-code-cli', false);

      // First call: backend → sprint
      const firstCallArgs = subAgentServiceSpy.spawnCustom.calls.argsFor(0);
      expect(firstCallArgs[5]).toBe('sprint');

      // Second call: test → paranoid
      const secondCallArgs = subAgentServiceSpy.spawnCustom.calls.argsFor(1);
      expect(secondCallArgs[5]).toBe('paranoid');
    });

    it('should use sprint as default mode for unknown roles', async () => {
      const unknownRolePlan: IntentPlan = {
        summary: 'unknown roles',
        agents: [
          { name: 'A', role: 'unknown-role' as any, goal: 'g', description: 'd' },
          { name: 'B', role: 'backend', goal: 'g', description: 'd' },
        ],
      };

      await service.executePlan('session-1', unknownRolePlan, 'claude-code-cli', false);

      const firstCallArgs = subAgentServiceSpy.spawnCustom.calls.argsFor(0);
      expect(firstCallArgs[5]).toBe('sprint');
    });

    it('should include auto-approve text in prompt when enabled', async () => {
      await service.executePlan('session-1', testPlan, 'claude-code-cli', true);

      const promptArg = subAgentServiceSpy.spawnCustom.calls.argsFor(0)[3] as string;
      expect(promptArg).toContain('Auto-Approve');
      expect(promptArg).toContain('Proceed without asking for confirmation');
    });

    it('should NOT include auto-approve text when disabled', async () => {
      await service.executePlan('session-1', testPlan, 'claude-code-cli', false);

      const promptArg = subAgentServiceSpy.spawnCustom.calls.argsFor(0)[3] as string;
      expect(promptArg).not.toContain('Auto-Approve');
    });

    it('should include plan summary and role in agent prompts', async () => {
      await service.executePlan('session-1', testPlan, 'claude-code-cli', false);

      const promptArg = subAgentServiceSpy.spawnCustom.calls.argsFor(0)[3] as string;
      expect(promptArg).toContain('Backend Agent');
      expect(promptArg).toContain('backend');
      expect(promptArg).toContain('Test execution');
    });

    it('should set phase to error when spawnCustom throws', async () => {
      subAgentServiceSpy.spawnCustom.and.rejectWith(new Error('spawn failed'));

      await service.executePlan('session-1', testPlan, 'claude-code-cli', false);

      expect(service.phase()).toBe('error');
      expect(service.error()).toBe('spawn failed');
    });

    it('should pass correct parentSessionId and provider', async () => {
      await service.executePlan('my-session', testPlan, 'codex', false);

      const firstCallArgs = subAgentServiceSpy.spawnCustom.calls.argsFor(0);
      expect(firstCallArgs[0]).toBe('my-session');
      expect(firstCallArgs[4]).toBe('codex');
    });
  });

  // ── enhancePrompt ──────────────────────────────────────────────
  describe('enhancePrompt', () => {
    it('should return enhanced text on success', async () => {
      mockApi.enhanceIntentPrompt = jasmine.createSpy().and.resolveTo({
        ok: true,
        enhanced: 'Better prompt text',
      });

      const result = await service.enhancePrompt('rough prompt', 'claude-code-cli');

      expect(result).toBe('Better prompt text');
      expect(service.phase()).toBe('input');
    });

    it('should leave the phase alone (the modal shows its own spinner)', async () => {
      mockApi.enhanceIntentPrompt = jasmine.createSpy().and.resolveTo({ ok: true, enhanced: 'enhanced' });

      await service.enhancePrompt('test', 'claude-code-cli');

      expect(service.phase()).toBe('input');
    });

    it('should enhance locally when API returns ok:false', async () => {
      mockApi.enhanceIntentPrompt = jasmine.createSpy().and.resolveTo({ ok: false, error: 'fail' });

      const result = await service.enhancePrompt('test', 'claude-code-cli');

      expect(result).toContain('test');
      expect(service.phase()).toBe('input');
    });

    it('should enhance locally when API is not available', async () => {
      const result = await service.enhancePrompt('test', 'claude-code-cli');

      expect(result).toContain('test');
    });

    it('should enhance locally on API error', async () => {
      mockApi.enhanceIntentPrompt = jasmine.createSpy().and.rejectWith(new Error('crash'));

      const result = await service.enhancePrompt('test', 'claude-code-cli');

      expect(result).toContain('test');
    });

    it('should enhance locally on timeout (>15s)', async () => {
      jasmine.clock().install();
      try {
        mockApi.enhanceIntentPrompt = jasmine.createSpy().and.callFake(
          () => new Promise(resolve => setTimeout(() => resolve({ ok: true, enhanced: 'late' }), 20000)),
        );

        const pending = service.enhancePrompt('test', 'claude-code-cli');
        jasmine.clock().tick(15001);
        const result = await pending;

        expect(result).not.toBe('late');
        expect(result).toContain('test');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should forward sessionContext and projectStructure', async () => {
      mockApi.enhanceIntentPrompt = jasmine.createSpy().and.resolveTo({ ok: true, enhanced: 'e' });

      await service.enhancePrompt('test', 'claude-code-cli', 'ctx', 'proj');

      const callArgs = mockApi.enhanceIntentPrompt.calls.mostRecent().args[0];
      expect(callArgs.sessionContext).toBe('ctx');
      expect(callArgs.projectStructure).toBe('proj');
    });
  });
});
