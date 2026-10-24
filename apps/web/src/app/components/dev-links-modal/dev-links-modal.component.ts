import { Component, HostListener, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DevLink, DevLinksService } from '@core/services/dev-links.service';
import { SwalService } from '@core/services/swal.service';

/**
 * Dev Links modal — lists the local dev URLs a project exposes and opens them
 * in the system browser on click. A fast heuristic scan (cached in the main
 * process, TTL 4h) seeds the list; the session's provider CLI can refine it
 * (AI, project-aware). The combined list is cached per workspace in
 * localStorage so reopening is instant. Local-only, nothing leaves the device.
 *
 * Same imperative pattern as ProjectBriefModalComponent: placed in the parent
 * template, driven via @ViewChild `open()`/`close()`.
 */
@Component({
  selector: 'app-dev-links-modal',
  standalone: true,
  imports: [TranslateModule],
  template: `
    @if (visible()) {
      <div class="dl-overlay po-modal-overlay" (click)="close()">
        <div class="dl-modal po-modal" role="dialog" aria-modal="true" [attr.aria-label]="'DEVLINKS.Title' | translate" (click)="$event.stopPropagation()">
          <div class="dl-header po-modal-header">
            <span class="dl-title po-modal-title">
              <iconify-icon [icon]="browserIcon()" width="18"></iconify-icon>
              {{ 'DEVLINKS.Title' | translate }}
              @if (projectName) {
                <span class="dl-project">· {{ projectName }}</span>
              }
            </span>
            <button class="dl-close po-modal-close" (click)="close()" [attr.aria-label]="'BUTTONS.Close' | translate"><iconify-icon icon="solar:close-circle-linear" width="18"></iconify-icon></button>
          </div>

          <div class="dl-body po-modal-body">
            @if (!workspacePath) {
              <div class="dl-empty">
                <iconify-icon icon="solar:folder-error-linear" width="22"></iconify-icon>
                <span>{{ 'DEVLINKS.No workspace' | translate }}</span>
              </div>
            } @else if (loading()) {
              <div class="dl-loading">
                <div class="spinner-border spinner-border-sm" role="status"></div>
                <span>{{ 'DEVLINKS.Scanning' | translate }}</span>
              </div>
            } @else {
              @if (links().length === 0 && !aiLoading()) {
                <div class="dl-empty">
                  <iconify-icon icon="solar:link-broken-linear" width="22"></iconify-icon>
                  <span>{{ 'DEVLINKS.Empty' | translate }}</span>
                </div>
              }

              <div class="dl-list">
                @for (link of links(); track link.url) {
                  <button class="dl-item" (click)="openLink(link)">
                    <span class="dl-item-main">
                      <span class="dl-item-label">
                        {{ link.label }}
                        @if (link.source === 'ai') {
                          <iconify-icon class="dl-ai-badge" icon="solar:magic-wand-bold" width="12"></iconify-icon>
                        }
                      </span>
                      @if (link.description) {
                        <span class="dl-item-desc">{{ link.description }}</span>
                      }
                      <span class="dl-item-url">{{ link.url }}</span>
                    </span>
                    <iconify-icon class="dl-item-go" icon="solar:arrow-right-up-linear" width="16"></iconify-icon>
                  </button>
                }
              </div>

              @if (aiLoading()) {
                <div class="dl-loading slim">
                  <div class="spinner-border spinner-border-sm" role="status"></div>
                  <span>{{ 'DEVLINKS.AI searching' | translate }}</span>
                </div>
              }
              @if (aiError()) {
                <div class="dl-error slim">
                  <iconify-icon icon="solar:danger-triangle-linear" width="14"></iconify-icon>
                  <span>{{ aiError() }}</span>
                </div>
              }
            }
          </div>

          <div class="dl-footer po-modal-footer">
            <span class="dl-hint">
              @if (aiGeneratedAt(); as ts) {
                {{ 'DEVLINKS.AI generated at' | translate: { date: formatDate(ts) } }}
              } @else {
                {{ 'DEVLINKS.Hint' | translate }}
              }
            </span>
            <div class="dl-actions">
              @if (canGenerateAi()) {
                <button class="dl-btn-ai" (click)="generateAi()" [disabled]="aiLoading()">
                  <iconify-icon icon="solar:magic-wand-bold" width="14"></iconify-icon>
                  {{ (aiGeneratedAt() ? 'DEVLINKS.Refresh AI' : 'DEVLINKS.Find with AI') | translate }}
                </button>
              }
              <button class="dl-btn-close" (click)="close()">{{ 'BUTTONS.Close' | translate }}</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .dl-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      backdrop-filter: blur(4px); z-index: 1050;
      display: flex; align-items: center; justify-content: center;
    }
    .dl-modal {
      width: 520px; max-width: 92vw; max-height: 82vh;
      display: flex; flex-direction: column;
      background: #fff; border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15); overflow: hidden;
    }
    :host-context([data-bs-theme="dark"]) .dl-modal {
      background: #1e293b; box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .dl-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem; border-bottom: 1px solid rgba(100,116,139,0.1);
      font-size: 0.9rem; font-weight: 700;
    }
    .dl-title { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
    .dl-project {
      font-weight: 500; color: rgba(100,116,139,0.8);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dl-close {
      background: none; border: none; cursor: pointer;
      color: rgba(100,116,139,0.5); padding: 0.1rem; display: flex;
    }
    .dl-close:hover { color: #ef4444; }
    .dl-body {
      padding: 0.85rem 1rem; display: flex; flex-direction: column;
      gap: 0.6rem; overflow-y: auto;
    }
    .dl-loading, .dl-empty, .dl-error {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      padding: 1.5rem 0.5rem; font-size: 0.82rem; color: rgba(100,116,139,0.7);
    }
    .dl-loading.slim, .dl-error.slim { padding: 0.5rem; justify-content: flex-start; font-size: 0.75rem; }
    .dl-error { color: #ef4444; }
    .dl-list { display: flex; flex-direction: column; gap: 0.4rem; }
    .dl-item {
      display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
      width: 100%; text-align: start; cursor: pointer;
      padding: 0.55rem 0.7rem; border-radius: 10px;
      border: 1px solid rgba(100,116,139,0.14); background: transparent; color: inherit;
      transition: border-color 0.12s, background 0.12s;
    }
    .dl-item:hover {
      border-color: rgba(99,102,241,0.45);
      background: rgba(99,102,241,0.05);
    }
    .dl-item-main { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .dl-item-label {
      display: flex; align-items: center; gap: 0.3rem;
      font-size: 0.82rem; font-weight: 600;
    }
    .dl-ai-badge { color: #8b5cf6; }
    .dl-item-desc { font-size: 0.72rem; color: rgba(100,116,139,0.75); }
    .dl-item-url {
      font-size: 0.7rem; color: #6366f1; font-family: ui-monospace, monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dl-item-go { color: rgba(100,116,139,0.5); flex-shrink: 0; }
    .dl-item:hover .dl-item-go { color: #6366f1; }
    .dl-footer {
      display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
      padding: 0.7rem 1rem; border-top: 1px solid rgba(100,116,139,0.08);
    }
    .dl-hint { font-size: 0.68rem; color: rgba(100,116,139,0.55); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dl-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
    .dl-btn-ai {
      display: flex; align-items: center; gap: 0.3rem;
      padding: 0.4rem 0.7rem; background: #8b5cf6; color: #fff; border: none;
      border-radius: 8px; font-size: 0.75rem; font-weight: 600; cursor: pointer;
    }
    .dl-btn-ai:hover { background: #7c3aed; }
    .dl-btn-ai:disabled { opacity: 0.6; cursor: not-allowed; }
    .dl-btn-close {
      padding: 0.4rem 0.8rem; border: 1px solid rgba(100,116,139,0.15);
      border-radius: 8px; background: transparent; font-size: 0.75rem;
      cursor: pointer; color: inherit;
    }
  `,
})
export class DevLinksModalComponent {
  /** Set imperatively by the parent before calling open(). */
  workspacePath?: string;
  provider?: string;
  projectName?: string;

