import { Injectable, inject, signal } from '@angular/core';
import { SessionEffortService } from './session-effort.service';
import { MODEL_TRACKED_PROVIDERS } from './model-labels';

/**
 * Which model a terminal is ACTUALLY running.
 *
 * The spawn picker only tells us what the CLI was launched with; from the
 * first `/model` inside the TUI that value is a lie. The provider writes the
 * truth into its own session log (Claude's transcript jsonl, Codex's rollout),
 * so the main process reads the tail of that file and reports the model back.
 *
 * Performance contract — this must never cost anything noticeable:
 *  - pull only, never a poll: the view asks after events it already reacts to
 *    (status change, pane focus), never on a timer;
 *  - throttled per session (MIN_REFRESH_MS) with an in-flight guard, so a
 *    burst of status changes collapses into one call;
 *  - skipped while the window is hidden;
 *  - skipped entirely for providers with no readable log, and when the host
 *    bridge doesn't expose the reader (older desktop builds);
 *  - the main process short-circuits on mtime, so a request that finds
 *    nothing new never reads the file.
 *
 * Failure is always silent: the caller falls back to the spawn model.
 */
@Injectable({ providedIn: 'root' })
export class SessionModelService {
  private readonly efforts = inject(SessionEffortService);
  /**
   * Don't ask the host about the same session more often than this. Matched to
   * the resolver's own cache TTL: asking sooner would just be answered from
   * cache anyway.
   */
  private static readonly MIN_REFRESH_MS = 10_000;
  /** How long to wait for a `/model` confirmation before stopping the pulse. */
  private static readonly SWITCH_TIMEOUT_MS = 45_000;

  /** sessionId → model id read from the provider's session log. */
  private readonly runtime = signal<Record<string, string>>({});
  /** sessionId → model the CLI announced on screen (`Set model to …`). */
  private readonly detected = signal<Record<string, string>>({});
  /** sessionId → why the runtime model is still unknown (host diagnostics). */
  private readonly reasons = signal<Record<string, string>>({});
  /**
   * sessionId → model the user just asked for via `/model`, until the
   * provider's log confirms it. The CLI only records a model when it answers,
   * so without this the badge would sit on the old value for a whole turn.
   */
  private readonly switching = signal<Record<string, string>>({});
  /** Watchdog for switches never confirmed (see markSwitching). */
  private readonly switchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Set<string>();
  private readonly lastAskedAt = new Map<string, number>();

  private get api(): any {
    return (window as any).promptops;
  }

  /**
   * Reactive read — null while unknown. What the CLI announced on screen wins
   * over what the log says, because the log lags by one answer.
   */
  runtimeModel(sessionId: string): string | null {
    return this.detected()[sessionId] ?? this.runtime()[sessionId] ?? null;
  }

  /**
   * Why `runtimeModel()` is still null, as reported by the host:
   * `no-conversation-id` (the CLI hasn't announced its session yet),
   * `log-not-found`, `no-model-in-tail` (no answer recorded yet),
   * `unsupported-provider`. Null once the model resolves.
   */
  runtimeReason(sessionId: string): string | null {
    return this.reasons()[sessionId] ?? null;
  }

  /** Model requested via `/model` and not yet confirmed by the provider's log. */
  switchingTo(sessionId: string): string | null {
    return this.switching()[sessionId] ?? null;
  }

  // ── Live detection from the terminal itself ────────────────────────
  //
  // When the user runs `/model` inside the TUI, Claude answers on the spot
  // with "Set model to Haiku 4.5 …". That line is the earliest and most
  // reliable signal there is: it needs no hook, no transcript, and it lands
  // before the model has answered anything. So the terminal stream is sniffed
  // for it — cheaply: a couple of substring checks per chunk, and the regex
  // only runs on the rare chunk that mentions a model at all.

  /** Last few chars per session, so a message split across chunks still matches. */
  private readonly tails = new Map<string, string>();
  private static readonly TAIL_KEEP = 96;
  /**
   * "Set model to Haiku 4.5. and saved as default" → Haiku 4.5
   * "Set model to Sonnet 4.5 (claude-sonnet-4-5)"  → claude-sonnet-4-5
   * The `\.(?!\d)` matters: a plain `.` terminator would cut "4.5" to "4".
   */
  // "Kept model as Sonnet 5": the user dismissed the picker — the pending
  // switch must end on the model that is ACTUALLY in use (audit UX 10/2026:
  // the badge kept saying Haiku while Claude said "Kept model as Sonnet 5").
  private static readonly SET_MODEL_RE =
    /(?:Set model to|Kept model as)\s+\**([^\n\r*(]+?)\**\s*(?:\(([^)]+)\))?\s*(?:\.(?!\d)|,|\band\b|$)/i;
  /** A bracketed value is only an id if it looks like one — "(recommended)" isn't. */
  private static readonly MODEL_ID_RE = /^[a-z][\w.:/]*[-.][\w.:/-]+$/i;
  private static readonly ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

