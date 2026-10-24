import { Injectable, signal } from '@angular/core';

/**
 * Stop-in-clear (F5): SessionHistoryService used to mirror every session
 * activity event into a row of `prompts WHERE status='session_log'` —
 * meaning every prompt-text the user typed in the terminal was persisted
 * in plain text. That table is no longer the ranking source
 * of truth (Task 16 switched to user_prompt_totals), so all logging
 * here is now a no-op.
 *
 * The class is preserved as a thin stub so existing component imports
 * and dependency injections do not break. It can be deleted entirely
 * once F6 cleanup removes the residual session_log rows.
 */
@Injectable({ providedIn: 'root' })
export class SessionHistoryService {
  /** Retained because some templates may still read it; always null now. */
  categoryId = signal<number | null>(null);

  setCategory(_categoryId: number | null, _sessionName: string, _sessionDbId?: string): void {}

  logWorkspaceCreated(_workspaceName: string, _projectPath: string): void {}
  logSessionCreated(_sessionName: string, _provider?: string): void {}
  logStart(_provider?: string): void {}
  logClose(): void {}
  logSpawn(_agentTitle: string, _prompt: string): void {}
  logMerge(_agentTitle: string): void {}
  logPrompt(_promptText: string): void {}
  logSlotExecuted(_slotLabel: string, _promptText: string): void {}
  logTabAdded(_sessionName: string): void {}

  /**
   * Used to be a remote category-create call; now a no-op that
   * always resolves to null. Callers expecting a number receive null
   * and short-circuit any downstream binding.
   */
  async createSessionCategory(_sessionName: string): Promise<number | null> {
    return null;
  }

  /**
   * Same: callers tolerated null already (as the original code returned
   * null on cache miss).
   */
  async ensureCategory(): Promise<number | null> {
    return null;
  }
}
