import { Injectable, inject, signal, computed, Signal } from '@angular/core';
import { AgentActionNoticeService } from './agent-action-notice.service';
import { ProviderId } from '@core/providers/provider-capability';

export type ReviewFocus = 'correctness' | 'security' | 'style' | 'free';
export type ReviewStatus = 'running' | 'done' | 'error' | 'canceled';
export type ReviewVerdict = 'PASS' | 'ISSUES' | 'FAIL';

export interface ReviewRun {
  id: string;
  subAgentId: string;
  parentSessionId: string;
  reviewerProviderId: ProviderId;
  focus: ReviewFocus;
  status: ReviewStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  output: string;
  verdict?: ReviewVerdict;
  errorMessage?: string;
}

interface DonePayload {
  runId: string;
  subAgentId: string;
  status: ReviewStatus;
  verdict?: ReviewVerdict;
  durationMs: number;
  errorMessage?: string;
}

/**
 * Cross-conversation state for sub-agent reviews.
 *
 * Outlives the modal lifecycle so closing and reopening the dialog restores
 * the in-flight stream and the full history for that task. Hydrates lazily
 * from the main process the first time a task is queried.
 */
@Injectable({ providedIn: 'root' })
export class SubAgentReviewService {
  /** Map of subAgentId → review history, oldest first. */
  private readonly runs = signal<Map<string, ReviewRun[]>>(new Map());

  /** Tasks already hydrated from the main process. */
  private readonly hydrated = new Set<string>();

  /** Default reviewer config remembered between runs (in-session). */
  readonly lastReviewer = signal<ProviderId | null>(null);
  readonly lastFocus = signal<ReviewFocus>('free');

  private listenersAttached = false;
  private readonly notices = inject(AgentActionNoticeService);
  private readonly openers = new Map<string, () => void>();
  private readonly notified = new Set<string>();
  private readonly requested = new Set<string>();
  private readonly polls = new Map<string, ReturnType<typeof setInterval>>();

  registerOpener(taskId: string, open: () => void): void {
    this.openers.set(taskId, open);
  }

  /** Consecutive failed polls per task: a task whose history cannot be read stops polling. */
  private readonly pollFailures = new Map<string, number>();
  private static readonly MAX_POLL_FAILURES = 5;

  private watch(taskId: string): void {
    if (this.polls.has(taskId)) return;
    this.pollFailures.delete(taskId);
    this.polls.set(taskId, setInterval(() => void this.hydrateTask(taskId, true), 1000));
  }

  private stopWatching(taskId: string): void {
    clearInterval(this.polls.get(taskId));
    this.polls.delete(taskId);
    this.pollFailures.delete(taskId);
  }

  /** A failed poll; after a few in a row (agent gone, IPC down) the 1 s poll stops. */
  private pollFailed(taskId: string): void {
    if (!this.polls.has(taskId)) return;
    const n = (this.pollFailures.get(taskId) ?? 0) + 1;
    if (n >= SubAgentReviewService.MAX_POLL_FAILURES) this.stopWatching(taskId);
    else this.pollFailures.set(taskId, n);
  }

  private notifyDone(run: ReviewRun): void {
    if (run.status === 'running' || this.notified.has(run.id)) return;
    this.notified.add(run.id);
    const label = run.status === 'error' ? 'SUBAGENTS.REVIEW.Failed'
      : run.status === 'canceled' ? 'SUBAGENTS.REVIEW.Canceled' : 'SUBAGENTS.REVIEW.Review output';
    this.notices.show(run.subAgentId, label, () => this.openers.get(run.subAgentId)?.());
  }

  private get api(): any {
    return (window as any).promptops;
  }

  /** Attach push listeners exactly once. Safe to call multiple times. */
  startListening(): void {
    if (this.listenersAttached) return;
    if (!this.api?.onSubAgentReviewOutput) return;
    this.listenersAttached = true;

    this.api.onSubAgentReviewOutput(
      (_event: unknown, data: { runId: string; chunk: string }) => {
        this.appendChunk(data.runId, data.chunk);
      },
    );

    this.api.onSubAgentReviewDone(
      (_event: unknown, data: DonePayload) => {
        this.markDone(data);
      },
    );
  }

  // ── Read API ──────────────────────────────────────────────────

  /** Signal-driven list for a task. Cheap to consume in templates. */
  runsForTask(subAgentId: string): Signal<ReviewRun[]> {
    return computed(() => this.runs().get(subAgentId) ?? []);
  }

  latestForTask(subAgentId: string): Signal<ReviewRun | undefined> {
    return computed(() => {
      const list = this.runs().get(subAgentId) ?? [];
      return list.length > 0 ? list[list.length - 1] : undefined;
    });
  }

