import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  DestroyRef,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TooltipDirective } from '../../../../common/tooltip.directive';
import {
  ForwardPortsService,
  PortProtocol,
  PortRow,
  PortVisibility,
  forwardedPortUrl,
} from '../../../../core/services/forward-ports.service';

type EditKind = 'label' | 'localPort';

/**
 * URL for the in-app preview iframe, or null when the row does not describe a
 * plain http(s) service on a valid localhost port. This is the only input to
 * bypassSecurityTrustResourceUrl, so it is rebuilt from validated parts and
 * never taken verbatim from the (localStorage-backed) row.
 */
export function previewUrl(row: Pick<PortRow, 'protocol' | 'localPort'>): string | null {
  return forwardedPortUrl(row);
}

/**
 * "Ports" panel like the VS Code one: Port / Forwarded Address /
 * Running Process / Visibility / Origin table, inline actions on hover, full
 * context menu, "Add Port" row, built-in preview and
 * auto-forward toast. The state lives in ForwardPortsService.
 */
@Component({
  selector: 'app-forward-ports-panel',
  standalone: true,
  imports: [FormsModule, TranslateModule, TooltipDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="fp-root" [class.with-preview]="preview()">
      <div class="fp-table-wrap" tabindex="0" (keydown)="onKey($event)">
        @if (ports.aiDetecting() || ports.aiError() || aiPending().length > 0) {
          <div class="fp-ai">
            <div class="fp-ai-head">
              <iconify-icon icon="codicon:sparkle" width="14"></iconify-icon>
              @if (ports.aiDetecting()) {
                <span>{{ 'FORWARD_PORTS.Detecting' | translate }}</span>
                <iconify-icon class="fp-spin" icon="codicon:loading" width="13"></iconify-icon>
              } @else if (ports.aiError()) {
                <span class="fp-ai-err">{{ 'FORWARD_PORTS.AI failed' | translate: { error: ports.aiError() } }}</span>
              } @else {
                <span>{{ (aiPending().length === 1 ? 'FORWARD_PORTS.AI found one' : 'FORWARD_PORTS.AI found many') | translate: { count: aiPending().length } }}</span>
              }
              <span class="fp-ai-spacer"></span>
              @if (!ports.aiDetecting()) {
                <button class="fp-act" (click)="ports.detectWithAi()" [appTooltip]="'FORWARD_PORTS.Detect again' | translate" [attr.aria-label]="'FORWARD_PORTS.Detect again' | translate">
                  <iconify-icon icon="codicon:refresh" width="13"></iconify-icon>
                </button>
              }
            </div>
            @for (s of aiPending(); track s.port) {
              <label class="fp-ai-row">
                <input type="checkbox" [checked]="!aiUnchecked().has(s.port)" (change)="toggleAi(s.port)" />
                <span class="fp-dot" [class.on]="isListening(s.port)"
                      [appTooltip]="(isListening(s.port) ? 'FORWARD_PORTS.Running now' : 'FORWARD_PORTS.Not running yet') | translate"></span>
                <span class="fp-ai-label">{{ s.label }}</span>
                <span class="fp-muted">:{{ s.port }}</span>
                @if (s.description) { <span class="fp-ai-desc">{{ s.description }}</span> }
                <span class="fp-ai-spacer"></span>
                @if (s.command) {
                  <code class="fp-ai-cmd" [attr.title]="s.command">{{ s.command }}</code>
                  <button class="fp-act visible" (click)="$event.preventDefault(); copyText(s.command)" [appTooltip]="'FORWARD_PORTS.Copy command' | translate" [attr.aria-label]="'FORWARD_PORTS.Copy command' | translate">
                    <iconify-icon icon="codicon:copy" width="13"></iconify-icon>
                  </button>
                }
                <button class="fp-act visible" (click)="$event.preventDefault(); ports.dismissAiSuggestion(s.port)" [appTooltip]="'FORWARD_PORTS.Dismiss' | translate" [attr.aria-label]="'FORWARD_PORTS.Dismiss' | translate">
                  <iconify-icon icon="codicon:close" width="13"></iconify-icon>
                </button>
              </label>
            }
            @if (aiPending().length > 0 && !ports.aiDetecting()) {
              <div class="fp-ai-foot">
                <button class="fp-primary" [disabled]="aiSelected().length === 0" (click)="applyAi()">
                  {{ (aiSelected().length === 1 ? 'FORWARD_PORTS.Forward one' : 'FORWARD_PORTS.Forward many') | translate: { count: aiSelected().length } }}
                </button>
              </div>
            }
          </div>
        }
        <table class="fp-table">
          <thead>
            <tr>
              <th class="c-port">{{ 'FORWARD_PORTS.Col port' | translate }}</th>
              <th class="c-addr">{{ 'FORWARD_PORTS.Col address' | translate }}</th>
              <th class="c-proc">{{ 'FORWARD_PORTS.Col process' | translate }}</th>
              <th class="c-vis">{{ 'FORWARD_PORTS.Col visibility' | translate }}</th>
              <th class="c-origin">{{ 'FORWARD_PORTS.Col origin' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of ports.rows(); track row.host + ':' + row.port) {
              <tr [class.selected]="isSelected(row)"
                  (click)="select(row)"
                  (dblclick)="startEdit(row, 'label')"
                  (contextmenu)="openMenu($event, row)">
                <td class="c-port">
                  <span class="fp-dot" [class.on]="!!row.running || row.tunneled"
                        [appTooltip]="(row.running ? 'FORWARD_PORTS.Listening' : 'FORWARD_PORTS.Not listening') | translate"></span>
                  @if (editing()?.row === row && editing()?.kind === 'label') {
                    <input #editInput class="fp-inline-input" [ngModel]="row.label ?? ''"
                           [placeholder]="'FORWARD_PORTS.Label placeholder' | translate" [attr.aria-label]="'FORWARD_PORTS.Label placeholder' | translate" (keydown.enter)="commitLabel(row, editInput.value)"
                           (keydown.escape)="editing.set(null)" (blur)="commitLabel(row, editInput.value)" />
                  } @else {
                    @if (row.label) {
                      <span class="fp-label">{{ row.label }}</span>
                      <span class="fp-muted">({{ row.port }})</span>
                    } @else {
                      <span>{{ row.port }}</span>
                    }
                    @if (row.host !== 'localhost') { <span class="fp-muted">{{ row.host }}</span> }
                    <button class="fp-act" (click)="$event.stopPropagation(); startEdit(row, 'label')" [appTooltip]="('FORWARD_PORTS.Set label' | translate) + ' (F2)'" [attr.aria-label]="'FORWARD_PORTS.Set label' | translate">
                      <iconify-icon icon="codicon:edit" width="13"></iconify-icon>
                    </button>
                  }
                </td>
                <td class="c-addr">
                  @if (editing()?.row === row && editing()?.kind === 'localPort') {
                    <input #portInput class="fp-inline-input" type="number" min="1" max="65535" [attr.aria-label]="'FORWARD_PORTS.Change local port' | translate"
                           [ngModel]="row.localPort" (keydown.enter)="commitLocalPort(row, portInput.value)"
                           (keydown.escape)="editing.set(null)" (blur)="commitLocalPort(row, portInput.value)" />
                  } @else {
                    <a class="fp-link" (click)="$event.stopPropagation(); ports.openInBrowser(row)"
                       [appTooltip]="'FORWARD_PORTS.Follow link' | translate: { url: ports.url(row) }">{{ row.address }}</a>
                    <span class="fp-row-actions">
                      <button class="fp-act" (click)="$event.stopPropagation(); copy(row)" [appTooltip]="'FORWARD_PORTS.Copy address' | translate" [attr.aria-label]="'FORWARD_PORTS.Copy address' | translate">
                        <iconify-icon icon="codicon:copy" width="13"></iconify-icon>
                      </button>
                      <button class="fp-act" (click)="$event.stopPropagation(); ports.openInBrowser(row)" [appTooltip]="'FORWARD_PORTS.Open in browser' | translate" [attr.aria-label]="'FORWARD_PORTS.Open in browser' | translate">
                        <iconify-icon icon="codicon:globe" width="13"></iconify-icon>
                      </button>
                      <button class="fp-act" (click)="$event.stopPropagation(); openPreview(row)" [appTooltip]="'FORWARD_PORTS.Preview' | translate" [attr.aria-label]="'FORWARD_PORTS.Preview' | translate">
                        <iconify-icon icon="codicon:open-preview" width="13"></iconify-icon>
                      </button>
                    </span>
                  }
                </td>
                <td class="c-proc" [attr.title]="row.running?.command">
                  @if (row.running) {
                    {{ row.running.command }} <span class="fp-muted">({{ row.running.pid }})</span>
                  }
                </td>
                <td class="c-vis">{{ (row.visibility === 'public' ? 'FORWARD_PORTS.Public' : 'FORWARD_PORTS.Private') | translate }}</td>
                <td class="c-origin">
                  {{ (row.origin === 'auto' ? 'FORWARD_PORTS.Auto forwarded' : 'FORWARD_PORTS.User forwarded') | translate }}
                  <button class="fp-act fp-stop" (click)="$event.stopPropagation(); stop(row)" [appTooltip]="('FORWARD_PORTS.Stop' | translate) + ' (Delete)'" [attr.aria-label]="'FORWARD_PORTS.Stop' | translate">
                    <iconify-icon icon="codicon:close" width="13"></iconify-icon>
                  </button>
                </td>
              </tr>
            }
            <tr class="fp-add-row">
              <td colspan="5">
                @if (adding()) {
                  <div class="fp-add-field">
                    <input #addInput class="fp-inline-input" list="fp-suggest" [(ngModel)]="addValue"
                           [placeholder]="'FORWARD_PORTS.Add placeholder' | translate" [attr.aria-label]="'FORWARD_PORTS.Add placeholder' | translate"
                           (keydown.enter)="commitAdd()" (keydown.escape)="cancelAdd()" (blur)="commitAdd(true)" />
                    <datalist id="fp-suggest">
                      @for (s of ports.suggestions(); track s.port) {
                        <option [value]="s.port">{{ s.process }} ({{ s.pid }})</option>
                      }
                    </datalist>
                    @if (addError()) { <div class="fp-error">{{ addError() }}</div> }
                  </div>
                } @else {
                  <button class="fp-add-btn" (click)="startAdd()">{{ 'FORWARD_PORTS.Add port' | translate }}</button>
                }
              </td>
            </tr>
          </tbody>
        </table>

        @if (ports.rows().length === 0 && !adding()) {
          <div class="fp-empty">
            <p>{{ 'FORWARD_PORTS.Empty' | translate }}</p>
            <button class="fp-primary" (click)="startAdd()">{{ 'FORWARD_PORTS.Forward a port' | translate }}</button>
            @if (ports.canUseAi && !ports.aiDetecting()) {
              <button class="fp-secondary" (click)="ports.detectWithAi()">
                <iconify-icon icon="codicon:sparkle" width="13"></iconify-icon> {{ 'FORWARD_PORTS.Detect with AI' | translate }}
              </button>
            }
          </div>
        }
      </div>

      @if (preview(); as p) {
        <div class="fp-preview">
          <div class="fp-preview-bar">
            <button class="fp-act" (click)="reloadPreview()" [appTooltip]="'FORWARD_PORTS.Reload' | translate" [attr.aria-label]="'FORWARD_PORTS.Reload' | translate">
              <iconify-icon icon="codicon:refresh" width="13"></iconify-icon>
            </button>
            <span class="fp-preview-url">{{ p.url }}</span>
            <button class="fp-act" (click)="ports.openInBrowser(p.row)" [appTooltip]="'FORWARD_PORTS.Open in browser' | translate" [attr.aria-label]="'FORWARD_PORTS.Open in browser' | translate">
              <iconify-icon icon="codicon:link-external" width="13"></iconify-icon>
            </button>
            <button class="fp-act" (click)="preview.set(null)" [appTooltip]="'COMMON.Close' | translate" [attr.aria-label]="'COMMON.Close' | translate">
              <iconify-icon icon="codicon:close" width="13"></iconify-icon>
            </button>
          </div>
          <!-- A local dev server is any code from any repo: it may run scripts
               and forms in its own origin, never navigate or script the app. -->
          <iframe [src]="p.safe" [attr.title]="'FORWARD_PORTS.Preview title' | translate" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>
        </div>
      }

      @if (toast(); as t) {
        <div class="fp-toast">
          <iconify-icon icon="codicon:info" width="14"></iconify-icon>
          <span>{{ 'FORWARD_PORTS.Available' | translate: { port: t.port } }}</span>
          <button class="fp-primary" (click)="ports.openInBrowser(t); toast.set(null)">{{ 'FORWARD_PORTS.Open in browser' | translate }}</button>
          <button class="fp-secondary" (click)="openPreview(t); toast.set(null)">{{ 'FORWARD_PORTS.Preview' | translate }}</button>
          <button class="fp-act" (click)="toast.set(null)" [attr.aria-label]="'COMMON.Close' | translate"><iconify-icon icon="codicon:close" width="13"></iconify-icon></button>
        </div>
      }

      @if (menu(); as m) {
        <div class="fp-menu-backdrop" (click)="menu.set(null)" (contextmenu)="$event.preventDefault(); menu.set(null)"></div>
        <div class="fp-menu" [style.left.px]="m.x" [style.top.px]="m.y" (click)="$event.stopPropagation()">
          <button (click)="menu.set(null); ports.openInBrowser(m.row)">{{ 'FORWARD_PORTS.Open in browser' | translate }}</button>
          <button (click)="menu.set(null); openPreview(m.row)">{{ 'FORWARD_PORTS.Preview' | translate }}</button>
          <div class="sep"></div>
          <button (click)="menu.set(null); startEdit(m.row, 'label')">{{ 'FORWARD_PORTS.Set label' | translate }} <kbd>F2</kbd></button>
          <button (click)="menu.set(null); copy(m.row)">{{ 'FORWARD_PORTS.Copy address' | translate }} <kbd>{{ mod }}C</kbd></button>
          <button (click)="menu.set(null); startEdit(m.row, 'localPort')">{{ 'FORWARD_PORTS.Change local port' | translate }}</button>
          <div class="sep"></div>
          <div class="fp-sub">
            <button>{{ 'FORWARD_PORTS.Visibility menu' | translate }} <iconify-icon icon="codicon:chevron-right" width="12"></iconify-icon></button>
            <div class="fp-submenu">
              @for (v of visibilities; track v.id) {
                <button (click)="menu.set(null); setVisibility(m.row, v.id)">
                  <span class="chk">{{ m.row.visibility === v.id ? '✓' : '' }}</span>{{ v.labelKey | translate }}
                </button>
              }
            </div>
          </div>
          <div class="fp-sub">
            <button>{{ 'FORWARD_PORTS.Protocol menu' | translate }} <iconify-icon icon="codicon:chevron-right" width="12"></iconify-icon></button>
            <div class="fp-submenu">
              @for (p of protocols; track p.id) {
                <button (click)="menu.set(null); ports.setProtocol(m.row, p.id)">
                  <span class="chk">{{ m.row.protocol === p.id ? '✓' : '' }}</span>{{ p.label }}
                </button>
              }
            </div>
          </div>
          <div class="sep"></div>
          <button (click)="menu.set(null); stop(m.row)">{{ 'FORWARD_PORTS.Stop' | translate }} <kbd>Delete</kbd></button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host { display: flex; flex: 1; min-height: 0; }
    .fp-root { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; font-size: 0.75rem; color: var(--po-text-primary, #e6edf3); }
    .fp-table-wrap { flex: 1; min-width: 0; overflow: auto; outline: none; container-type: inline-size; }
    .with-preview .fp-table-wrap { flex: 0 0 55%; border-inline-end: 1px solid var(--po-border-subtle, rgba(128,128,128,.25)); }

    .fp-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th {
      position: sticky; top: 0; z-index: 1;
      text-align: start; font-weight: 400; padding: 4px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: var(--po-text-secondary, #9da5b4);
      background: var(--po-bg-1, #161b22);
      border-bottom: 1px solid var(--po-border-subtle, rgba(128,128,128,.25));
    }
    td { padding: 0 10px; height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .c-port { width: 20%; } .c-addr { width: 26%; } .c-proc { width: 26%; } .c-vis { width: 11%; } .c-origin { width: 17%; }
    tbody tr:not(.fp-add-row) { cursor: default; }
    tbody tr:not(.fp-add-row):hover { background: color-mix(in srgb, var(--po-text-primary, #e6edf3) 6%, transparent); }
    tbody tr.selected { background: color-mix(in srgb, var(--po-info, #3b82f6) 22%, transparent) !important; outline: 1px solid color-mix(in srgb, var(--po-info, #3b82f6) 60%, transparent); outline-offset: -1px; }
    td.c-port, td.c-addr, td.c-origin { position: relative; }

    .fp-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-inline-end: 6px; background: var(--po-text-tertiary, #6e7681); vertical-align: middle; }
    .fp-dot.on { background: var(--po-success, #3fb950); }
    .fp-label { margin-inline-end: 4px; }
    .fp-muted { color: var(--po-text-secondary, #9da5b4); margin-inline-start: 2px; }
    .fp-link { color: var(--po-info, #3794ff); cursor: pointer; text-decoration: none; }
    .fp-link:hover { text-decoration: underline; }

    .fp-act {
      display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; padding: 0; border: none; border-radius: 4px;
      background: transparent; color: var(--po-text-secondary, #9da5b4); cursor: pointer; vertical-align: middle;
    }
    .fp-act:hover { background: color-mix(in srgb, var(--po-text-primary, #e6edf3) 12%, transparent); color: var(--po-text-primary, #e6edf3); }
    td .fp-act, .fp-row-actions { visibility: hidden; }
    .fp-row-actions { position: absolute; inset-inline-end: 6px; top: 2px; display: inline-flex; gap: 1px; }
    td.c-port .fp-act { position: absolute; inset-inline-end: 6px; top: 2px; }
    .fp-stop { position: absolute; inset-inline-end: 6px; top: 2px; }
    tr:hover .fp-act, tr.selected .fp-act, tr:hover .fp-row-actions, tr.selected .fp-row-actions { visibility: visible; }

    .fp-inline-input {
      width: 100%; height: 20px; padding: 0 6px; font: inherit; color: inherit;
      background: var(--po-bg-0, #0d1117);
      border: 1px solid var(--po-info, #3794ff); border-radius: 2px; outline: none;
    }
    .fp-add-row td { height: 30px; }
    .fp-add-btn {
      font: inherit; padding: 2px 10px; border-radius: 2px; cursor: pointer;
      color: var(--po-text-primary, #e6edf3);
      background: color-mix(in srgb, var(--po-text-primary, #e6edf3) 10%, transparent);
      border: 1px solid transparent;
    }
    .fp-add-btn:hover { background: color-mix(in srgb, var(--po-text-primary, #e6edf3) 16%, transparent); }
    .fp-add-field { max-width: 420px; }
    .fp-error { margin-top: 2px; padding: 2px 6px; font-size: 0.7rem; color: var(--po-text-primary, #e6edf3); background: var(--po-error-bg, rgba(248,81,73,.15)); border: 1px solid var(--po-error, #f85149); }

    .fp-empty { padding: 18px 12px; color: var(--po-text-secondary, #9da5b4); }
    .fp-empty p { margin: 0 0 10px; }
    .fp-empty button + button { margin-inline-start: 6px; }
    .fp-secondary iconify-icon { vertical-align: -2px; }

    .fp-ai {
      margin: 8px 10px; border: 1px solid var(--po-border-subtle, rgba(128,128,128,.25)); border-radius: 6px;
      background: var(--po-bg-1, #161b22);
    }
    .fp-ai-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; color: var(--po-text-secondary, #9da5b4); }
    .fp-ai-head > iconify-icon:first-child { color: var(--po-warning, #d29922); }
    .fp-ai-err { color: var(--po-error, #f85149); }
    .fp-ai-spacer { flex: 1; }
    .fp-ai-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; margin: 0; padding: 4px 8px; cursor: pointer;
      border-top: 1px solid var(--po-border-subtle, rgba(128,128,128,.25));
    }
    .fp-ai-row:hover { background: color-mix(in srgb, var(--po-text-primary, #e6edf3) 5%, transparent); }
    .fp-ai-row .fp-dot { margin-inline-end: 0; }
    .fp-ai-label { font-weight: 600; white-space: nowrap; }
    .fp-ai-desc { color: var(--po-text-secondary, #9da5b4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .fp-ai-cmd {
      max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 6px; border-radius: 3px;
      font-size: 0.7rem; color: var(--po-text-primary, #e6edf3); background: var(--po-bg-0, #0d1117);
    }
    @container (max-width: 520px) { .fp-ai-row .fp-ai-spacer { display: none; } }
    .fp-ai-foot { display: flex; justify-content: flex-end; padding: 6px 8px; border-top: 1px solid var(--po-border-subtle, rgba(128,128,128,.25)); }
    .fp-primary:disabled { opacity: .5; cursor: default; }
    .fp-act.visible { visibility: visible; }
    .fp-spin { animation: fp-spin 1s linear infinite; }
    @keyframes fp-spin { to { transform: rotate(360deg); } }
    .fp-primary, .fp-secondary { font: inherit; padding: 3px 12px; border-radius: 2px; border: none; cursor: pointer; }
    .fp-primary { background: var(--po-accent, #4f46e5); color: var(--po-accent-on, #fff); }
    .fp-primary:hover { filter: brightness(1.1); }
    .fp-secondary { background: color-mix(in srgb, var(--po-text-primary, #e6edf3) 12%, transparent); color: var(--po-text-primary, #e6edf3); }

    .fp-preview { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .fp-preview-bar { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-bottom: 1px solid var(--po-border-subtle, rgba(128,128,128,.25)); }
    .fp-preview-url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; padding: 1px 8px; border-radius: 3px; background: var(--po-bg-0, #0d1117); color: var(--po-text-secondary, #9da5b4); }
    .fp-preview iframe { flex: 1; border: 0; background: #fff; }

    .fp-toast {
      position: absolute; inset-inline-end: 10px; bottom: 10px; z-index: 5; max-width: calc(100% - 20px);
      display: flex; align-items: center; gap: 8px; padding: 8px 10px;
      background: var(--po-bg-2, #21262d); border: 1px solid var(--po-border-strong, rgba(128,128,128,.4));
      border-radius: 4px; box-shadow: var(--po-shadow-md, 0 4px 14px rgba(0,0,0,.35));
    }
    .fp-toast > iconify-icon { color: var(--po-info, #3794ff); flex-shrink: 0; }

    .fp-menu-backdrop { position: fixed; inset: 0; z-index: 1000; }
    .fp-menu, .fp-submenu {
      min-width: 220px; padding: 4px; z-index: 1001;
      background: var(--po-bg-2, #21262d); border: 1px solid var(--po-border-strong, rgba(128,128,128,.4));
      border-radius: 6px; box-shadow: var(--po-shadow-lg, 0 8px 24px rgba(0,0,0,.45));
    }
    .fp-menu { position: fixed; }
    .fp-menu button {
      display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%;
      padding: 4px 10px; font: inherit; font-size: 0.75rem; text-align: start; border: none; border-radius: 4px;
      background: transparent; color: var(--po-text-primary, #e6edf3); cursor: pointer;
    }
    .fp-menu button:hover { background: var(--po-info, #0e639c); color: #fff; }
    .fp-menu kbd { font: inherit; color: var(--po-text-secondary, #9da5b4); background: none; padding: 0; box-shadow: none; }
    .fp-menu button:hover kbd { color: inherit; }
    .fp-menu .sep { height: 1px; margin: 4px 6px; background: var(--po-border-subtle, rgba(128,128,128,.25)); }
    .fp-sub { position: relative; }
    .fp-submenu { display: none; position: absolute; inset-inline-start: 100%; top: -4px; min-width: 140px; }
    .fp-sub:hover .fp-submenu { display: block; }
    .fp-submenu button { justify-content: flex-start; gap: 6px; }
    .chk { display: inline-block; width: 12px; }
  `,
})
export class ForwardPortsPanelComponent {
  readonly ports = inject(ForwardPortsService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly translate = inject(TranslateService);

  readonly mod = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
  readonly visibilities: { id: PortVisibility; labelKey: string }[] = [
    { id: 'private', labelKey: 'FORWARD_PORTS.Private' },
    { id: 'public', labelKey: 'FORWARD_PORTS.Public' },
  ];
  readonly protocols: { id: PortProtocol; label: string }[] = [
    { id: 'http', label: 'HTTP' },
    { id: 'https', label: 'HTTPS' },
  ];

  readonly selectedKey = signal<string | null>(null);
  readonly editing = signal<{ row: PortRow; kind: EditKind } | null>(null);
  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);
  addValue = '';
  readonly menu = signal<{ x: number; y: number; row: PortRow } | null>(null);
  readonly preview = signal<{ row: PortRow; url: string; safe: SafeResourceUrl } | null>(null);
  readonly toast = signal<PortRow | null>(null);

  private readonly addInput = viewChild<ElementRef<HTMLInputElement>>('addInput');
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');
  private readonly portInput = viewChild<ElementRef<HTMLInputElement>>('portInput');

  /** AI suggestions not yet forwarded; checked by default. */
  readonly aiPending = computed(() => {
    const taken = new Set(this.ports.rows().filter(r => r.host === 'localhost').map(r => r.port));
    return this.ports.aiSuggestions().filter(s => !taken.has(s.port));
  });
  readonly aiUnchecked = signal<Set<number>>(new Set());
  readonly aiSelected = computed(() => this.aiPending().filter(s => !this.aiUnchecked().has(s.port)));

  constructor() {
    // On-demand port scan: only while the panel is mounted.
    this.ports.attach();
    inject(DestroyRef).onDestroy(() => this.ports.detach());
    // Automatic detection on the first panel open (24h TTL per project).
    effect(() => {
      if (!this.ports.workspace() || !this.ports.provider()) return;
      untracked(() => this.ports.autoDetect());
    });
    let seenAdd = this.ports.addRequests();
    effect(() => {
      const n = this.ports.addRequests();
      if (n !== seenAdd) { seenAdd = n; untracked(() => this.startAdd()); }
    });
    // Toast "Your application running on port N is available" come VS Code.
    effect(() => {
      const r = this.ports.lastAutoForwarded();
      if (!r) return;
      untracked(() => {
        this.toast.set(r);
        this.ports.lastAutoForwarded.set(null);
        setTimeout(() => { if (this.toast() === r) this.toast.set(null); }, 12000);
      });
    });
  }

  isSelected(row: PortRow): boolean {
    return this.selectedKey() === `${row.host}:${row.port}`;
  }

  select(row: PortRow): void {
    this.selectedKey.set(`${row.host}:${row.port}`);
  }

  private selectedRow(): PortRow | undefined {
    return this.ports.rows().find(r => this.isSelected(r));
  }

  onKey(e: KeyboardEvent): void {
    if (this.editing() || this.adding()) return;
    const row = this.selectedRow();
    const rows = this.ports.rows();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const i = row ? rows.indexOf(row) : -1;
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) this.select(next);
      e.preventDefault();
      return;
    }
    if (!row) return;
    if (e.key === 'F2') { this.startEdit(row, 'label'); e.preventDefault(); }
    else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) { void this.stop(row); e.preventDefault(); }
    else if (e.key === 'Enter') { void this.ports.openInBrowser(row); e.preventDefault(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { this.copy(row); e.preventDefault(); }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menu.set(null);
  }

  openMenu(e: MouseEvent, row: PortRow): void {
    e.preventDefault();
    this.select(row);
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 290);
    this.menu.set({ x, y, row });
  }

  startEdit(row: PortRow, kind: EditKind): void {
    this.select(row);
    this.editing.set({ row, kind });
    setTimeout(() => {
      const el = (kind === 'label' ? this.editInput() : this.portInput())?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  commitLabel(row: PortRow, value: string): void {
    if (!this.editing()) return;
    this.editing.set(null);
    this.ports.setLabel(row, value);
  }

  async commitLocalPort(row: PortRow, value: string): Promise<void> {
    if (!this.editing()) return;
    this.editing.set(null);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535 || n === row.localPort) return;
    const res = await this.ports.retunnel(row, { localPort: n });
    if (!res.ok) this.flashError(res.error);
  }

  async setVisibility(row: PortRow, visibility: PortVisibility): Promise<void> {
    if (row.visibility === visibility) return;
    const res = await this.ports.retunnel(row, { visibility });
    if (!res.ok) this.flashError(res.error);
  }

  startAdd(): void {
    this.adding.set(true);
    this.addValue = '';
    this.addError.set(null);
    setTimeout(() => this.addInput()?.nativeElement.focus());
  }

  cancelAdd(): void {
    this.adding.set(false);
    this.addError.set(null);
  }

  async commitAdd(fromBlur = false): Promise<void> {
    const v = this.addValue.trim();
    if (!v) { this.cancelAdd(); return; }
    const res = await this.ports.forward(v);
    if (res.ok) {
      this.cancelAdd();
    } else if (fromBlur) {
      this.cancelAdd();
    } else {
      this.addError.set(res.error ?? this.translate.instant('FORWARD_PORTS.Forward failed'));
    }
  }

  async stop(row: PortRow): Promise<void> {
    if (this.preview()?.row.port === row.port) this.preview.set(null);
    await this.ports.stop(row);
  }

  toggleAi(port: number): void {
    this.aiUnchecked.update(set => {
      const next = new Set(set);
      if (!next.delete(port)) next.add(port);
      return next;
    });
  }

  isListening(port: number): boolean {
    return this.ports.listening().some(l => l.port === port);
  }

  async applyAi(): Promise<void> {
    await this.ports.applyAiSuggestions(this.aiSelected());
  }

  copyText(text: string): void {
    // A refused clipboard write (no focus / permission) must not surface as an unhandled rejection.
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  copy(row: PortRow): void {
    navigator.clipboard?.writeText(row.address).catch(() => undefined);
  }

  openPreview(row: PortRow): void {
    const url = previewUrl(row);
    // The row comes from localStorage (po.forwardPorts.v1) and the proxy reply: only
    // http(s) on a numeric localhost port may ever reach the trusted iframe src.
    if (!url) return;
    this.preview.set({ row, url, safe: this.sanitizer.bypassSecurityTrustResourceUrl(url) });
  }

  reloadPreview(): void {
    const p = this.preview();
    if (!p) return;
    this.preview.set(null);
    setTimeout(() => this.openPreview(p.row));
  }

  private flashError(msg?: string): void {
    this.toast.set(null);
    this.addError.set(msg ?? this.translate.instant('FORWARD_PORTS.Forward failed'));
    this.adding.set(true);
  }
}
