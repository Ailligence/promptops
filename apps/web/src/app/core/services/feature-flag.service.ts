import { Injectable, signal } from '@angular/core';

/**
 * Feature access service. Every feature of this build is enabled; each one
 * has a tier ('free' | 'pro') and the local profile reads as PRO, so
 * `canAccess` is true for all of them.
 *
 * Usage:
 *   ff.canAccess('database_explorer')  → true when the user is PRO
 *   ff.canAccess('git_panel')          → true
 *   ff.isPro()                         → true if current user has PRO
 */

export type Tier = 'free' | 'pro';

/** Tier of each feature. Features not listed are free. */
const FEATURES: Record<string, Tier> = {
  git_panel: 'free',
  ai_commit: 'free',
  multi_provider: 'free',
  sub_agents: 'free',
  quick_agents: 'free',
  session_history: 'free',
  prompt_library: 'free',
  teams: 'free',
  workspaces: 'free',
  access_control: 'free',
  database_explorer: 'pro',
  docker_integration: 'pro',
  voice_agent: 'pro',
};

@Injectable({ providedIn: 'root' })
export class FeatureFlagService {
  /** Reactive signal for user PRO status */
  userIsPro = signal(false);

  constructor() {
    this.refreshProStatus();
  }

  /** Re-read is_pro from localStorage (call after login/logout) */
  refreshProStatus(): void {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      this.userIsPro.set(!!user?.is_pro);
    } catch {
      this.userIsPro.set(false);
    }
  }

  /** Check if current user is PRO */
  isPro(): boolean {
    return this.userIsPro();
  }

  /** Check if a feature requires PRO tier */
  isProFeature(key: string): boolean {
    return FEATURES[key] === 'pro';
  }

  /**
   * Check if the current user can access a feature.
   * Free features → always accessible.
   * Pro features → only if user.is_pro.
   * Unknown features → accessible (fail-open).
   */
  canAccess(key: string): boolean {
    const tier = FEATURES[key];
    if (!tier) return true;
    if (tier === 'free') return true;
    return this.userIsPro();
  }

  /** Get the tier of a feature */
  getTier(key: string): Tier | null {
    return FEATURES[key] ?? null;
  }

  /** Get all features with tier info */
  getAllFeatures(): { key: string; tier: Tier }[] {
    return Object.entries(FEATURES).map(([key, tier]) => ({ key, tier }));
  }

  /** Re-reads the PRO status (kept for the app start sequence). */
  async loadFlags(): Promise<void> {
    this.refreshProStatus();
  }
}