  /** Convenience for the button badge in sub-agent-panel. */
  countForTask(subAgentId: string): Signal<number> {
    return computed(() => (this.runs().get(subAgentId) ?? []).length);
  }

  hasActiveForTask(subAgentId: string): Signal<boolean> {
    return computed(() => (this.runs().get(subAgentId) ?? []).some((r) => r.status === 'running'));
  }

  // ── Hydration ─────────────────────────────────────────────────

  /** Ask the main process for the full history of a task. */
  async hydrateTask(subAgentId: string, refresh = false): Promise<void> {
    if (!this.api?.listSubAgentReviews) return;
    if (!refresh && this.hydrated.has(subAgentId)) return;
    this.hydrated.add(subAgentId);

    try {
      const res = await this.api.listSubAgentReviews(subAgentId);
      if (!res?.ok) { this.hydrated.delete(subAgentId); this.pollFailed(subAgentId); return; }
      this.pollFailures.delete(subAgentId);
      const list: ReviewRun[] = res.runs ?? [];
      const previous = this.runs().get(subAgentId) ?? [];
      this.runs.update((m) => {
        const next = new Map(m);
        next.set(subAgentId, [...list, ...(m.get(subAgentId) ?? []).filter(r => !list.some(saved => saved.id === r.id))]);
        return next;
      });
      for (const run of list) {
        if (this.requested.has(run.id) || previous.some(r => r.id === run.id && r.status === 'running')) this.notifyDone(run);
      }
      if (list.some(r => r.status === 'running')) this.watch(subAgentId);
      else this.stopWatching(subAgentId);
    } catch {
      this.hydrated.delete(subAgentId);
      this.pollFailed(subAgentId);
    }
  }

  // ── Mutations (issued by the modal) ───────────────────────────

  async start(
    subAgentId: string,
    reviewerProviderId: ProviderId,
    focus: ReviewFocus,
  ): Promise<string | null> {
    if (!this.api?.requestSubAgentReview) throw new Error('Review unavailable in this app');
    this.startListening();
    if (this.hasActiveForTask(subAgentId)()) throw new Error('A review is already running');
    this.lastReviewer.set(reviewerProviderId);
    this.lastFocus.set(focus);

    const res = await this.api.requestSubAgentReview({
      subAgentId,
      reviewerProviderId,
      focus,
    });
    if (!res?.ok) {
      throw new Error(res?.error ?? 'Failed to start review');
    }
    this.requested.add(res.runId);
    this.watch(subAgentId);
    await this.hydrateTask(subAgentId, true);
    return res.runId as string;
  }

  async cancel(runId: string): Promise<void> {
    if (!this.api?.cancelSubAgentReview) return;
    await this.api.cancelSubAgentReview(runId);
  }

  /** Wipe the cached history for a task (used by Clear-all). */
  clearTask(subAgentId: string): void {
    this.stopWatching(subAgentId);
    this.hydrated.delete(subAgentId);
    this.runs.update((m) => {
      const next = new Map(m);
      next.delete(subAgentId);
      return next;
    });
  }

  // ── Internal state updates ────────────────────────────────────

  private appendChunk(runId: string, chunk: string): void {
    this.runs.update((m) => {
      const next = new Map(m);
      for (const [subAgentId, list] of next) {
        const idx = list.findIndex((r) => r.id === runId);
        if (idx === -1) continue;
        const updated = [...list];
        const target = { ...updated[idx], output: updated[idx].output + chunk };
        updated[idx] = target;
        next.set(subAgentId, updated);
        break;
      }
      return next;
    });
  }

  private markDone(payload: DonePayload): void {
    this.runs.update((m) => {
      const next = new Map(m);
      const list = next.get(payload.subAgentId);
      if (!list) return next;
      const idx = list.findIndex((r) => r.id === payload.runId);
      if (idx === -1) return next;
      const updated = [...list];
      updated[idx] = {
        ...updated[idx],
        status: payload.status,
        verdict: payload.verdict,
        durationMs: payload.durationMs,
        finishedAt: Date.now(),
        errorMessage: payload.errorMessage,
      };
      next.set(payload.subAgentId, updated);
      this.notifyDone(updated[idx]);
      return next;
    });
  }

  /**
   * Register an optimistic new run in the local store right after the main
   * process accepts a `start` request. The chunks/done push events from main
   * will then patch this entry in place.
   */
  registerOptimistic(run: ReviewRun): void {
    this.runs.update((m) => {
      const next = new Map(m);
      const list = next.get(run.subAgentId) ?? [];
      if (!list.some(r => r.id === run.id)) next.set(run.subAgentId, [...list, run]);
      return next;
    });
    if (run.status !== 'running') this.notifyDone(run);
  }
}
