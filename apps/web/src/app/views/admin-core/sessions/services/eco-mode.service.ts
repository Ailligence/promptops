import { Injectable, signal, computed } from '@angular/core';

export type EcoLevel = 'lite' | 'full' | 'ultra';

const ECO_INSTRUCTIONS: Record<EcoLevel, string> = {
  lite: 'From now on, be concise. Remove filler words (just/really/basically), hedging, and pleasantries. Keep grammar intact. Shorter sentences preferred. Code unchanged. ACTIVE EVERY RESPONSE.',
  full: 'From now on, respond like caveman. Terse. Technical substance exact. Only fluff die. Drop: articles, filler (just/really/basically), pleasantries, hedging. Fragments OK. Short synonyms. Code unchanged. Pattern: [thing] [action] [reason]. [next step]. ACTIVE EVERY RESPONSE.',
  ultra: 'From now on, MAXIMUM compression. Telegraphic style. No articles, no filler, no hedging, no pleasantries. Single words where possible. Code unchanged. Pattern: [thing] [verb]. [next]. Absolute minimum tokens. ACTIVE EVERY RESPONSE.',
};

const DEACTIVATE_INSTRUCTION = 'From now on, return to normal verbosity. Write complete sentences, use articles, filler words, and full explanations as you normally would.';

/**
 * Manages Eco Mode (energy saving) state globally and per-session.
 *
 * Global eco mode can be toggled via the bottom bar.
 * Individual sessions can opt-out (disable eco) while the global mode is ON.
 */
@Injectable({ providedIn: 'root' })
export class EcoModeService {
  /** Global eco mode toggle. */
  readonly enabled = signal(false);

  /** Current intensity level. */
  readonly level = signal<EcoLevel>('full');

  /** Set of session IDs where eco is explicitly DISABLED (opt-out). */
  private readonly _disabledSessions = signal<Set<string>>(new Set());

  /**
   * Set of session IDs where eco was switched on from the terminal toolbar
   * while the global toggle is OFF (opt-in — eco for that terminal only).
   */
  private readonly _enabledSessions = signal<Set<string>>(new Set());

  /** Whether any session has eco active. */
  readonly hasActiveSession = computed(() => this.enabled() || this._enabledSessions().size > 0);

  private get api(): any {
    return (window as any).promptops;
  }

  get isDesktop(): boolean {
    return !!this.api?.executeSmartAction;
  }

  constructor() {
    this.restore();
  }

  /** Check if eco mode is active for a specific session. */
  isActiveForSession(sessionId: string): boolean {
    if (this._enabledSessions().has(sessionId)) return true;
    return this.enabled() && !this._disabledSessions().has(sessionId);
  }

  /**
   * Terminal-toolbar toggle: flips eco for THIS session regardless of the
   * global switch and injects the instruction right away (same one-click feel
   * as the model picker — it just sends the prompt).
   */
  async toggleSessionStandalone(sessionId: string): Promise<boolean> {
    const active = this.isActiveForSession(sessionId);

    const enabledSet = new Set(this._enabledSessions());
    const disabledSet = new Set(this._disabledSessions());

    if (active) {
      enabledSet.delete(sessionId);
      if (this.enabled()) disabledSet.add(sessionId);
    } else {
      disabledSet.delete(sessionId);
      if (!this.enabled()) enabledSet.add(sessionId);
    }

    this._enabledSessions.set(enabledSet);
    this._disabledSessions.set(disabledSet);
    this.persist();

    await this.injectInstruction(
      sessionId,
      active ? DEACTIVATE_INSTRUCTION : ECO_INSTRUCTIONS[this.level()],
    );

    return !active;
  }

  /** Toggle global eco mode. Returns the new state. */
  async toggleGlobal(activeSessionId?: string): Promise<boolean> {
    const newState = !this.enabled();
    this.enabled.set(newState);
    this.persist();

    if (!newState) {
      // Clear all per-session overrides, with or without an active session:
      // otherwise old opt-outs came back the next time eco was turned on.
      this._disabledSessions.set(new Set());
      this.persist();
    }
    if (activeSessionId && this.isDesktop) {
      await this.injectInstruction(activeSessionId, newState ? ECO_INSTRUCTIONS[this.level()] : DEACTIVATE_INSTRUCTION);
    }

    return newState;
  }

  /** Toggle eco mode for a specific session. Only works when global is ON. */
  async toggleSession(sessionId: string): Promise<void> {
    if (!this.enabled()) return;

    const disabled = new Set(this._disabledSessions());
    if (disabled.has(sessionId)) {
      // Re-enable eco for this session
      disabled.delete(sessionId);
      this._disabledSessions.set(disabled);
      if (this.isDesktop) {
        await this.injectInstruction(sessionId, ECO_INSTRUCTIONS[this.level()]);
      }
    } else {
      // Disable eco for this session
      disabled.add(sessionId);
      this._disabledSessions.set(disabled);
      if (this.isDesktop) {
        await this.injectInstruction(sessionId, DEACTIVATE_INSTRUCTION);
      }
    }

    this.persist();
  }

  /** Set intensity level. */
  setLevel(level: EcoLevel): void {
    this.level.set(level);
    this.persist();
  }

  /** Get the eco instruction for the current level. */
  getInstruction(): string {
    return ECO_INSTRUCTIONS[this.level()];
  }

  /** Get the current eco level for passing to sub-agent spawn. */
  getSpawnEcoLevel(): EcoLevel | undefined {
    return this.enabled() ? this.level() : undefined;
  }

  // ── Modal bridge ─────────────────────────────────────

  /**
   * Bumped whenever some other component (e.g. the sub-agent composer's Eco
   * mode) wants the global eco modal opened. The bottom bar owns the modal
   * markup and reacts to this counter.
   */
  readonly modalOpenRequest = signal(0);

  /** Ask the bottom bar to open the eco modal. */
  requestOpenModal(): void {
    this.modalOpenRequest.update(n => n + 1);
  }

  // ── Persistence ──────────────────────────────────────

  private persist(): void {
    try {
      localStorage.setItem('po-eco-mode', String(this.enabled()));
      localStorage.setItem('po-eco-level', this.level());
      localStorage.setItem('po-eco-disabled', JSON.stringify([...this._disabledSessions()]));
      localStorage.setItem('po-eco-sessions', JSON.stringify([...this._enabledSessions()]));
    } catch { /* storage full or blocked: the toggle still applies for this run */ }
  }

  private restore(): void {
    if (localStorage.getItem('po-eco-mode') === 'true') {
      this.enabled.set(true);
    }
    const level = localStorage.getItem('po-eco-level');
    if (level === 'lite' || level === 'full' || level === 'ultra') {
      this.level.set(level);
    }
    try {
      const disabled = JSON.parse(localStorage.getItem('po-eco-disabled') ?? '[]');
      if (Array.isArray(disabled)) {
        this._disabledSessions.set(new Set(disabled));
      }
    } catch { /* ignore */ }
    try {
      const per = JSON.parse(localStorage.getItem('po-eco-sessions') ?? '[]');
      if (Array.isArray(per)) {
        this._enabledSessions.set(new Set(per));
      }
    } catch { /* ignore */ }
  }

  // ── Terminal injection ───────────────────────────────

  private async injectInstruction(sessionId: string, instruction: string): Promise<void> {
    if (!this.isDesktop) return;
    try {
      await this.api.executeSmartAction(sessionId, instruction);
    } catch {
      // Session might not be ready yet — silently ignore
    }
  }
}
