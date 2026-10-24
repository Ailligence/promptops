import { Injectable, signal } from '@angular/core';
import { ProviderType } from '../../../../../store/sessions/session.state';
import { SPAWN_PROVIDERS } from './spawn-providers.const';
import { spawnModels } from './model-labels';
import { ReasoningEffort, validEffort } from './reasoning-effort';

/**
 * The provider + model picked on the sub-agent spawn input (composer chip) —
 * the ONE reference for "which AI do I launch with" across the app.
 *
 * There is no per-session default provider any more: the team board, the
 * prompt library, the feedback section and the voice router all spawn/create
 * with the provider the user last picked here. Persisted in localStorage so
 * the choice survives navigation and restarts; the model is remembered PER
 * provider so recalling never leaks a model into another provider's picker.
 */
@Injectable({ providedIn: 'root' })
export class SpawnSelectionService {
  private static readonly PROVIDER_KEY = 'promptops-spawn-provider-last';
  private static readonly MODEL_KEY = 'promptops-spawn-model-by-provider';
  /** Used when the user never picked anything yet. */
  static readonly FALLBACK_PROVIDER: ProviderType = 'claude-code-cli';

  /** Last picked provider, or null when the user never picked one. */
  readonly provider = signal<ProviderType | null>(this.readProvider());

  /** Provider to spawn/create with right now: the pick, else the caller's fallback, else Claude. */
  effectiveProvider(fallback?: string | null): ProviderType {
    return this.provider()
      ?? (this.isKnown(fallback) ? (fallback as ProviderType) : SpawnSelectionService.FALLBACK_PROVIDER);
  }

  /** Remember a pick (only call once the provider passed the CLI-availability check). */
  setProvider(provider: string): void {
    if (!this.isKnown(provider)) return;
    this.provider.set(provider as ProviderType);
    try { localStorage.setItem(SpawnSelectionService.PROVIDER_KEY, provider); } catch { /* quota */ }
  }

  /** Remembered model for `provider`, validated against that provider's own model list. */
  recallModel(provider: string): string | null {
    const id = this.readModelMemory()[provider];
    if (!id) return null;
    return spawnModels(provider).some(m => m.id === id) ? id : null;
  }

  /** Remember (or forget, with null = provider default) the model picked for `provider`. */
  rememberModel(provider: string, id: string | null): void {
    const mem = this.readModelMemory();
    if (id) mem[provider] = id; else delete mem[provider];
    try { localStorage.setItem(SpawnSelectionService.MODEL_KEY, JSON.stringify(mem)); } catch { /* quota */ }
  }

  /** Model remembered for the effective provider (convenience for spawn/create callers). */
  effectiveModel(fallbackProvider?: string | null): string | null {
    return this.recallModel(this.effectiveProvider(fallbackProvider));
  }

  recallEffort(provider: string, model?: string | null): ReasoningEffort | null {
    try {
      const memory = JSON.parse(localStorage.getItem('promptops-spawn-effort-by-provider') ?? '{}');
      return validEffort(provider, memory?.[provider], model) ?? null;
    } catch { return null; }
  }

  rememberEffort(provider: string, effort: string | null): void {
    try {
      const parsed = JSON.parse(localStorage.getItem('promptops-spawn-effort-by-provider') ?? '{}');
      const memory = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      const value = validEffort(provider, effort);
      if (value) memory[provider] = value; else delete memory[provider];
      localStorage.setItem('promptops-spawn-effort-by-provider', JSON.stringify(memory));
    } catch { /* storage unavailable */ }
  }

  private isKnown(provider: string | null | undefined): boolean {
    return !!provider && SPAWN_PROVIDERS.some(p => p.value === provider);
  }

  private readProvider(): ProviderType | null {
    try {
      const raw = localStorage.getItem(SpawnSelectionService.PROVIDER_KEY);
      return this.isKnown(raw) ? (raw as ProviderType) : null;
    } catch { return null; }
  }

  private readModelMemory(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(SpawnSelectionService.MODEL_KEY) ?? '{}');
    } catch { return {}; }
  }
}
