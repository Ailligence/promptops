/**
 * A plugin's page is a description made of DATA: the app draws it, with its own components.
 * Everything that arrives here comes from third-party code: only what is known is kept, every text
 * becomes a length-capped string, and nothing is ever interpreted as HTML.
 */

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
export type FieldKind = 'text' | 'textarea' | 'select' | 'choice' | 'toggle' | 'repo';
export interface PageOption { value: string; label: string; icon: string | null; hint: string }
export interface PageRepoValue { handle: string; name: string; branch: string }

export type PageBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string; muted: boolean }
  | { type: 'notice'; tone: NoticeTone; text: string }
  | { type: 'divider' }
  | { type: 'field'; kind: FieldKind; id: string; label: string; help: string; placeholder: string; rows: number; live: boolean; half: boolean;
      options: PageOption[]; value: string | boolean | PageRepoValue | null }
  | { type: 'actions'; items: { id: string; label: string; style: 'primary' | 'default' | 'ghost' | 'danger'; icon: string | null; disabled: boolean }[] }
  | { type: 'output'; id: string | null; label: string; text: string; mono: boolean; copy: boolean; editable: boolean }
  | { type: 'list'; empty: string; items: { title: string; subtitle: string; meta: string; icon: string | null }[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'stats'; items: { label: string; value: string; hint: string }[] }
  | { type: 'progress'; label: string; value: number }
  | { type: 'columns'; columns: PageBlock[][] }
  | { type: 'floorplan'; empty: string; hub: string; rooms: FloorRoom[] };

/** Floor plan: rooms (folders) → desks (workspaces or sessions) → agents. `session` opens the session in the app. */
export type FloorStatus = 'working' | 'waiting' | 'idle' | 'standby' | 'error' | 'off';
export interface FloorAgent { name: string; provider: string; status: FloorStatus }
export interface FloorDesk {
  title: string; subtitle: string; status: FloorStatus; badge: string; session: string | null; agents: FloorAgent[];
  /** Built-in floor plan only: all the sessions of the desk. Plugins cannot set it. */
  members?: string[];
  /** Built-in floor plan only: an agent is waiting for input or has finished. `seq` changes on every new alert. */
  alert?: FloorAlert | null;
}
export interface FloorAlert { kind: 'input' | 'done'; text: string; seq: number; at: number }
export interface FloorRoom { title: string; subtitle: string; color: string | null; wide: boolean; desks: FloorDesk[] }

export interface PageView { title: string; subtitle: string; blocks: PageBlock[] }

const MAX_BLOCKS = 200;
const MAX_OPTIONS = 60;
const MAX_ROWS = 200;
const TONES: NoticeTone[] = ['info', 'success', 'warning', 'danger'];
const KINDS: FieldKind[] = ['text', 'textarea', 'select', 'choice', 'toggle', 'repo'];
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,59}$/;
const ICON = /^ti-[a-z0-9-]{2,45}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const FLOOR_STATUSES: FloorStatus[] = ['working', 'waiting', 'idle', 'standby', 'error', 'off'];
const PROVIDER = /^[a-z0-9-]{1,40}$/;
const floorStatus = (v: unknown): FloorStatus => (FLOOR_STATUSES.includes(v as FloorStatus) ? (v as FloorStatus) : 'idle');

const str = (v: unknown, max: number): string => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** An icon becomes a CSS class: only a well-formed Tabler name is accepted. */
export const safeIcon = (v: unknown): string | null => (typeof v === 'string' && ICON.test(v) ? v : null);

function repoValue(v: unknown): PageRepoValue | null {
  const o = obj(v);
  return typeof o['handle'] === 'string' && o['handle'] ? { handle: str(o['handle'], 80), name: str(o['name'], 120), branch: str(o['branch'], 200) } : null;
}

