import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export type SessionEventType =
  | 'spawn'
  | 'merge'
  | 'status'
  | 'output'
  | 'error'
  | 'prompt'
  | 'action'
  | 'start'
  | 'close'
  | 'slot'
  | 'tab'
  | 'workspace';

export interface SessionEventPayload {
  event_type: SessionEventType;
  sub_agent_id?: string | null;
  actor?: string | null;
  data?: Record<string, unknown> | null;
}

export interface SessionEvent {
  id: string;
  session_id: string;
  sub_agent_id: string | null;
  event_type: SessionEventType;
  actor: string | null;
  data: Record<string, unknown> | null;
  sequence: number;
  created_at: string;
  session_name?: string;
}

/**
 * Session events are not recorded: prompt text and output snapshots are
 * never stored. The recordXxx() methods are no-ops kept so call sites
 * stay simple.
 *
 * The fetchTimeline-style methods return empty observables — no
 * UI consumes them today (verified before stop-in-clear).
 */
@Injectable({ providedIn: 'root' })
export class SessionEventService {
  setSession(_sessionDbId: string | null): void {}

  recordSpawn(_subAgentId: string, _title: string, _prompt: string, _mode?: string): void {}
  recordStatus(_subAgentId: string, _title: string, _status: string): void {}
  recordOutput(_subAgentId: string, _title: string, _output: string): void {}
  recordError(_subAgentId: string, _title: string, _error: string): void {}
  recordMerge(_subAgentId: string, _title: string): void {}
  recordPrompt(): void {}
  recordStart(_provider?: string): void {}
  recordClose(): void {}
  recordSlot(_slotLabel: string, _promptText: string): void {}
  recordAction(_actor: string, _action: string, _details?: Record<string, unknown>): void {}

  getSessionTimeline(
    _sessionId: string,
    _opts?: { event_type?: string; sub_agent_id?: string; limit?: number },
  ): Observable<SessionEvent[]> {
    return of([]);
  }

  getWorkspaceTimeline(
    _workspaceId: string,
    _opts?: { event_type?: string; sub_agent_id?: string; limit?: number },
  ): Observable<SessionEvent[]> {
    return of([]);
  }
}