  visible = signal(false);
  loading = signal(false);
  links = signal<DevLink[]>([]);
  aiLoading = signal(false);
  aiError = signal<string | null>(null);
  aiGeneratedAt = signal<number | null>(null);
  browserIcon = signal('solar:global-linear');

  private aiSource = '';

  private readonly service = inject(DevLinksService);
  private readonly swal = inject(SwalService);
  private readonly translate = inject(TranslateService);

  canGenerateAi = computed(
    () => !!this.provider && this.provider !== 'generic-shell' && this.service.isDesktop,
  );

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible()) this.close();
  }

  async open(): Promise<void> {
    this.visible.set(true);
    this.aiError.set(null);
    this.aiGeneratedAt.set(null);
    this.links.set([]);
    this.aiSource = '';

    this.service.defaultBrowser().then((b) => this.browserIcon.set(b.icon)).catch(() => {});

    if (!this.workspacePath || !this.service.isAvailable) return;

    // Serve the per-project cache instantly if present.
    const cached = this.service.getCached(this.workspacePath);
    if (cached) {
      this.links.set(cached.links);
      this.aiGeneratedAt.set(cached.aiGeneratedAt);
    }

    // Refresh the heuristic layer (cheap, cached in main) and merge.
    this.loading.set(!cached);
    try {
      const res = await this.service.scan(this.workspacePath);
      this.aiSource = res.aiSource;
      this.mergeLinks(res.links);
      this.persist();
    } catch {
      /* keep whatever the cache had */
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    this.visible.set(false);
  }

  async openLink(link: DevLink): Promise<void> {
    try {
      await this.service.open(link.url);
    } catch {
      this.swal.error(this.translate.instant('MESSAGE.Generic error'));
    }
  }

  async generateAi(): Promise<void> {
    if (!this.workspacePath || !this.provider || this.aiLoading()) return;
    this.aiLoading.set(true);
    this.aiError.set(null);
    try {
      const aiLinks = await this.service.generateAiLinks(this.provider, this.workspacePath, this.aiSource);
      this.mergeLinks(aiLinks);
      this.aiGeneratedAt.set(Date.now());
      this.persist();
    } catch (err: any) {
      this.aiError.set(err?.message || this.translate.instant('MESSAGE.Generic error'));
    } finally {
      this.aiLoading.set(false);
    }
  }

  /** Merge new links, de-duped by URL; AI-sourced entries win on label/desc. */
  private mergeLinks(incoming: DevLink[]): void {
    const byUrl = new Map<string, DevLink>();
    for (const l of this.links()) byUrl.set(l.url, l);
    for (const l of incoming) {
      const existing = byUrl.get(l.url);
      if (!existing || l.source === 'ai') byUrl.set(l.url, l);
    }
    this.links.set([...byUrl.values()]);
  }

  private persist(): void {
    if (this.workspacePath) {
      this.service.saveCached(this.workspacePath, this.links(), this.aiGeneratedAt());
    }
  }

  formatDate(ts: number): string {
    const lang = this.translate.currentLang || this.translate.defaultLang || 'en';
    try {
      return new Date(ts).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return new Date(ts).toLocaleString();
    }
  }
}
