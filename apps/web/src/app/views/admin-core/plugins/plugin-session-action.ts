/**
 * Response of a session button. It comes from third-party code: only a well-formed
 * proposal is kept, every text becomes a capped string, and nothing is executed
 * here. The app decides what to do with it (confirm, send, composer).
 */
import { PageView, normalizeView } from './plugin-page-view';

export const MAX_ACTION_TEXT = 20_000;
const MAX_NAME = 60;

export type SessionActionProposal =
  | { kind: 'insert'; text: string }
  | { kind: 'prompt'; text: string; target: string | null }
  | { kind: 'spawn'; prompt: string; provider: string | null; mode: string | null; name: string | null }
  | { kind: 'panel'; view: PageView }
  | { kind: 'toast'; message: string };

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
/**
 * Text that ends up in an agent's terminal input. Control characters are removed (line breaks and
 * tabs stay): an ESC in it could close the bracketed paste early (`ESC[201~`) and turn the rest
 * into keystrokes, submitting an "insert" or typing a command the person never saw in the preview.
 */
export const terminalSafe = (text: string): string =>
  text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
const termText = (v: unknown, max: number): string => terminalSafe(str(v, max));
const opt = (v: unknown, max: number): string | null => {
  const s = str(v, max).trim();
  return s ? s : null;
};
const SLUG = /^[a-z0-9][a-z0-9._-]{0,59}$/;

export function normalizeSessionAction(raw: unknown): SessionActionProposal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['insert'] === 'string') {
    const text = termText(r['insert'], MAX_ACTION_TEXT);
    return text.trim() ? { kind: 'insert', text } : null;
  }
  if (typeof r['prompt'] === 'string') {
    const text = termText(r['prompt'], MAX_ACTION_TEXT);
    return text.trim() ? { kind: 'prompt', text, target: opt(r['target'], MAX_NAME) } : null;
  }
  if (r['spawn'] && typeof r['spawn'] === 'object') {
    const s = r['spawn'] as Record<string, unknown>;
    const prompt = termText(s['prompt'], MAX_ACTION_TEXT);
    if (!prompt.trim()) return null;
    const provider = opt(s['provider'], 40);
    const mode = opt(s['mode'], 40);
    return {
      kind: 'spawn', prompt,
      provider: provider && SLUG.test(provider) ? provider : null,
      mode: mode && SLUG.test(mode) ? mode : null,
      name: opt(s['name'], MAX_NAME),
    };
  }
  if (r['panel'] && typeof r['panel'] === 'object') {
    return { kind: 'panel', view: normalizeView(r['panel']) };
  }
  if (typeof r['toast'] === 'string') {
    const message = termText(r['toast'], 300);
    return message.trim() ? { kind: 'toast', message } : null;
  }
  return null;
}

/** Addressable name of an agent, as in `promptops ctl`: lowercase, non-alphanumerics → `-`. */
export function agentSlug(title: string): string {
  return title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}
