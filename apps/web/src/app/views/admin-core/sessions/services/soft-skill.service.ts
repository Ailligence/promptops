import { Injectable, signal } from '@angular/core';
import { MODE_PRESETS, SoftSkillPayload, SubAgentMode } from './sub-agent.service';

/**
 * A soft skill as stored/selected in the spawn composer.
 *
 * Built-in modes are the "preset" soft skills (Sprint, Architect, …) and keep
 * living in `MODE_PRESETS`. This shape covers the OTHER two sources:
 * - `custom`: written by the user in the Soft skill modal (persisted here);
 * - `catalog`: a catalog skill (SKILL.md) reused as plain instructions, so it
 *   works on any provider without materializing files into the workspace.
 *
 * `baseMode` still drives the five-parameter config (and the native CLI
 * flags) — the instructions are layered on top by the desktop preamble.
 */
export interface SoftSkill extends SoftSkillPayload {
  id: string;
  /** Iconify icon shown on the composer chip. */
  icon: string;
  baseMode: SubAgentMode;
  source: 'custom' | 'catalog';
  /** For catalog-derived skills: the originating catalog item id. */
  catalogItemId?: string;
  createdAt: string;
  updatedAt?: string;
}

export const MAX_SOFT_SKILL_NAME = 120;
export const MAX_SOFT_SKILL_INSTRUCTIONS = 4000;
export const DEFAULT_SOFT_SKILL_ICON = 'solar:star-bold-duotone';
export const CATALOG_SOFT_SKILL_ICON = 'solar:magic-stick-3-bold-duotone';

/** Base modes a soft skill can sit on. `eco` is a composer pseudo-mode and stays a mode-only pick. */
export const SOFT_SKILL_BASE_MODES: SubAgentMode[] = ['sprint', 'clean', 'architect', 'detective', 'refactor', 'paranoid', 'minimal', 'plan_only'];

const STORAGE_KEY = 'promptops:soft-skills';

/**
 * User-written soft skills — localStorage backed (same policy as the custom
 * GitHub skills in AgentInjectService): private to this machine, never
 * stored elsewhere, never contains secrets.
 */
@Injectable({ providedIn: 'root' })
export class SoftSkillService {
  readonly skills = signal<SoftSkill[]>(this.load());

  /** Trim + cap a free-form skill into a valid stored shape, or null if unusable. */
  normalize(input: Partial<SoftSkill> & { name?: string; instructions?: string }): SoftSkill | null {
    const name = (input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SOFT_SKILL_NAME);
    const instructions = (input.instructions ?? '').trim().slice(0, MAX_SOFT_SKILL_INSTRUCTIONS);
    if (!name || !instructions) return null;
    const baseMode: SubAgentMode = input.baseMode && MODE_PRESETS[input.baseMode] && input.baseMode !== 'eco' ? input.baseMode : 'sprint';
    const source: SoftSkill['source'] = input.source === 'catalog' ? 'catalog' : 'custom';
    const now = new Date().toISOString();
    return {
      id: input.id || `${source}:${this.uuid()}`,
      name,
      instructions,
      icon: input.icon || (source === 'catalog' ? CATALOG_SOFT_SKILL_ICON : DEFAULT_SOFT_SKILL_ICON),
      baseMode,
      source,
      ...(input.catalogItemId ? { catalogItemId: input.catalogItemId } : {}),
      createdAt: input.createdAt || now,
      updatedAt: now,
    };
  }

  /** Insert or replace (by id) and persist. Returns the stored skill. */
  save(input: Partial<SoftSkill> & { name: string; instructions: string }): SoftSkill | null {
    const skill = this.normalize(input);
    if (!skill) return null;
    this.skills.update(list => [skill, ...list.filter(s => s.id !== skill.id)]);
    this.persist();
    return skill;
  }

  remove(id: string): void {
    this.skills.update(list => list.filter(s => s.id !== id));
    this.persist();
  }

  byId(id: string | null | undefined): SoftSkill | undefined {
    if (!id) return undefined;
    return this.skills().find(s => s.id === id);
  }

  /** Wire payload for the spawn — only what the desktop preamble needs. */
  toPayload(skill: SoftSkill): SoftSkillPayload {
    return { id: skill.id, name: skill.name, instructions: skill.instructions };
  }

  /**
   * Turn a catalog skill (SKILL.md markdown payload) into plain instructions:
   * the YAML frontmatter is dropped, the body is kept verbatim.
   */
  instructionsFromSkillMarkdown(markdown: string): string {
    const text = (markdown ?? '').replace(/\r\n/g, '\n');
    const m = /^---\n[\s\S]*?\n---\n?/.exec(text);
    return (m ? text.slice(m[0].length) : text).trim();
  }

  private load(): SoftSkill[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((s: any) => this.normalize({ ...s, createdAt: s?.createdAt }))
        .filter((s: SoftSkill | null): s is SoftSkill => !!s);
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.skills()));
    } catch {
      // Quota / private mode: the in-memory list still works for this run.
    }
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
