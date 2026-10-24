/** Command execution metadata lives in the prompt's persisted notes, so existing
 * prompt/slot APIs can round-trip it without a local store schema migration. */
export interface QuickActionCommand {
  version: 1;
  kind: 'command';
  directory: string;
}

export function commandActionNotes(directory: string): string {
  if (!directory.trim()) throw new Error('Command directory is required');
  return JSON.stringify({ promptopsQuickAction: { version: 1, kind: 'command', directory } });
}

export function readCommandAction(notes?: string): QuickActionCommand | null {
  if (!notes) return null;
  let parsed: any;
  try { parsed = JSON.parse(notes); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || !('promptopsQuickAction' in parsed)) return null;
  const action = parsed.promptopsQuickAction;
  if (action?.version !== 1 || action.kind !== 'command' ||
      typeof action.directory !== 'string' || !action.directory.trim()) {
    throw new Error('Invalid quick action command metadata');
  }
  return action;
}
