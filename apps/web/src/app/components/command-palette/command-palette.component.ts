import {
  CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

export type PaletteLamp = 'working' | 'idle' | 'blocked' | 'off';

export interface PaletteCommand {
  id: string;
  /** PALETTE.* group key: Sessions, Agents, Actions, Pages. */
  group: 'Sessions' | 'Agents' | 'Actions' | 'Pages';
  label: string;
  hint?: string;
  icon?: string;
  lamp?: PaletteLamp;
  /** Extra words that should match (e.g. the English name of a translated page). */
  keywords?: string;
  run: () => void;
}

const GROUP_ORDER: PaletteCommand['group'][] = ['Sessions', 'Agents', 'Actions', 'Pages'];

/** Every whitespace-separated term must appear, in order of typing, somewhere in the haystack. */
function matches(cmd: PaletteCommand, query: string): boolean {
  if (!query) return true;
  const hay = `${cmd.label} ${cmd.hint ?? ''} ${cmd.keywords ?? ''}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => hay.includes(term));
}

/**
 * ⌘K: one field that routes to any session, agent, tool or page. Opened and
 * closed by the host through `open`; it never owns the commands, it only
 * filters and runs them.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="cp-backdrop" (mousedown)="closed.emit()"></div>
      <div class="cp" role="dialog" aria-modal="true" [attr.aria-label]="'PALETTE.Commands' | translate">
        <div class="cp-field">
          <iconify-icon icon="tabler:search" width="16" aria-hidden="true"></iconify-icon>
          <input #field
            type="text"
            role="combobox"
            [attr.aria-expanded]="filtered().length > 0"
            aria-controls="cp-list"
            [attr.aria-activedescendant]="active() ? 'cp-' + active()!.id : null"
            [placeholder]="'PALETTE.Placeholder' | translate"
            [value]="query()"
            (input)="query.set($any($event.target).value); cursor.set(0)"
            (keydown)="onKey($event)"
            spellcheck="false"
            autocomplete="off" />
          <kbd class="cp-esc">esc</kbd>
        </div>
        <ul class="cp-list" id="cp-list" role="listbox">
          @for (section of sections(); track section.group) {
            <li class="cp-group" role="presentation">{{ 'PALETTE.' + section.group | translate }}</li>
            @for (cmd of section.items; track cmd.id) {
              <li class="cp-item" role="option"
                  [id]="'cp-' + cmd.id"
                  [class.active]="cmd === active()"
                  [attr.aria-selected]="cmd === active()"
                  (mousemove)="hover(cmd)"
                  (click)="run(cmd)">
                @if (cmd.lamp) {
                  <span class="po-lamp" [class]="'po-lamp po-lamp--' + cmd.lamp" aria-hidden="true"></span>
                } @else if (cmd.icon) {
                  <iconify-icon class="cp-icon" [icon]="cmd.icon" width="16" aria-hidden="true"></iconify-icon>
                }
                <span class="cp-label">{{ cmd.label }}</span>
                @if (cmd.hint) { <span class="cp-hint">{{ cmd.hint }}</span> }
              </li>
            }
          } @empty {
            <li class="cp-empty">{{ 'PALETTE.Empty' | translate }}</li>
          }
        </ul>
        <div class="cp-foot">{{ 'PALETTE.Hint' | translate }}</div>
      </div>
    }
  `,
  styles: `
    .cp-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2100;
      background: oklch(0 0 0 / 0.45);
    }
    .cp {
      position: fixed;
      z-index: 2101;
      top: 12vh;
      left: 50%;
      width: min(640px, calc(100vw - 32px));
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      max-height: 64vh;
      border: 1px solid var(--po-border-strong);
      border-radius: var(--po-radius-xl);
      background: var(--po-bg-2);
      box-shadow: var(--po-shadow-lg);
      overflow: hidden;
    }
    @media (prefers-reduced-motion: no-preference) {
      .cp { animation: cp-in var(--po-duration-base) var(--po-ease-out); }
      @keyframes cp-in { from { opacity: 0; transform: translate(-50%, -6px); } }
    }
    .cp-field {
      display: flex;
      align-items: center;
      gap: var(--po-space-2);
      padding: 0 var(--po-space-4);
      border-bottom: 1px solid var(--po-border-subtle);
      color: var(--po-text-tertiary);
    }
    .cp-field input {
      flex: 1;
      height: 48px;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--po-text-primary);
      font-size: 15px;
    }
    .cp-field input::placeholder { color: var(--po-text-tertiary); }
    .cp-esc, .cp-foot { font-family: var(--po-font-mono); font-size: var(--po-text-xs); color: var(--po-text-tertiary); }
    .cp-esc { padding: 1px 6px; border: 1px solid var(--po-border-strong); border-radius: var(--po-radius-sm); background: transparent; }
    .cp-list { flex: 1; margin: 0; padding: var(--po-space-1) var(--po-space-2) var(--po-space-2); overflow-y: auto; list-style: none; }
    .cp-group {
      padding: var(--po-space-3) var(--po-space-2) var(--po-space-1);
      font-size: var(--po-label-size, 11px);
      font-weight: 600;
      letter-spacing: var(--po-label-tracking, 0.09em);
      text-transform: uppercase;
      color: var(--po-text-tertiary);
    }
    .cp-item {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--po-space-3);
      min-height: 36px;
      padding: 0 var(--po-space-2);
      border-radius: var(--po-radius-sm);
      color: var(--po-text-secondary);
      cursor: pointer;
    }
    .cp-item.active { background: var(--po-bg-4); color: var(--po-text-primary); }
    .cp-icon { color: var(--po-text-tertiary); }
    .cp-item.active .cp-icon { color: var(--po-accent-text, var(--po-accent)); }
    .cp-item .po-lamp { margin-inline: 4px; }
    .cp-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--po-text-base); }
    .cp-hint { flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--po-font-mono); font-size: var(--po-text-xs); color: var(--po-text-tertiary); }
    .cp-empty { padding: var(--po-space-5) var(--po-space-2); text-align: center; color: var(--po-text-tertiary); }
    .cp-foot { padding: var(--po-space-2) var(--po-space-4); border-top: 1px solid var(--po-border-subtle); }
  `,
})
export class CommandPaletteComponent {
  readonly open = input(false);
  readonly commands = input<PaletteCommand[]>([]);
  readonly closed = output<void>();

