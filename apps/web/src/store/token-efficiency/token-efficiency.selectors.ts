import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ProviderUsageSnapshot, TokenEfficiencyState } from './token-efficiency.state';

export const getTokenEfficiencyState = createFeatureSelector<TokenEfficiencyState>('tokenEfficiency');

export const getSessionTokenStats = (sessionId: string) =>
  createSelector(
    getTokenEfficiencyState,
    (state) => state.sessionStats[sessionId] ?? null,
  );

export const getAllSessionTokenStats = createSelector(
  getTokenEfficiencyState,
  (state) => state.sessionStats,
);

export const getDashboardTokenStats = createSelector(
  getTokenEfficiencyState,
  (state) => state.dashboard,
);

export const getTokenEfficiencyLoading = createSelector(
  getTokenEfficiencyState,
  (state) => state.loading,
);

export const getTokenEfficiencyError = createSelector(
  getTokenEfficiencyState,
  (state) => state.error,
);

// Provider usage selectors
export const getProviderUsage = (sessionId: string) =>
  createSelector(
    getTokenEfficiencyState,
    (state) => state.providerUsage[sessionId] ?? null,
  );

export const getAllProviderUsage = createSelector(
  getTokenEfficiencyState,
  (state) => state.providerUsage,
);

/**
 * Newest snapshot for a provider across every session (usage is an account
 * quota, not a session one). Lets the panel show the last known bars right
 * away on a provider switch while the delayed re-probe runs.
 */
export const getLatestProviderUsageForProvider = (provider: string) =>
  createSelector(
    getTokenEfficiencyState,
    (state) => {
      let best: ProviderUsageSnapshot | null = null;
      for (const snap of Object.values(state.providerUsage)) {
        if (snap.provider !== provider) continue;
        if (!best || Date.parse(snap.timestamp) > Date.parse(best.timestamp)) best = snap;
      }
      return best;
    },
  );

export const getProviderUsageError = (sessionId: string) =>
  createSelector(
    getTokenEfficiencyState,
    (state) => state.providerUsageErrors[sessionId] ?? null,
  );
