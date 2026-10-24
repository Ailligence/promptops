import {
  Component,
  inject,
  input,
  output,
  signal,
  OnInit,
  OnDestroy,
  ElementRef,
  HostListener,
  Renderer2,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { DataBackend } from '@core/data/data-backend';
import { CategoryNamePipe } from '@core/category-name.pipe';

type PromptTab = 'mine' | 'starred' | 'shared';

@Component({
  selector: 'app-prompt-picker-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule, CategoryNamePipe],
  template: `
    <div class="prompt-picker-backdrop" (click)="closed.emit()"></div>
    <div class="prompt-picker-modal">
      <div class="prompt-picker-header">
        <h6>{{ 'QUICK_ACCESS.PickPrompt' | translate }}</h6>
        <button class="prompt-picker-close" (click)="closed.emit()">
          <i class="ti ti-x"></i>
        </button>
      </div>

      <!-- Tabs -->
      <div class="prompt-picker-tabs">
        <button
          class="prompt-picker-tab"
          [class.active]="activeTab() === 'mine'"
          (click)="switchTab('mine')"
        >
          <i class="ti ti-book"></i>
          {{ 'QUICK_ACCESS.TabMine' | translate }}
        </button>
        <button
          class="prompt-picker-tab"
          [class.active]="activeTab() === 'starred'"
          (click)="switchTab('starred')"
        >
          <i class="ti ti-star"></i>
          {{ 'QUICK_ACCESS.TabStarred' | translate }}
        </button>
        <button
          class="prompt-picker-tab"
          [class.active]="activeTab() === 'shared'"
          (click)="switchTab('shared')"
        >
          <i class="ti ti-share"></i>
          {{ 'QUICK_ACCESS.TabShared' | translate }}
        </button>
      </div>

      <div class="prompt-picker-search-wrap">
        <i class="ti ti-search"></i>
        <input
          type="text"
          class="prompt-picker-search"
          [placeholder]="'QUICK_ACCESS.SearchPrompts' | translate"
          [(ngModel)]="searchQuery"
          (ngModelChange)="onSearch()"
          autofocus
        />
      </div>

      <div class="prompt-picker-list">
        @if (loading()) {
          <div class="prompt-picker-loading">
            <i class="ti ti-loader-2 spin"></i>
          </div>
        } @else if (prompts().length === 0) {
          <div class="prompt-picker-empty">
            {{ 'QUICK_ACCESS.NoResults' | translate }}
          </div>
        } @else {
          @for (prompt of prompts(); track prompt.id) {
            @if (!excludedIds().includes(prompt.id)) {
              <button
                class="prompt-picker-item"
                (click)="selectPrompt(prompt)"
              >
                <span class="prompt-picker-title">{{ prompt.title }}</span>
                @if (prompt.category) {
                  <span
                    class="prompt-picker-category"
                    [style.background]="prompt.category.color + '20'"
                    [style.color]="prompt.category.color"
                  >
                    {{ prompt.category | categoryName }}
                  </span>
                }
                @if (activeTab() === 'starred') {
                  <span class="prompt-picker-badge starred">
                    <i class="ti ti-star-filled"></i>
                  </span>
                }
                @if (activeTab() === 'shared') {
                  <span class="prompt-picker-badge shared">
                    <i class="ti ti-share"></i>
                  </span>
                }
              </button>
            }
          }
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 9999;
      pointer-events: auto;
    }

    .prompt-picker-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(4px);
      z-index: 9999;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .prompt-picker-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10000;
      width: 480px;
      max-width: 90vw;
      max-height: 75vh;
      background: rgba(255, 255, 255, 0.97);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(79, 70, 229, 0.15);
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(31, 38, 135, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modalIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-modal {
      background: rgba(30, 41, 59, 0.97);
      border-color: rgba(99, 102, 241, 0.25);
      color: #e2e8f0;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-header h6 {
      color: #f1f5f9;
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-close {
      background: rgba(239, 68, 68, 0.15);
      color: rgba(248, 113, 113, 0.9);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-close:hover {
      background: rgba(239, 68, 68, 0.3);
      color: rgba(248, 113, 113, 1);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-tab {
      border-color: rgba(99, 102, 241, 0.2);
      color: rgba(203, 213, 225, 0.65);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-tab:hover {
      background: rgba(99, 102, 241, 0.15);
      color: rgba(199, 210, 254, 0.95);
      border-color: rgba(99, 102, 241, 0.4);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-tab.active {
      background: rgba(99, 102, 241, 0.22);
      color: #c7d2fe;
      border-color: rgba(99, 102, 241, 0.5);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-search-wrap i {
      color: rgba(165, 180, 252, 0.55);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-search {
      background: rgba(15, 23, 42, 0.6);
      border-color: rgba(99, 102, 241, 0.25);
      color: #e2e8f0;
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-search::placeholder {
      color: rgba(148, 163, 184, 0.6);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-search:focus {
      border-color: rgba(99, 102, 241, 0.6);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-item {
      color: #e2e8f0;
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-item:hover {
      background: rgba(99, 102, 241, 0.18);
    }

    :host-context([data-bs-theme="dark"]) .prompt-picker-loading,
    :host-context([data-bs-theme="dark"]) .prompt-picker-empty {
      color: rgba(148, 163, 184, 0.8);
    }

    @keyframes modalIn {
      from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }

    .prompt-picker-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px 12px;

      h6 {
        margin: 0;
        font-weight: 600;
        font-size: 0.95rem;
      }
    }

    .prompt-picker-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.1);
      color: rgba(239, 68, 68, 0.8);
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: rgba(239, 68, 68, 0.2);
        color: rgba(239, 68, 68, 1);
      }
    }

    /* ── Tabs ── */
    .prompt-picker-tabs {
      display: flex;
      gap: 4px;
      padding: 0 20px 12px;
    }

    .prompt-picker-tab {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      border: 1px solid rgba(79, 70, 229, 0.12);
      border-radius: 10px;
      background: transparent;
      color: rgba(100, 116, 139, 0.7);
      font-size: 0.78rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;

      i {
        font-size: 0.9rem;
      }

      &:hover {
        background: rgba(79, 70, 229, 0.06);
        color: rgba(79, 70, 229, 0.8);
        border-color: rgba(79, 70, 229, 0.2);
      }

      &.active {
        background: rgba(79, 70, 229, 0.12);
        color: rgba(79, 70, 229, 1);
        border-color: rgba(79, 70, 229, 0.3);
        font-weight: 600;
      }
    }

    .prompt-picker-search-wrap {
      position: relative;
      padding: 0 20px 12px;

      i {
        position: absolute;
        left: 32px;
        top: 10px;
        color: rgba(79, 70, 229, 0.4);
        font-size: 1rem;
      }
    }

    .prompt-picker-search {
      width: 100%;
      padding: 10px 12px 10px 36px;
      border: 1px solid rgba(79, 70, 229, 0.2);
      border-radius: 10px;
      font-size: 0.85rem;
      background: rgba(79, 70, 229, 0.05);
      color: inherit;
      outline: none;
      transition: border-color 0.2s;

      &:focus {
        border-color: rgba(79, 70, 229, 0.5);
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
      }
    }

    .prompt-picker-list {
      flex: 1;
      overflow-y: auto;
      padding: 0 12px 12px;
      max-height: 360px;
    }

    .prompt-picker-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 10px 12px;
      border: none;
      border-radius: 10px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

      &:hover {
        background: rgba(79, 70, 229, 0.1);
        transform: translateX(4px);
      }
    }

    .prompt-picker-title {
      flex: 1;
      font-size: 0.85rem;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .prompt-picker-category {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 6px;
      white-space: nowrap;
    }

    .prompt-picker-badge {
      display: flex;
      align-items: center;
      font-size: 0.7rem;
      flex-shrink: 0;

      &.starred {
        color: #f59e0b;
      }
      &.shared {
        color: #3b82f6;
      }
    }

    .prompt-picker-loading,
    .prompt-picker-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      color: rgba(100, 116, 139, 0.7);
      font-size: 0.85rem;
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
export class PromptPickerModalComponent implements OnInit, OnDestroy {
  excludedIds = input<number[]>([]);
  selected = output<{ promptId: number; label: string }>();
  closed = output<void>();

  private localData = inject(DataBackend);
  private elRef = inject(ElementRef);
  private renderer = inject(Renderer2);

  activeTab = signal<PromptTab>('mine');
  searchQuery = '';
  prompts = signal<any[]>([]);
  loading = signal(false);

  private searchTimeout: any;
  private originalParent: Node | null = null;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  ngOnInit(): void {
    this.originalParent = this.elRef.nativeElement.parentNode;
    this.renderer.appendChild(document.body, this.elRef.nativeElement);
    this.loadPrompts();
  }

  ngOnDestroy(): void {
    if (this.elRef.nativeElement.parentNode === document.body) {
      this.renderer.removeChild(document.body, this.elRef.nativeElement);
    }
  }

  switchTab(tab: PromptTab): void {
    this.activeTab.set(tab);
    this.searchQuery = '';
    this.loadPrompts();
  }

  onSearch(): void {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => this.loadPrompts(), 300);
  }

  async loadPrompts(): Promise<void> {
    this.loading.set(true);
    try {
      // Starred and shared prompts come from other people: always empty here.
      if (this.activeTab() !== 'mine') {
        this.prompts.set([]);
        return;
      }
      const params: Record<string, unknown> = { per_page: 50 };
      if (this.searchQuery) params['search'] = this.searchQuery;
      const response = await this.localData.call<{ prompts: any[] }>('prompts.list', params);
      this.prompts.set(response?.prompts ?? []);
    } catch (error) {
      this.prompts.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  selectPrompt(prompt: any): void {
    this.selected.emit({ promptId: prompt.id, label: prompt.title });
    this.closed.emit();
  }
}
