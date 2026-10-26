import {
  Component,
  input,
  output,
  signal,
  computed,
  inject,
  ElementRef,
  Renderer2,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { EscCloseDirective } from '../../../../common/esc-close.directive';

const QUICK_ACCESS_ICONS: { name: string; label: string }[] = [
  { name: 'ti-bolt', label: 'bolt' },
  { name: 'ti-star', label: 'star' },
  { name: 'ti-heart', label: 'heart' },
  { name: 'ti-bookmark', label: 'bookmark' },
  { name: 'ti-flame', label: 'flame' },
  { name: 'ti-rocket', label: 'rocket' },
  { name: 'ti-bulb', label: 'bulb' },
  { name: 'ti-code', label: 'code' },
  { name: 'ti-terminal-2', label: 'terminal' },
  { name: 'ti-brain', label: 'brain' },
  { name: 'ti-message', label: 'message' },
  { name: 'ti-mail', label: 'mail' },
  { name: 'ti-file-text', label: 'file text' },
  { name: 'ti-clipboard', label: 'clipboard' },
  { name: 'ti-note', label: 'note' },
  { name: 'ti-list', label: 'list' },
  { name: 'ti-check', label: 'check' },
  { name: 'ti-target', label: 'target' },
  { name: 'ti-trophy', label: 'trophy' },
  { name: 'ti-crown', label: 'crown' },
  { name: 'ti-palette', label: 'palette' },
  { name: 'ti-photo', label: 'photo' },
  { name: 'ti-music', label: 'music' },
  { name: 'ti-video', label: 'video' },
  { name: 'ti-microphone', label: 'microphone' },
  { name: 'ti-world', label: 'world' },
  { name: 'ti-map-pin', label: 'map pin' },
  { name: 'ti-calendar', label: 'calendar' },
  { name: 'ti-clock', label: 'clock' },
  { name: 'ti-bell', label: 'bell' },
  { name: 'ti-shield', label: 'shield' },
  { name: 'ti-lock', label: 'lock' },
  { name: 'ti-key', label: 'key' },
  { name: 'ti-settings', label: 'settings' },
  { name: 'ti-tool', label: 'tool' },
  { name: 'ti-chart-bar', label: 'chart bar' },
  { name: 'ti-chart-line', label: 'chart line' },
  { name: 'ti-database', label: 'database' },
  { name: 'ti-cloud', label: 'cloud' },
  { name: 'ti-cpu', label: 'cpu' },
  { name: 'ti-wand', label: 'wand' },
  { name: 'ti-pencil', label: 'pencil' },
  { name: 'ti-send', label: 'send' },
  { name: 'ti-link', label: 'link' },
  { name: 'ti-hash', label: 'hash' },
  { name: 'ti-at', label: 'at' },
  { name: 'ti-home', label: 'home' },
  { name: 'ti-user', label: 'user' },
];

@Component({
  selector: 'app-icon-picker',
  standalone: true,
  imports: [FormsModule, EscCloseDirective, TranslateModule],
  template: `
    <div class="icon-picker-overlay" (click)="closed.emit()"></div>
    <div class="icon-picker-popover" appEscClose (escClose)="closed.emit()">
      <input
        type="text"
        class="icon-picker-search"
        [placeholder]="'COMMON.Search icons' | translate"
        [(ngModel)]="searchQuery"
        (ngModelChange)="onSearch()"
      />
      <div class="icon-picker-grid">
        @for (icon of filteredIcons(); track icon.name) {
          <button
            class="icon-picker-item"
            [class.selected]="icon.name === currentIcon()"
            [title]="icon.label"
            (click)="selectIcon(icon.name)"
          >
            <i class="ti {{ icon.name }}"></i>
          </button>
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

    .icon-picker-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(4px);
      z-index: 9999;
    }

    .icon-picker-popover {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10000;
      width: 260px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid oklch(from var(--po-accent) l c h / 15%);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(31, 38, 135, 0.15);
      padding: 12px;
      animation: iconPickerIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    [data-bs-theme="dark"] .icon-picker-popover {
      background: rgba(30, 41, 59, 0.95);
      border-color: oklch(from var(--po-accent) l c h / 20%);
    }

    @keyframes iconPickerIn {
      from { opacity: 0; transform: translate(-50%, -48%) scale(0.95); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }

    .icon-picker-search {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid oklch(from var(--po-accent) l c h / 20%);
      border-radius: 8px;
      font-size: 0.8rem;
      background: oklch(from var(--po-accent) l c h / 5%);
      color: inherit;
      outline: none;
      margin-bottom: 10px;
      transition: border-color 0.2s;

      &:focus {
        border-color: oklch(from var(--po-accent) l c h / 50%);
      }
    }

    .icon-picker-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 4px;
      max-height: 200px;
      overflow-y: auto;
    }

    .icon-picker-item {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: oklch(from var(--po-accent) l c h / 70%);
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      font-size: 1.1rem;

      &:hover {
        background: oklch(from var(--po-accent) l c h / 10%);
        color: oklch(from var(--po-accent) l c h / 100%);
        transform: scale(1.1);
      }

      &.selected {
        background: oklch(from var(--po-accent) l c h / 20%);
        border-color: oklch(from var(--po-accent) l c h / 40%);
        color: oklch(from var(--po-accent) l c h / 100%);
        box-shadow: 0 2px 8px oklch(from var(--po-accent) l c h / 20%);
      }
    }
  `,
})
export class IconPickerComponent implements OnInit, OnDestroy {
  currentIcon = input<string>('ti-bolt');
  selected = output<string>();
  closed = output<void>();

  private elRef = inject(ElementRef);
  private renderer = inject(Renderer2);

  searchQuery = '';
  private _filteredIcons = signal(QUICK_ACCESS_ICONS);

  ngOnInit(): void {
    this.renderer.appendChild(document.body, this.elRef.nativeElement);
  }

  ngOnDestroy(): void {
    if (this.elRef.nativeElement.parentNode === document.body) {
      this.renderer.removeChild(document.body, this.elRef.nativeElement);
    }
  }

  filteredIcons = computed(() => this._filteredIcons());

  onSearch(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this._filteredIcons.set(QUICK_ACCESS_ICONS);
    } else {
      this._filteredIcons.set(
        QUICK_ACCESS_ICONS.filter(
          (icon) =>
            icon.label.includes(q) || icon.name.includes(q)
        )
      );
    }
  }

  selectIcon(iconName: string): void {
    this.selected.emit(iconName);
    this.closed.emit();
  }
}
