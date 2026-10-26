import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import {
  FolderCommandMap,
  SmartActionService,
} from '../../views/admin-core/sessions/services/smart-action.service';

type CommandKind = 'npm' | 'make' | 'docker' | 'script';

interface CommandItem {
  /** Text actually inserted into the textarea (may carry a `cd <folder> &&` prefix). */
  command: string;
  /** Short label shown to the user (the bare command, no cd prefix). */
  display: string;
  /** Originating folder name, shown as a dim suffix. */
  folderName: string;
  kind: CommandKind;
}

const KIND_ICON: Record<CommandKind, string> = {
  npm: 'solar:box-bold-duotone',
  make: 'solar:sledgehammer-bold-duotone',
  docker: 'solar:server-square-bold-duotone',
  script: 'solar:code-square-bold-duotone',
};

/** Fixed docker compose commands — kept identical to the bottom-bar Commands modal. */
const DOCKER_COMMANDS = [
  'docker compose up',
  'docker compose build',
  'docker compose down',
];

const MAX_VISIBLE_RESULTS = 50;

/** Minimum typed chars before the dropdown appears — keeps it from popping up while typing. */
const MIN_QUERY_LEN = 2;

/**
 * Command autocomplete for the sub-agent spawn input, active only in
 * "generic-shell" mode where the prompt IS a literal terminal command.
 *
 * Mirrors {@link MentionAutocompleteComponent}: it attaches to the same
 * textarea, intercepts keydown in the capture phase (to beat the parent's
 * `keydown.enter` → spawn binding), and offers ↑↓ navigate / Tab+⏎ insert /
 * esc close. The candidate list is the workspace command scan
 * (npm scripts / make targets / docker compose / scripts/), reusing
 * {@link SmartActionService.scanFolders}.
 */
