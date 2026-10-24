import { modelEfforts } from './model-labels';

/** Native effort values. Keep in sync with the other desktop host. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function effortOptions(provider: string, model?: string | null): readonly ReasoningEffort[] {
  if (provider === 'claude-code-cli') {
    if (model?.includes('haiku')) return [];
    return ['low', 'medium', 'high', 'xhigh', 'max'];
  }
  if (provider === 'antigravity') {
    const levels = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
    const efforts = modelEfforts(provider, model) ?? [];
    return levels.filter((l) => efforts.includes(l));
  }
  return provider === 'codex' ? ['low', 'medium', 'high', 'xhigh'] : [];
}

export function validEffort(provider: string, effort: unknown, model?: string | null): ReasoningEffort | undefined {
  return effortOptions(provider, model).find(value => value === effort);
}
