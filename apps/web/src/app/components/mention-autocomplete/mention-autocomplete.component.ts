import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  OnDestroy,
  OnInit,
  effect,
  inject,
  input,
  output,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

interface MentionItem {
  path: string;
  type: 'file' | 'dir';
}

const desktopApi = () => (window as any).promptops;

const DEBOUNCE_MS = 120;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 30;
const MAX_VISIBLE_RESULTS = 50;

const TRIGGER_REGEX = /(^|\s)@([^\s@]*)$/;

@Component({
  selector: 'app-mention-autocomplete',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (open()) {
      <div
        class="mention-dropdown"
        [style.top.px]="position().top"
        [style.left.px]="position().left"
        [style.width.px]="position().width"
        (mousedown)="$event.preventDefault()"
      >
        @if (!workspacePath()) {
          <div class="mention-row mention-status">
            <iconify-icon icon="solar:info-circle-line-duotone" width="12"></iconify-icon>
            <span>{{ 'AUTOCOMPLETE.No workspace' | translate }}</span>
          </div>
        } @else if (loading() && results().length === 0) {
          <div class="mention-row mention-status">
            <iconify-icon icon="solar:refresh-bold" width="12" class="spin"></iconify-icon>
            <span>{{ 'AUTOCOMPLETE.Searching' | translate }}</span>
          </div>
        } @else if (results().length === 0) {
          <div class="mention-row mention-status">
            <iconify-icon icon="solar:info-circle-line-duotone" width="12"></iconify-icon>
            <span>{{ 'AUTOCOMPLETE.No matches in' | translate: { workspace: shortWorkspace() } }}</span>
          </div>
        } @else {
          <div class="mention-list" #listEl>
            @for (item of results(); track item.path; let i = $index) {
              <button
                type="button"
                class="mention-row mention-item"
                [class.active]="i === activeIndex()"
                [attr.data-idx]="i"
                (mouseenter)="activeIndex.set(i)"
                (click)="commit(item)"
              >
                <iconify-icon
                  [icon]="item.type === 'dir' ? 'solar:folder-bold-duotone' : 'solar:file-bold-duotone'"
                  width="13"
                ></iconify-icon>
                <span class="mention-name">{{ basename(item.path) }}</span>
                <span class="mention-dir">{{ dirname(item.path) }}</span>
              </button>
            }
          </div>
          <div class="mention-hint">
            <kbd>↑↓</kbd> {{ 'AUTOCOMPLETE.navigate' | translate }}
            <kbd>⏎</kbd> {{ 'AUTOCOMPLETE.insert' | translate }}
            <kbd>esc</kbd> {{ 'AUTOCOMPLETE.close' | translate }}
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host { display: contents; }

    .mention-dropdown {
      position: fixed;
      z-index: 2000;
      min-width: 280px;
      max-width: 480px;
      background: var(--po-bg-1, #1a1d24);
      border: 1px solid var(--po-border-subtle, rgba(255,255,255,0.08));
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      overflow: hidden;
      font-size: 0.78rem;
      animation: mention-pop 0.08s ease-out;
    }

    @keyframes mention-pop {
      from { opacity: 0; transform: translateY(-2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .mention-list {
      max-height: 240px;
      overflow-y: auto;
      padding: 4px;
    }

    .mention-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      width: 100%;
      padding: 0.3rem 0.5rem;
      border: 0;
      background: transparent;
      color: var(--po-text-primary, #e4e6eb);
      text-align: start;
      cursor: pointer;
      border-radius: 4px;
      font-family: inherit;
    }
    .mention-item.active,
    .mention-item:hover {
      background: oklch(from var(--po-accent) l c h / 18%);
      color: var(--po-accent-text);
    }

    .mention-name {
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .mention-dir {
      color: var(--po-text-secondary, #8b92a3);
      font-size: 0.7rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }

    .mention-status {
      cursor: default;
      color: var(--po-text-secondary, #8b92a3);
      padding: 0.5rem 0.6rem;
    }

    .mention-hint {
      display: flex;
      gap: 0.5rem;
      padding: 0.25rem 0.5rem;
      border-top: 1px solid var(--po-border-subtle, rgba(255,255,255,0.06));
      background: rgba(0,0,0,0.18);
      font-size: 0.62rem;
      color: var(--po-text-tertiary, #6b7280);
      align-items: center;
    }
    .mention-hint kbd {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 3px;
      padding: 0 4px;
      font-size: 0.6rem;
    }

    .spin { animation: mention-spin 1s linear infinite; }
    @keyframes mention-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `,
})
export class MentionAutocompleteComponent implements OnInit, OnDestroy {
  textareaRef = input<HTMLTextAreaElement | null>(null);
  workspacePath = input<string | undefined>();
  /** Emitted when a path is inserted, after the textarea has been mutated. */
  insert = output<string>();

  protected open = signal(false);
  protected loading = signal(false);
  protected results = signal<MentionItem[]>([]);
  protected activeIndex = signal(0);
  protected position = signal<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });

  private host = inject(ElementRef);

  private attached: HTMLTextAreaElement | null = null;
  private trigger: { start: number; query: string } | null = null;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;
  private cache = new Map<string, { items: MentionItem[]; ts: number }>();

  private boundInput = () => this.handleInput();
  private boundKeydown = (e: KeyboardEvent) => this.handleKeydown(e);
  private boundBlur = () => this.handleBlur();
  private boundDocMousedown = (e: MouseEvent) => this.handleDocMousedown(e);
  private boundScroll = () => this.handleScrollOrResize();
  private boundResize = () => this.handleScrollOrResize();

  constructor() {
    effect(() => {
      const ref = this.textareaRef();
      this.detach();
      if (ref) this.attach(ref);
    });
  }

  ngOnInit(): void {
    document.addEventListener('mousedown', this.boundDocMousedown, true);
    window.addEventListener('resize', this.boundResize);
    window.addEventListener('scroll', this.boundScroll, true);
  }

  ngOnDestroy(): void {
    this.detach();
    document.removeEventListener('mousedown', this.boundDocMousedown, true);
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('scroll', this.boundScroll, true);
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
  }

  // ── Listener wiring ─────────────────────────────────────────────

  private attach(el: HTMLTextAreaElement): void {
    this.attached = el;
    el.addEventListener('input', this.boundInput);
    // capture phase: must intercept before parent (keydown.enter) bindings fire.
    el.addEventListener('keydown', this.boundKeydown, true);
    el.addEventListener('blur', this.boundBlur);
  }

  private detach(): void {
    const el = this.attached;
    if (!el) return;
    el.removeEventListener('input', this.boundInput);
    el.removeEventListener('keydown', this.boundKeydown, true);
    el.removeEventListener('blur', this.boundBlur);
    this.attached = null;
    this.close();
  }

  // ── Trigger detection ──────────────────────────────────────────

  private handleInput(): void {
    const el = this.attached;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const before = el.value.slice(0, caret);
    const m = before.match(TRIGGER_REGEX);
    if (!m) {
      this.close();
      return;
    }
    const query = m[2];
    const triggerStart = caret - query.length - 1; // position of '@'
    this.trigger = { start: triggerStart, query };
    this.reposition(el);
    this.scheduleSearch(query);
  }

  /**
   * Anchor the dropdown to the textarea (not the caret).
   * Robust across font/padding edge cases. Flips above when no room below.
   */
  private reposition(el: HTMLTextAreaElement): void {
    const rect = el.getBoundingClientRect();
    const dropdownH = 280;
    const margin = 4;
    const viewportH = window.innerHeight;

    const overflowBelow = rect.bottom + dropdownH + margin > viewportH;
    const top = overflowBelow
      ? Math.max(8, rect.top - dropdownH - margin)
      : rect.bottom + margin;

    const width = Math.max(rect.width, 280);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));

    this.position.set({ top, left, width });
    this.open.set(true);
  }

  // ── Search & cache ──────────────────────────────────────────────

  private scheduleSearch(query: string): void {
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => {
      void this.runSearch(query);
    }, DEBOUNCE_MS);
  }

  private async runSearch(query: string): Promise<void> {
    const ws = this.workspacePath();
    if (!ws) {
      this.results.set([]);
      this.loading.set(false);
      return;
    }
    const cacheKey = `${ws}\0${query}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      this.results.set(cached.items);
      this.activeIndex.set(0);
      this.loading.set(false);
      return;
    }

    const seq = ++this.requestSeq;
    this.loading.set(true);

    let items: MentionItem[] = [];
    try {
      const api = desktopApi();
      if (api?.fsSearchPaths) {
        const res = await api.fsSearchPaths(ws, query, { maxResults: MAX_VISIBLE_RESULTS });
        if (res?.ok && Array.isArray(res.items)) items = res.items;
      } else if (api?.fsSearchFiles) {
        // Fallback: backend without the new handler — files only.
        const res = await api.fsSearchFiles(ws, query);
        if (res?.ok && Array.isArray(res.files)) {
          items = res.files.map((p: string) => ({ path: p, type: 'file' as const }));
        }
      }
    } catch {
      items = [];
    }

    // Stale guard — ignore older requests.
    if (seq !== this.requestSeq) return;

    this.results.set(items);
    this.activeIndex.set(0);
    this.loading.set(false);
    this.cacheStore(cacheKey, items);
  }

  private cacheStore(key: string, items: MentionItem[]): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // LRU-ish: drop oldest insertion (Map preserves insertion order).
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { items, ts: Date.now() });
  }

  // ── Keyboard ────────────────────────────────────────────────────

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.open()) return;
    const items = this.results();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.activeIndex.update((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
      this.scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.activeIndex.update((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
      this.scrollActiveIntoView();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const item = items[this.activeIndex()];
      if (item) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.commit(item);
      } else {
        this.close();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }
  }

  private handleBlur(): void {
    // Defer so that mouse-clicks on a dropdown item can register first.
    setTimeout(() => this.close(), 120);
  }

  private handleDocMousedown(e: MouseEvent): void {
    if (!this.open()) return;
    const target = e.target as Node | null;
    const dropdown = this.host.nativeElement.querySelector('.mention-dropdown');
    if (!dropdown) return;
    if (target && (dropdown.contains(target) || this.attached?.contains(target))) return;
    this.close();
  }

  private handleScrollOrResize(): void {
    if (!this.open() || !this.attached || !this.trigger) return;
    this.reposition(this.attached);
  }

  private scrollActiveIntoView(): void {
    queueMicrotask(() => {
      const el = this.host.nativeElement.querySelector(
        `.mention-item[data-idx="${this.activeIndex()}"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  // ── Commit ──────────────────────────────────────────────────────

  protected commit(item: MentionItem): void {
    const el = this.attached;
    const trig = this.trigger;
    if (!el || !trig) {
      this.close();
      return;
    }

    const value = el.value;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, trig.start);
    const after = value.slice(caret);
    const insertion = '@' + item.path + ' ';
    const next = before + insertion + after;
    const nextCaret = before.length + insertion.length;

    // Use native setter to keep React/Angular-compatible event semantics.
    const proto = Object.getPrototypeOf(el) as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, next);
    } else {
      el.value = next;
    }
    el.selectionStart = el.selectionEnd = nextCaret;

    // Tell Angular's (input) binding to refresh the bound signal.
    el.dispatchEvent(new Event('input', { bubbles: true }));

    this.insert.emit(item.path);
    this.close();
    el.focus();
  }

  protected close(): void {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.trigger = null;
    this.open.set(false);
    this.loading.set(false);
    this.results.set([]);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  protected basename(p: string): string {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i >= 0 ? p.slice(i + 1) : p;
  }

  protected dirname(p: string): string {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i >= 0 ? p.slice(0, i) : '';
  }

  protected shortWorkspace(): string {
    const ws = this.workspacePath();
    if (!ws) return '';
    return this.basename(ws.replace(/\/+$/, '')) || ws;
  }
}

