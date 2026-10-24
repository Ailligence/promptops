import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, OnInit, computed, effect, inject, input, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { getSessions } from '@/store/sessions/session.selectors';
import { getWorkspaces } from '@/store/workspaces/workspace.selectors';
import { loadSessions } from '@/store/sessions/session.actions';
import { loadWorkspaces } from '@/store/workspaces/workspace.actions';
import { setActiveSession } from '@/store/sessions/session.actions';
import { SidebarFoldersService } from '../sessions/services/sidebar-folders.service';
import { SubAgentService } from '../sessions/services/sub-agent.service';
import { buildWorkspaceSnapshot, WorkspaceSnapshot } from './plugin-workspace-snapshot';
import { SessionSummary } from '@/store/sessions/session.state';
import { WorkspaceSummary } from '@/store/workspaces/workspace.state';
import { FloorDesk, PageBlock, PageRepoValue, PageView, normalizeView, viewValues } from './plugin-page-view';
import { PluginRuntimeService } from './plugin-runtime.service';
import { PluginFloorplanComponent } from './plugin-floorplan.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

interface RepoCandidate { key: string; name: string; path: string; from: string }

/**
 * Page of a plugin in the `pages` section.
 *
 * The plugin runs in its sandbox and returns a DESCRIPTION of the page. Here it is drawn
 * with the app's components and style: no HTML, CSS or code ever comes from the plugin.
 * Folder paths stay here: the plugin gets a handle, created by Rust when the user picks.
 */
