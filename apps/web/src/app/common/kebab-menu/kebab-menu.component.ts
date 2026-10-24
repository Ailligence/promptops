import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  Output,
  ViewEncapsulation,
  ChangeDetectionStrategy
} from '@angular/core';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { TooltipDirective } from '../tooltip.directive';

/**
 * A single entry in a {@link KebabMenuComponent}.
 * Labels are expected to be already translated by the host.
 */
export interface KebabMenuItem {
  /** Stable identifier emitted by `(select)` when the item is clicked. */
  id: string;
  /** Already-translated label shown to the user. */
  label: string;
  /** Optional iconify icon name (e.g. `solar:copy-bold`). */
  icon?: string;
  /** Render the item in the destructive/danger style (red). */
  danger?: boolean;
  /** Disable the item (non-clickable, dimmed). */
  disabled?: boolean;
  /** Render a separator line *before* this item. */
  divider?: boolean;
}

/**
 * Reusable "three vertical dots" (kebab) menu.
 *
 * Groups secondary/less-used actions behind a single `⋮` trigger so dense
 * toolbars stay clean. Built on `NgbDropdown` with `container="body"`, so the
 * menu escapes `overflow: hidden` / `transform` ancestors (e.g. hover-lifted
 * cards) and never gets clipped.
 *
 * Usage:
 * ```html
 * <app-kebab-menu
 *   [items]="menuItems"
 *   variant="overlay"
 *   [tooltip]="'COMMON.More actions' | translate"
 *   (select)="onMenuSelect($event)"
 *   (openChange)="onOpenChange($event)"
 * ></app-kebab-menu>
 * ```
 *
 * Styling is global (ViewEncapsulation.None) but namespaced under `.po-kebab*`
 * so it can render anywhere, including the body-portaled menu.
 */
@Component({
  selector: 'app-kebab-menu',
  standalone: true,
  imports: [NgbDropdownModule, TooltipDirective, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      ngbDropdown
      container="body"
      [placement]="placement"
      class="po-kebab"
      (openChange)="openChange.emit($event)"
    >
      <button
        type="button"
        class="po-kebab-trigger"
        [class.overlay]="variant === 'overlay'"
        ngbDropdownToggle
        [attr.aria-label]="ariaLabel || tooltip || ('COMMON.More actions' | translate)"
        [appTooltip]="tooltip"
        (click)="onTriggerClick($event)"
      >
        <iconify-icon [icon]="icon" [attr.width]="iconSize"></iconify-icon>
      </button>
      <div ngbDropdownMenu class="po-kebab-menu" [attr.aria-label]="ariaLabel || tooltip || ('COMMON.More actions' | translate)">
        @for (item of items; track item.id) {
          @if (item.divider) {
            <div class="po-kebab-divider" role="separator"></div>
          }
          <button
            type="button"
            ngbDropdownItem
            class="po-kebab-item"
            [class.danger]="item.danger"
            [disabled]="item.disabled"
            (click)="onSelect(item, $event)"
          >
            @if (item.icon) {
              <iconify-icon [icon]="item.icon" width="14" class="po-kebab-item-icon"></iconify-icon>
            }
            <span class="po-kebab-item-label">{{ item.label }}</span>
          </button>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .po-kebab {
      display: inline-flex;
    }

    .po-kebab-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      border-radius: var(--po-radius-sm, 4px);
      background: transparent;
      color: var(--po-text-secondary);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .po-kebab-trigger::after {
      display: none !important; /* kill bootstrap dropdown caret */
    }
    .po-kebab-trigger:hover,
    .po-kebab-trigger.show {
      background: var(--po-bg-4, rgba(255, 255, 255, 0.08));
      color: var(--po-text-primary);
    }
    /* Compact dark variant for image/card hover overlays */
    .po-kebab-trigger.overlay {
      width: 20px;
      height: 20px;
      border-radius: 3px;
      background: rgba(0, 0, 0, 0.6);
      color: var(--po-text-primary);
    }
    .po-kebab-trigger.overlay:hover,
    .po-kebab-trigger.overlay.show {
      background: rgba(0, 0, 0, 0.85);
    }

    .po-kebab-menu.dropdown-menu {
      min-width: 184px;
      padding: 4px;
      background: var(--po-bg-3);
      border: 1px solid var(--po-border-subtle);
      border-radius: var(--po-radius-lg, 8px);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
      z-index: 10050; /* above the asset preview overlay (10000) */
    }

    .po-kebab-menu .po-kebab-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 10px;
      border: none;
      border-radius: var(--po-radius-md, 6px);
      background: transparent;
      color: var(--po-text-primary);
      font-size: 0.72rem;
      font-weight: 500;
      line-height: 1.2;
      text-align: start;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.12s, color 0.12s;
    }
    .po-kebab-menu .po-kebab-item:hover:not(:disabled),
    .po-kebab-menu .po-kebab-item:focus-visible:not(:disabled) {
      background: var(--po-bg-4);
      color: var(--po-text-primary);
      outline: none;
    }
    .po-kebab-menu .po-kebab-item:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .po-kebab-menu .po-kebab-item.danger {
      color: var(--po-error);
    }
    .po-kebab-menu .po-kebab-item.danger:hover:not(:disabled) {
      background: var(--po-error-bg);
      color: var(--po-error);
    }

    .po-kebab-item-icon {
      flex-shrink: 0;
      opacity: 0.9;
    }
    .po-kebab-item-label {
      flex: 1;
    }

    .po-kebab-divider {
      height: 1px;
      margin: 4px 6px;
      background: var(--po-border-subtle);
    }
  `,
})
export class KebabMenuComponent {
  /** Menu entries to render. */
  @Input() items: KebabMenuItem[] = [];
  /** Iconify icon for the trigger. Defaults to vertical dots. */
  @Input() icon = 'mdi:dots-vertical';
  /** Trigger icon width in px. */
  @Input() iconSize = 16;
  /** Tooltip text for the trigger (already translated). */
  @Input() tooltip = '';
  /** Accessible label for the trigger/menu (default: the tooltip, else "More actions" translated). */
  @Input() ariaLabel = '';
  /** Visual style of the trigger: `ghost` (toolbars) or `overlay` (card hovers). */
  @Input() variant: 'ghost' | 'overlay' = 'ghost';
  /** ng-bootstrap placement string, e.g. `bottom-end top-end`. */
  @Input() placement = 'bottom-end top-end';

  /** Emits the clicked item's `id`. */
  @Output() select = new EventEmitter<string>();
  /** Emits whenever the menu opens (`true`) or closes (`false`). */
  @Output() openChange = new EventEmitter<boolean>();

  onSelect(item: KebabMenuItem, event: Event): void {
    event.stopPropagation();
    if (item.disabled) return;
    this.select.emit(item.id);
  }

  /** Keep the click from bubbling to clickable ancestors (e.g. a card). */
  onTriggerClick(event: Event): void {
    event.stopPropagation();
  }
}
