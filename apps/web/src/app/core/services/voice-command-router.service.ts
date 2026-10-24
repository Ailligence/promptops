import { Injectable, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { getActiveSessionId, getSessions, getSessionsByWorkspaceId } from '@/store/sessions/session.selectors';
import { setActiveSession } from '@/store/sessions/session.actions';
import { getWorkspaces } from '@/store/workspaces/workspace.selectors';
import { setActiveWorkspace } from '@/store/workspaces/workspace.actions';
import { SessionService } from '@/app/views/admin-core/sessions/services/session.service';
import { SubAgentService } from '@/app/views/admin-core/sessions/services/sub-agent.service';
import { VoiceIntentRegistryService, MatchedIntent } from './voice-intent-registry.service';
import { SupportedLang, VoiceCommandId, VOICE_COMMANDS } from '@/app/components/voice-agent/voice-commands-data';

import { SpawnSelectionService } from '../../views/admin-core/sessions/services/spawn-selection.service';
import type { SubAgentProvider } from '../../views/admin-core/sessions/services/sub-agent.service';
export interface RouteResult {
  ok: boolean;
  intentId?: VoiceCommandId;
  /** Short feedback for UI ("Apertura sessioni…"). */
  feedback?: string;
  /** True when the action requires a separate user confirmation step. */
  needsConfirmation?: boolean;
  /** Pending payload when needsConfirmation = true. */
  pending?: { type: 'session.close' | 'prompt.run'; data: any };
  error?: string;
  /** When set, signals to the host UI to open the help modal. */
  openHelp?: boolean;
}

const DANGEROUS_KEYWORDS = [
  'rm -rf', 'rm -r /', 'mkfs', 'dd if=', ':(){', 'chmod -R 777 /', 'format c:',
  'git push --force', 'git reset --hard', 'drop table', 'delete from',
];

/** Last sent prompt per session, used by prompt.repeat. */
const lastPromptCache = new Map<string, string>();

@Injectable({ providedIn: 'root' })
export class VoiceCommandRouterService {
  private router = inject(Router);
  private spawnSelection = inject(SpawnSelectionService);
  private store = inject(Store);
  private sessionService = inject(SessionService);
  private subAgentService = inject(SubAgentService);
  private location = inject(Location);
  private registry = inject(VoiceIntentRegistryService);
  private translate = inject(TranslateService);

  private t(key: string, params?: Record<string, any>): string {
    return this.translate.instant(`voice.feedback.${key}`, params);
  }

  async route(text: string, lang: SupportedLang | null): Promise<RouteResult> {
    // Composite handling: try splitting on natural separators ("," or
    // language-specific connectors). If every segment matches as its own
    // intent, run them in series — max 2 to keep behavior predictable.
    // If splitting produces an unmatched segment, fall through to the
    // single-intent path (this also protects "send ciao, mondo" where the
    // comma is internal to the spoken message).
    const segments = this.splitComposite(text);
    if (segments.length >= 2) {
      const matchedSegs = segments.slice(0, 2).map((seg) => ({ seg, m: this.registry.match(seg, lang) }));
      if (matchedSegs.every((s) => s.m)) {
        return this.executeChain(matchedSegs as { seg: string; m: MatchedIntent }[]);
      }
    }

    const matched = this.registry.match(text, lang);
    if (!matched) {
      console.info('[voice] no match', { text, lang });
      return { ok: false, feedback: `"${text}" — not recognized`, error: 'no-match' };
    }
    console.info('[voice] matched', {
      intent: matched.command.id,
      score: matched.score,
      lang: matched.matchedLang,
      param: matched.param,
      n: matched.n,
    });
    const result = await this.execute(matched);
    console.info('[voice] routed', {
      intent: matched.command.id,
      ok: result.ok,
      needsConfirmation: result.needsConfirmation ?? false,
      error: result.error,
    });
    return result;
  }

  /**
   * Programmatic entry point for UI quick actions (voice quick panel):
   * runs a command by id with the same side effects as the spoken phrase,
   * skipping speech matching entirely.
   */
  async executeCommand(id: VoiceCommandId, opts: { n?: number; param?: string } = {}): Promise<RouteResult> {
    const command = VOICE_COMMANDS.find((c) => c.id === id);
    if (!command) return { ok: false, error: 'unknown-command' };
    return this.execute({ command, n: opts.n, param: opts.param, score: 1, matchedLang: 'en' });
  }

  /**
   * Splits a transcript into ordered segments on natural connectors.
   * Returns single-element array when no separator matches.
   */
  private splitComposite(text: string): string[] {
    // Connectors per language. Order matters: longer phrases first so that
    // "e poi" beats "e", "and then" beats "and".
    const connectors = [
      ' e poi ',     // it
      ' poi ',       // it
      ' and then ',  // en
      ' then ',      // en
      ' y luego ',   // es
      ' y después ', // es
      ' luego ',     // es
      ' et puis ',   // fr
      ' puis ',      // fr
      ' e depois ',  // pt
      ' depois ',    // pt
    ];
    let parts: string[] = [text];
    for (const conn of connectors) {
      parts = parts.flatMap((p) => p.split(new RegExp(this.escapeRegex(conn), 'i')));
    }
    // Then comma split as the final pass (so "x e poi y, z" → 3 parts).
    parts = parts.flatMap((p) => p.split(','));
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Run up to 2 matched intents in order. Stops at the first segment that
   * needs confirmation or fails — confirmation never carries a follow-up.
   */
  private async executeChain(segs: { seg: string; m: MatchedIntent }[]): Promise<RouteResult> {
    const feedbacks: string[] = [];
    let lastResult: RouteResult | null = null;
    for (const { seg, m } of segs) {
      console.info('[voice] composite-step', { seg, intent: m.command.id });
      const r = await this.execute(m);
      lastResult = r;
      if (r.feedback) feedbacks.push(r.feedback);
      if (r.needsConfirmation || !r.ok) break;
    }
    if (!lastResult) return { ok: false, error: 'composite-empty' };
    return {
      ...lastResult,
      feedback: feedbacks.join(' · '),
    };
  }

  private async execute(intent: MatchedIntent): Promise<RouteResult> {
    const id = intent.command.id;
    try {
      switch (id) {
        // ── Navigation ─────────────────────────────────────────
        case 'nav.sessions':
        case 'nav.workspaces':
          await this.router.navigate(['/admin/sessions']);
          return { ok: true, intentId: id, feedback: this.t('navigated_sessions') };
        case 'nav.settings':
          await this.router.navigate(['/admin/app-settings']);
          return { ok: true, intentId: id, feedback: this.t('navigated_settings') };
        case 'nav.ranking':
          await this.router.navigate(['/admin/ranking']);
          return { ok: true, intentId: id, feedback: this.t('navigated_ranking') };
        case 'nav.back':
          this.location.back();
          return { ok: true, intentId: id, feedback: this.t('back') };
        case 'nav.forward':
          this.location.forward();
          return { ok: true, intentId: id, feedback: this.t('forward') };

        // ── Session ────────────────────────────────────────────
        case 'session.open':
          return this.openSessionByName(intent.param ?? '');
        case 'session.openByNumber':
          return this.openSessionBySlot(intent.n ?? 0);
        case 'session.next':
          return this.cycleSession(+1);
        case 'session.previous':
          return this.cycleSession(-1);
        case 'session.new':
          await this.router.navigate(['/admin/sessions'], { queryParams: { new: 1 } });
          return { ok: true, intentId: id, feedback: this.t('new_session') };
        case 'session.close':
          return {
            ok: true,
            intentId: id,
            needsConfirmation: true,
            feedback: this.t('confirm_close_session'),
            pending: { type: 'session.close', data: { sessionId: await this.getActiveSessionIdValue() } },
          };

        case 'workspace.open':
          // Workspace is a sub-concept of sessions in this app — same UX as session.open
          return this.openSessionByName(intent.param ?? '');

        // ── Focus ──────────────────────────────────────────────
        case 'focus.subagent':
          return this.focusSubAgentSlot(intent.n ?? 0);
        case 'focus.terminal':
          return this.focusMainTerminal();
        case 'focus.subagentNext':
          return this.cycleSubAgent(+1);
        case 'focus.subagentPrev':
          return this.cycleSubAgent(-1);
        case 'focus.listAgents':
          return this.listAgents();
        case 'subagent.spawn':
          return this.spawnSubAgentWithPrompt(intent.param ?? '');

        // ── Prompt ─────────────────────────────────────────────
        case 'prompt.send':
          return this.sendToFocused(intent.param ?? '', { autoSubmit: true });
        case 'prompt.compose':
          return this.sendToFocused(intent.param ?? '', { autoSubmit: false });
        case 'prompt.run':
          return this.runCommandOnFocused(intent.param ?? '');
        case 'prompt.repeat':
          return this.repeatLastPrompt();
        case 'prompt.cancelLast':
          return this.sendCtrlC();
        case 'prompt.clear':
          return this.sendToFocused('clear', { autoSubmit: true });

        // ── Control ────────────────────────────────────────────
        case 'control.cancel':
          return { ok: true, intentId: id, feedback: this.t('canceled') };
        case 'control.help':
          return { ok: true, intentId: id, openHelp: true, feedback: this.t('opening_guide') };
        case 'control.confirm':
        case 'control.reject':
        case 'control.repeat':
          // These are handled by the host UI in the context of a pending action.
          return { ok: true, intentId: id, feedback: '' };

        default:
          return { ok: false, intentId: id, error: 'not-implemented' };
      }
    } catch (err: any) {
      return { ok: false, intentId: id, error: err?.message || 'execution failed' };
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async getActiveSessionIdValue(): Promise<string | null> {
    return firstValueFrom(this.store.select(getActiveSessionId).pipe(take(1)));
  }

  private async getSessionsValue() {
    return firstValueFrom(this.store.select(getSessions).pipe(take(1)));
  }

  /**
   * Reduce a string to a comparable "slug": lowercase + only [a-z0-9],
   * dropping spaces, hyphens, underscores, dots, accents. So that
   * "Prompt-Ops 2025" and "promptops2025" collide.
   */
  private slugify(s: string): string {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
      .replace(/[^a-z0-9]+/g, '');
  }

  /** Levenshtein distance — used as a last-resort fuzzy match for typos. */
  private levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let curr = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const next = Math.min(prev[j] + 1, curr + 1, prev[j - 1] + cost);
        prev[j - 1] = curr;
        curr = next;
      }
      prev[b.length] = curr;
    }
    return prev[b.length];
  }

  /**
   * Find the best fuzzy match for `needle` in a list of `{id, name}` items.
   * Returns the matched item or null. Tries: exact, slug-equal, slug-substring,
   * word-substring, token-overlap, then Levenshtein on slug.
   */
  private findBestMatch<T extends { id: string; name: string }>(needle: string, items: T[]): T | null {
    if (!items.length) return null;
    const lower = needle.toLowerCase();
    const wantSlug = this.slugify(needle);

    let match = items.find((i) => i.name.toLowerCase() === lower);
    if (!match) match = items.find((i) => this.slugify(i.name) === wantSlug);
    if (!match) match = items.find((i) => {
      const ss = this.slugify(i.name);
      return ss.includes(wantSlug) || wantSlug.includes(ss);
    });
    if (!match) match = items.find((i) => i.name.toLowerCase().includes(lower) || lower.includes(i.name.toLowerCase()));
    if (!match) {
      const words = lower.split(/\s+/);
      let bestScore = 0;
      for (const i of items) {
        const sWords = i.name.toLowerCase().split(/[\s\-_]+/);
        const score = words.filter((w) => sWords.some((sw) => sw.includes(w) || w.includes(sw))).length;
        if (score > bestScore) { bestScore = score; match = i; }
      }
      if (bestScore === 0) match = undefined;
    }
    if (!match) {
      let bestDist = Infinity;
      let bestCandidate: T | undefined;
      for (const i of items) {
        const d = this.levenshtein(wantSlug, this.slugify(i.name));
        if (d < bestDist) { bestDist = d; bestCandidate = i; }
      }
      const tolerance = Math.max(2, Math.floor(wantSlug.length * 0.25));
      if (bestCandidate && bestDist <= tolerance) match = bestCandidate;
    }
    return match ?? null;
  }

  private async getWorkspacesValue(): Promise<{ id: string; name: string }[]> {
    const w = await firstValueFrom(this.store.select(getWorkspaces).pipe(take(1)));
    return (w ?? []) as { id: string; name: string }[];
  }

  /**
   * "Open session X" (in any supported language) — searches BOTH workspaces and sessions, picks the
   * stronger match. Workspaces take priority on equal-quality matches because
   * they are the parent concept; selecting a workspace also routes to /sessions.
   */
  private async openSessionByName(name: string): Promise<RouteResult> {
    const trimmed = name.replace(/[.,;:!?"]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!trimmed) return { ok: false, intentId: 'session.open', error: this.t('no_name') };

    const [sessions, workspaces] = await Promise.all([this.getSessionsValue(), this.getWorkspacesValue()]);
    const wantSlug = this.slugify(trimmed);

    // Prefer workspace if its slug is exact/contained — that's the most likely
    // intent when the user says a top-level project name.
    const wsExact = workspaces.find((w) => this.slugify(w.name) === wantSlug);
    if (wsExact) return this.activateWorkspace(wsExact, trimmed);

    const sessionMatch = this.findBestMatch(trimmed, sessions);
    if (sessionMatch) return this.activateSession(sessionMatch, trimmed);

    const wsMatch = this.findBestMatch(trimmed, workspaces);
    if (wsMatch) return this.activateWorkspace(wsMatch, trimmed);

    if (sessions.length === 0 && workspaces.length === 0) {
      return { ok: false, intentId: 'session.open', error: this.t('no_sessions') };
    }
    return { ok: false, intentId: 'session.open', error: this.t('session_not_found', { name: trimmed }) };
  }

  private async activateSession(match: { id: string; name: string }, asked: string): Promise<RouteResult> {
    console.info('[voice] activating session', { id: match.id, name: match.name, asked });
    await this.router.navigate(['/admin/sessions']);
    this.store.dispatch(setActiveSession({ sessionId: match.id }));
    this.subAgentService.setVoiceFocus(null);
    await this.syncFocusToBackend({ sessionId: match.id, subAgentSlot: null, subAgentId: null });
    return { ok: true, intentId: 'session.open', feedback: this.t('opened', { name: match.name }) };
  }

  private async activateWorkspace(match: { id: string; name: string }, asked: string): Promise<RouteResult> {
    console.info('[voice] activating workspace', { id: match.id, name: match.name, asked });
    this.store.dispatch(setActiveWorkspace({ workspaceId: match.id }));
    await this.router.navigate(['/admin/sessions']);
    this.subAgentService.setVoiceFocus(null);

    // Open the FIRST session of this workspace if there is one — saves the
    // user one extra click. Sorted by createdAt so it's deterministic.
    const wsSessions = await firstValueFrom(
      this.store.select(getSessionsByWorkspaceId(match.id)).pipe(take(1)),
    );
    if (wsSessions && wsSessions.length > 0) {
      const first = [...wsSessions].sort((a: any, b: any) =>
        String(a.created_at ?? a.createdAt ?? '').localeCompare(String(b.created_at ?? b.createdAt ?? '')),
      )[0];
      this.store.dispatch(setActiveSession({ sessionId: first.id }));
      await this.syncFocusToBackend({ sessionId: first.id, subAgentSlot: null, subAgentId: null });
      console.info('[voice] auto-opened first session of workspace', { sessionId: first.id, name: first.name });
      return { ok: true, intentId: 'workspace.open', feedback: this.t('opened', { name: `${match.name} → ${first.name}` }) };
    }
    return { ok: true, intentId: 'workspace.open', feedback: this.t('opened', { name: match.name }) };
  }

  private async openSessionBySlot(slot: number): Promise<RouteResult> {
    if (slot < 1 || slot > 9) return { ok: false, intentId: 'session.openByNumber', error: this.t('slot_out_of_range') };
    const sessions = await this.getSessionsValue();
    if (slot > sessions.length) return { ok: false, intentId: 'session.openByNumber', error: this.t('only_n_sessions', { n: sessions.length }) };
    const target = sessions[slot - 1];
    await this.router.navigate(['/admin/sessions']);
    this.store.dispatch(setActiveSession({ sessionId: target.id }));
    this.subAgentService.setVoiceFocus(null);
    await this.syncFocusToBackend({ sessionId: target.id, subAgentSlot: null, subAgentId: null });
    return { ok: true, intentId: 'session.openByNumber', feedback: this.t('opened_n', { n: slot, name: target.name }) };
  }

  private async cycleSession(delta: number): Promise<RouteResult> {
    const sessions = await this.getSessionsValue();
    if (sessions.length === 0) return { ok: false, error: this.t('no_sessions') };
    const activeId = await this.getActiveSessionIdValue();
    const idx = activeId ? sessions.findIndex((s) => s.id === activeId) : -1;
    const nextIdx = ((idx === -1 ? 0 : idx + delta) + sessions.length) % sessions.length;
    const target = sessions[nextIdx];
    this.store.dispatch(setActiveSession({ sessionId: target.id }));
    this.subAgentService.setVoiceFocus(null);
    await this.syncFocusToBackend({ sessionId: target.id, subAgentSlot: null, subAgentId: null });
    return { ok: true, feedback: `→ ${target.name}` };
  }

  /**
   * Focus a sub-agent by 1-based slot. We resolve the slot via the renderer's
   * SubAgentService (which honors the user's custom drag-drop order, falling
   * back to createdAt ASC) instead of asking the backend FocusTracker — that
   * way we avoid any session-ID mismatch between Redux and the SubAgentManager's
   * parentIndex.
   */
  private async focusSubAgentSlot(slot: number): Promise<RouteResult> {
    if (slot < 1 || slot > 9) return { ok: false, intentId: 'focus.subagent', error: this.t('slot_out_of_range') };
    const list = this.subAgentService.activeSubAgentsBySlot();
    if (list.length === 0) return { ok: false, intentId: 'focus.subagent', error: this.t('no_subagents') };
    const target = list.find((sa) => sa.slot === slot);
    if (!target) return { ok: false, intentId: 'focus.subagent', error: this.t('subagent_n_missing', { n: slot, total: list.length }) };
    console.info('[voice] focus sub-agent', { slot, id: target.id, sessionId: target.sessionId });
    this.subAgentService.setVoiceFocus(target.id);
    const activeId = await this.getActiveSessionIdValue();
    if (activeId) {
      await this.syncFocusToBackend({ sessionId: activeId, subAgentId: target.id });
    }
    return { ok: true, intentId: 'focus.subagent', feedback: this.t('focused_subagent', { n: slot, name: target.title || target.role }) };
  }

  private async focusMainTerminal(): Promise<RouteResult> {
    const activeId = await this.getActiveSessionIdValue();
    if (!activeId) return { ok: false, intentId: 'focus.terminal', error: this.t('no_active_session') };
    this.subAgentService.setVoiceFocus(null);
    await this.syncFocusToBackend({ sessionId: activeId, subAgentSlot: null, subAgentId: null });
    return { ok: true, intentId: 'focus.terminal', feedback: this.t('focused_terminal') };
  }

  private async cycleSubAgent(delta: number): Promise<RouteResult> {
    const list = this.subAgentService.activeSubAgentsBySlot();
    if (list.length === 0) return { ok: false, error: this.t('no_subagents') };
    const currentId = this.subAgentService.voiceFocusedSubAgentId();
    const currentSlot = currentId ? (list.find((sa) => sa.id === currentId)?.slot ?? 0) : 0;
    const nextSlot = ((currentSlot - 1 + delta) + list.length) % list.length + 1;
    return this.focusSubAgentSlot(nextSlot);
  }

  /**
   * Spawn a sub-agent inside the active session with the spoken prompt.
   * Refuses (with a clear hint) if no session is currently active.
   */
  private async spawnSubAgentWithPrompt(rawPrompt: string): Promise<RouteResult> {
    const prompt = rawPrompt.trim();
    if (!prompt) return { ok: false, intentId: 'subagent.spawn', error: this.t('empty_text') };

    const activeId = await this.getActiveSessionIdValue();
    if (!activeId) {
      return {
        ok: false,
        intentId: 'subagent.spawn',
        error: this.t('subagent_needs_session'),
      };
    }

    // Pick a short title from the prompt (first 6 words, truncated to 60 chars)
    const title = prompt.split(/\s+/).slice(0, 6).join(' ').slice(0, 60);
    console.info('[voice] spawning sub-agent', { parentSessionId: activeId, title, prompt });
    try {
      // Same provider/model the spawn input would use — no per-session default.
      const provider = this.spawnSelection.effectiveProvider();
      const model = this.spawnSelection.recallModel(provider) ?? undefined;
      const sa = await this.subAgentService.spawnCustom(
        activeId, 'voice', title, prompt, provider as SubAgentProvider,
        undefined, undefined, undefined, undefined, undefined, undefined, model,
      );
      if (!sa) {
        return { ok: false, intentId: 'subagent.spawn', error: this.t('subagent_spawn_failed') };
      }
      // Auto-focus the new sub-agent so the next "send/run" goes to it
      this.subAgentService.setVoiceFocus(sa.id);
      return { ok: true, intentId: 'subagent.spawn', feedback: this.t('subagent_spawned', { title }) };
    } catch (err: any) {
      return { ok: false, intentId: 'subagent.spawn', error: err?.message || this.t('subagent_spawn_failed') };
    }
  }

  private async listAgents(): Promise<RouteResult> {
    const list = this.subAgentService.activeSubAgentsBySlot();
    if (list.length === 0) return { ok: true, feedback: this.t('no_subagents_active') };
    const labels = list.map((sa) => `${sa.slot}: ${sa.title || sa.role}`).join(' | ');
    return { ok: true, feedback: labels };
  }

  private async sendToFocused(text: string, opts: { autoSubmit: boolean }): Promise<RouteResult> {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: this.t('empty_text') };
    const target = await this.resolveWriteTarget();
    if (!target) return { ok: false, error: this.t('no_active_target') };
    // "send rm -rf …" submits like "run" does: the same confirmation applies,
    // whichever verb the transcript happened to start with.
    if (opts.autoSubmit && this.isDangerous(trimmed)) {
      return this.confirmDangerous(trimmed, target);
    }
    const payload = trimmed + (opts.autoSubmit ? '\n' : '');
    console.info('[voice] writing to target', { type: target.type, id: target.id, autoSubmit: opts.autoSubmit, preview: trimmed.slice(0, 40) });
    await this.writeToTarget(target, payload);
    if (opts.autoSubmit) lastPromptCache.set(`${target.type}:${target.id}`, trimmed);
    const targetLabel = target.type === 'subagent' ? this.t('target_subagent') : this.t('target_terminal');
    const key = opts.autoSubmit ? 'sent_to' : 'composed_to';
    return { ok: true, feedback: this.t(key, { text: trimmed, target: targetLabel }) };
  }

  private async runCommandOnFocused(cmd: string): Promise<RouteResult> {
    const trimmed = cmd.trim();
    if (!trimmed) return { ok: false, error: this.t('empty_command') };
    if (this.isDangerous(trimmed)) {
      return this.confirmDangerous(trimmed, await this.resolveWriteTarget());
    }
    return this.sendToFocused(trimmed, { autoSubmit: true });
  }

  /** Asks for confirmation; on yes the command goes to `target` (the focused agent or terminal). */
  private confirmDangerous(
    cmd: string,
    target: { type: 'session' | 'subagent'; id: string } | null,
  ): RouteResult {
    return {
      ok: true,
      intentId: 'prompt.run',
      needsConfirmation: true,
      feedback: this.t('confirm_dangerous', { cmd }),
      pending: { type: 'prompt.run', data: { cmd, target } },
    };
  }

  private async repeatLastPrompt(): Promise<RouteResult> {
    const target = await this.resolveWriteTarget();
    if (!target) return { ok: false, error: this.t('no_active_target') };
    const last = lastPromptCache.get(`${target.type}:${target.id}`);
    if (!last) return { ok: false, error: this.t('no_previous_prompt') };
    await this.writeToTarget(target, last + '\n');
    return { ok: true, feedback: this.t('repeated', { text: last }) };
  }

  private async sendCtrlC(): Promise<RouteResult> {
    const target = await this.resolveWriteTarget();
    if (!target) return { ok: false, error: this.t('no_active_target') };
    await this.writeToTarget(target, '\x03');
    return { ok: true, feedback: this.t('interrupted') };
  }

  // ── target resolution ──────────────────────────────────────────────────

  /**
   * Renderer-side write resolution: prefer the in-UI voice focus (set by
   * focus.subagent), then the backend FocusTracker, then the active Redux
   * session as a last resort.
   */
  private async resolveWriteTarget(): Promise<{ type: 'session' | 'subagent'; id: string } | null> {
    const voiceFocusedId = this.subAgentService.voiceFocusedSubAgentId();
    if (voiceFocusedId) return { type: 'subagent', id: voiceFocusedId };
    const focus = await this.getActiveFocusFromBackend();
    if (focus?.subAgentId) return { type: 'subagent', id: focus.subAgentId };
    const activeId = focus?.sessionId ?? (await this.getActiveSessionIdValue());
    if (!activeId) return null;
    return { type: 'session', id: activeId };
  }

  private async writeToTarget(target: { type: 'session' | 'subagent'; id: string }, data: string): Promise<void> {
    const api = (window as any).promptops;
    if (target.type === 'subagent' && api?.writeSubAgent) {
      await api.writeSubAgent(target.id, data);
    } else {
      this.sessionService.writeSession(target.id, data);
    }
  }

  private async getActiveFocusFromBackend(): Promise<{ sessionId: string | null; subAgentSlot: number | null; subAgentId: string | null } | null> {
    const api = (window as any).promptops;
    if (!api?.getActiveFocus) return null;
    try {
      const res = await api.getActiveFocus();
      return res?.ok ? res.state : null;
    } catch {
      return null;
    }
  }

  private async syncFocusToBackend(patch: { sessionId?: string | null; subAgentSlot?: number | null; subAgentId?: string | null }) {
    const api = (window as any).promptops;
    if (!api?.setActiveFocus) return null;
    try {
      const res = await api.setActiveFocus(patch);
      return res?.ok ? res.state : null;
    } catch {
      return null;
    }
  }

  private async listSubAgentsForSession(sessionId: string): Promise<any[]> {
    const api = (window as any).promptops;
    if (!api?.listSubAgents) return [];
    try {
      const res = await api.listSubAgents(sessionId);
      const list = res?.subAgents ?? res ?? [];
      // Sort by createdAt ASC to match backend slot order
      return list.slice().sort((a: any, b: any) =>
        String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')),
      );
    } catch {
      return [];
    }
  }

  /**
   * Transcripts reach here normalized (hyphens become spaces, punctuation is
   * dropped), so "rm -rf" arrives as "rm rf": both sides are compared in that
   * same form.
   */
  private isDangerous(cmd: string): boolean {
    const norm = (s: string) =>
      s.toLowerCase().replace(/[.,;:!?¿¡«»"'`]+/g, ' ').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    const text = ` ${norm(cmd)} `;
    return DANGEROUS_KEYWORDS.some((kw) => text.includes(` ${norm(kw)}`));
  }
}
