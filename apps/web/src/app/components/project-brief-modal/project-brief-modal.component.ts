import { Component, HostListener, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  ProjectBriefService,
  ProjectBriefData,
  BriefMemoryEntry,
} from '@core/services/project-brief.service';
import { SwalService } from '@core/services/swal.service';

type MemoryCategory = 'project' | 'feedback' | 'reference' | 'other';
type MemoryCategoryFilter = 'all' | MemoryCategory;

/** Memory files are conventionally named <type>_<slug>.md — derive the chip category. */
function memoryCategoryOf(entry: BriefMemoryEntry): MemoryCategory {
  const source = (entry.file ?? entry.title).toLowerCase();
  if (source.startsWith('project')) return 'project';
  if (source.startsWith('feedback')) return 'feedback';
  if (source.startsWith('reference')) return 'reference';
  return 'other';
}

/**
 * Generated AI briefs are cached per workspace in localStorage so reopening
 * the modal shows the last brief instead of paying a new LLM call; the
 * Regenerate button overwrites the cached entry. Local-only, never synced.
 */
const BRIEF_CACHE_KEY = 'promptops_project_brief_cache';
const BRIEF_CACHE_MAX = 20;

interface CachedAiBrief {
  text: string;
  generatedAt: number;
}

function readBriefCache(): Record<string, CachedAiBrief> {
  try {
    const parsed = JSON.parse(localStorage.getItem(BRIEF_CACHE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Project Brief modal — a short, auto-generated presentation of the project
 * built from the coding agents' memories (CLAUDE.md/AGENTS.md/GEMINI.md,
 * Claude Code per-project memory, .promptops artifacts).
 *
 * Same interaction pattern as AddNoteModalComponent: placed in the parent
 * template, driven imperatively via a @ViewChild ref (`open()`/`close()`),
 * visibility on an internal signal. All data is local-only — nothing from
 * the agent memories ever leaves the device.
 */
@Component({
  selector: 'app-project-brief-modal',
  standalone: true,
  imports: [TranslateModule],
  template: `
    @if (visible()) {
      <div class="brief-modal-overlay" (click)="close()">
        <div class="brief-modal" role="dialog" aria-modal="true" [attr.aria-label]="'BRIEF.Project brief' | translate" (click)="$event.stopPropagation()">
          <div class="brief-modal-header">
            <span class="brief-title">
              <i class="ti ti-presentation"></i>
              {{ 'BRIEF.Project brief' | translate }}
              @if (data(); as d) {
                <span class="brief-project-name">· {{ d.projectName }}</span>
              }
            </span>
            <button class="close-btn" (click)="close()" [attr.aria-label]="'BUTTONS.Close' | translate"><i class="ti ti-x"></i></button>
          </div>

          <div class="brief-modal-body">
            @if (!workspacePath) {
              <div class="brief-empty">
                <i class="ti ti-folder-off"></i>
                <span>{{ 'BRIEF.No workspace' | translate }}</span>
              </div>
            } @else if (loading()) {
              <div class="brief-loading">
                <div class="spinner-border spinner-border-sm" role="status"></div>
                <span>{{ 'BRIEF.Reading memories' | translate }}</span>
              </div>
            } @else if (error()) {
              <div class="brief-error">
                <i class="ti ti-alert-triangle"></i>
                <span>{{ 'BRIEF.Error' | translate }}</span>
              </div>
            } @else {
              @if (data(); as d) {
              <div class="brief-path">
                <i class="ti ti-folder"></i>
                <span>{{ d.workspacePath }}</span>
              </div>

              @if (d.frameworks.length || d.languages.length) {
                <div class="brief-badges">
                  @for (fw of d.frameworks; track fw) {
                    <span class="brief-badge badge-fw">{{ fw }}</span>
                  }
                  @for (lang of d.languages; track lang) {
                    <span class="brief-badge badge-lang">{{ lang }}</span>
                  }
                </div>
              }

              @if (isBriefEmpty(d)) {
                <div class="brief-empty">
                  <i class="ti ti-brain"></i>
                  <span>{{ 'BRIEF.Empty' | translate }}</span>
                </div>
              } @else {
                <!-- AI summary -->
                <div class="brief-section">
                  <div class="brief-section-title">
                    <i class="ti ti-sparkles"></i>
                    <span>{{ 'BRIEF.AI summary' | translate }}</span>
                    @if (aiGeneratedAt(); as ts) {
                      <span class="brief-count">{{ 'BRIEF.Generated at' | translate: { date: formatBriefDate(ts) } }}</span>
                    }
                    @if (canGenerateAi()) {
                      <button
                        class="btn-generate"
                        (click)="generateAiBrief()"
                        [disabled]="aiLoading()"
                      >
                        @if (aiLoading()) {
                          <div class="spinner-border spinner-border-sm" role="status"></div>
                          {{ 'BRIEF.Generating' | translate }}
                        } @else {
                          <i class="ti ti-sparkles"></i>
                          {{ aiText() ? ('BRIEF.Regenerate' | translate) : ('BRIEF.Generate' | translate) }}
                        }
                      </button>
                    }
                  </div>
                  @if (aiError()) {
                    <div class="brief-error slim">
                      <i class="ti ti-alert-triangle"></i>
                      <span>{{ aiError() }}</span>
                    </div>
                  }
                  @if (aiText(); as text) {
                    <div class="brief-ai-text">{{ text }}</div>
                  } @else if (!aiLoading() && !aiError()) {
                    <div class="brief-hint">{{ 'BRIEF.AI hint' | translate }}</div>
                  }
                </div>

                <!-- Context files -->
                @if (curatedFiles(d).length) {
                  <div class="brief-section">
                    <div class="brief-section-title">
                      <i class="ti ti-file-text"></i>
                      <span>{{ 'BRIEF.Context files' | translate }}</span>
                    </div>
                    @for (file of curatedFiles(d); track file.fileName) {
                      <details class="brief-file" [open]="curatedFiles(d).length === 1">
                        <summary>{{ file.fileName }}</summary>
                        <pre class="brief-excerpt">{{ file.excerpt }}</pre>
                      </details>
                    }
                  </div>
                }

                <!-- Agent memories -->
                @if (d.agentMemories.entries.length) {
                  <div class="brief-section">
                    <div class="brief-section-title">
                      <i class="ti ti-brain"></i>
                      <span>{{ 'BRIEF.Agent memories' | translate }}</span>
                      @if (memoryFilterActive()) {
                        <span class="brief-count">{{ filteredMemories().length }}/{{ d.agentMemories.entries.length }}</span>
                      } @else {
                        <span class="brief-count">{{ 'BRIEF.Memory files' | translate: { count: d.agentMemories.fileCount } }}</span>
                      }
                    </div>
                    @if (memoryFilterEnabled(d)) {
                      <input
                        class="memory-filter"
                        type="text"
                        [placeholder]="'BRIEF.Filter memories' | translate"
                        [value]="memoryQuery()"
                        (input)="onMemoryQueryInput($event)"
                      />
                      @if (memoryCategories().length > 2) {
                        <div class="memory-chips">
                          @for (cat of memoryCategories(); track cat.key) {
                            <button
                              class="memory-chip"
                              [class.active]="memoryCategory() === cat.key"
                              (click)="memoryCategory.set(cat.key)"
                            >
                              {{ memoryCatLabels[cat.key] | translate }}
                              <span class="chip-count">{{ cat.count }}</span>
                            </button>
                          }
                        </div>
                      }
                    }
                    <div class="brief-memories" [class.scrollable]="memoryFilterEnabled(d)">
                      @for (entry of filteredMemories(); track $index) {
                        <div class="brief-memory-item">
                          <span class="memory-title">{{ entry.title }}</span>
                          @if (entry.hook) {
                            <span class="memory-hook">{{ entry.hook }}</span>
                          }
                        </div>
                      } @empty {
                        <div class="brief-hint">{{ 'BRIEF.No matches' | translate }}</div>
                      }
                    </div>
                  </div>
                }

                <!-- Recent activity -->
                @if (d.recentActivity.length) {
                  <div class="brief-section">
                    <div class="brief-section-title">
                      <i class="ti ti-history"></i>
                      <span>{{ 'BRIEF.Recent activity' | translate }}</span>
                    </div>
                    <div class="brief-memories">
                      @for (entry of d.recentActivity; track entry.timestamp) {
                        <div class="brief-memory-item">
                          <span class="activity-badge" [attr.data-category]="entry.category">{{ entry.category }}</span>
                          <span class="memory-hook">{{ entry.content }}</span>
                        </div>
                      }
                    </div>
                  </div>
                }
              }
              }
            }
          </div>

          <div class="brief-modal-footer">
            <button class="btn-cancel" (click)="close()">{{ 'BUTTONS.Close' | translate }}</button>
            @if (data() && !isBriefEmpty(data()!)) {
              <button class="btn-copy" (click)="copyBrief()">
                <i class="ti ti-copy"></i>
                {{ 'BRIEF.Copy' | translate }}
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .brief-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      z-index: 1050;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .brief-modal {
      width: 640px;
      max-width: 92vw;
      max-height: 84vh;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      overflow: hidden;
    }
    :host-context([data-bs-theme="dark"]) .brief-modal {
      background: #1e293b;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }
    .brief-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(100, 116, 139, 0.1);
      font-size: 0.9rem;
      font-weight: 700;
    }
    .brief-title { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
    .brief-project-name {
      font-weight: 500;
      color: rgba(100, 116, 139, 0.8);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      color: rgba(100, 116, 139, 0.5);
      padding: 0.15rem;
    }
    .close-btn:hover { color: #ef4444; }
    .brief-modal-body {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      overflow-y: auto;
    }
    .brief-path {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.72rem;
      color: rgba(100, 116, 139, 0.6);
      padding: 0.35rem 0.5rem;
      background: rgba(99, 102, 241, 0.04);
      border-radius: 6px;
      word-break: break-all;
    }
    .brief-badges { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .brief-badge {
      font-size: 0.68rem;
      font-weight: 600;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.08);
      color: #6366f1;
    }
    .brief-badge.badge-lang { background: rgba(139, 92, 246, 0.08); color: #8b5cf6; }
    .brief-loading, .brief-empty, .brief-error {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 1.5rem 0.5rem;
      font-size: 0.82rem;
      color: rgba(100, 116, 139, 0.7);
    }
    .brief-error { color: #ef4444; }
    .brief-error.slim { padding: 0.35rem 0; justify-content: flex-start; font-size: 0.75rem; }
    .brief-section {
      border: 1px solid rgba(100, 116, 139, 0.1);
      border-radius: 10px;
      padding: 0.6rem 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    :host-context([data-bs-theme="dark"]) .brief-section {
      border-color: rgba(99, 102, 241, 0.12);
    }
    .brief-section-title {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.78rem;
      font-weight: 700;
    }
    .brief-section-title i { color: #6366f1; }
    .brief-count {
      font-weight: 500;
      font-size: 0.68rem;
      color: rgba(100, 116, 139, 0.55);
    }
    .btn-generate {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.25rem 0.6rem;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-generate:hover { background: #4f46e5; }
    .btn-generate:disabled { opacity: 0.6; cursor: not-allowed; }
    .brief-ai-text {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.8rem;
      line-height: 1.5;
      padding: 0.5rem 0.6rem;
      background: rgba(99, 102, 241, 0.04);
      border-radius: 8px;
    }
    .brief-hint { font-size: 0.72rem; color: rgba(100, 116, 139, 0.55); }
    .brief-file summary {
      cursor: pointer;
      font-size: 0.76rem;
      font-weight: 600;
      color: #6366f1;
    }
    .brief-excerpt {
      margin: 0.35rem 0 0;
      max-height: 220px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.72rem;
      line-height: 1.45;
      padding: 0.5rem 0.6rem;
      background: rgba(100, 116, 139, 0.05);
      border-radius: 8px;
    }
    :host-context([data-bs-theme="dark"]) .brief-excerpt,
    :host-context([data-bs-theme="dark"]) .brief-ai-text {
      background: rgba(15, 23, 42, 0.5);
      color: #e2e8f0;
    }
    .brief-memories { display: flex; flex-direction: column; gap: 0.3rem; }
    .brief-memories.scrollable {
      max-height: 280px;
      overflow-y: auto;
      padding-right: 0.25rem;
    }
    .memory-filter {
      width: 100%;
      padding: 0.35rem 0.6rem;
      border: 1px solid rgba(100, 116, 139, 0.15);
      border-radius: 8px;
      font-size: 0.75rem;
      background: transparent;
      color: inherit;
      outline: none;
    }
    .memory-filter:focus { border-color: rgba(99, 102, 241, 0.4); }
    .memory-filter::placeholder { color: rgba(100, 116, 139, 0.5); }
    :host-context([data-bs-theme="dark"]) .memory-filter {
      border-color: rgba(148, 163, 184, 0.2);
    }
    .memory-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .memory-chip {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.15rem 0.55rem;
      border: 1px solid rgba(100, 116, 139, 0.15);
      border-radius: 999px;
      background: transparent;
      font-size: 0.68rem;
      font-weight: 600;
      color: rgba(100, 116, 139, 0.8);
      cursor: pointer;
    }
    .memory-chip:hover { border-color: rgba(99, 102, 241, 0.35); color: #6366f1; }
    .memory-chip.active {
      background: rgba(99, 102, 241, 0.1);
      border-color: rgba(99, 102, 241, 0.4);
      color: #6366f1;
    }
    .memory-chip .chip-count { font-weight: 500; opacity: 0.7; }
    :host-context([data-bs-theme="dark"]) .memory-chip { color: rgba(148, 163, 184, 0.85); }
    :host-context([data-bs-theme="dark"]) .memory-chip:hover,
    :host-context([data-bs-theme="dark"]) .memory-chip.active { color: #a5b4fc; }
    .brief-memory-item {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      font-size: 0.75rem;
      line-height: 1.4;
    }
    .memory-title { font-weight: 600; flex-shrink: 0; }
    .memory-hook { color: rgba(100, 116, 139, 0.75); word-break: break-word; }
    :host-context([data-bs-theme="dark"]) .memory-hook { color: rgba(148, 163, 184, 0.85); }
    .activity-badge {
      flex-shrink: 0;
      font-size: 0.62rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 0.08rem 0.4rem;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.08);
      color: #6366f1;
    }
    .brief-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid rgba(100, 116, 139, 0.08);
    }
    .btn-cancel {
      padding: 0.4rem 0.8rem;
      border: 1px solid rgba(100, 116, 139, 0.15);
      border-radius: 8px;
      background: transparent;
      font-size: 0.78rem;
      cursor: pointer;
      color: inherit;
    }
    .btn-copy {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.4rem 0.8rem;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-copy:hover { background: #4f46e5; }
  `,
})
export class ProjectBriefModalComponent {
  /** Set imperatively by the parent before calling open() (addNoteModal pattern). */
  workspacePath?: string;
  provider?: string;
  projectName?: string;

  visible = signal(false);
  loading = signal(false);
  error = signal(false);
  data = signal<ProjectBriefData | null>(null);
  aiText = signal<string | null>(null);
  aiGeneratedAt = signal<number | null>(null);
  aiLoading = signal(false);
  aiError = signal<string | null>(null);

  /** Above this count the memories get a filter toolbar and a bounded scroll box. */
  private static readonly MEMORY_FILTER_MIN = 12;

  memoryQuery = signal('');
  memoryCategory = signal<MemoryCategoryFilter>('all');

  readonly memoryCatLabels: Record<MemoryCategoryFilter, string> = {
    all: 'BRIEF.All',
    project: 'BRIEF.Projects',
    feedback: 'BRIEF.Feedback',
    reference: 'BRIEF.References',
    other: 'BRIEF.Other',
  };

  memoryCategories = computed(() => {
    const entries = this.data()?.agentMemories.entries ?? [];
    const counts: Record<MemoryCategory, number> = { project: 0, feedback: 0, reference: 0, other: 0 };
    for (const entry of entries) counts[memoryCategoryOf(entry)]++;
    const cats: { key: MemoryCategoryFilter; count: number }[] = [
      { key: 'all', count: entries.length },
    ];
    for (const key of ['project', 'feedback', 'reference', 'other'] as const) {
      if (counts[key] > 0) cats.push({ key, count: counts[key] });
    }
    return cats;
  });

  filteredMemories = computed(() => {
    const entries = this.data()?.agentMemories.entries ?? [];
    const query = this.memoryQuery().trim().toLowerCase();
    const category = this.memoryCategory();
    return entries.filter(
      (entry) =>
        (category === 'all' || memoryCategoryOf(entry) === category) &&
        (!query ||
          entry.title.toLowerCase().includes(query) ||
          entry.hook.toLowerCase().includes(query)),
    );
  });

  memoryFilterActive = computed(
    () => this.memoryQuery().trim() !== '' || this.memoryCategory() !== 'all',
  );

  private readonly briefService = inject(ProjectBriefService);
  private readonly swalService = inject(SwalService);
  private readonly translateService = inject(TranslateService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible()) this.close();
  }

  async open(): Promise<void> {
    this.visible.set(true);
    this.error.set(false);
    this.data.set(null);
    this.aiText.set(null);
    this.aiGeneratedAt.set(null);
    this.aiError.set(null);
    this.memoryQuery.set('');
    this.memoryCategory.set('all');
    this.loadCachedAiBrief();

    if (!this.workspacePath) return;
    if (!this.briefService.isAvailable) {
      // Web build or an older desktop preload without the Project Brief API.
      this.error.set(true);
      return;
    }

    this.loading.set(true);
    try {
      this.data.set(await this.briefService.collect(this.workspacePath));
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    this.visible.set(false);
  }

  curatedFiles(d: ProjectBriefData) {
    return d.contextFiles.filter((f) => f.curated);
  }

  memoryFilterEnabled(d: ProjectBriefData): boolean {
    return d.agentMemories.entries.length > ProjectBriefModalComponent.MEMORY_FILTER_MIN;
  }

  /** Locale-aware timestamp without requiring Angular locale registration. */
  formatBriefDate(ts: number): string {
    const lang = this.translateService.currentLang || this.translateService.defaultLang || 'en';
    try {
      return new Date(ts).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  private loadCachedAiBrief(): void {
    if (!this.workspacePath) return;
    const cached = readBriefCache()[this.workspacePath];
    if (cached?.text) {
      this.aiText.set(cached.text);
      this.aiGeneratedAt.set(typeof cached.generatedAt === 'number' ? cached.generatedAt : null);
    }
  }

  private saveCachedAiBrief(text: string, generatedAt: number): void {
    if (!this.workspacePath) return;
    const cache = readBriefCache();
    cache[this.workspacePath] = { text, generatedAt };
    const paths = Object.keys(cache);
    if (paths.length > BRIEF_CACHE_MAX) {
      paths.sort((a, b) => (cache[a]?.generatedAt ?? 0) - (cache[b]?.generatedAt ?? 0));
      for (const stale of paths.slice(0, paths.length - BRIEF_CACHE_MAX)) delete cache[stale];
    }
    try {
      localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Quota exceeded — the brief still lives in the open modal, just unsaved.
    }
  }

  onMemoryQueryInput(event: Event): void {
    this.memoryQuery.set((event.target as HTMLInputElement).value);
  }

  isBriefEmpty(d: ProjectBriefData): boolean {
    return (
      this.curatedFiles(d).length === 0 &&
      d.agentMemories.entries.length === 0 &&
      d.recentActivity.length === 0
    );
  }

  /** AI generation goes through the session's provider CLI — not for plain shells. */
  canGenerateAi(): boolean {
    return !!this.provider && this.provider !== 'generic-shell' && this.briefService.isDesktop;
  }

  async generateAiBrief(): Promise<void> {
    const d = this.data();
    if (!d || !this.provider || this.aiLoading()) return;

    this.aiLoading.set(true);
    this.aiError.set(null);
    try {
      const lang = this.translateService.currentLang || this.translateService.defaultLang || 'en';
      const prompt =
        'You are writing a short project brief to present a software project to a teammate.\n' +
        `Write it in the language with ISO 639-1 code "${lang}".\n` +
        'Maximum ~300 words. Plain text only: short paragraphs and hyphen bullets, no markdown syntax.\n' +
        'Cover: what the project is, its main components, key conventions or guardrails, and current work in progress.\n' +
        'Base it ONLY on the material below; do not invent anything.\n\n' +
        '=== MATERIAL ===\n' +
        d.aiSource;
      const text = await this.briefService.generateAiBrief(prompt, this.provider, this.workspacePath);
      const generatedAt = Date.now();
      this.aiText.set(text);
      this.aiGeneratedAt.set(generatedAt);
      this.saveCachedAiBrief(text, generatedAt);
    } catch (err: any) {
      this.aiError.set(err?.message || this.translateService.instant('MESSAGE.Generic error'));
    } finally {
      this.aiLoading.set(false);
    }
  }

  async copyBrief(): Promise<void> {
    const d = this.data();
    if (!d) return;

    const lines: string[] = [`# ${d.projectName}`, d.workspacePath, ''];
    const ai = this.aiText();
    if (ai) {
      lines.push(ai, '');
    }
    for (const file of this.curatedFiles(d)) {
      lines.push(`## ${file.fileName}`, file.excerpt, '');
    }
    if (d.agentMemories.entries.length) {
      lines.push(`## ${this.translateService.instant('BRIEF.Agent memories')}`);
      for (const entry of d.agentMemories.entries) {
        lines.push(`- ${entry.title}${entry.hook ? ` — ${entry.hook}` : ''}`);
      }
      lines.push('');
    }
    if (d.recentActivity.length) {
      lines.push(`## ${this.translateService.instant('BRIEF.Recent activity')}`);
      for (const entry of d.recentActivity) {
        lines.push(`- [${entry.category}] ${entry.content}`);
      }
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      this.swalService.autoClose(
        this.translateService.instant('BRIEF.Copied'),
        this.translateService.instant('BRIEF.Copied message'),
      );
    } catch {
      this.swalService.error(this.translateService.instant('MESSAGE.Generic error'));
    }
  }
}
