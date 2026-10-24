import { createReducer, on } from '@ngrx/store';
import { initialTokenEfficiencyState, TokenEfficiencyState } from './token-efficiency.state';
import {
  loadSessionTokenStats,
  loadSessionTokenStatsSuccess,
  loadSessionTokenStatsFailure,
  tokenUsageUpdated,
  loadDashboardStats,
  loadDashboardStatsSuccess,
  loadDashboardStatsFailure,
  recordTokenUsageSuccess,
  clearTokenStats,
  providerUsageUpdated,
  loadProviderUsageSuccess,
  providerUsageProbeFailed,
  clearProviderUsageProbeError,
} from './token-efficiency.actions';

export const tokenEfficiencyReducer = createReducer(
  initialTokenEfficiencyState,

  on(loadSessionTokenStats, (state): TokenEfficiencyState => ({
    ...state,
    loading: true,
  })),

  on(loadSessionTokenStatsSuccess, (state, { stats }): TokenEfficiencyState => ({
    ...state,
    sessionStats: {
      ...state.sessionStats,
      [stats.sessionId]: stats,
    },
    loading: false,
  })),

  on(loadSessionTokenStatsFailure, (state, { error }): TokenEfficiencyState => ({
    ...state,
    loading: false,
    error,
  })),

  // Real-time push from desktop IPC
  on(tokenUsageUpdated, (state, { sessionId, stats }): TokenEfficiencyState => ({
    ...state,
    sessionStats: {
      ...state.sessionStats,
      [sessionId]: stats,
    },
  })),

  on(loadDashboardStats, (state): TokenEfficiencyState => ({
    ...state,
    loading: true,
  })),

  on(loadDashboardStatsSuccess, (state, { dashboard }): TokenEfficiencyState => ({
    ...state,
    dashboard,
    loading: false,
  })),

  on(loadDashboardStatsFailure, (state, { error }): TokenEfficiencyState => ({
    ...state,
    loading: false,
    error,
  })),

  on(recordTokenUsageSuccess, (state, { stats }): TokenEfficiencyState => ({
    ...state,
    sessionStats: {
      ...state.sessionStats,
      [stats.sessionId]: stats,
    },
  })),

  // Provider usage push from desktop IPC
  on(providerUsageUpdated, (state, { snapshot }): TokenEfficiencyState => {
    const { [snapshot.sessionId]: _discarded, ...remainingErrors } = state.providerUsageErrors;
    return {
      ...state,
      providerUsage: {
        ...state.providerUsage,
        [snapshot.sessionId]: snapshot,
      },
      providerUsageErrors: remainingErrors,
    };
  }),

  on(loadProviderUsageSuccess, (state, { snapshot }): TokenEfficiencyState => {
    const { [snapshot.sessionId]: _discarded, ...remainingErrors } = state.providerUsageErrors;
    return {
      ...state,
      providerUsage: {
        ...state.providerUsage,
        [snapshot.sessionId]: snapshot,
      },
      providerUsageErrors: remainingErrors,
    };
  }),

  on(providerUsageProbeFailed, (state, { error }): TokenEfficiencyState => ({
    ...state,
    providerUsageErrors: {
      ...state.providerUsageErrors,
      [error.sessionId]: error,
    },
  })),

  on(clearProviderUsageProbeError, (state, { sessionId }): TokenEfficiencyState => {
    if (!state.providerUsageErrors[sessionId]) return state;
    const { [sessionId]: _discarded, ...remainingErrors } = state.providerUsageErrors;
    return { ...state, providerUsageErrors: remainingErrors };
  }),

  on(clearTokenStats, (): TokenEfficiencyState => ({ ...initialTokenEfficiencyState })),
);
