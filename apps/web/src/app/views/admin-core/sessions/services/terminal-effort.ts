import { validEffort } from './reasoning-effort';

export const EFFORT_SCALE = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

/** Only CLI status/confirmation lines, never an echoed `/effort` command. */
export function parseTerminalEffort(text: string, provider: string): string | null {
  const clean = text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    // TUI renderers can move the cursor over blank cells instead of writing
    // spaces. Preserve those separators before removing ANSI formatting.
    .replace(/\x1b\[\d*[Ca]/g, ' ')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const level = '(none|minimal|low|medium|high|xhigh|max|ultra)';
  const pattern = provider === 'codex'
    ? `(?:reasoning effort:?\\s*${level}\\b|Model:[^\\r\\n]*?\\((${EFFORT_SCALE.join('|')})\\s+reasoning\\b)`
    : `(?:Set\\s+effort(?:\\s+level)?\\s+to|Effort(?:\\s+level)?\\s+set\\s+to|Current\\s+effort\\s+level:)\\s*${level}\\b`;
  const matches = [...clean.matchAll(new RegExp(pattern, 'gi'))];
  const last = matches.at(-1);
  return last ? (last[1] ?? last[2]).toLowerCase() : null;
}

/** Fresh status is read after every key: never infer the CLI's current level. */
export async function switchTerminalEffort(
  provider: string,
  effort: string,
  exchange: (input: string) => Promise<string>,
): Promise<void> {
  if (!validEffort(provider, effort)) throw new Error('Unsupported effort');
  if (provider === 'claude-code-cli') {
    if (await exchange(`/effort ${effort}`) !== effort) throw new Error('Effort not applied');
    return;
  }
  let current = await exchange('/status');
  for (let step = 0; current !== effort && step < EFFORT_SCALE.length; step++) {
    const from = EFFORT_SCALE.indexOf(current as typeof EFFORT_SCALE[number]);
    const to = EFFORT_SCALE.indexOf(effort as typeof EFFORT_SCALE[number]);
    if (from < 0) throw new Error('Unknown current effort');
    const next = await exchange(from < to ? '\x1b.' : '\x1b,');
    const index = EFFORT_SCALE.indexOf(next as typeof EFFORT_SCALE[number]);
    if (next === current || index < 0 || (from < to ? index > to : index < to)) {
      throw new Error('Effort unavailable or shortcut not applied');
    }
    current = next;
  }
  if (current !== effort) throw new Error('Effort not applied');
}