  /**
   * Feed terminal output. Safe to call on every chunk — it returns after two
   * substring checks unless the chunk actually mentions a model.
   */
  noteTerminalOutput(sessionId: string, chunk: string): void {
    if (!sessionId || !chunk) return;
    this.efforts.noteTerminalOutput(sessionId, chunk);
    const joined = (this.tails.get(sessionId) ?? '') + chunk;
    if (!joined.includes('model') && !joined.includes('Model')) {
      this.tails.set(sessionId, joined.slice(-SessionModelService.TAIL_KEEP));
      return;
    }

    const clean = joined.replace(SessionModelService.ANSI_RE, '');
    // LAST announcement wins: switching model twice in a row puts two
    // "Set model to …" lines in the same window, and String.match would
    // return the first — i.e. the model the user just moved away from.
    const scanner = new RegExp(SessionModelService.SET_MODEL_RE.source, 'gi');
    let match: RegExpExecArray | null = null;
    for (let hit = scanner.exec(clean); hit; hit = scanner.exec(clean)) match = hit;
    if (!match) {
      this.tails.set(sessionId, joined.slice(-SessionModelService.TAIL_KEEP));
      return;
    }
    // Consume it: leaving the line in the tail would make the next chunk
    // re-read a stale announcement and undo a newer switch.
    this.tails.set(sessionId, '');

    // "Set model to Sonnet 4.5 (claude-sonnet-4-5)" → prefer the id in
    // brackets; otherwise keep the human label, which renders as-is.
    const bracketed = match[2]?.trim();
    const label = match[1]?.trim();
    const value =
      (bracketed && SessionModelService.MODEL_ID_RE.test(bracketed) ? bracketed : label) ?? '';
    if (!value) return;
    this.setDetectedModel(sessionId, value);
  }

  /**
   * A model we saw the CLI announce. It outranks the log until the log agrees:
   * the transcript keeps naming the OLD model until the new one actually
   * answers, so without this precedence the badge would flip back.
   */
  private setDetectedModel(sessionId: string, model: string): void {
    this.detected.update((map) => (map[sessionId] === model ? map : { ...map, [sessionId]: model }));
    this.reasons.update((map) => {
      if (!(sessionId in map)) return map;
      const next = { ...map };
      delete next[sessionId];
      return next;
    });
    // The CLI just confirmed a model on screen: whatever switch was pending,
    // it's over — stop the badge from pulsing.
    this.clearSwitching(sessionId);
  }

  /**
   * Record a `/model` the user just sent. Cleared as soon as the CLI announces
   * the switch on screen or the log reports a new model — and, failing both,
   * by SWITCH_TIMEOUT_MS: a pending state with no way out would leave the badge
   * blinking forever (e.g. the CLI opened its own picker instead of applying
   * the argument, so no confirmation line is ever printed).
   */
  markSwitching(sessionId: string, model: string): void {
    this.switching.update((map) => ({ ...map, [sessionId]: model }));
    // The switch itself is a turn boundary: allow the next poll immediately.
    this.lastAskedAt.delete(sessionId);

    clearTimeout(this.switchTimers.get(sessionId));
    this.switchTimers.set(
      sessionId,
      setTimeout(() => {
        this.switchTimers.delete(sessionId);
        this.clearSwitching(sessionId);
      }, SessionModelService.SWITCH_TIMEOUT_MS),
    );
  }

  /** Give up on a pending switch (confirmed, superseded, or timed out). */
  private clearSwitching(sessionId: string): void {
    const timer = this.switchTimers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.switchTimers.delete(sessionId);
    }
    this.switching.update((map) => {
      if (!(sessionId in map)) return map;
      const next = { ...map };
      delete next[sessionId];
      return next;
    });
  }

  /**
   * Best-effort refresh. Cheap to call from a template-driven effect: every
   * guard below returns before touching IPC.
   */
  refresh(sessionId: string | undefined | null, provider: string | undefined): void {
    if (!sessionId || !MODEL_TRACKED_PROVIDERS.has(provider ?? '')) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.inFlight.has(sessionId)) return;

    const now = Date.now();
    if (now - (this.lastAskedAt.get(sessionId) ?? 0) < SessionModelService.MIN_REFRESH_MS) return;

    const read = this.api?.getSessionModel;
    if (typeof read !== 'function') return;

    this.lastAskedAt.set(sessionId, now);
    this.inFlight.add(sessionId);
    Promise.resolve(read.call(this.api, sessionId))
      .then((res: any) => {
        const model: string | undefined = typeof res === 'string' ? res : res?.model;
        const reason: string | undefined = typeof res === 'object' ? res?.reason : undefined;
        this.reasons.update((map) => {
          const next = reason ?? '';
          if ((map[sessionId] ?? '') === next) return map;
          const copy = { ...map };
          if (next) copy[sessionId] = next; else delete copy[sessionId];
          return copy;
        });
        if (!model) return;
        const previous = this.runtime()[sessionId];
        this.runtime.update((map) => (map[sessionId] === model ? map : { ...map, [sessionId]: model }));
        // The log caught up with what we saw on screen: drop the override.
        if (this.detected()[sessionId] === model) {
          this.detected.update((map) => {
            const next = { ...map };
            delete next[sessionId];
            return next;
          });
        }
        // The log moved: whatever the user asked for, this is now the truth.
        if (model !== previous && this.switching()[sessionId]) this.clearSwitching(sessionId);
      })
      .catch(() => { /* best-effort: the badge keeps showing the spawn model */ })
      .finally(() => this.inFlight.delete(sessionId));
  }

  /** Drop state for a terminal that no longer exists. */
  forget(sessionId: string): void {
    this.efforts.forget(sessionId);
    this.lastAskedAt.delete(sessionId);
    this.inFlight.delete(sessionId);
    this.tails.delete(sessionId);
    this.detected.update((map) => {
      if (!(sessionId in map)) return map;
      const next = { ...map };
      delete next[sessionId];
      return next;
    });
    this.clearSwitching(sessionId);
    this.reasons.update((map) => {
      if (!(sessionId in map)) return map;
      const next = { ...map };
      delete next[sessionId];
      return next;
    });
    this.runtime.update((map) => {
      if (!(sessionId in map)) return map;
      const next = { ...map };
      delete next[sessionId];
      return next;
    });
  }
}
