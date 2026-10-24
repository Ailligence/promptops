import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { getActiveSession, getSessions } from '@/store/sessions/session.selectors';
import { Prompt } from '@core/models/prompt';
import { DataBackend } from '@core/data/data-backend';

export interface ActionSlot {
  id: number;
  user_id: number;
  session_id: string | null;
  prompt_id: number;
  label: string;
  icon: string;
  sort_order: number;
  prompt?: { id: number; title: string; body: string; status: string };
}

export interface ActionSlotScope { type: 'workspace' | 'session' | 'global'; id: string; }

@Injectable({ providedIn: 'root' })
export class ActionSlotService {
  readonly scopeMode = signal<'session' | 'global'>(this.readScopeMode());

  private readScopeMode(): 'session' | 'global' {
    try { return localStorage.getItem('po-quick-action-scope') === 'global' ? 'global' : 'session'; }
    catch { return 'session'; }
  }

  setScopeMode(mode: 'session' | 'global'): void {
    if (mode === this.scopeMode()) return;
    this.scopeMode.set(mode);
    try { localStorage.setItem('po-quick-action-scope', mode); } catch { /* Storage may be unavailable. */ }
  }

  slots = signal<ActionSlot[]>([]);
  selectedSlotId = signal<number | null>(null);
  lastAddedSlotId = signal<number | null>(null);
  loading = signal(false);
  loadError = signal(false);

  private data = inject(DataBackend);
  private activeSession = toSignal(inject(Store).select(getActiveSession), { initialValue: null });
  private sessions = toSignal(inject(Store).select(getSessions), { initialValue: [] });
  readonly context = computed(() => {
    const session = this.activeSession();
    if (this.scopeMode() === 'global') {
      return { sessionId: session?.dbId ?? session?.id ?? '', scope: { type: 'global', id: 'global' } as ActionSlotScope, key: 'global:global' };
    }
    if (!session) return null;
    const scope: ActionSlotScope = session.workspaceId
      ? { type: 'workspace', id: session.workspaceId }
      : { type: 'session', id: session.dbId ?? session.id };
    return { sessionId: session.dbId ?? session.id, scope, key: `${scope.type}:${scope.id}` };
  }, { equal: (a, b) => a?.sessionId === b?.sessionId && a?.key === b?.key });

  private requestVersion = 0;
  private currentKey: string | null = null;
  private selections = new Map<string, number | null>();

  constructor() {
    effect(() => {
      const context = this.context();
      untracked(() => {
        if (this.currentKey !== (context?.key ?? null)) {
          if (this.currentKey) this.selections.set(this.currentKey, this.selectedSlotId());
          this.currentKey = context?.key ?? null;
          this.slots.set([]);
          this.selectedSlotId.set(this.currentKey ? this.selections.get(this.currentKey) ?? null : null);
          this.lastAddedSlotId.set(null);
        }
        void this.loadSlots();
      });
    });
  }

  private matches(scope?: ActionSlotScope): boolean {
    return !!scope && `${scope.type}:${scope.id}` === this.context()?.key;
  }

  async getPrompt(id: number): Promise<Prompt> {
    return this.data.call<Prompt>('prompts.get', { id });
  }

  async loadSlots(): Promise<void> {
    const context = this.context();
    const version = ++this.requestVersion;
    this.loadError.set(false);
    if (!context) { this.loading.set(false); return; }
    this.loading.set(true);
    try {
      const response = await this.data.call<{ slots: ActionSlot[]; scope: ActionSlotScope }>('actionSlots.list', {
        session_id: context.sessionId, scope: context.scope.type === 'global' ? 'global' : 'session',
      });
      if (version !== this.requestVersion || context.key !== this.context()?.key) return;
      // Only accept the explicitly selected context.
      if (!this.matches(response?.scope)) throw new Error('Quick action scope mismatch');
      const slots: ActionSlot[] = response.slots ?? [];
      this.slots.set(slots);
      if (!slots.some(slot => slot.id === this.selectedSlotId())) {
        this.selectedSlotId.set(slots[0]?.id ?? null);
      }
    } catch {
      if (version === this.requestVersion && context.key === this.context()?.key) this.loadError.set(true);
    } finally {
      if (version === this.requestVersion) this.loading.set(false);
    }
  }

  async addSlot(promptId: number, label: string, icon = 'ti-bolt', sessionId = this.context()?.sessionId, options: { throwOnError?: boolean; scope?: 'session' | 'global' } = {}): Promise<ActionSlot | null> {
    const scope = options.scope ?? this.scopeMode();
    if (!sessionId && scope !== 'global') return null;
    // Dialogs capture the local terminal ID; stored slots use the stored session id.
    const session = this.sessions().find(item => item.id === sessionId);
    sessionId = session?.dbId ?? sessionId;
    try {
      const response = await this.data.call<{ slot: ActionSlot; scope: ActionSlotScope }>('actionSlots.create', {
        prompt_id: promptId, label, icon, session_id: sessionId, scope,
      });
      const slot: ActionSlot = response.slot;
      if (this.matches(response?.scope)) {
        this.slots.update(current => [slot, ...current.filter(item => item.id !== slot.id)]);
        this.selectedSlotId.set(slot.id);
        this.lastAddedSlotId.set(slot.id);
        // Supersede any pre-create list response, then reconcile the stored order.
        void this.loadSlots();
      }
      return slot;
    } catch (error) {
      if (options.throwOnError) throw error;
      return null;
    }
  }

  async removeSlot(id: number): Promise<boolean> {
    const context = this.context();
    if (!context) return false;
    try {
      await this.data.call('actionSlots.delete', {
        id, session_id: context.sessionId, scope: context.scope.type === 'global' ? 'global' : 'session',
      });
      if (context.key === this.context()?.key) {
        this.slots.update(current => current.filter(slot => slot.id !== id));
        if (this.selectedSlotId() === id) this.selectedSlotId.set(this.slots()[0]?.id ?? null);
        void this.loadSlots();
      }
      return true;
    } catch { return false; }
  }

  async updatePromptBody(slot: ActionSlot, newBody: string): Promise<void> {
    if (!slot.prompt) return;
    const context = this.context();
    this.slots.update(current => current.map(item => item.id === slot.id && item.prompt
      ? { ...item, prompt: { ...item.prompt, body: newBody } } : item));
    try {
      await this.data.call('prompts.update', { id: slot.prompt.id, body: newBody });
    } catch {
      if (context?.key === this.context()?.key) await this.loadSlots();
    }
  }

  async reorder(orderedIds: number[]): Promise<void> {
    const context = this.context();
    if (!context) return;
    this.slots.update(current => {
      const byId = new Map(current.map(slot => [slot.id, slot]));
      return orderedIds.map((id, index) => {
        const item = byId.get(id);
        return item ? { ...item, sort_order: index } : null;
      }).filter((slot): slot is ActionSlot => slot !== null);
    });
    try {
      await this.data.call('actionSlots.reorder', { order: orderedIds, session_id: context.sessionId, scope: context.scope.type === 'global' ? 'global' : 'session' });
    } catch { /* Reconcile rejected/stale orders with the stored ones below. */ }
    finally {
      if (context.key === this.context()?.key) await this.loadSlots();
    }
  }
}
