import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { SessionTokenStats, DashboardTokenStats } from '@/store/token-efficiency/token-efficiency.state';

/**
 * Token efficiency statistics. This edition keeps no usage history, so every
 * call answers "no data" and the views show their empty state.
 */
@Injectable({ providedIn: 'root' })
export class TokenEfficiencyApiService {
  /** Token usage for a prompt in a session: not recorded. */
  recordUsage(_data: {
    session_id: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_tokens: number;
    estimation_breakdown?: Record<string, number>;
    provider?: string;
    optimization_flags?: Record<string, boolean>;
  }): Observable<SessionTokenStats | null> {
    return of(null);
  }

  /** Token stats for a session: none. */
  getSessionStats(_sessionId: string): Observable<SessionTokenStats | null> {
    return of(null);
  }

  /** Aggregated stats: none. */
  getDashboardStats(): Observable<DashboardTokenStats | null> {
    return of(null);
  }
}
