import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { filter, firstValueFrom, take, timeout } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { SwalService } from '@core/services/swal.service';
import { OrgPolicyService } from '@core/services/org-policy.service';
import { escapeHtml } from './remote-bridge.service';
import { createSession, createSessionFailure, createSessionSuccess, newCreateSessionRequestId, setActiveSession } from '../../../../../store/sessions/session.actions';
import { getSessions } from '../../../../../store/sessions/session.selectors';
import { SubAgentService } from './sub-agent.service';
import { MODEL_FLAGS } from './model-labels';

/** Payload of `ctl:agent-move` (agent_ctl::move_to_session). */
interface AgentMoveRequest {
  subAgentId: string;
  parentSessionId: string;
  name: string;
  provider: string;
  model?: string | null;
  providerSessionId?: string | null;
  workspacePath?: string | null;
}

/** Lets the agent's MCP tool reply before its terminal goes away. */
const REPLY_GRACE_MS = 1200;

/**
 * "Move me to a new session" from the PromptOps MCP: creates a session
 * with the name the user typed (same provider + workspace), resuming the
 * agent's conversation there, closes the sub-agent and opens the session.
 * Tauri only: the event does not exist on the web.
 */
@Injectable({ providedIn: 'root' })
export class AgentMoveService {
  private store = inject(Store);
  private actions$ = inject(Actions);
  private router = inject(Router);
  private subAgents = inject(SubAgentService);
  private swal = inject(SwalService);
  private translate = inject(TranslateService);
  private orgPolicy = inject(OrgPolicyService);
  private started = false;
  private inFlight = new Set<string>();

  init(): void {
    const api = (window as any).promptops;
    if (this.started || !api?.onCtlAgentMove) return;
    this.started = true;
    api.onCtlAgentMove((_e: unknown, request: AgentMoveRequest) => {
      if (request?.subAgentId) void this.move(request);
    });
    // Same channel family: "mettiti/mettilo in panchina" from the MCP.
    api.onCtlAgentBench?.((_e: unknown, request: { parentSessionId: string; role: string; title: string; benched: boolean }) => {
      if (request?.parentSessionId && request.title) this.subAgents.applyCtlBench(request);
    });
  }

  private async move(request: AgentMoveRequest): Promise<void> {
    if (this.inFlight.has(request.subAgentId)) return;
    if (this.subAgents.isLocked(request.subAgentId)) {
      // The agent was already told it is moving: say why it did not.
      this.swal.error(this.translate.instant('SUBAGENTS.Move locked'));
      return;
    }
    // Checked before the agent is closed: a refused provider would leave the
    // conversation with no terminal at all.
    if (!this.orgPolicy.isProviderAllowed(request.provider)) {
      this.swal.error(escapeHtml(this.orgPolicy.deniedMessage(request.provider)));
      return;
    }
    this.inFlight.add(request.subAgentId);
    try {
      await new Promise((resolve) => setTimeout(resolve, REPLY_GRACE_MS));
      // The agent stops first: the same conversation must not run in two terminals.
      await this.subAgents.destroy(request.subAgentId);

      const sessions = await firstValueFrom(this.store.select(getSessions).pipe(take(1)));
      // Saving a session replaces the one with the same name: never take a
      // name another session already has.
      const taken = new Set(sessions.map((s) => s.name));
      let name = request.name;
      for (let n = 2; taken.has(name); n++) name = `${request.name} (${n})`;
      const parentSession = sessions.find((s) => s.id === request.parentSessionId);
      const cwd = request.workspacePath ?? parentSession?.workspace?.path;
      const config: Record<string, unknown> = {};
      if (cwd) config['cwd'] = cwd;
      // Same shape as a provider switch (session.rs): the model travels as CLI args.
      const providerOptions: Record<string, unknown> = {};
      const family = ['zai', 'kimi'].includes(request.provider) ? 'claude-code-cli' : request.provider;
      const modelFlag = MODEL_FLAGS[family];
      if (request.model && modelFlag) providerOptions['args'] = `${modelFlag} ${request.model}`;
      if (request.providerSessionId) Object.assign(providerOptions, { resume: true, claudeSessionId: request.providerSessionId });
      if (Object.keys(providerOptions).length) config['providerOptions'] = providerOptions;

      // Only OUR session's outcome: a session the user creates meanwhile must
      // not be opened (or reported) as the moved one.
      const requestId = newCreateSessionRequestId();
      const created$ = firstValueFrom(this.actions$.pipe(
        ofType(createSessionSuccess, createSessionFailure),
        filter((a) => a.requestId === requestId),
        take(1),
        timeout(60_000),
      )).catch(() => createSessionFailure({ error: 'timed out' }));
      this.store.dispatch(createSession({
        requestId,
        name,
        provider: request.provider,
        config,
        workspaceId: parentSession?.workspaceId ?? null,
        categoryId: parentSession?.categoryId ?? null,
      }));
      const result = await created$;
      if (result.type === createSessionFailure.type) {
        console.warn('[agent-move] session not created', (result as ReturnType<typeof createSessionFailure>).error);
        this.reportFailure(request);
        return;
      }
      const session = (result as ReturnType<typeof createSessionSuccess>).session;
      this.store.dispatch(setActiveSession({ sessionId: session.id }));
      if (!this.router.url.startsWith('/admin/sessions')) await this.router.navigate(['/admin/sessions']);
    } catch (err) {
      console.warn('[agent-move] move failed', err);
      this.reportFailure(request);
    } finally {
      this.inFlight.delete(request.subAgentId);
    }
  }

  /** The agent's terminal is gone: tell the user how to get the conversation back. */
  private reportFailure(request: AgentMoveRequest): void {
    let text = this.translate.instant('SUBAGENTS.Move failed');
    if (request.providerSessionId) {
      text += '<br>' + this.translate.instant('SUBAGENTS.Move failed resume', { id: escapeHtml(request.providerSessionId) });
    }
    this.swal.error(text);
  }
}
