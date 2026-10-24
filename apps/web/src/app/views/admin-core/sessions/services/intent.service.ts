import { Injectable, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { SubAgentService, SubAgentProvider, SubAgentMode, SubAgentStatus } from './sub-agent.service';
import {
  createSession,
  createSessionSuccess,
  createSessionFailure,
  newCreateSessionRequestId,
  setActiveSession,
} from '../../../../../store/sessions/session.actions';
import { getSessions } from '../../../../../store/sessions/session.selectors';

export interface IntentAgent {
  name: string;
  role: string;
  goal: string;
  description: string;
  mode?: SubAgentMode;
  /** Specific directories/file patterns this agent operates on */
  scope?: string[];
  /** Ordered list of atomic tasks this agent must complete */
  tasks?: string[];
  /** Explicit boundaries — areas this agent must NOT touch */
  boundaries?: string[];
  /** Wave number (1-based). Agents in the same wave run in parallel. */
  wave?: number;
  /** Names of agents that must complete before this one can start. */
  dependsOn?: string[];
}

export interface IntentPlan {
  summary: string;
  agents: IntentAgent[];
  /** Original user intent — forwarded verbatim to every sub-agent */
  originalIntent?: string;
  /** Session context shown to every sub-agent */
  sessionContext?: string;
  /** Project structure shown to every sub-agent */
  projectStructure?: string;
  /** Path of the shared contract file produced by wave 1 and read by wave 2+ */
  contractPath?: string;
}

export type IntentPhase = 'input' | 'generating' | 'review' | 'executing' | 'done' | 'error' | 'stopped';

export type EnhanceDepth = 'short' | 'medium' | 'strong';

const DEFAULT_CONTRACT_PATH = '.promptops/intent-contract.md';
const MAX_AGENTS = 5;
const WAVE_TIMEOUT_MS = 20 * 60 * 1000; // 20 min per wave
const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES: SubAgentStatus[] = ['completed', 'error', 'exited'];

@Injectable({ providedIn: 'root' })
export class IntentService {
  private subAgentService = inject(SubAgentService);
  private store = inject(Store);
  private actions$ = inject(Actions);
  private translate = inject(TranslateService, { optional: true });

  phase = signal<IntentPhase>('input');
  currentPlan = signal<IntentPlan | null>(null);
  error = signal<string | null>(null);
  /** Wave currently running (1-based). Null when idle. */
  currentWave = signal<number | null>(null);
  /** Agents currently waiting for their predecessors. */
  waitingAgents = signal<string[]>([]);

  /** Draft state — persisted across modal close/reopen so the user can dismiss the modal mid-flight without losing their intent or in-progress wave view. */
  draftIntent = signal<string>('');
  draftProvider = signal<SubAgentProvider | null>(null);
  draftAutoApprove = signal<boolean>(false);
  /** Session this draft/execution belongs to. Used to avoid cross-session bleed. */
  activeSessionId = signal<string | null>(null);

  /** Set by stop() to abort the wave loop. Read by executePlan/awaitAgentTermination. */
  private stopRequested = false;

  private get api(): any {
    return (window as any).promptops;
  }

  async generatePlan(
    intent: string,
    provider: SubAgentProvider,
    sessionContext?: string,
    projectStructure?: string,
  ): Promise<IntentPlan | null> {
    this.phase.set('generating');
    this.error.set(null);

    const systemPrompt = `You are an AI orchestrator. Produce a THREE-WAVE execution plan to fulfill a user's intent using isolated CLI sub-agents running in separate terminals.

HARD RULES:
- Sub-agents CANNOT talk to each other. The ONLY way they share state is by reading/writing files in the repo.
- You MUST produce exactly THREE waves:
  - Wave 1 → ONE "Contract Architect" agent (role: "devops"). It writes a shared contract file at "${DEFAULT_CONTRACT_PATH}" defining endpoints, DTO shapes, TypeScript types, file paths, naming, and any cross-layer decisions. It does NOT implement features.
  - Wave 2 → 1 to 3 specialized worker agents (backend / frontend / refactor / test / debug) running IN PARALLEL. Each reads the contract file and implements its slice.
  - Wave 3 → ONE "Integrator" agent (role: "debug"). It reads the git diff produced by wave 2, runs build/typecheck/tests, wires up leftover glue, and reports.
- Total agents: 3 to 5. Prefer the minimum that covers the intent.
- Each agent MUST declare:
  - "wave": 1 | 2 | 3
  - "dependsOn": list of agent names it must wait for (wave 2 depends on the Architect's name; wave 3 depends on every wave-2 worker's name)
  - "scope" and "boundaries" so its slice is unambiguous
- Tasks must be ordered, atomic, and numbered.
- Every wave-2 worker MUST have a task "Read ${DEFAULT_CONTRACT_PATH} and treat it as the source of truth" as step 1.
- The Integrator MUST have tasks to run build/typecheck and to reconcile mismatches between wave-2 outputs.

Respond ONLY with valid JSON in this exact format:
{
  "summary": "Brief summary of the plan",
  "agents": [
    {
      "name": "Contract Architect",
      "role": "devops",
      "wave": 1,
      "dependsOn": [],
      "goal": "Write the shared contract file",
      "description": "Define endpoints, DTOs, types, and file paths that the workers will follow.",
      "scope": [".promptops/"],
      "tasks": ["1. Analyze the intent", "2. Write ${DEFAULT_CONTRACT_PATH} with endpoints, DTOs, types, file paths"],
      "boundaries": ["Do NOT implement features", "Do NOT modify source code outside .promptops/"]
    },
    {
      "name": "Backend Worker",
      "role": "backend",
      "wave": 2,
      "dependsOn": ["Contract Architect"],
      "goal": "Implement the backend slice per the contract",
      "description": "...",
      "scope": ["backend/app/"],
      "tasks": ["1. Read ${DEFAULT_CONTRACT_PATH} and treat it as the source of truth", "2. ..."],
      "boundaries": ["Do NOT modify frontend files"]
    },
    {
      "name": "Integrator",
      "role": "debug",
      "wave": 3,
      "dependsOn": ["Backend Worker"],
      "goal": "Verify and wire up the final result",
      "description": "Run build/typecheck, fix glue, reconcile any contract drift.",
      "tasks": ["1. Read git diff", "2. Run build and typecheck", "3. Fix wiring mismatches", "4. Report"],
      "boundaries": ["Do NOT rewrite features"]
    }
  ]
}`;

    const userMessage = [
      `USER INTENT: ${intent}`,
      sessionContext ? `\nSESSION CONTEXT:\n${sessionContext}` : '',
      projectStructure ? `\nPROJECT STRUCTURE:\n${projectStructure}` : '',
    ].filter(Boolean).join('\n');

    try {
      if (this.api?.generateIntentPlan) {
        const aiResult = await Promise.race([
          this.api.generateIntentPlan({ systemPrompt, userMessage, provider }),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
        ]);
        const plan = aiResult?.ok && aiResult.plan ? this.validatePlan(aiResult.plan) : null;
        if (plan) {
          this.attachContext(plan, intent, sessionContext, projectStructure);
          this.currentPlan.set(plan);
          this.phase.set('review');
          return plan;
        }
      }

      const plan = this.generateLocalPlan(intent);
      this.attachContext(plan, intent, sessionContext, projectStructure);
      this.currentPlan.set(plan);
      this.phase.set('review');
      return plan;
    } catch {
      const plan = this.generateLocalPlan(intent);
      this.attachContext(plan, intent, sessionContext, projectStructure);
      this.currentPlan.set(plan);
      this.phase.set('review');
      return plan;
    }
  }

  private attachContext(
    plan: IntentPlan,
    intent: string,
    sessionContext?: string,
    projectStructure?: string,
  ): void {
    plan.originalIntent = intent;
    plan.sessionContext = sessionContext;
    plan.projectStructure = projectStructure;
    plan.contractPath = plan.contractPath ?? DEFAULT_CONTRACT_PATH;
    this.assignWaves(plan);
  }

  /**
   * Provision a fresh session that owns the intent execution, then run the
   * plan with that session as the sub-agents' parent. The triggering session
   * stays untouched — the user is switched to the new session so the spawned
   * agents have a quiet, dedicated terminal to live in.
   *
   * Why a dedicated session: spawning N sub-agents in parallel from the user's
   * active terminal puts every sub-agent's CC TUI under contention with the
   * parent's existing prompt, which surfaces as the "prompt stuck idle" bug
   * (paste lands before CC has finished rendering, Enter is dropped).
   */
  async executeInDedicatedSession(
    triggeringSessionId: string,
    plan: IntentPlan,
    provider: SubAgentProvider,
    autoApprove: boolean,
  ): Promise<void> {
    this.phase.set('executing');
    this.error.set(null);
    this.currentWave.set(null);
    this.waitingAgents.set([]);
    this.stopRequested = false;

    // Inherit workspace + cwd from the triggering session so the new session
    // operates on the same project the user was working in.
    const sessions = await firstValueFrom(this.store.select(getSessions).pipe(take(1)));
    const triggering = sessions.find(s => s.id === triggeringSessionId);
    const cwd = triggering?.workspace?.path;
    const workspaceId = triggering?.workspaceId ?? null;

    const intentText = (plan.originalIntent ?? plan.summary ?? 'intent').trim();
    const truncated = intentText.length > 50
      ? intentText.slice(0, 50).trimEnd() + '…'
      : intentText;
    // A free name: saving a session replaces the one with the same name, so a
    // second run of the same intent would overwrite the first one's session.
    const baseName = `Intent · ${truncated}`;
    const taken = new Set(sessions.map(s => s.name));
    let name = baseName;
    for (let n = 2; taken.has(name); n++) name = `${baseName} (${n})`;

    // Subscribe BEFORE dispatching so we never miss the response on the
    // hot Actions stream. Only OUR session's success counts: a session
    // created meanwhile elsewhere (sidebar, MCP, restore) must not receive
    // the plan's agents.
    const requestId = newCreateSessionRequestId();
    const created$ = firstValueFrom(
      this.actions$.pipe(
        ofType(createSessionSuccess, createSessionFailure),
        filter(a => a.requestId === requestId),
        take(1),
        timeout(60_000),
      ),
    ).catch(() => createSessionFailure({ error: 'timed out' }));

    this.store.dispatch(createSession({
      requestId,
      name,
      provider,
      config: cwd ? { cwd } : {},
      workspaceId,
    }));

    const result = await created$;

    if (result.type === createSessionFailure.type) {
      const err = (result as ReturnType<typeof createSessionFailure>).error;
      const label = this.translate?.instant('SESSIONS.Create_Failed');
      this.error.set(`${label && label !== 'SESSIONS.Create_Failed' ? label : 'Could not create the session'}: ${err}`);
      this.phase.set('error');
      return;
    }

    if (this.stopRequested) {
      this.phase.set('stopped');
      return;
    }

    const newSession = (result as ReturnType<typeof createSessionSuccess>).session;

    // Re-anchor the draft to the new session so reopening the modal from
    // there restores the in-flight wave view (instead of starting fresh).
    this.activeSessionId.set(newSession.id);

    // The reducer already pinned activeSessionId to the new session, but
    // dispatch explicitly: defends against the user clicking another tab in
    // between the dispatch above and the spawn loop below.
    this.store.dispatch(setActiveSession({ sessionId: newSession.id }));

    // Give the freshly-spawned PTY a beat before we start hammering it
    // with sub-agent spawns. The parent terminal needs to render its CC
    // TUI; sub-agent injection has its own delay inside the main process.
    await new Promise(r => setTimeout(r, 800));

    if (this.stopRequested) {
      this.phase.set('stopped');
      return;
    }

    return this.executePlan(newSession.id, plan, provider, autoApprove);
  }

  /**
   * Execute the confirmed plan wave by wave. Agents in the same wave run in
   * parallel; wave N+1 starts only after every agent in wave N reaches a
   * terminal status (completed/error/exited/destroyed).
   */
  async executePlan(
    parentSessionId: string,
    plan: IntentPlan,
    provider: SubAgentProvider,
    autoApprove: boolean,
  ): Promise<void> {
    this.phase.set('executing');
    this.currentWave.set(null);
    this.waitingAgents.set([]);
    this.stopRequested = false;

    const roleToMode: Record<string, SubAgentMode> = {
      backend: 'sprint',
      frontend: 'sprint',
      refactor: 'refactor',
      debug: 'detective',
      test: 'paranoid',
      docs: 'minimal',
      devops: 'architect',
    };

    try {
      this.assignWaves(plan);
      const waves = this.groupByWave(plan);

      for (const [waveNumber, waveAgents] of waves) {
        if (this.stopRequested) break;
        this.currentWave.set(waveNumber);
        this.waitingAgents.set(
          plan.agents
            .filter(a => (a.wave ?? 1) > waveNumber)
            .map(a => a.name),
        );

        const spawnedIds: string[] = [];
        for (const agent of waveAgents) {
          if (this.stopRequested) break;
          const prompt = this.buildAgentPrompt(agent, plan, autoApprove);
          const mode = agent.mode ?? roleToMode[agent.role] ?? 'sprint';
          const spawned = await this.subAgentService.spawnCustom(
            parentSessionId,
            agent.role,
            agent.name,
            prompt,
            provider,
            mode,
          );
          if (spawned?.id) spawnedIds.push(spawned.id);
          await new Promise(r => setTimeout(r, 500));
        }

        if (this.stopRequested) break;

        // Only wait if there are downstream waves.
        const hasNextWave = waves.some(([w]) => w > waveNumber);
        if (hasNextWave && spawnedIds.length) {
          await Promise.all(spawnedIds.map(id => this.awaitAgentTermination(id)));
        }
      }

      this.currentWave.set(null);
      this.waitingAgents.set([]);
      if (this.stopRequested) {
        this.phase.set('stopped');
      } else {
        this.phase.set('done');
      }
    } catch (err: any) {
      this.error.set(err.message ?? 'Failed to spawn agents');
      this.phase.set('error');
      this.currentWave.set(null);
      this.waitingAgents.set([]);
    }
  }

  private groupByWave(plan: IntentPlan): Array<[number, IntentAgent[]]> {
    const map = new Map<number, IntentAgent[]>();
    for (const agent of plan.agents) {
      const w = agent.wave ?? 1;
      if (!map.has(w)) map.set(w, []);
      map.get(w)!.push(agent);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }

  /**
   * Poll the SubAgentService until the given agent reaches a terminal status
   * or disappears from the active list (destroyed).
   */
  private async awaitAgentTermination(subAgentId: string, timeoutMs = WAVE_TIMEOUT_MS): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return;
      // activeSubAgents only holds the session on screen: when the user
      // switches away the agents are still alive in allSubAgents (kept up to
      // date by the status/destroy pushes), so look there too.
      const active = this.subAgentService.activeSubAgents().find(a => a.id === subAgentId)
        ?? this.subAgentService.allSubAgents().find(a => a.id === subAgentId);
      if (!active) {
        // Gone from active list → destroyed/merged. Consider terminated.
        return;
      }
      if (TERMINAL_STATUSES.includes(active.status)) return;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    // Timeout: don't block the whole plan forever; let the next wave proceed.
  }

  async enhancePrompt(
    prompt: string,
    provider: SubAgentProvider,
    sessionContext?: string,
    projectStructure?: string,
    depth: EnhanceDepth = 'medium',
  ): Promise<string> {
    try {
      if (this.api?.enhanceIntentPrompt) {
        const result = await Promise.race([
          this.api.enhanceIntentPrompt({ prompt, provider, sessionContext, projectStructure, depth }),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 15000)),
        ]);
        if (result?.ok && result.enhanced) {
          return result.enhanced;
        }
      }
    } catch {
      // fall through
    }
    return this.enhanceLocally(prompt, depth);
  }

  private enhanceLocally(prompt: string, depth: EnhanceDepth = 'medium'): string {
    const trimmed = prompt.trim();
    const parts: string[] = [];

    const startsWithVerb = /^(add|create|implement|fix|refactor|update|build|remove|move|change|migrate|set up|configure|write|design)/i.test(trimmed);
    const base = startsWithVerb ? trimmed : `Implement the following: ${trimmed}`;
    parts.push(base.endsWith('.') ? base : `${base}.`);

    if (depth === 'short') return parts.join(' ');

    const lower = trimmed.toLowerCase();
    if (lower.includes('button') || lower.includes('modal') || lower.includes('ui') || lower.includes('component') || lower.includes('page')) {
      parts.push('Include proper styling, loading states, and error handling in the UI.');
    }
    if (lower.includes('api') || lower.includes('endpoint') || lower.includes('backend') || lower.includes('database')) {
      parts.push('Ensure proper validation, error responses, and consistent API conventions.');
    }
    if (lower.includes('refactor') || lower.includes('clean') || lower.includes('move')) {
      parts.push('Preserve existing behavior and update all references.');
    }
    if (parts.length === 1) {
      parts.push('Follow existing project conventions and ensure the implementation is complete and tested.');
    }

    if (depth === 'strong') {
      parts.push('Define clear acceptance criteria: the change must be covered by tests, must not regress existing functionality, and must handle edge cases (empty input, errors, concurrent access) explicitly.');
      parts.push('Document any assumptions, list all touched files/components, and verify the change end-to-end before considering it complete.');
    }

    return parts.join(' ');
  }

  /**
   * Abort wave execution. Already-spawned sub-agents keep running in their
   * own terminals — the user can manage them from the sub-agents panel.
   * Idempotent.
   */
  stop(): void {
    if (this.phase() === 'executing') {
      this.stopRequested = true;
      this.phase.set('stopped');
      this.currentWave.set(null);
      this.waitingAgents.set([]);
    } else if (this.phase() !== 'stopped') {
      // Done/error/review → mark stopped so UI shows "Delete" button.
      this.stopRequested = true;
      this.phase.set('stopped');
    }
  }

  reset(): void {
    this.phase.set('input');
    this.currentPlan.set(null);
    this.error.set(null);
    this.currentWave.set(null);
    this.waitingAgents.set([]);
    this.stopRequested = false;
  }

  /** Full reset — also clears the persisted draft. Used when starting a brand-new intent. */
  hardReset(): void {
    this.reset();
    this.draftIntent.set('');
    this.draftAutoApprove.set(false);
    this.activeSessionId.set(null);
  }

  /** True while a plan is being generated, reviewed, or executed — i.e. there is state worth restoring. */
  hasInFlightState(): boolean {
    const phase = this.phase();
    return phase !== 'input' || this.currentPlan() !== null;
  }

  // ── Private helpers ───────────────────────────────────────────

  /** Null when the AI plan has no usable agents: the caller falls back to the local plan. */
  private validatePlan(raw: any): IntentPlan | null {
    const plan: IntentPlan = {
      summary: raw.summary ?? 'Execution plan',
      agents: [],
      contractPath: typeof raw.contractPath === 'string' ? raw.contractPath : DEFAULT_CONTRACT_PATH,
    };

    const agents = Array.isArray(raw.agents) ? raw.agents : [];
    if (!agents.length) return null;
    for (const a of agents.slice(0, MAX_AGENTS)) {
      plan.agents.push({
        name: a.name ?? 'Agent',
        role: a.role ?? 'backend',
        goal: a.goal ?? '',
        description: a.description ?? '',
        mode: a.mode,
        scope: Array.isArray(a.scope) ? a.scope : undefined,
        tasks: Array.isArray(a.tasks) ? a.tasks : undefined,
        boundaries: Array.isArray(a.boundaries) ? a.boundaries : undefined,
        wave: typeof a.wave === 'number' ? a.wave : undefined,
        dependsOn: Array.isArray(a.dependsOn) ? a.dependsOn : undefined,
      });
    }

    if (plan.agents.length < 2) {
      plan.agents.push({
        name: 'Support Agent',
        role: 'debug',
        goal: 'Verify and test the changes',
        description: 'Run tests and validate the implementation',
      });
    }

    return plan;
  }

  /**
   * Assign wave numbers from dependsOn when missing; fill empty dependsOn
   * so wave 2 depends on wave 1, wave 3 depends on wave 2.
   */
  private assignWaves(plan: IntentPlan): void {
    const byName = new Map(plan.agents.map(a => [a.name, a]));

    // If any agent has dependsOn but no wave, compute wave as 1 + max(wave(dep)).
    const resolveWave = (agent: IntentAgent, seen: Set<string>): number => {
      if (typeof agent.wave === 'number') return agent.wave;
      if (seen.has(agent.name)) return 1;
      seen.add(agent.name);
      const deps = agent.dependsOn ?? [];
      if (!deps.length) return 1;
      const depWaves = deps
        .map(d => byName.get(d))
        .filter((a): a is IntentAgent => !!a)
        .map(d => resolveWave(d, seen));
      return 1 + Math.max(0, ...depWaves);
    };

    for (const agent of plan.agents) {
      agent.wave = resolveWave(agent, new Set());
    }

    // Backfill dependsOn: every agent in wave N without explicit deps depends
    // on all agents in wave N-1. This guarantees the runner waits correctly
    // even when the AI forgets to wire them.
    const byWave = new Map<number, IntentAgent[]>();
    for (const a of plan.agents) {
      const w = a.wave ?? 1;
      if (!byWave.has(w)) byWave.set(w, []);
      byWave.get(w)!.push(a);
    }
    for (const agent of plan.agents) {
      if (agent.dependsOn && agent.dependsOn.length) continue;
      const w = agent.wave ?? 1;
      if (w <= 1) {
        agent.dependsOn = [];
        continue;
      }
      const prev = byWave.get(w - 1) ?? [];
      agent.dependsOn = prev.map(a => a.name);
    }
  }

  /**
   * Local 3-wave plan: Architect → 1-3 workers → Integrator.
   */
  private generateLocalPlan(intent: string): IntentPlan {
    const lower = intent.toLowerCase();
    const workers: IntentAgent[] = [];

    const wantsFrontend = /frontend|ui|component|page|modal|button/.test(lower);
    const wantsBackend = /backend|api|endpoint|server|database|migration/.test(lower);
    const wantsRefactor = /refactor|clean|restructure|move/.test(lower);
    const wantsTest = /test|spec|coverage/.test(lower);
    const wantsDebug = /bug|fix|debug|error|crash/.test(lower);

    if (wantsFrontend) {
      workers.push({
        name: 'Frontend Worker',
        role: 'frontend',
        goal: 'Implement the frontend slice per the contract',
        description: 'Handle component, styling, and template changes using types/paths from the contract.',
        scope: ['webapp/src/app/'],
        tasks: [
          `1. Read ${DEFAULT_CONTRACT_PATH} and treat it as the source of truth`,
          '2. Update components/pages to call the agreed endpoints with the agreed DTOs',
          '3. Ensure styling and states are consistent with existing design',
        ],
        boundaries: ['Do NOT modify backend files', 'Do NOT modify desktop app files'],
      });
    }
    if (wantsBackend) {
      workers.push({
        name: 'Backend Worker',
        role: 'backend',
        goal: 'Implement the backend slice per the contract',
        description: 'Build controllers/services/endpoints matching the contract exactly.',
        scope: ['backend/app/', 'backend/routes/', 'backend/database/'],
        tasks: [
          `1. Read ${DEFAULT_CONTRACT_PATH} and treat it as the source of truth`,
          '2. Implement endpoints/services with the exact routes and DTO shapes from the contract',
          '3. Add validation and error handling consistent with project conventions',
        ],
        boundaries: ['Do NOT modify frontend files', 'Do NOT modify desktop app files'],
      });
    }
    if (wantsRefactor && workers.length < 3) {
      workers.push({
        name: 'Refactor Worker',
        role: 'refactor',
        goal: 'Refactor per the contract without behavior change',
        description: 'Restructure code as defined in the contract, preserving existing behavior.',
        tasks: [
          `1. Read ${DEFAULT_CONTRACT_PATH} and treat it as the source of truth`,
          '2. Apply the refactor exactly as the contract prescribes',
          '3. Update all references and imports',
        ],
        boundaries: ['Do NOT change public API contracts beyond what the contract file specifies'],
      });
    }
    if (wantsTest && workers.length < 3) {
      workers.push({
        name: 'Test Worker',
        role: 'test',
        goal: 'Write tests matching the contract',
        description: 'Cover the behavior described in the contract with unit/integration tests.',
        scope: ['backend/tests/', 'webapp/src/**/*.spec.ts'],
        tasks: [
          `1. Read ${DEFAULT_CONTRACT_PATH} and treat it as the source of truth`,
          '2. Write tests that assert the contract',
          '3. Run tests and fix failures on the test side only',
        ],
        boundaries: ['Do NOT modify production code', 'Do NOT change existing test behavior'],
      });
    }
    if (wantsDebug && workers.length < 3) {
      workers.push({
        name: 'Debug Worker',
        role: 'debug',
        goal: 'Investigate and fix the issue described in the contract',
        description: 'Reproduce, root-cause, and fix the issue scoped by the contract.',
        tasks: [
          `1. Read ${DEFAULT_CONTRACT_PATH} and treat it as the source of truth`,
          '2. Reproduce and identify the root cause',
          '3. Implement the minimal fix inside the contract scope',
        ],
        boundaries: ['Do NOT refactor unrelated code', 'Do NOT add new features'],
      });
    }

    if (workers.length === 0) {
      workers.push({
        name: 'Implementation Worker',
        role: 'backend',
        goal: 'Implement the primary changes per the contract',
        description: 'Apply the contract end-to-end within the agreed scope.',
        tasks: [
          `1. Read ${DEFAULT_CONTRACT_PATH} and treat it as the source of truth`,
          '2. Implement the changes as specified',
          '3. Verify the implementation works within its own scope',
        ],
      });
    }

    const architectNames: string[] = ['Contract Architect'];
    const architect: IntentAgent = {
      name: 'Contract Architect',
      role: 'devops',
      wave: 1,
      dependsOn: [],
      goal: 'Write the shared contract file the workers will follow',
      description: 'Analyze the intent and write a concrete contract: endpoints, DTO shapes, TypeScript types, file paths, naming, and cross-layer decisions.',
      scope: ['.promptops/'],
      tasks: [
        '1. Analyze the user intent and the relevant parts of the codebase',
        `2. Write ${DEFAULT_CONTRACT_PATH} listing endpoints, DTO shapes, types, file paths, and naming`,
        '3. Flag any assumption explicitly so workers do not re-invent it',
      ],
      boundaries: ['Do NOT implement features', 'Do NOT modify source code outside .promptops/'],
    };

    const sliced = workers.slice(0, 3).map(w => ({
      ...w,
      wave: 2 as number,
      dependsOn: architectNames,
    }));

    const integrator: IntentAgent = {
      name: 'Integrator',
      role: 'debug',
      wave: 3,
      dependsOn: sliced.map(w => w.name),
      goal: 'Verify end-to-end and wire up any leftover glue',
      description: 'Read the git diff from wave 2, run build/typecheck, reconcile mismatches, and report.',
      tasks: [
        '1. Read the git diff produced by the previous wave',
        `2. Check wave-2 outputs against ${DEFAULT_CONTRACT_PATH}`,
        '3. Run build and typecheck; fix wiring mismatches only',
        '4. Report what was done and any remaining gaps',
      ],
      boundaries: ['Do NOT rewrite features', 'Do NOT invent new APIs — fix glue only'],
    };

    const agents = [architect, ...sliced, integrator].slice(0, MAX_AGENTS);

    return {
      summary: `Plan for: ${intent.substring(0, 100)}${intent.length > 100 ? '...' : ''}`,
      agents,
      contractPath: DEFAULT_CONTRACT_PATH,
    };
  }

  /**
   * Build a detailed, self-contained prompt for a sub-agent.
   */
  private buildAgentPrompt(agent: IntentAgent, plan: IntentPlan, autoApprove: boolean): string {
    const waveNumber = agent.wave ?? 1;
    const contractPath = plan.contractPath ?? DEFAULT_CONTRACT_PATH;
    const totalAgents = plan.agents.length;

    const sameWave = plan.agents.filter(a => (a.wave ?? 1) === waveNumber && a.name !== agent.name);
    const earlierWaves = plan.agents.filter(a => (a.wave ?? 1) < waveNumber);
    const laterWaves = plan.agents.filter(a => (a.wave ?? 1) > waveNumber);

    const formatList = (list: IntentAgent[]) =>
      list.length
        ? list.map(a => `- **${a.name}** (${a.role}, wave ${a.wave ?? 1}): ${a.goal}`).join('\n')
        : '- (none)';

    const parts: string[] = [
      `# ${agent.name}`,
      ``,
      `## Your Role`,
      `You are the **${agent.role}** agent, running in **wave ${waveNumber}** of a ${this.waveCount(plan)}-wave plan.`,
      ``,
    ];

    if (plan.originalIntent) {
      parts.push(
        `## Original User Request (shared by ALL agents)`,
        plan.originalIntent,
        ``,
        `## Your Slice of This Request`,
        `The request above is the FULL picture. You are ONE of ${totalAgents} agents splitting it up.`,
        `Execute ONLY the slice defined below. Do NOT attempt the whole request.`,
        ``,
      );
    }

    if (plan.sessionContext) {
      parts.push(`## Session Context`, plan.sessionContext, ``);
    }
    if (plan.projectStructure) {
      parts.push(`## Project Structure`, plan.projectStructure, ``);
    }

    // Shared contract — the ONLY coordination mechanism between waves.
    parts.push(
      `## Shared Contract (${contractPath})`,
      `The shared contract file at \`${contractPath}\` is the single source of truth that bridges agents across waves.`,
    );
    if (waveNumber === 1) {
      parts.push(
        `You are the FIRST wave. The contract file does NOT exist yet — **you must WRITE it**.`,
        `Downstream agents will read it as gospel. If you omit a decision, they will guess, and the merge will fail.`,
        `Include: endpoints (method + path), DTO/JSON shapes, TypeScript types, file paths the workers will touch, naming conventions, error shape.`,
      );
    } else {
      parts.push(
        `An earlier wave has already WRITTEN the contract at \`${contractPath}\`. **Read it first. Treat it as immutable for your purposes.**`,
        `If the contract is ambiguous or missing something, make the minimum reasonable assumption, write it inline in your own commit message / report, and keep going — do NOT edit the contract file.`,
      );
    }
    parts.push(``);

    parts.push(`## Goal`, agent.goal, ``, `## What To Do`, agent.description);

    if (agent.scope?.length) {
      parts.push('', '## Scope (ONLY work in these areas)');
      for (const s of agent.scope) parts.push(`- \`${s}\``);
    }

    if (agent.tasks?.length) {
      parts.push('', '## Tasks (execute in order)');
      for (const t of agent.tasks) parts.push(t.match(/^\d/) ? `- ${t}` : `- ${t}`);
    }

    if (agent.boundaries?.length) {
      parts.push('', '## Boundaries (DO NOT)');
      for (const b of agent.boundaries) parts.push(`- ⛔ ${b}`);
    }

    // Isolation — critical because terminals are separate processes.
    parts.push(
      '',
      '## Isolation (READ CAREFULLY)',
      'You run in your OWN terminal. You CANNOT see, message, wait for, or read output from the other agents.',
      'There is NO shared memory, NO IPC, NO handoff protocol. The ONLY shared surface is the filesystem (repo + contract file).',
      'Treat this prompt and the contract file as your ONLY source of truth.',
    );

    // Wave-specific coordination block.
    parts.push('', '## Waves (informational only)');
    parts.push(`This is part of a larger plan: "${plan.summary}"`);
    parts.push(`It is a **${this.waveCount(plan)}-wave plan**. You are in **wave ${waveNumber}**.`);
    if (earlierWaves.length) {
      parts.push('', '**Earlier waves (already finished before you started):**', formatList(earlierWaves));
    }
    if (sameWave.length) {
      parts.push('', '**Same wave as you — running in parallel RIGHT NOW in separate terminals:**', formatList(sameWave));
      parts.push('These agents cannot see you and you cannot see them. Do NOT duplicate their work.');
    }
    if (laterWaves.length) {
      parts.push('', '**Later waves (will start after this wave finishes):**', formatList(laterWaves));
      parts.push('They will read the contract file + your git changes. Leave your slice in a state they can pick up.');
    }

    if (waveNumber === 1) {
      parts.push(
        '',
        `**Your wave is BLOCKING**: nothing downstream runs until you finish. Keep it focused and short. When the contract is written, END your session.`,
      );
    } else if (laterWaves.length) {
      parts.push(
        '',
        `**Your wave is BLOCKING the next one**: wave ${waveNumber + 1} is waiting for you. Finish your slice end-to-end and END your session promptly.`,
      );
    } else {
      parts.push(
        '',
        `**You are the FINAL wave**: reconcile everything, verify the build, and report. Nothing runs after you.`,
      );
    }

    parts.push(
      '',
      '## Reconciliation',
      'Complete your slice end-to-end within this terminal.',
      'Commit your changes (or leave them staged in the working tree) so the next wave can read the diff.',
      'Report a short summary of what you did at the end — the parent session will reconcile results across waves.',
    );

    if (autoApprove) {
      parts.push('', '## Auto-Approve', 'You have been granted auto-approve. Proceed without asking for confirmation.');
    }

    return parts.join('\n');
  }

  private waveCount(plan: IntentPlan): number {
    const waves = new Set<number>();
    for (const a of plan.agents) waves.add(a.wave ?? 1);
    return waves.size || 1;
  }

  getAgentPromptPreview(plan: IntentPlan, autoApprove: boolean): Array<{ agent: IntentAgent; prompt: string }> {
    this.assignWaves(plan);
    return plan.agents.map(agent => ({
      agent,
      prompt: this.buildAgentPrompt(agent, plan, autoApprove),
    }));
  }
}
