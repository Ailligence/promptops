import { createAction, props } from '@ngrx/store';
import { SessionTokenStats, DashboardTokenStats } from './token-efficiency.state';

// Session stats
export const loadSessionTokenStats = createAction(
  '[TokenEfficiency] Load Session Stats',
  props<{ sessionId: string }>(),
);
export const loadSessionTokenStatsSuccess = createAction(
  '[TokenEfficiency] Load Session Stats Success',
  props<{ stats: SessionTokenStats }>(),
);
export const loadSessionTokenStatsFailure = createAction(
  '[TokenEfficiency] Load Session Stats Failure',
  props<{ error: string }>(),
);

// Real-time update from IPC push
export const tokenUsageUpdated = createAction(
  '[TokenEfficiency] Usage Updated',
  props<{ sessionId: string; stats: SessionTokenStats }>(),
);

// Dashboard
export const loadDashboardStats = createAction('[TokenEfficiency] Load Dashboard');
export const loadDashboardStatsSuccess = createAction(
  '[TokenEfficiency] Load Dashboard Success',
  props<{ dashboard: DashboardTokenStats }>(),
);
export const loadDashboardStatsFailure = createAction(
  '[TokenEfficiency] Load Dashboard Failure',
  props<{ error: string }>(),
);

// Record usage (triggered from desktop app or API)
export const recordTokenUsage = createAction(
  '[TokenEfficiency] Record Usage',
  props<{
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedTokens: number;
    provider: string;
    estimationBreakdown?: Record<string, number>;
    optimizationFlags?: Record<string, boolean>;
  }>(),
);
export const recordTokenUsageSuccess = createAction(
  '[TokenEfficiency] Record Usage Success',
  props<{ stats: SessionTokenStats }>(),
);

// Provider usage (real rate-limit data from Anthropic)
export const providerUsageUpdated = createAction(
  '[TokenEfficiency] Provider Usage Updated',
  props<{ snapshot: import('./token-efficiency.state').ProviderUsageSnapshot }>(),
);

export const loadProviderUsage = createAction(
  '[TokenEfficiency] Load Provider Usage',
  props<{ sessionId: string }>(),
);

export const loadProviderUsageSuccess = createAction(
  '[TokenEfficiency] Load Provider Usage Success',
  props<{ snapshot: import('./token-efficiency.state').ProviderUsageSnapshot }>(),
);

export const probeProviderUsage = createAction(
  '[TokenEfficiency] Probe Provider Usage',
  // `provider`: hint for the desktop probe after a data-only provider switch
  // (composer chip) — the desktop side still maps the session to the provider
  // it was spawned with. Optional: older desktop builds simply ignore it.
  // `userInitiated`: true only for an explicit Refresh/Retry click. The
  // desktop launches the provider CLI (which signs in with the user's
  // account) only then; automatic probes answer from cache or fail with
  // `user-action-required`.
  props<{ sessionId: string; provider?: string; userInitiated?: boolean }>(),
);

export const providerUsageProbeFailed = createAction(
  '[TokenEfficiency] Provider Usage Probe Failed',
  props<{ error: import('./token-efficiency.state').ProviderUsageProbeError }>(),
);

export const clearProviderUsageProbeError = createAction(
  '[TokenEfficiency] Clear Provider Usage Probe Error',
  props<{ sessionId: string }>(),
);

// Clear
export const clearTokenStats = createAction('[TokenEfficiency] Clear');