@Component({
  selector: 'app-command-autocomplete',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (open()) {
      <div
        class="cmd-dropdown"
        [style.top.px]="position().top"
        [style.left.px]="position().left"
        [style.width.px]="position().width"
        (mousedown)="$event.preventDefault()"
      >
        @if (!workspacePath()) {
          <div class="cmd-row cmd-status">
            <iconify-icon icon="solar:info-circle-line-duotone" width="12"></iconify-icon>
            <span>{{ 'AUTOCOMPLETE.No workspace' | translate }}</span>
          </div>
        } @else if (loading() && allCommands().length === 0) {
          <div class="cmd-row cmd-status">
            <iconify-icon icon="solar:refresh-bold" width="12" class="spin"></iconify-icon>
            <span>{{ 'AUTOCOMPLETE.Scanning commands' | translate }}</span>
          </div>
        } @else if (results().length === 0) {
          <div class="cmd-row cmd-status">
            <iconify-icon icon="solar:info-circle-line-duotone" width="12"></iconify-icon>
            <span>{{ 'AUTOCOMPLETE.No commands in' | translate: { workspace: shortWorkspace() } }}</span>
          </div>
        } @else {
          @if (sole(); as s) {
            <!-- Single precise match: compact ghost row with an always-visible Tab affordance. -->
            <button
              type="button"
              class="cmd-row cmd-item cmd-single active"
              [attr.data-idx]="0"
              (click)="commit(s)"
            >
              <iconify-icon [icon]="iconFor(s.kind)" width="13"></iconify-icon>
              <span class="cmd-name">{{ s.display }}</span>
              <span class="cmd-folder">{{ s.folderName }}</span>
              <span class="cmd-tab-badge"><kbd>⇥</kbd> {{ 'AUTOCOMPLETE.Tab' | translate }}</span>
            </button>
          } @else {
            <div class="cmd-list" #listEl>
              @for (item of results(); track item.command; let i = $index) {
                <button
                  type="button"
                  class="cmd-row cmd-item"
                  [class.active]="engaged() && i === activeIndex()"
                  [attr.data-idx]="i"
                  (mouseenter)="activeIndex.set(i); engaged.set(true)"
                  (click)="commit(item)"
                >
                  <iconify-icon [icon]="iconFor(item.kind)" width="13"></iconify-icon>
                  <span class="cmd-name">{{ item.display }}</span>
                  <span class="cmd-folder">{{ item.folderName }}</span>
                </button>
              }
            </div>
            <div class="cmd-hint">
              <kbd>↑↓</kbd> {{ 'AUTOCOMPLETE.navigate' | translate }}
              <kbd>tab</kbd> {{ 'AUTOCOMPLETE.insert' | translate }}
              <kbd>esc</kbd> {{ 'AUTOCOMPLETE.close' | translate }}
            </div>
          }
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host { display: contents; }

    .cmd-dropdown {
      position: fixed;
      z-index: 2000;
      min-width: 280px;
      max-width: 540px;
      background: var(--po-bg-1, #1a1d24);
      border: 1px solid var(--po-border-subtle, rgba(255,255,255,0.08));
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      overflow: hidden;
      font-size: 0.78rem;
      animation: cmd-pop 0.08s ease-out;
    }

    @keyframes cmd-pop {
      from { opacity: 0; transform: translateY(-2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .cmd-list {
      max-height: 240px;
      overflow-y: auto;
      padding: 4px;
    }

    .cmd-row {
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
    .cmd-item.active,
    .cmd-item:hover {
      background: oklch(from var(--po-accent) l c h / 18%);
      color: var(--po-accent-text);
    }

    .cmd-name {
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
      font-family: var(--po-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    }

    .cmd-folder {
      color: var(--po-text-secondary, #8b92a3);
      font-size: 0.7rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      text-align: end;
    }

    /* Single-match ghost row: pinned Tab badge so the affordance is unmistakable. */
    .cmd-single {
      margin: 4px;
      width: calc(100% - 8px);
    }
    .cmd-single .cmd-folder {
      flex: 0 1 auto;
      text-align: start;
    }
    .cmd-tab-badge {
      margin-inline-start: auto;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
      color: var(--po-accent-text);
      font-size: 0.62rem;
      font-weight: 600;
      background: oklch(from var(--po-accent) l c h / 18%);
      border: 1px solid oklch(from var(--po-accent) l c h / 35%);
      border-radius: 4px;
      padding: 1px 6px;
    }
    .cmd-tab-badge kbd {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 3px;
      padding: 0 3px;
      font-size: 0.6rem;
    }

    .cmd-status {
      cursor: default;
      color: var(--po-text-secondary, #8b92a3);
      padding: 0.5rem 0.6rem;
    }

    .cmd-hint {
      display: flex;
      gap: 0.5rem;
      padding: 0.25rem 0.5rem;
      border-top: 1px solid var(--po-border-subtle, rgba(255,255,255,0.06));
      background: rgba(0,0,0,0.18);
      font-size: 0.62rem;
      color: var(--po-text-tertiary, #6b7280);
      align-items: center;
    }
    .cmd-hint kbd {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 3px;
      padding: 0 4px;
      font-size: 0.6rem;
    }

    .spin { animation: cmd-spin 1s linear infinite; }
    @keyframes cmd-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `,
})
export class CommandAutocompleteComponent implements OnInit, OnDestroy {
  textareaRef = input<HTMLTextAreaElement | null>(null);
  workspacePath = input<string | undefined>();
  /** Only active when the spawn provider is "generic-shell". */
  enabled = input<boolean>(false);
  /** Emitted when a command is inserted, after the textarea has been mutated. */
  insert = output<string>();

  protected open = signal(false);
  protected results = signal<CommandItem[]>([]);
  protected activeIndex = signal(0);
  /**
   * True only after the user EXPLICITLY engaged the list (↑↓ or hover). Gates the
   * Enter key: without explicit engagement Enter spawns instead of inserting a
   * suggestion, so a stray ⏎ while typing never injects random text.
   */
  protected engaged = signal(false);
  protected position = signal<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });

  private host = inject(ElementRef);
  private smartActions = inject(SmartActionService);

  /**
   * Candidate commands derived from the SAME shared source the bottom-bar
   * "Commands" modal renders (`SmartActionService.folderMap()`), formatted
   * identically. Reactive: external re-scans refresh the list automatically.
   */
  protected allCommands = computed(() => this.buildCandidates(this.smartActions.folderMap()));
  /** True while the shared workspace scan is running. */
  protected loading = computed(() => this.smartActions.scanning());
  /** The single candidate when exactly one matches — renders the inline "⇥ Tab" ghost row. */
  protected sole = computed<CommandItem | null>(() => {
    const r = this.results();
    return r.length === 1 ? r[0] : null;
  });

  private attached: HTMLTextAreaElement | null = null;
  /** [start, end) range of the current line being completed. */
  private lineRange: { start: number; end: number } | null = null;
  /** Workspace we already kicked a scan for, to avoid re-scanning in a loop. */
  private lastScanWs: string | null = null;

  private boundInput = () => this.handleInput();
  private boundKeydown = (e: KeyboardEvent) => this.handleKeydown(e);
  private boundBlur = () => this.handleBlur();
  private boundDocMousedown = (e: MouseEvent) => this.handleDocMousedown(e);
  private boundScroll = () => this.handleScrollOrResize();
  private boundResize = () => this.handleScrollOrResize();

  constructor() {
    // (Re)attach to the textarea when the ref changes.
    effect(() => {
      const ref = this.textareaRef();
      this.detach();
      if (ref) this.attach(ref);
    });

    // Ensure the shared command list is populated when shell mode is active.
    // We reuse SmartActionService.folderMap() (same list as the Commands modal);
    // only trigger a scan once per workspace if nothing has populated it yet.
    effect(() => {
      const ws = this.workspacePath();
      const on = this.enabled();
      if (!on || !ws) {
        this.close();
        return;
      }
      if (
        this.smartActions.folderMap().length === 0 &&
        this.lastScanWs !== ws &&
        !this.smartActions.scanning()
      ) {
        this.lastScanWs = ws;
        void this.smartActions.scanFolders(ws);
      }
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

  // ── Candidate building ──────────────────────────────────────────

  /**
   * Flattens the folder map into a deduped command list, formatted byte-for-byte
   * like the bottom-bar "Commands" modal (`injectCommand(...)` calls), so the
   * autocomplete offers exactly the commands shown there:
   *   - npm scripts:  `(pm==='npm'?'npm run':pm) + ' ' + script`
   *   - docker:       `docker compose up|build|down`
   *   - make targets: `make <target>`
   *   - scripts/:     `./scripts/<file>`
   * Commands are plain (no `cd` prefix), matching the modal's injection behavior.
   */
  private buildCandidates(map: FolderCommandMap): CommandItem[] {
    const out: CommandItem[] = [];
    const seen = new Set<string>();
    const add = (command: string, folderName: string, kind: CommandKind) => {
      if (seen.has(command)) return;
      seen.add(command);
      out.push({ command, display: command, folderName, kind });
    };

    for (const entry of map) {
      const { commands: c, folderName } = entry;
      const runCmd = c.packageManager === 'npm' ? 'npm run' : c.packageManager;

      for (const script of Object.keys(c.npmScripts)) {
        add(`${runCmd} ${script}`, folderName, 'npm');
      }
      if (c.hasDockerCompose) {
        for (const dc of DOCKER_COMMANDS) add(dc, folderName, 'docker');
      }
      if (c.hasMakefile) {
        for (const target of c.makeTargets) add(`make ${target}`, folderName, 'make');
      }
      for (const file of c.scriptFiles) {
        add(`./scripts/${file}`, folderName, 'script');
      }
    }
    return out;
  }

  // ── Trigger detection ──────────────────────────────────────────

  private handleInput(): void {
    const el = this.attached;
    if (!el || !this.enabled()) {
      this.close();
      return;
    }
    const caret = el.selectionStart ?? 0;
    const value = el.value;

    // Defer to the @-mention autocomplete when an @-token is being typed.
    if (/(^|\s)@([^\s@]*)$/.test(value.slice(0, caret))) {
      this.close();
      return;
    }

    // Scope completion to the current line (shell commands are line-oriented).
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    let lineEnd = value.indexOf('\n', caret);
    if (lineEnd === -1) lineEnd = value.length;
    const query = value.slice(lineStart, caret);

    const matches = this.filter(query);
    if (matches.length === 0) {
      this.close();
      return;
    }

    this.lineRange = { start: lineStart, end: lineEnd };
    this.results.set(matches);
    this.activeIndex.set(0);
    this.engaged.set(false); // new keystroke → require explicit engagement again
    this.reposition(el);
  }

  /**
   * Ranked filter, deliberately conservative to keep the dropdown unobtrusive:
   * it stays hidden until the user has typed at least {@link MIN_QUERY_LEN} chars,
   * and only prefix/substring matches qualify (loose subsequence matching is
   * dropped — it made the list pop up on almost any keystroke).
   */
  private filter(rawQuery: string): CommandItem[] {
    const all = this.allCommands();
    const q = rawQuery.trim().toLowerCase();
    if (q.length < MIN_QUERY_LEN) return [];

    const scored: { item: CommandItem; score: number }[] = [];
    for (const item of all) {
      const hay = item.display.toLowerCase();
      let score = -1;
      if (hay.startsWith(q)) score = 3;
      else if (hay.includes(q)) score = 2;
      if (score >= 0) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score || a.item.display.length - b.item.display.length);
    return scored.slice(0, MAX_VISIBLE_RESULTS).map((s) => s.item);
  }

  /**
   * Anchor the dropdown right below the textarea, next to where the user is
   * typing. Height is estimated from the result count (a single match is one
   * short row, not the full list), so we only flip above when the box genuinely
   * overflows the viewport AND there's room up there — never for a lone suggestion.
   */
  private reposition(el: HTMLTextAreaElement): void {
    const rect = el.getBoundingClientRect();
    const margin = 4;
    const viewportH = window.innerHeight;

    // Estimate the real rendered height: single-match ghost row vs. list + hint.
    const n = this.results().length;
    const estH = n <= 1 ? 44 : Math.min(280, n * 30 + 34);

    const overflowBelow = rect.bottom + estH + margin > viewportH;
    const fitsAbove = rect.top - estH - margin >= 8;
    const top = overflowBelow && fitsAbove ? rect.top - estH - margin : rect.bottom + margin;

    const width = Math.max(rect.width, 280);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));

    this.position.set({ top, left, width });
    this.open.set(true);
  }

  // ── Keyboard ────────────────────────────────────────────────────

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.open()) return;
    const items = this.results();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.engaged.set(true);
      this.activeIndex.update((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
      this.scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.engaged.set(true);
      this.activeIndex.update((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
      this.scrollActiveIntoView();
    } else if (e.key === 'Tab') {
      const item = items[this.activeIndex()];
      e.preventDefault();
      e.stopImmediatePropagation();
      if (item) this.commit(item);
      else this.close();
    } else if (e.key === 'Enter') {
      // Shift+Enter inserts a newline: never commit the suggestion, just close.
      if (e.shiftKey) {
        this.close();
        return;
      }
      const item = items[this.activeIndex()];
      // Only commit on Enter when the user EXPLICITLY engaged the list (↑↓/hover)
      // and the line isn't already the command. Otherwise Enter spawns (falls
      // through to the parent's keydown.enter) — a stray ⏎ never inserts text.
      if (this.engaged() && item && !this.lineEqualsActive(item)) {
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

  private lineEqualsActive(item: CommandItem): boolean {
    const el = this.attached;
    const range = this.lineRange;
    if (!el || !range) return false;
    const line = el.value.slice(range.start, range.end).trim();
    return line === item.command || line === item.display;
  }

  private handleBlur(): void {
    // Defer so that mouse-clicks on a dropdown item can register first.
    setTimeout(() => this.close(), 120);
  }

  private handleDocMousedown(e: MouseEvent): void {
    if (!this.open()) return;
    const target = e.target as Node | null;
    const dropdown = this.host.nativeElement.querySelector('.cmd-dropdown');
    if (!dropdown) return;
    if (target && (dropdown.contains(target) || this.attached?.contains(target))) return;
    this.close();
  }

  private handleScrollOrResize(): void {
    if (!this.open() || !this.attached) return;
    this.reposition(this.attached);
  }

  private scrollActiveIntoView(): void {
    queueMicrotask(() => {
      const el = this.host.nativeElement.querySelector(
        `.cmd-item[data-idx="${this.activeIndex()}"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  // ── Commit ──────────────────────────────────────────────────────

  protected commit(item: CommandItem): void {
    const el = this.attached;
    const range = this.lineRange;
    if (!el || !range) {
      this.close();
      return;
    }

    const value = el.value;
    const before = value.slice(0, range.start);
    const after = value.slice(range.end);
    const next = before + item.command + after;
    const nextCaret = before.length + item.command.length;

    // Use the native setter so Angular's (input) binding still fires.
    const proto = Object.getPrototypeOf(el) as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, next);
    } else {
      el.value = next;
    }
    el.selectionStart = el.selectionEnd = nextCaret;
    el.dispatchEvent(new Event('input', { bubbles: true }));

    this.insert.emit(item.command);
    this.close();
    el.focus();
  }

  protected close(): void {
    this.lineRange = null;
    this.open.set(false);
    this.results.set([]);
    this.engaged.set(false);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  protected iconFor(kind: CommandKind): string {
    return KIND_ICON[kind];
  }

  protected shortWorkspace(): string {
    const ws = this.workspacePath();
    if (!ws) return '';
    const trimmed = ws.replace(/[/\\]+$/, '');
    const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return i >= 0 ? trimmed.slice(i + 1) : trimmed;
  }
}
