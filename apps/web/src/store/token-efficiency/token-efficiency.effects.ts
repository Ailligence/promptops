import { Injectable, inject, NgZone } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { from, of } from 'rxjs';
import { map, switchMap, catchError, tap } from 'rxjs/operators';
import {
  loadSessionTokenStats,
  loadSessionTokenStatsSuccess,
  loadSessionTokenStatsFailure,
  loadDashboardStats,
  loadDashboardStatsSuccess,
  loadDashboardStatsFailure,
  recordTokenUsage,
  recordTokenUsageSuccess,
  tokenUsageUpdated,
  providerUsageUpdated,
  loadProviderUsage,
  loadProviderUsageSuccess,
  probeProviderUsage,
  providerUsageProbeFailed,
} from './token-efficiency.actions';
import { SessionTokenStats, ProviderUsageSnapshot, ProviderUsageProbeError } from './token-efficiency.state';
import { TokenEfficiencyApiService } from '../../app/views/admin-core/sessions/services/token-efficiency-api.service';
import { SessionService } from '../../app/views/admin-core/sessions/services/session.service';
import { Store } from '@ngrx/store';

@Injectable()
export class TokenEfficiencyEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private apiService = inject(TokenEfficiencyApiService);
  private sessionService = inject(SessionService);
  private ngZone = inject(NgZone);
  private ipcCleanup: (() => void) | null = null;

  private providerUsageCleanup: (() => void) | null = null;
  private providerUsageFailedCleanup: (() => void) | null = null;

  constructor() {
    this.setupIpcListener();
    this.setupProviderUsageListener();
  }

  /**
   * Listen for real-time token usage updates from desktop IPC.
   */
  private setupIpcListener(): void {
    if (!this.sessionService.isDesktop) return;

    this.ipcCleanup = this.sessionService.onTokenUsageUpdated((data) => {
      this.ngZone.run(() => {
        const stats: SessionTokenStats = {
          sessionId: data.sessionId,
          tokensUsed: data.stats.tokens_used,
          tokensEstimated: data.stats.tokens_estimated,
          tokensSaved: data.stats.tokens_saved,
          savingsAvailable: data.stats.savings_available,
          efficiencyPercentage: data.stats.efficiency_percentage,
          breakdown: data.stats.breakdown ?? null,
          optimizationFlags: data.stats.optimization_flags ?? null,
          optimizationAnalytics: data.stats.optimization_analytics ?? null,
          promptCount: data.stats.prompt_count ?? undefined,
          cacheReadTokens: data.stats.cache_read_tokens ?? undefined,
          cacheHitPercentage: data.stats.cache_hit_percentage ?? undefined,
          costUsd: data.stats.cost_usd ?? undefined,
          costSavedUsd: data.stats.cost_saved_usd ?? undefined,
          cacheSavedUsd: data.stats.cache_saved_usd ?? undefined,
          lastContextTokens: data.stats.last_context_tokens ?? undefined,
          lastActivityMs: data.stats.last_activity_ms ?? undefined,
          cacheTtlMs: data.stats.cache_ttl_ms ?? undefined,
          agentContexts: data.stats.agent_contexts ?? undefined,
          coldResumeCount: data.stats.cold_resume_count ?? undefined,
          coldResumeTokens: data.stats.cold_resume_tokens ?? undefined,
          compactionsByPromptops: data.stats.compactions_by_promptops ?? undefined,
        };
        this.store.dispatch(tokenUsageUpdated({ sessionId: data.sessionId, stats }));
      });
    });
  }

  /**
   * Listen for real-time provider usage updates from desktop IPC.
   */
  private setupProviderUsageListener(): void {
    if (!this.sessionService.isDesktop) return;

    const promptops = (window as any).promptops;
    if (!promptops?.onProviderUsageUpdated) return;

    this.providerUsageCleanup = promptops.onProviderUsageUpdated((_event: unknown, data: any) => {
      this.ngZone.run(() => {
        this.store.dispatch(providerUsageUpdated({ snapshot: data }));
      });
    });

    if (promptops.onProviderUsageProbeFailed) {
      this.providerUsageFailedCleanup = promptops.onProviderUsageProbeFailed((_event: unknown, data: any) => {
        this.ngZone.run(() => {
          const error: ProviderUsageProbeError = {
            sessionId: data.sessionId,
            provider: data.provider,
            reason: data.reason,
            detail: data.detail,
            timestamp: new Date().toISOString(),
          };
          this.store.dispatch(providerUsageProbeFailed({ error }));
        });
      });
    }
  }

  /**
   * Load provider usage for a session (desktop IPC).
   */
  loadProviderUsage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadProviderUsage),
      switchMap(({ sessionId }) => {
        if (!this.sessionService.isDesktop) return of();
        const promptops = (window as any).promptops;
        if (!promptops?.getProviderUsage) return of();

        return from(promptops.getProviderUsage(sessionId)).pipe(
          map((snapshot: any) => {
            if (snapshot) return loadProviderUsageSuccess({ snapshot });
            return { type: '[TokenEfficiency] Provider Usage Not Available' };
          }),
          catchError(() => of({ type: '[TokenEfficiency] Provider Usage Error' })),
        );
      }),
    ),
  );

  /**
   * Trigger a fresh provider usage probe.
   */
  probeProviderUsage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(probeProviderUsage),
      switchMap(({ sessionId, provider, userInitiated }) => {
        if (!this.sessionService.isDesktop) return of();
        const promptops = (window as any).promptops;
        if (!promptops?.probeProviderUsage) return of();

        return from(promptops.probeProviderUsage(sessionId, provider, userInitiated === true)).pipe(
          map((snapshot: any) => {
            if (snapshot) return loadProviderUsageSuccess({ snapshot });
            return { type: '[TokenEfficiency] Provider Probe No Result' };
          }),
          catchError(() => of({ type: '[TokenEfficiency] Provider Probe Error' })),
        );
      }),
    ),
  );

  /**
   * Load session stats — tries desktop IPC first, falls back to API.
   */
  loadSessionStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadSessionTokenStats),
      switchMap(({ sessionId }) => {
        if (this.sessionService.isDesktop) {
          return from(this.sessionService.getTokenStats(sessionId)).pipe(
            map((localStats) => {
              if (localStats) {
                const stats: SessionTokenStats = {
                  sessionId,
                  tokensUsed: localStats.tokensUsed ?? 0,
                  tokensEstimated: localStats.tokensEstimated ?? 0,
                  tokensSaved: localStats.tokensSaved ?? 0,
                  savingsAvailable: localStats.savingsAvailable,
                  efficiencyPercentage: localStats.efficiencyPercentage ?? 0,
                  breakdown: localStats.breakdown ?? null,
                  optimizationFlags: localStats.optimizationFlags ?? null,
                  optimizationAnalytics: localStats.optimizationAnalytics ?? null,
                  promptCount: localStats.promptCount ?? undefined,
                  cacheReadTokens: localStats.cacheReadTokens ?? undefined,
                  cacheHitPercentage: localStats.cacheHitPercentage ?? undefined,
                  costUsd: localStats.costUsd ?? undefined,
                  costSavedUsd: localStats.costSavedUsd ?? undefined,
                  cacheSavedUsd: localStats.cacheSavedUsd ?? undefined,
                  lastContextTokens: localStats.lastContextTokens ?? undefined,
                  lastActivityMs: localStats.lastActivityMs ?? undefined,
                  cacheTtlMs: localStats.cacheTtlMs ?? undefined,
                  agentContexts: localStats.agentContexts ?? undefined,
                  coldResumeCount: localStats.coldResumeCount ?? undefined,
                  coldResumeTokens: localStats.coldResumeTokens ?? undefined,
                  compactionsByPromptops: localStats.compactionsByPromptops ?? undefined,
                };
                return loadSessionTokenStatsSuccess({ stats });
              }
              // No local stats — empty state
              return loadSessionTokenStatsSuccess({
                stats: { sessionId, tokensUsed: 0, tokensEstimated: 0, tokensSaved: 0, savingsAvailable: false, efficiencyPercentage: 0, breakdown: null, optimizationFlags: null, optimizationAnalytics: null },
              });
            }),
            catchError((err) => of(loadSessionTokenStatsFailure({ error: err.message }))),
          );
        }

        // Web-only: fetch from API
        return this.apiService.getSessionStats(sessionId).pipe(
          map((stats) => {
            if (stats) return loadSessionTokenStatsSuccess({ stats });
            return loadSessionTokenStatsSuccess({
              stats: { sessionId, tokensUsed: 0, tokensEstimated: 0, tokensSaved: 0, efficiencyPercentage: 0, breakdown: null, optimizationFlags: null, optimizationAnalytics: null },
            });
          }),
          catchError((err) => of(loadSessionTokenStatsFailure({ error: err.message }))),
        );
      }),
    ),
  );

  /**
   * Load dashboard stats from API.
   */
  loadDashboard$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadDashboardStats),
      switchMap(() =>
        this.apiService.getDashboardStats().pipe(
          map((dashboard) => {
            if (dashboard) return loadDashboardStatsSuccess({ dashboard });
            return loadDashboardStatsSuccess({
              dashboard: { totalTokensUsed: 0, totalTokensEstimated: 0, totalTokensSaved: 0, averageEfficiency: 0, sessionCount: 0, topSessions: [] },
            });
          }),
          catchError((err) => of(loadDashboardStatsFailure({ error: err.message }))),
        ),
      ),
    ),
  );

  /**
   * Record token usage — save to API for persistence.
   */
  recordUsage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(recordTokenUsage),
      switchMap(({ sessionId, inputTokens, outputTokens, totalTokens, estimatedTokens, provider, estimationBreakdown, optimizationFlags }) =>
        this.apiService.recordUsage({
          session_id: sessionId,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: totalTokens,
          estimated_tokens: estimatedTokens,
          estimation_breakdown: estimationBreakdown,
          provider,
          optimization_flags: optimizationFlags,
        }).pipe(
          map((stats) => {
            if (stats) return recordTokenUsageSuccess({ stats });
            return recordTokenUsageSuccess({
              stats: { sessionId, tokensUsed: totalTokens, tokensEstimated: estimatedTokens, tokensSaved: Math.max(0, estimatedTokens - totalTokens), efficiencyPercentage: 0, breakdown: null, optimizationFlags: null, optimizationAnalytics: null },
            });
          }),
          catchError(() => of(recordTokenUsageSuccess({
            stats: { sessionId, tokensUsed: totalTokens, tokensEstimated: estimatedTokens, tokensSaved: Math.max(0, estimatedTokens - totalTokens), efficiencyPercentage: 0, breakdown: null, optimizationFlags: null, optimizationAnalytics: null },
          }))),
        ),
      ),
    ),
  );
}
