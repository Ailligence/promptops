import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  signal,
  computed,
  OnInit,
  HostListener,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { SubAgentService, ArchivedSubAgentEntry, MODE_PRESETS } from '../services/sub-agent.service';

/**
 * Modal that displays previously closed/completed sub-agent sessions,
 * allowing the user to identify and select one for resume.
 *
 * Each entry shows: title, role, mode badge, parent session, workspace,
 * relative timestamp, prompt excerpt, and resume capability indicator.
 */
@Component({
  selector: 'app-resume-subagent-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <h5 class="modal-title">
        <iconify-icon icon="solar:history-bold" width="18"></iconify-icon>
        {{ 'SUBAGENTS.Resume Sub-Agent' | translate }}
      </h5>
      <button type="button" class="btn-close" (click)="modal.dismiss()" [attr.aria-label]="'COMMON.Close' | translate"></button>
    </div>
    <div class="modal-body">
      <!-- Scope tabs -->
      <div class="scope-tabs">
        <button class="scope-tab" [class.active]="scope() === 'session'" (click)="setScope('session')">
          <iconify-icon icon="solar:monitor-bold" width="13"></iconify-icon>
          {{ currentSessionName || ('SESSIONS.Session' | translate) }}
          @if (sessionEntries().length > 0) {
            <span class="scope-count">{{ sessionEntries().length }}</span>
          }
        </button>
        <button class="scope-tab" [class.active]="scope() === 'all'" (click)="setScope('all')">
          <iconify-icon icon="solar:folder-bold" width="13"></iconify-icon>
          {{ 'SUBAGENTS.All workspaces' | translate }}
          @if (allEntries().length > 0) {
            <span class="scope-count">{{ allEntries().length }}</span>
          }
        </button>
      </div>

      <!-- Search -->
      <div class="search-box">
        <iconify-icon icon="solar:magnifer-linear" width="14"></iconify-icon>
        <input
          type="text"
          class="search-input"
          ngbAutofocus
          [attr.aria-label]="'SUBAGENTS.Search by name or role' | translate"
          [placeholder]="'SUBAGENTS.Search by name or role' | translate"
          [(ngModel)]="searchQuery"
          (ngModelChange)="onSearch()"
        />
        @if (searchQuery) {
          <button class="search-clear" (click)="searchQuery = ''; onSearch()" [attr.aria-label]="'SUBAGENTS.ARCHIVE.Clear search' | translate">
            <iconify-icon icon="solar:close-circle-bold" width="14"></iconify-icon>
          </button>
        }
      </div>

      <!-- Archived list -->
      @if (loading()) {
        <div class="loading-state">
          <iconify-icon icon="solar:refresh-bold" width="16" class="spin"></iconify-icon>
          {{ 'SUBAGENTS.Loading' | translate }}
        </div>
      } @else if (filteredEntries().length === 0) {
        <div class="empty-state">
          <iconify-icon icon="solar:inbox-line-bold-duotone" width="32"></iconify-icon>
          <span>{{ 'SUBAGENTS.No archived sessions' | translate }}</span>
        </div>
      } @else {
        <div class="archived-list">
          @for (entry of filteredEntries(); track entryKey(entry)) {
            <div
              class="archived-card"
              [class.selected]="selectedEntry() === entry"
              (click)="selectEntry(entry)"
            >
              <div class="card-top">
                <div class="card-left">
                  <iconify-icon [icon]="entry.icon" width="20"></iconify-icon>
                  <div class="card-info">
                    <span class="card-title">{{ entry.title }}</span>
                    <span class="card-meta">
                      {{ entry.parentSessionName || ('SESSIONS.Session' | translate) }}
                      @if (entry.workspacePath) {
                        · {{ shortenPath(entry.workspacePath) }}
                      }
                      · {{ timeAgo(entry.archivedAt) }}
                    </span>
                  </div>
                </div>
                <div class="card-badges">
                  @if (entry.mode) {
                    <span class="mode-badge">{{ getModeLabel(entry.mode) }}</span>
                  }
                  <span class="resume-badge" [class.can-resume]="entry.canResume" [class.re-spawn]="!entry.canResume">
                    @if (entry.canResume) {
                      <iconify-icon icon="solar:restart-bold" width="10"></iconify-icon>
                      {{ 'SESSIONS.Resume' | translate }}
                    } @else {
                      <iconify-icon icon="solar:play-bold" width="10"></iconify-icon>
                      {{ 'SUBAGENTS.ARCHIVE.Respawn' | translate }}
                    }
                  </span>
                </div>
              </div>
              <div class="card-prompt">
                <iconify-icon icon="solar:chat-round-dots-bold" width="12"></iconify-icon>
                {{ truncatePrompt(entry.userPrompt, 120) }}
              </div>
            </div>
          }
        </div>
      }
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline-secondary btn-sm" (click)="modal.dismiss()">
        {{ 'SESSIONS.Cancel' | translate }}
      </button>
      <button
        class="btn btn-primary btn-sm"
        [disabled]="!selectedEntry()"
        (click)="confirm()"
      >
        <iconify-icon icon="solar:restart-bold" width="14" class="me-1"></iconify-icon>
        {{ 'SUBAGENTS.Resume Selected' | translate }}
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .scope-tabs {
      display: flex;
      gap: 0.35rem;
      margin-bottom: 0.5rem;
    }
    .scope-tab {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
      padding: 0.4rem 0.5rem;
      font-size: 0.72rem;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid var(--bs-border-color, rgba(100, 116, 139, 0.12));
      background: transparent;
      color: var(--bs-secondary-color, rgba(100, 116, 139, 0.6));
      cursor: pointer;
      transition: all var(--po-duration-fast);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .scope-tab:hover { background: rgba(99, 102, 241, 0.04); border-color: rgba(99, 102, 241, 0.15); color: #818cf8; }
    .scope-tab.active {
      background: oklch(from var(--po-accent) l c h / 8%);
      border-color: oklch(from var(--po-accent) l c h / 30%);
      color: var(--po-accent-text);
    }
    .scope-count {
      font-size: 0.6rem;
      font-weight: 700;
      background: oklch(from var(--po-accent) l c h / 15%);
      color: var(--po-accent-text);
      padding: 0 5px;
      border-radius: 999px;
    }

    .search-box {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 0.65rem;
      background: var(--bs-tertiary-bg, rgba(248, 250, 252, 0.5));
      border: 1px solid var(--bs-border-color, rgba(100, 116, 139, 0.12));
      border-radius: 8px;
      margin-bottom: 0.75rem;
      color: var(--bs-secondary-color, rgba(100, 116, 139, 0.6));
    }
    :host-context([data-bs-theme="dark"]) .search-box { background: rgba(15, 23, 42, 0.3); }

    .search-input {
      flex: 1;
      border: none;
      background: transparent;
      outline: none;
      font-size: 0.8rem;
      color: var(--bs-body-color, inherit);
    }
    .search-input::placeholder {
      color: var(--bs-secondary-color, rgba(100, 116, 139, 0.4));
    }

    .search-clear {
      display: flex;
      align-items: center;
      border: none;
      background: transparent;
      color: var(--bs-secondary-color, rgba(100, 116, 139, 0.5));
      cursor: pointer;
      padding: 0;
    }
    .search-clear:hover { color: var(--bs-body-color, inherit); }

    .archived-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      max-height: 360px;
      overflow-y: auto;
    }

    .archived-card {
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--bs-border-color, rgba(100, 116, 139, 0.12));
      border-radius: 8px;
      cursor: pointer;
      transition: all var(--po-duration-fast);
    }
    .archived-card:hover {
      background: oklch(from var(--po-accent) l c h / 4%);
      border-color: oklch(from var(--po-accent) l c h / 15%);
    }
    .archived-card.selected {
      background: oklch(from var(--po-accent) l c h / 8%);
      border-color: oklch(from var(--po-accent) l c h / 35%);
    }
    :host-context([data-bs-theme="dark"]) .archived-card:hover { background: rgba(99, 102, 241, 0.06); }
    :host-context([data-bs-theme="dark"]) .archived-card.selected { background: rgba(99, 102, 241, 0.1); }

    .card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }

    .card-left {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }

    .card-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .card-title {
      font-size: 0.82rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card-meta {
      font-size: 0.68rem;
      color: var(--bs-secondary-color, rgba(100, 116, 139, 0.6));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card-badges {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      flex-shrink: 0;
    }

    .mode-badge {
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      background: rgba(88, 166, 255, 0.12);
      color: var(--po-info);
      letter-spacing: 0.03em;
    }

    .resume-badge {
      display: flex;
      align-items: center;
      gap: 0.2rem;
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      letter-spacing: 0.03em;
    }
    .resume-badge.can-resume {
      background: oklch(from var(--po-success) l c h / 12%);
      color: var(--po-success);
    }
    .resume-badge.re-spawn {
      background: oklch(from var(--po-warning) l c h / 12%);
      color: var(--po-warning);
    }

    .card-prompt {
      display: flex;
      align-items: flex-start;
      gap: 0.3rem;
      font-size: 0.72rem;
      color: var(--bs-secondary-color, rgba(100, 116, 139, 0.5));
      line-height: 1.4;
      font-family: 'JetBrains Mono', monospace;
      padding-inline-start: 0.1rem;
    }
    .card-prompt iconify-icon {
      flex-shrink: 0;
      margin-top: 2px;
    }

    .loading-state, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 2rem 1rem;
      color: var(--bs-secondary-color, rgba(100, 116, 139, 0.5));
      font-size: 0.82rem;
    }

    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `,
})
export class ResumeSubAgentModalComponent implements OnInit {
  modal = inject(NgbActiveModal);
  private subAgentService = inject(SubAgentService);
  private translate = inject(TranslateService);

  /** Set via componentInstance before opening */
  currentSessionName = '';
  currentWorkspacePath = '';

  loading = signal(true);
  allEntries = signal<ArchivedSubAgentEntry[]>([]);
  sessionEntries = signal<ArchivedSubAgentEntry[]>([]);
  filteredEntries = signal<ArchivedSubAgentEntry[]>([]);
  selectedEntry = signal<ArchivedSubAgentEntry | null>(null);
  scope = signal<'session' | 'all'>('session');
  searchQuery = '';

  async ngOnInit(): Promise<void> {
    try {
      const entries = await this.subAgentService.listArchived();
      this.allEntries.set(entries);

      // Filter entries belonging to current session/workspace
      const sessionFiltered = entries.filter((e) =>
        (this.currentSessionName && e.parentSessionName === this.currentSessionName) ||
        (this.currentWorkspacePath && e.workspacePath === this.currentWorkspacePath),
      );
      this.sessionEntries.set(sessionFiltered);

      // Default to session scope if there are entries, otherwise show all
      if (sessionFiltered.length > 0) {
        this.scope.set('session');
        this.filteredEntries.set(sessionFiltered);
      } else {
        this.scope.set('all');
        this.filteredEntries.set(entries);
      }
    } catch {
      // Unreadable archive: the empty state is shown instead of an unhandled rejection.
      this.allEntries.set([]);
      this.sessionEntries.set([]);
      this.filteredEntries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  setScope(newScope: 'session' | 'all'): void {
    this.scope.set(newScope);
    this.searchQuery = '';
    this.selectedEntry.set(null);
    this.filteredEntries.set(
      newScope === 'session' ? this.sessionEntries() : this.allEntries(),
    );
  }

  onSearch(): void {
    const base = this.scope() === 'session' ? this.sessionEntries() : this.allEntries();
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filteredEntries.set(base);
      return;
    }
    this.filteredEntries.set(
      base.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.role.toLowerCase().includes(q) ||
          (e.parentSessionName ?? '').toLowerCase().includes(q) ||
          e.userPrompt.toLowerCase().includes(q),
      ),
    );
    if (this.selectedEntry() && !this.filteredEntries().includes(this.selectedEntry()!)) {
      this.selectedEntry.set(null);
    }
  }

  selectEntry(entry: ArchivedSubAgentEntry): void {
    this.selectedEntry.update((current) => (current === entry ? null : entry));
  }

  confirm(): void {
    if (this.selectedEntry()) {
      this.modal.close(this.selectedEntry());
    }
  }

  /** Enter resumes the selected entry (primary, non-destructive); never from a button or textarea. */
  @HostListener('keydown.enter', ['$event'])
  onEnter(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (event.defaultPrevented || !this.selectedEntry()) return;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) return;
    event.preventDefault();
    this.confirm();
  }

  entryKey(entry: ArchivedSubAgentEntry): string {
    return entry.archiveId ?? `${entry.parentSessionId}-${entry.index}-${entry.archivedAt}`;
  }

  getModeLabel(mode: string): string {
    const preset = MODE_PRESETS[mode as keyof typeof MODE_PRESETS];
    return preset ? `${preset.icon} ${preset.label}` : mode;
  }

  truncatePrompt(prompt: string, maxLen: number): string {
    if (!prompt) return '';
    // Strip mode preamble if accidentally included
    const clean = prompt.replace(/^You are a specialized sub-agent[\s\S]*?---\s*/m, '').trim();
    const text = clean || prompt;
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  }

  shortenPath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    return parts.length > 2 ? parts.slice(-2).join('/') : path;
  }

  timeAgo(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60_000);
    const t = (key: string, n?: number) => this.translate.instant('SUBAGENTS.ARCHIVE.' + key, { n });
    if (minutes < 1) return t('Just now');
    if (minutes < 60) return t('Minutes ago', minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('Hours ago', hours);
    const days = Math.floor(hours / 24);
    if (days === 1) return t('Yesterday');
    return t('Days ago', days);
  }
}