function block(raw: unknown, depth: number, budget: { left: number }): PageBlock | null {
  const b = obj(raw);
  if (budget.left-- <= 0) return null;
  switch (b['type']) {
    case 'heading': return { type: 'heading', text: str(b['text'], 200) };
    case 'text': return { type: 'text', text: str(b['text'], 4000), muted: b['muted'] === true };
    case 'notice': return { type: 'notice', tone: TONES.includes(b['tone'] as NoticeTone) ? (b['tone'] as NoticeTone) : 'info', text: str(b['text'], 1000) };
    case 'divider': return { type: 'divider' };
    case 'field': {
      const kind = KINDS.includes(b['kind'] as FieldKind) ? (b['kind'] as FieldKind) : null;
      const id = str(b['id'], 60);
      if (!kind || !ID.test(id)) return null;
      const options = list(b['options'], MAX_OPTIONS).map((o) => obj(o)).map((o) => ({
        value: str(o['value'], 200), label: str(o['label'], 120) || str(o['value'], 120), icon: safeIcon(o['icon']), hint: str(o['hint'], 160),
      }));
      const value = kind === 'toggle' ? b['value'] === true : kind === 'repo' ? repoValue(b['value']) : str(b['value'], 200_000);
      return { type: 'field', kind, id, label: str(b['label'], 160), help: str(b['help'], 400), placeholder: str(b['placeholder'], 200),
        rows: Math.min(Math.max(Number(b['rows']) || 5, 2), 24), live: b['live'] === true, half: b['half'] === true, options, value };
    }
    case 'actions': {
      const items = list(b['items'], 8).map((i) => obj(i)).filter((i) => ID.test(str(i['id'], 60))).map((i) => ({
        id: str(i['id'], 60), label: str(i['label'], 60) || str(i['id'], 60), icon: safeIcon(i['icon']), disabled: i['disabled'] === true,
        style: (['primary', 'ghost', 'danger'].includes(i['style'] as string) ? i['style'] : 'default') as 'primary' | 'default' | 'ghost' | 'danger',
      }));
      return items.length ? { type: 'actions', items } : null;
    }
    case 'output': {
      const id = str(b['id'], 60);
      const editable = b['editable'] === true && ID.test(id);
      return { type: 'output', id: ID.test(id) ? id : null, label: str(b['label'], 160), text: str(b['text'], 200_000), mono: b['mono'] === true, copy: b['copy'] !== false, editable };
    }
    case 'list':
      return { type: 'list', empty: str(b['empty'], 200), items: list(b['items'], MAX_ROWS).map((i) => obj(i)).map((i) => ({
        title: str(i['title'], 200), subtitle: str(i['subtitle'], 400), meta: str(i['meta'], 80), icon: safeIcon(i['icon']) })) };
    case 'table': {
      const columns = list(b['columns'], 8).map((c) => str(c, 80));
      return { type: 'table', columns, rows: list(b['rows'], MAX_ROWS).map((r) => columns.map((_, i) => str(list(r, 8)[i], 400))) };
    }
    case 'stats':
      return { type: 'stats', items: list(b['items'], 6).map((i) => obj(i)).map((i) => ({ label: str(i['label'], 60), value: str(i['value'], 60), hint: str(i['hint'], 120) })) };
    case 'progress':
      return { type: 'progress', label: str(b['label'], 160), value: Math.min(Math.max(Number(b['value']) || 0, 0), 1) };
    case 'floorplan':
      if (depth > 0) return null;
      return { type: 'floorplan', empty: str(b['empty'], 200), hub: str(b['hub'], 40), rooms: list(b['rooms'], 40).map((r) => obj(r)).map((r) => ({
        title: str(r['title'], 80), subtitle: str(r['subtitle'], 160), color: typeof r['color'] === 'string' && COLOR.test(r['color']) ? r['color'] : null,
        wide: r['wide'] === true,
        desks: list(r['desks'], 60).map((d) => obj(d)).map((d) => ({
          title: str(d['title'], 80), subtitle: str(d['subtitle'], 160), status: floorStatus(d['status']), badge: str(d['badge'], 12),
          // Just a reference: the app opens the session ONLY if it exists among the user's sessions.
          session: typeof d['session'] === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(d['session']) ? d['session'] : null,
          agents: list(d['agents'], 16).map((a) => obj(a)).map((a) => ({
            name: str(a['name'], 80), provider: typeof a['provider'] === 'string' && PROVIDER.test(a['provider']) ? a['provider'] : '', status: floorStatus(a['status']),
          })),
        })),
      })) };
    case 'columns':
      // Columns don't nest: two at most, and only at the top level.
      if (depth > 0) return null;
      return { type: 'columns', columns: list(b['columns'], 2).map((col) => blocks(col, depth + 1, budget)) };
    default:
      return null;
  }
}

function blocks(raw: unknown, depth: number, budget: { left: number }): PageBlock[] {
  return list(raw, MAX_BLOCKS).map((b) => block(b, depth, budget)).filter((b): b is PageBlock => b !== null);
}

export function normalizeView(raw: unknown): PageView {
  const v = obj(raw);
  return { title: str(v['title'], 80), subtitle: str(v['subtitle'], 300), blocks: blocks(v['blocks'], 0, { left: MAX_BLOCKS }) };
}

/** Initial form values: editable fields and boxes, at any depth. */
export function viewValues(view: PageView): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (list: PageBlock[]) => {
    for (const b of list) {
      if (b.type === 'field') out[b.id] = b.value;
      else if (b.type === 'output' && b.editable && b.id) out[b.id] = b.text;
      else if (b.type === 'columns') b.columns.forEach(walk);
    }
  };
  walk(view.blocks);
  return out;
}
