import { Injectable, signal } from '@angular/core';

export interface GoalVerdictRecord {
  iteration: number;
  verdict: 'GOAL_REACHED' | 'CONTINUE' | 'STUCK';
  progress: number;
  feedback: string;
  at: string;
}

export type GoalLoopPhase =
  | 'running'
  | 'evaluating'
  | 'done'
  | 'stuck'
  | 'budget'
  | 'error'
  | 'stopped';

/** Mirror of the desktop GoalLoopState (Tauri goal_loop). */
export interface GoalLoopState {
  subAgentId: string;
  parentSessionId: string;
  goal: string;
  phase: GoalLoopPhase;
  iteration: number;
  maxIterations: number;
  totalTokens: number;
  maxTotalTokens?: number;
  stuckThreshold: number;
  lastVerdict?: GoalVerdictRecord;
  noProgressStreak: number;
  bestProgress: number;
  startedAt: string;
  endedAt?: string;
  stopReason?: string;
}

/**
 * Live state of goal-driven workers ("Goal" runtime — the autonomous
 * evaluate-vs-goal loop that drives a worker's turns without the user).
 * Push-updated via the desktop bridge; components hydrate on mount so a
 * reopened chat shows the loop state without waiting for the next event.
 */
@Injectable({ providedIn: 'root' })
export class GoalLoopService {
  /** subAgentId → latest goal loop state. */
  readonly states = signal<Record<string, GoalLoopState>>({});

  private get api(): any {
    return (window as any).promptops;
  }

  /** True when the running desktop exposes the goal-loop API. */
  get supported(): boolean {
    return !!this.api?.getGoalLoopState;
  }

  constructor() {
    this.api?.onGoalLoopUpdate?.(
      (_ev: unknown, data: { subAgentId: string; state: GoalLoopState }) => {
        if (!data?.subAgentId || !data.state) return;
        this.states.update((m) => ({ ...m, [data.subAgentId]: data.state }));
      },
    );
  }

  stateOf(subAgentId: string): GoalLoopState | undefined {
    return this.states()[subAgentId];
  }

  /** Fetch the current state once (HUD rehydrate on chat open/reopen). */
  async hydrate(subAgentId: string): Promise<void> {
    if (!this.supported) return;
    try {
      const res = await this.api.getGoalLoopState(subAgentId);
      if (res?.ok && res.state) {
        this.states.update((m) => ({ ...m, [subAgentId]: res.state }));
      }
    } catch {
      /* not goal-driven or desktop too old — HUD stays hidden */
    }
  }

  /** Stop the loop and the in-flight turn; the worker survives as a chat. */
  async stop(subAgentId: string): Promise<void> {
    if (!this.supported) return;
    try {
      await this.api.stopGoalLoop(subAgentId);
    } catch {
      /* non-fatal — the push event reports the real state */
    }
  }
}