@Component({
  selector: 'app-plugin-page',
  standalone: true,
  imports: [CommonModule, RouterLink, PluginFloorplanComponent, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="pp-wrap">
      <!-- APP band, not the plugin's: name, author and version come from the approved manifest and the plugin cannot
           change or hide them. It keeps a third-party page from being mistaken for a PromptOps screen. -->
      @if (plugin(); as p) {
        <div class="pp-trust" role="note">
          <i class="ti ti-puzzle" aria-hidden="true"></i>
          <span class="pp-trust-who">{{ 'PLUGIN_RUNTIME.Page.Plugin page' | translate }} · <strong>{{ sourceOf(p) }}{{ p.name }}</strong> <small>v{{ p.version }}</small></span>
          @if (p.dev) { <span class="pp-trust-tag" [title]="'PLUGIN_RUNTIME.Page.Local hint' | translate">{{ 'PLUGIN_RUNTIME.Page.Local tag' | translate }}</span> }
          <span class="pp-trust-rule">{{ 'PLUGIN_RUNTIME.Page.Trust rule' | translate }}</span>
          <a class="pp-trust-link" routerLink="/admin/plugins">{{ 'PLUGIN_RUNTIME.Page.Manage' | translate }}</a>
        </div>
      }
      <header class="pp-head">
        <div class="pp-title">
          <h1>{{ view()?.title || decl()?.title || ('PLUGIN_RUNTIME.Page.Plugin' | translate) }}</h1>
          @if (view()?.subtitle) { <p>{{ view()!.subtitle }}</p> }
        </div>
      </header>

      @if (problem(); as message) {
        <div class="pp-notice danger">
          <i class="ti ti-alert-triangle" aria-hidden="true"></i>
          <div>{{ message }}</div>
          <button type="button" class="pp-link" (click)="load()">{{ 'PLUGIN_RUNTIME.Page.Try again' | translate }}</button>
        </div>
      }

      @if (loading()) {
        <div class="pp-skeleton" aria-busy="true"><span></span><span></span><span></span></div>
      }
      @if (!loading() && view(); as v) {
        <div class="pp-blocks" [class.busy]="pending() !== null">
          @for (b of v.blocks; track $index) {
            <ng-container *ngTemplateOutlet="blockTpl; context: { $implicit: b }"></ng-container>
          }
        </div>
      }
    </div>

    <ng-template #blockTpl let-b>
      @switch (b.type) {
        @case ('columns') {
          <div class="pp-columns">
            @for (col of b.columns; track $index) {
              <div class="pp-blocks pp-col">
                @for (inner of col; track $index) {
                  <ng-container *ngTemplateOutlet="blockTpl; context: { $implicit: inner }"></ng-container>
                }
              </div>
            }
          </div>
        }
        @case ('floorplan') {
          <app-plugin-floorplan [block]="b" [openable]="openableSessions()" (openDesk)="openDesk($event)" />
        }
        @case ('heading') { <h2 class="pp-h">{{ b.text }}</h2> }
        @case ('text') { <p class="pp-text" [class.muted]="b.muted">{{ b.text }}</p> }
        @case ('divider') { <hr class="pp-hr" /> }
        @case ('notice') {
          <div class="pp-notice" [ngClass]="b.tone">
            <i class="ti" [ngClass]="noticeIcon(b.tone)" aria-hidden="true"></i><div>{{ b.text }}</div>
          </div>
        }
        @case ('stats') {
          <div class="pp-stats">
            @for (s of b.items; track $index) {
              <div class="pp-stat" [attr.title]="s.hint || null"><small>{{ s.label }}</small><strong>{{ s.value }}</strong></div>
            }
          </div>
        }
        @case ('progress') {
          <div class="pp-progress">
            @if (b.label) { <small>{{ b.label }}</small> }
            <div class="pp-bar"><span [style.width.%]="b.value * 100"></span></div>
          </div>
        }
        @case ('list') {
          @if (b.items.length) {
            <ul class="pp-list">
              @for (i of b.items; track $index) {
                <li>
                  @if (i.icon) { <i class="ti" [ngClass]="i.icon" aria-hidden="true"></i> }
                  <div class="pp-list-main"><span>{{ i.title }}</span>@if (i.subtitle) { <small>{{ i.subtitle }}</small> }</div>
                  @if (i.meta) { <small class="pp-meta">{{ i.meta }}</small> }
                </li>
              }
            </ul>
          } @else if (b.empty) { <p class="pp-text muted">{{ b.empty }}</p> }
        }
        @case ('table') {
          <div class="pp-table-scroll">
            <table class="pp-table">
              <thead><tr>@for (c of b.columns; track $index) { <th>{{ c }}</th> }</tr></thead>
              <tbody>@for (r of b.rows; track $index) { <tr>@for (cell of r; track $index) { <td>{{ cell }}</td> }</tr> }</tbody>
            </table>
          </div>
        }
        @case ('actions') {
          <div class="pp-actions">
            @for (a of b.items; track a.id) {
              <button type="button" class="pp-btn" [ngClass]="a.style" [disabled]="a.disabled || pending() !== null" (click)="act(a.id)">
                @if (pending() === a.id) { <span class="pp-spin" aria-hidden="true"></span> }
                @else if (a.icon) { <i class="ti" [ngClass]="a.icon" aria-hidden="true"></i> }
                <span>{{ a.label }}</span>
              </button>
            }
          </div>
        }
        @case ('output') {
          <div class="pp-field">
            <div class="pp-label-row">
              <label [attr.for]="b.id ? 'pp-' + b.id : null">{{ b.label }}</label>
              @if (b.copy) {
                <button type="button" class="pp-link" (click)="copy(b)">
                  <i class="ti" [ngClass]="copied() === (b.id || b.label) ? 'ti-check' : 'ti-copy'" aria-hidden="true"></i>
                  {{ (copied() === (b.id || b.label) ? 'PLUGIN_RUNTIME.Page.Copied' : 'PLUGIN_RUNTIME.Page.Copy') | translate }}
                </button>
              }
            </div>
            @if (b.editable) {
              <textarea class="pp-input pp-out" [class.mono]="b.mono" [id]="'pp-' + b.id" rows="16" [value]="textOf(b.id)"
                [disabled]="pending() !== null" (input)="set(b.id, $any($event.target).value)"></textarea>
            } @else {
              <pre class="pp-pre" [class.mono]="b.mono">{{ b.text }}</pre>
            }
          </div>
        }
        @case ('field') {
          <div class="pp-field" [class.half]="b.half">
            @switch (b.kind) {
              @case ('toggle') {
                <label class="pp-toggle">
                  <input type="checkbox" [checked]="values()[b.id] === true" [disabled]="pending() !== null" (change)="set(b.id, $any($event.target).checked, b.live)" />
                  <span>{{ b.label }}</span>
                </label>
              }
              @case ('choice') {
                <label>{{ b.label }}</label>
                <div class="pp-choices" role="radiogroup" [attr.aria-label]="b.label">
                  @for (o of b.options; track o.value) {
                    <button type="button" class="pp-choice" role="radio" [class.selected]="values()[b.id] === o.value" [attr.aria-checked]="values()[b.id] === o.value"
                      [disabled]="pending() !== null" (click)="set(b.id, o.value, b.live)">
                      @if (o.icon) { <i class="ti" [ngClass]="o.icon" aria-hidden="true"></i> }
                      <span class="pp-choice-text"><span>{{ o.label }}</span>@if (o.hint) { <small>{{ o.hint }}</small> }</span>
                    </button>
                  }
                </div>
              }
              @case ('select') {
                <label [attr.for]="'pp-' + b.id">{{ b.label }}</label>
                <select class="pp-input" [id]="'pp-' + b.id" [disabled]="pending() !== null" (change)="set(b.id, $any($event.target).value, b.live)">
                  @for (o of b.options; track o.value) { <option [value]="o.value" [selected]="values()[b.id] === o.value">{{ o.label }}</option> }
                </select>
              }
              @case ('textarea') {
                <label [attr.for]="'pp-' + b.id">{{ b.label }}</label>
                <textarea class="pp-input" [id]="'pp-' + b.id" [rows]="b.rows" [placeholder]="b.placeholder" [value]="textOf(b.id)"
                  [disabled]="pending() !== null" (input)="set(b.id, $any($event.target).value)"></textarea>
              }
              @case ('repo') {
                <label [attr.for]="'pp-' + b.id">{{ b.label }}</label>
                <div class="pp-repo">
                  <i class="ti ti-folder-code" aria-hidden="true"></i>
                  <select class="pp-input" [id]="'pp-' + b.id" [disabled]="pending() !== null || granting() === b.id" (change)="pickRepo(b, $any($event.target).value)">
                    <option value="" [selected]="!repoKey()[b.id] && !repoOf(b.id)">{{ 'PLUGIN_RUNTIME.Page.No repository' | translate }}</option>
                    <!-- The plugin remembers the choice while the app is open: going back to the page you find it again. -->
                    @if (!repoKey()[b.id] && repoOf(b.id); as kept) { <option [value]="'~kept'" selected>{{ kept.name }}</option> }
                    @for (c of candidates(); track c.key) { <option [value]="c.key" [selected]="repoKey()[b.id] === c.key">{{ c.name }} · {{ 'PLUGIN_RUNTIME.Page.Source.' + c.from | translate }}</option> }
                  </select>
                </div>
                @if (repoOf(b.id); as r) {
                  <small class="pp-help ok"><i class="ti ti-git-branch" aria-hidden="true"></i> {{ 'PLUGIN_RUNTIME.Page.Repo picked' | translate: { repo: r.branch ? ('PLUGIN_RUNTIME.Page.Repo branch' | translate: { name: r.name, branch: r.branch }) : r.name } }}</small>
                }
                @if (repoError()[b.id]; as err) { <small class="pp-help bad">{{ err }}</small> }
                @if (!candidates().length) { <small class="pp-help">{{ 'PLUGIN_RUNTIME.Page.No candidates' | translate }}</small> }
              }
              @default {
                <label [attr.for]="'pp-' + b.id">{{ b.label }}</label>
                <input class="pp-input" type="text" [id]="'pp-' + b.id" [placeholder]="b.placeholder" [value]="textOf(b.id)"
                  [disabled]="pending() !== null" (input)="set(b.id, $any($event.target).value)" (keydown.enter)="$event.preventDefault()" />
              }
            }
            @if (b.help && b.kind !== 'repo' || b.help && !repoOf(b.id)) { <small class="pp-help">{{ b.help }}</small> }
            <!-- App notice, which the plugin cannot remove: a field asking for a credential is the classic way to steal it -->
            @if (asksForSecret(b)) { <small class="pp-help bad"><i class="ti ti-shield-exclamation" aria-hidden="true"></i> {{ 'PLUGIN_RUNTIME.Page.Secret warning' | translate }}</small> }
          </div>
        }
      }
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: block; --pp-surface: var(--po-page-surface, var(--promptops-body-bg, #fff)); --pp-soft: var(--po-page-soft, rgba(127,127,127,.08));
      --pp-ink: var(--po-page-ink, var(--promptops-body-color, #16181d)); --pp-muted: var(--po-page-muted, #6b7280); --pp-border: var(--po-page-border, rgba(127,127,127,.25)); }
    .pp-wrap { padding: 24px 12px; color: var(--pp-ink); }
    .pp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
    .pp-title h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -.4px; margin: 0 0 4px; }
    .pp-title p { margin: 0; font-size: 13px; color: var(--pp-muted); max-width: 76ch; }
    .pp-trust { display: flex; align-items: center; gap: 6px 12px; flex-wrap: wrap; margin-bottom: 18px; padding: 8px 12px; font-size: 12px; color: var(--pp-muted);
      border: 1px solid var(--pp-border); border-radius: var(--po-radius-md, 8px); background: var(--po-page-soft, rgba(127,127,127,.08)); }
    .pp-trust > i { font-size: 15px; color: var(--pp-ink); }
    .pp-trust-who { color: var(--pp-ink); white-space: nowrap; } .pp-trust-who small { color: var(--pp-muted); font-size: 11px; margin-left: 5px; }
    .pp-trust-tag { border: 1px solid var(--pp-border); border-radius: var(--po-radius-sm, 4px); padding: 0 7px; line-height: 18px; font-size: 11px; color: var(--pp-ink); white-space: nowrap; }
    .pp-trust-rule { flex: 1 1 320px; min-width: 0; }
    .pp-trust-link { margin-left: auto; color: var(--pp-muted); text-underline-offset: 3px; } .pp-trust-link:hover { color: var(--pp-ink); }

    .pp-blocks { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 12px; align-content: start; min-width: 0; }
    .pp-blocks > * { grid-column: 1 / -1; min-width: 0; }
    .pp-blocks > .pp-field.half { grid-column: auto; }
    .pp-columns { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 16px; align-items: start; }
    .pp-col { border: 1px solid var(--pp-border); border-radius: var(--po-radius-lg, 12px); background: var(--pp-surface); padding: 16px; }
    @media (max-width: 991px) { .pp-columns { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 575px) { .pp-blocks > .pp-field.half { grid-column: 1 / -1; } .pp-head { flex-direction: column; } }

    .pp-h { font-size: .95rem; font-weight: 600; margin: 0; }
    .pp-text { margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
    .pp-text.muted { color: var(--pp-muted); }
    .pp-hr { border: 0; border-top: 1px solid var(--pp-border); margin: 2px 0; opacity: 1; }

    .pp-field { display: flex; flex-direction: column; gap: 6px; }
    .pp-field > label, .pp-label-row label { font-size: 12px; font-weight: 600; margin: 0; }
    .pp-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .pp-input { width: 100%; font: inherit; font-size: 13px; color: var(--pp-ink); background: var(--pp-surface); border: 1px solid var(--pp-border);
      border-radius: var(--po-radius-md, 8px); padding: 8px 10px; min-height: 36px; outline: none; }
    .pp-input:focus { border-color: var(--pp-ink); }
    .pp-input:disabled { opacity: .6; }
    textarea.pp-input { resize: vertical; line-height: 1.5; }
    .pp-out.mono, .pp-pre.mono { font-family: var(--po-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 12.5px; }
    .pp-pre { margin: 0; font: inherit; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--pp-border); border-radius: var(--po-radius-md, 8px);
      padding: 10px; max-height: 420px; overflow: auto; background: var(--pp-soft); }
    .pp-help { font-size: 12px; color: var(--pp-muted); line-height: 1.4; }
    .pp-help.ok { color: var(--po-success, #1a7f37); }
    .pp-help.bad { color: var(--po-error, #cf222e); }

    .pp-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .pp-choice { display: flex; align-items: flex-start; gap: 8px; text-align: left; font: inherit; color: var(--pp-ink); background: var(--pp-surface);
      border: 1px solid var(--pp-border); border-radius: var(--po-radius-md, 8px); padding: 8px 10px; cursor: pointer; min-width: 0; }
    .pp-choice > i { font-size: 16px; line-height: 18px; color: var(--pp-muted); flex: none; }
    .pp-choice-text { display: flex; flex-direction: column; min-width: 0; font-size: 13px; font-weight: 600; line-height: 18px; }
    .pp-choice-text small { font-weight: 400; font-size: 11.5px; line-height: 1.35; color: var(--pp-muted); }
    .pp-choice:hover:not(:disabled) { border-color: var(--pp-ink); }
    .pp-choice.selected { border-color: var(--pp-ink); box-shadow: inset 0 0 0 1px var(--pp-ink); }
    .pp-choice.selected > i { color: var(--pp-ink); }
    .pp-choice:disabled { opacity: .6; cursor: default; }

    .pp-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 400 !important; cursor: pointer; }
    .pp-toggle input { accent-color: var(--pp-ink); width: 15px; height: 15px; }
    .pp-repo { display: flex; align-items: center; gap: 8px; }
    .pp-repo > i { font-size: 18px; color: var(--pp-muted); }

    .pp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .pp-btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600; min-height: 36px; padding: 0 14px; cursor: pointer;
      color: var(--pp-ink); background: var(--pp-surface); border: 1px solid var(--pp-border); border-radius: var(--po-radius-md, 8px); }
    .pp-btn:hover:not(:disabled) { border-color: var(--pp-ink); }
    .pp-btn.primary { background: var(--pp-ink); color: var(--pp-surface); border-color: var(--pp-ink); }
    .pp-btn.ghost { border-color: transparent; color: var(--pp-muted); }
    .pp-btn.danger { color: var(--po-error, #cf222e); }
    .pp-btn:disabled { opacity: .55; cursor: default; }
    .pp-link { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 12px; color: var(--pp-muted); background: none; border: 0; padding: 0; cursor: pointer; }
    .pp-link:hover { color: var(--pp-ink); text-decoration: underline; }
    .pp-spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: pp-spin .7s linear infinite; }
    @keyframes pp-spin { to { transform: rotate(360deg); } }

    .pp-notice { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.45; border: 1px solid var(--pp-border); border-radius: var(--po-radius-md, 8px);
      padding: 10px 12px; background: var(--pp-soft); overflow-wrap: anywhere; }
    .pp-notice > div { flex: 1 1 auto; min-width: 0; }
    .pp-notice > i { font-size: 16px; line-height: 19px; flex: none; }
    .pp-notice.success > i { color: var(--po-success, #1a7f37); }
    .pp-notice.warning > i { color: var(--po-warning, #9a6700); }
    .pp-notice.danger { border-color: var(--po-error, #cf222e); }
    .pp-notice.danger > i { color: var(--po-error, #cf222e); }

    .pp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
    .pp-stat { border: 1px solid var(--pp-border); border-radius: var(--po-radius-md, 8px); padding: 8px 10px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pp-stat small { font-size: 11px; color: var(--pp-muted); }
    .pp-stat strong { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pp-progress small { font-size: 12px; color: var(--pp-muted); }
    .pp-bar { height: 6px; border-radius: 999px; background: var(--pp-soft); overflow: hidden; margin-top: 4px; }
    .pp-bar span { display: block; height: 100%; background: var(--pp-ink); transition: width .2s; }
    .pp-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--pp-border); border-radius: var(--po-radius-md, 8px); }
    .pp-list li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; font-size: 13px; border-top: 1px solid var(--pp-border); }
    .pp-list li:first-child { border-top: 0; }
    .pp-list-main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
    .pp-list small, .pp-meta { font-size: 12px; color: var(--pp-muted); }
    .pp-table-scroll { overflow-x: auto; border: 1px solid var(--pp-border); border-radius: var(--po-radius-md, 8px); }
    .pp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .pp-table th, .pp-table td { text-align: left; padding: 8px 10px; border-top: 1px solid var(--pp-border); vertical-align: top; }
    .pp-table thead th { border-top: 0; font-size: 12px; font-weight: 600; color: var(--pp-muted); }

    .pp-skeleton { display: grid; gap: 10px; max-width: 640px; }
    .pp-skeleton span { height: 38px; border-radius: 8px; background: var(--pp-soft); animation: pp-pulse 1.2s ease-in-out infinite; }
    @keyframes pp-pulse { 50% { opacity: .45; } }
  `],
})
export class PluginPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private store = inject(Store);
  private folders = inject(SidebarFoldersService);
  private subAgents = inject(SubAgentService);
  private destroyRef = inject(DestroyRef);
  readonly runtime = inject(PluginRuntimeService);
  private translate = inject(TranslateService);

  private pluginId = signal('');
  private pageId = signal('');
  /** Embedded use (Plugin Studio preview): plugin and page come from here instead of the route. */
  readonly embedPluginId = input<string>('');
  readonly embedPageId = input<string>('');
  /** Changes on every Studio Reload: the page reopens with the new code. */
  readonly reloadKey = input<number>(0);
  private workspaces = signal<WorkspaceSummary[]>([]);
  private sessions = signal<SessionSummary[]>([]);
  /** Fields touched since the last send: an update pushed by the plugin doesn't overwrite them. */
  private dirty = new Set<string>();
  private loadSeq = 0;

  readonly view = signal<PageView | null>(null);
  readonly values = signal<Record<string, unknown>>({});
  readonly loading = signal(true);
  readonly problem = signal('');
  /** Id of the action in progress, or `~` for a field change. While it is not null the page is frozen. */
  readonly pending = signal<string | null>(null);
  readonly copied = signal('');
  readonly granting = signal('');
  readonly repoKey = signal<Record<string, string>>({});
  readonly repoError = signal<Record<string, string>>({});

  readonly plugin = computed(() => this.runtime.installed().find((p) => p.pluginId === this.pluginId()) ?? null);
  readonly decl = computed(() => this.plugin()?.pages?.find((p) => p.id === this.pageId()) ?? null);

  /**
   * `sidebar` pages with `sessions:read`: snapshot of folders, workspaces, sessions and agents (names and states only).
   * Other pages receive nothing.
   */
  private readonly snapshot = computed<WorkspaceSnapshot | null>(() => {
    const p = this.plugin();
    if (!p || this.decl()?.place !== 'sidebar' || !p.permissions.includes('sessions:read')) return null;
    return buildWorkspaceSnapshot(this.folders.folders(), this.workspaces(), this.sessions(), this.subAgents.allSubAgents());
  });
  /** Changes only when something the floor plan shows changes: avoids calling the plugin for nothing. */
  private readonly snapshotKey = computed(() => {
    const s = this.snapshot();
    if (!s) return '';
    return JSON.stringify([s.folders, s.workspaces, s.sessions]);
  });
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private context(): Record<string, unknown> {
    const s = this.snapshot();
    return s ? { workspace: s } : {};
  }

  /** The user's sessions: the floor plan opens only these, whatever the plugin proposes. */
  readonly openableSessions = computed(() => new Set(this.sessions().map((s) => s.id)));

  /** The plugin proposes, the app opens: only a session of the user's, never an address. */
  openDesk(d: FloorDesk): void {
    if (!d.session || !this.openableSessions().has(d.session)) return;
    this.store.dispatch(setActiveSession({ sessionId: d.session! }));
    void this.router.navigate(['/admin/sessions']);
  }

  /** "owner/" of the GitHub repository declared in the approved manifest. No repository, no prefix. */
  sourceOf(p: { repository?: string | null }): string {
    const owner = /^https:\/\/github\.com\/([^/]+)\//.exec(p.repository ?? '')?.[1];
    return owner ? `${owner}/` : '';
  }

  /** A field whose label, placeholder or help asks for a credential. It doesn't block: it warns, in the app's words. */
  asksForSecret(b: { kind?: string; label?: string; placeholder?: string; help?: string }): boolean {
    if (b.kind && !['text', 'textarea'].includes(b.kind)) return false;
    return /pass(word|phrase|code)?\b|\btoken\b|\bsecret\b|api[ _-]?key|\bcredential|\bpat\b|private key|\botp\b|2fa|\bpin\b/i.test(`${b.label ?? ''} ${b.placeholder ?? ''} ${b.help ?? ''}`);
  }

  /** Folders known to the app: workspaces and sessions with a local path. One row per folder. */
  readonly candidates = computed<RepoCandidate[]>(() => {
    const seen = new Set<string>();
    const out: RepoCandidate[] = [];
    const add = (key: string, name: string, path: string | null | undefined, from: string) => {
      if (!path || seen.has(path)) return;
      seen.add(path);
      out.push({ key, name, path, from });
    };
    for (const w of this.workspaces()) add(`w:${w.id}`, w.name, w.projectPath, 'workspace');
    for (const s of this.sessions()) add(`s:${s.id}`, s.name, s.workspace?.path ?? s.deviceWorkspace?.localPath, 'session');
    return out;
  });

  constructor() {
    // Embedded in the Studio: it (re)opens when the plugin, page or reloadKey change.
    effect(() => {
      const plugin = this.embedPluginId();
      const page = this.embedPageId();
      this.reloadKey();
      if (!plugin) return;
      queueMicrotask(() => {
        this.pluginId.set(plugin);
        this.pageId.set(page);
        this.repoKey.set({});
        this.repoError.set({});
        void this.load();
      });
    });
    // `sidebar` page: when folders, sessions or agent states change it reopens silently.
    effect(() => {
      const key = this.snapshotKey();
      if (!key) return;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.refreshSilently(), 700);
    });
    this.destroyRef.onDestroy(() => this.refreshTimer && clearTimeout(this.refreshTimer));
    // Updates pushed by the plugin while it works: progress, partial results.
    effect(() => {
      const update = this.runtime.pageUpdate();
      if (!update || update.pluginId !== this.pluginId() || update.pageId !== this.pageId()) return;
      this.apply(update.view, true);
    });
  }

  ngOnInit(): void {
    this.store.dispatch(loadWorkspaces());
    this.store.dispatch(loadSessions());
    this.store.select(getWorkspaces).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ws) => this.workspaces.set(ws ?? []));
    this.store.select(getSessions).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ss) => this.sessions.set(ss ?? []));
    if (this.embedPluginId()) return;
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.pluginId.set(params.get('pluginId') ?? '');
      this.pageId.set(params.get('pageId') ?? '');
      this.repoKey.set({});
      this.repoError.set({});
      void this.load();
    });
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.problem.set('');
    this.view.set(null);
    if (!this.runtime.available) {
      this.loading.set(false);
      this.problem.set(this.translate.instant('PLUGIN_RUNTIME.Page.Desktop only'));
      return;
    }
    try {
      await this.runtime.start();
      // Right after activation, the plugin may not have finished starting in its sandbox yet.
      let raw: unknown;
      for (let attempt = 0; ; attempt++) {
        try {
          raw = await this.runtime.openPage(this.pluginId(), this.pageId(), this.context());
          break;
        } catch (e) {
          if (attempt >= 5 || !/not running|not implemented|no active plugin/i.test(String(e))) throw e;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (seq !== this.loadSeq) return;
      this.apply(raw, false);
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.problem.set(this.readable(e));
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  /** Reopens the page without a loading skeleton: no flicker while agents work. */
  private async refreshSilently(): Promise<void> {
    if (this.loading() || this.pending() !== null || !this.view() || !this.runtime.available) return;
    const seq = this.loadSeq;
    try {
      const raw = await this.runtime.openPage(this.pluginId(), this.pageId(), this.context());
      if (seq === this.loadSeq && this.pending() === null) this.apply(raw, true);
    } catch { /* the next change retries */ }
  }

  private apply(raw: unknown, pushed: boolean): void {
    const view = normalizeView(raw);
    const fresh = viewValues(view);
    if (pushed) {
      for (const id of this.dirty) if (id in fresh) fresh[id] = this.values()[id];
    } else {
      this.dirty.clear();
    }
    this.view.set(view);
    this.values.set(fresh);
  }

  textOf(id: string | null): string {
    const v = id ? this.values()[id] : '';
    return typeof v === 'string' ? v : '';
  }

  repoOf(id: string): PageRepoValue | null {
    const v = this.values()[id];
    return v && typeof v === 'object' ? (v as PageRepoValue) : null;
  }

  set(id: string | null, value: unknown, live = false): void {
    if (!id) return;
    this.dirty.add(id);
    this.values.update((all) => ({ ...all, [id]: value }));
    if (live) void this.send('change', id);
  }

  act(id: string): void {
    void this.send('action', id);
  }

  private async send(type: 'action' | 'change', id: string): Promise<void> {
    if (this.pending() !== null) return;
    this.pending.set(type === 'action' ? id : '~');
    this.problem.set('');
    try {
      const raw = await this.runtime.pageEvent(this.pluginId(), this.pageId(), { type, id, values: this.values(), ...this.context() });
      this.dirty.clear();
      this.apply(raw, false);
    } catch (e) {
      this.problem.set(this.readable(e));
    } finally {
      this.pending.set(null);
    }
  }

  /** The choice goes through Rust, which checks it is a repository and creates the handle for this plugin. */
  async pickRepo(block: Extract<PageBlock, { type: 'field' }>, key: string): Promise<void> {
    const id = block.id;
    this.repoError.update((all) => ({ ...all, [id]: '' }));
    if (!key) {
      this.repoKey.update((all) => ({ ...all, [id]: '' }));
      this.set(id, null, block.live);
      return;
    }
    if (key === '~kept') return;
    const candidate = this.candidates().find((c) => c.key === key);
    if (!candidate) return;
    this.granting.set(id);
    try {
      const grant = await this.runtime.grantRepo(this.pluginId(), candidate.path);
      this.repoKey.update((all) => ({ ...all, [id]: key }));
      this.set(id, { handle: grant.handle, name: grant.name, branch: grant.branch }, block.live);
    } catch {
      this.repoKey.update((all) => ({ ...all, [id]: '' }));
      this.repoError.update((all) => ({ ...all, [id]: this.translate.instant('PLUGIN_RUNTIME.Page.Not git', { name: candidate.name }) }));
      this.set(id, null, block.live);
    } finally {
      this.granting.set('');
    }
  }

  async copy(block: Extract<PageBlock, { type: 'output' }>): Promise<void> {
    const text = block.editable && block.id ? this.textOf(block.id) : block.text;
    try {
      await navigator.clipboard.writeText(text);
      const mark = block.id || block.label;
      this.copied.set(mark);
      setTimeout(() => this.copied() === mark && this.copied.set(''), 1600);
    } catch {
      this.copied.set('');
    }
  }

  noticeIcon(tone: string): string {
    return ({ success: 'ti-circle-check', warning: 'ti-alert-triangle', danger: 'ti-alert-circle' } as Record<string, string>)[tone] ?? 'ti-info-circle';
  }

  private readable(e: unknown): string {
    const message = String((e as { message?: string })?.message ?? e ?? '').slice(0, 300);
    const t = (k: string) => this.translate.instant('PLUGIN_RUNTIME.Page.' + k);
    if (/plugin non attivo|plugin not active/i.test(message)) return t('Switched off');
    if (/page or method not declared/i.test(message)) return t('Not declared');
    if (/did not (answer|respond)/i.test(message)) return t('No answer');
    return message || t('Could not show');
  }
}
