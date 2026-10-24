import { Injectable } from '@angular/core';

/**
 * Project Brief — aggregation of the coding agents' memories for a workspace
 * (CLAUDE.md/AGENTS.md/GEMINI.md, Claude Code per-project memory files,
 * .promptops artifacts), collected by the native desktop side.
 *
 * Everything is local-only: memory content never leaves the device.
 */

export interface BriefContextFile {
  fileName: string;
  curated: boolean;
  excerpt: string;
  updatedAt?: string;
}

export interface BriefMemoryEntry {
  title: string;
  hook: string;
  file?: string;
}

export interface BriefActivityEntry {
  category: string;
  content: string;
  timestamp: number;
  relatedFiles: string[];
}

export interface ProjectBriefData {
  workspacePath: string;
  projectName: string;
  generatedAt: string;
  frameworks: string[];
  languages: string[];
  summary?: string;
  contextFiles: BriefContextFile[];
  agentMemories: {
    dir: string | null;
    entries: BriefMemoryEntry[];
    fileCount: number;
  };
  recentActivity: BriefActivityEntry[];
  aiSource: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectBriefService {
  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  private get api(): any {
    return (window as any).promptops;
  }

  /** Feature-detect against older preload builds. */
  get isAvailable(): boolean {
    return this.isDesktop && typeof this.api.collectProjectBrief === 'function';
  }

  async collect(workspacePath: string): Promise<ProjectBriefData> {
    if (!this.isAvailable) throw new Error('desktop_only');
    const res = await this.api.collectProjectBrief({ workspacePath });
    if (!res?.ok) throw new Error(res?.error || 'collect_failed');
    return res.data as ProjectBriefData;
  }

  /** One-shot LLM call through the session's provider CLI (local, nothing else is called). */
  async generateAiBrief(prompt: string, provider: string, cwd?: string): Promise<string> {
    if (!this.isDesktop || typeof this.api.aiGenerateText !== 'function') {
      throw new Error('desktop_only');
    }
    const res = await this.api.aiGenerateText(prompt, provider, cwd);
    if (!res?.ok) throw new Error(res?.error || 'generate_failed');
    return res.text as string;
  }
}