  protected readonly query = signal('');
  protected readonly cursor = signal(0);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly filtered = computed(() => {
    const q = this.query().trim();
    const hits = this.commands().filter((c) => matches(c, q));
    return GROUP_ORDER.flatMap((g) => hits.filter((c) => c.group === g));
  });

  protected readonly sections = computed(() => {
    const list = this.filtered();
    return GROUP_ORDER
      .map((group) => ({ group, items: list.filter((c) => c.group === group) }))
      .filter((s) => s.items.length > 0);
  });

  protected readonly active = computed(() => {
    const list = this.filtered();
    return list.length ? list[Math.min(this.cursor(), list.length - 1)] : null;
  });

  /** Whatever had focus before ⌘K (usually a terminal) gets it back on close. */
  private returnFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (!this.open()) {
        const back = this.returnFocus;
        this.returnFocus = null;
        if (back?.isConnected) queueMicrotask(() => back.focus());
        return;
      }
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.query.set('');
      this.cursor.set(0);
      queueMicrotask(() => this.field()?.nativeElement.focus());
    });
  }

  protected hover(cmd: PaletteCommand): void {
    this.cursor.set(this.filtered().indexOf(cmd));
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.filtered().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (n) this.cursor.set((this.cursor() + 1) % n);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (n) this.cursor.set((this.cursor() - 1 + n) % n);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const cmd = this.active();
      if (cmd) this.run(cmd);
    } else if (event.key === 'Tab') {
      // The field is the dialog's only stop: Tab stays inside.
      event.preventDefault();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit();
    }
    queueMicrotask(() => document.getElementById(this.active() ? 'cp-' + this.active()!.id : '')?.scrollIntoView({ block: 'nearest' }));
  }

  protected run(cmd: PaletteCommand): void {
    // A command that opens its own surface keeps the focus it moves to.
    this.returnFocus = null;
    this.closed.emit();
    cmd.run();
  }
}
