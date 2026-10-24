import { Component, HostBinding, HostListener, computed, effect, inject, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { SessionButtonPlace } from './plugin-registry.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TooltipDirective } from '../../../common/tooltip.directive';
import { SessionService } from '../sessions/services/session.service';
import { SubAgentService } from '../sessions/services/sub-agent.service';
import { PageView } from './plugin-page-view';
import { PluginRuntimeService, PluginSessionButton } from './plugin-runtime.service';
import { SessionActionProposal, agentSlug, normalizeSessionAction } from './plugin-session-action';

/** An agent of the session that can be sent to: the main one or a live sub-agent. */
interface SessionAgent { id: string; name: string; provider: string; status: string; isMain: boolean }

const MAX_INLINE = 4;
/** States in which an agent has opened a permission dialog or a question: it receives nothing from a plugin. */
const BLOCKED = new Set(['waiting_input']);
const GONE = new Set(['exited', 'error']);

/**
 * Plugin buttons in the bar of every agent terminal (next to review, echo,
 * Chrome and auto-approve). The same buttons on every terminal; the agent of that
 * terminal is the default recipient.
 *
 * The plugin never touches an agent: on click it only receives session metadata and
 * answers with ONE proposal. The app carries it out:
 *  - `insert` → text pasted into this agent's input, WITHOUT submitting: the user decides;
 *  - `prompt` → sent to an agent (default: this one), with the confirmation chosen by the user;
 *  - `spawn`  → spawn composer prefilled for a new sub-agent;
 *  - `panel`  → read-only window drawn by the app;
 *  - `toast`  → notification.
 * An agent stuck on a permission dialog never receives anything, whatever the policy.
 */
/** Fake session for the Studio preview: nothing is ever delivered to an agent. */
const PREVIEW_SESSION = 'plugin-studio-preview';

@Component({
  selector: 'app-plugin-session-buttons',
  standalone: true,
  imports: [TooltipDirective, TranslateModule],
  template: `
    @for (b of inline(); track b.pluginId + '/' + b.button.id) {
      <button type="button" class="psb-btn" [class.busy]="busyKey() === key(b)"
        [disabled]="(!sessionId() && !preview()) || busyKey() !== null" (click)="run(b)"
        [appTooltip]="b.button.title + ' · ' + b.pluginName + (b.dev ? ' (' + ('PLUGIN_RUNTIME.Buttons.Local' | translate) + ')' : '')"
        [attr.aria-label]="'PLUGIN_RUNTIME.Buttons.Button aria' | translate: { title: b.button.title, plugin: b.pluginName }">
        <i class="ti {{ b.button.icon }}" aria-hidden="true"></i>
        @if (showLabel()) { <span class="psb-label">{{ b.button.title }}</span> }
        <i class="ti ti-puzzle psb-mark" aria-hidden="true"></i>
        @if (!needsConfirmFor(b)) { <span class="psb-direct" aria-hidden="true"></span> }
      </button>
    }
    @if (overflow().length) {
      <span class="psb-more-wrap">
        <button type="button" class="psb-btn psb-more" (click)="menuOpen.set(!menuOpen())" [appTooltip]="'PLUGIN_RUNTIME.Buttons.More' | translate"
          [attr.aria-expanded]="menuOpen()" [attr.aria-label]="'PLUGIN_RUNTIME.Buttons.More' | translate">
          <i class="ti ti-puzzle" aria-hidden="true"></i><small>+{{ overflow().length }}</small>
        </button>
        @if (menuOpen()) {
          <div class="psb-menu" role="menu">
            @for (b of overflow(); track b.pluginId + '/' + b.button.id) {
              <button type="button" role="menuitem" [disabled]="(!sessionId() && !preview()) || busyKey() !== null" (click)="menuOpen.set(false); run(b)">
                <i class="ti {{ b.button.icon }}" aria-hidden="true"></i>
                <span>{{ b.button.title }}</span><small>{{ b.pluginName }}</small>
              </button>
            }
          </div>
        }
      </span>
    }

    @if (pending(); as p) {
      <div class="psb-backdrop" (click)="cancel()"></div>
      <div class="psb-modal" role="alertdialog" aria-modal="true" aria-labelledby="psb-title">
        <div class="psb-head">
          <div class="psb-from"><i class="ti ti-puzzle" aria-hidden="true"></i> {{ 'PLUGIN_RUNTIME.From' | translate: { name: p.button.pluginName } }}</div>
          <div class="fw-semibold" id="psb-title">{{ 'PLUGIN_RUNTIME.Buttons.Confirm title' | translate }}</div>
        </div>
        <div class="psb-body">
          <p class="psb-lead">{{ 'PLUGIN_RUNTIME.Buttons.Confirm lead' | translate: { button: p.button.button.title } }}</p>
          <label class="psb-cap" for="psb-target">{{ 'PLUGIN_RUNTIME.Buttons.Send to' | translate }}</label>
          <select id="psb-target" class="form-select form-select-sm psb-select" (change)="targetId.set($any($event.target).value)">
            @for (a of agents(); track a.id) {
              <option [value]="a.id" [selected]="a.id === targetId()">{{ a.isMain ? ('PLUGIN_RUNTIME.Buttons.Main agent' | translate) : a.name }} · {{ a.provider }}{{ blocked(a) ? ' · ' + ('PLUGIN_RUNTIME.Buttons.Waiting answer' | translate) : '' }}</option>
            }
          </select>
          @if (targetBlocked()) {
            <div class="psb-warn">{{ 'PLUGIN_RUNTIME.Buttons.Blocked warn' | translate }}</div>
          }
          <div class="psb-cap">{{ 'PLUGIN_RUNTIME.Buttons.Prompt chars' | translate: { count: p.text.length } }}</div>
          <pre class="psb-text">{{ p.text }}</pre>
          @if (policyOf(p.button) !== 'never') {
            <label class="psb-check">
              <input type="checkbox" [checked]="rememberSession()" (change)="rememberSession.set($any($event.target).checked)">
              {{ 'PLUGIN_RUNTIME.Buttons.Remember' | translate }}
            </label>
          }
        </div>
        <div class="psb-foot">
          <span class="psb-hint">{{ 'PLUGIN_RUNTIME.Buttons.Policy hint' | translate }}</span>
          <button type="button" class="btn btn-light btn-sm" (click)="cancel()">{{ 'PLUGIN_RUNTIME.Buttons.Dont send' | translate }}</button>
          <button type="button" class="btn btn-primary btn-sm" [disabled]="!armed() || targetBlocked() || sending()" (click)="send()">{{ 'PLUGIN_RUNTIME.Buttons.Send' | translate }}</button>
        </div>
      </div>
    }

    @if (panel(); as v) {
      <div class="psb-backdrop" (click)="panel.set(null)"></div>
      <div class="psb-modal" role="dialog" aria-modal="true" aria-labelledby="psb-panel-title">
        <div class="psb-head">
          <div class="psb-from"><i class="ti ti-puzzle" aria-hidden="true"></i> {{ 'PLUGIN_RUNTIME.From' | translate: { name: panelFrom() } }}</div>
          <div class="fw-semibold" id="psb-panel-title">{{ v.view.title || panelFrom() }}</div>
          @if (v.view.subtitle) { <div class="psb-sub">{{ v.view.subtitle }}</div> }
        </div>
        <div class="psb-body">
          @for (block of v.view.blocks; track $index) {
            @switch (block.type) {
              @case ('heading') { <div class="psb-h">{{ block.text }}</div> }
              @case ('text') { <p class="psb-p" [class.muted]="block.muted">{{ block.text }}</p> }
              @case ('notice') { <div class="psb-notice" [attr.data-tone]="block.tone">{{ block.text }}</div> }
              @case ('divider') { <hr> }
              @case ('output') {
                @if (block.label) { <div class="psb-cap">{{ block.label }}</div> }
                <pre class="psb-text" [class.mono]="block.mono">{{ block.text }}</pre>
              }
              @case ('list') {
                <ul class="psb-list">
                  @for (it of block.items; track $index) { <li><span>{{ it.title }}</span>@if (it.subtitle) {<small>{{ it.subtitle }}</small>}</li> }
                  @empty { <li class="muted">{{ block.empty || ('PLUGIN_RUNTIME.Buttons.Nothing here' | translate) }}</li> }
                </ul>
              }
              @case ('stats') {
                <div class="psb-stats">
                  @for (s of block.items; track $index) { <div><strong>{{ s.value }}</strong><small>{{ s.label }}</small></div> }
                </div>
              }
              @case ('table') {
                <div class="psb-table"><table>
                  <thead><tr>@for (c of block.columns; track $index) { <th>{{ c }}</th> }</tr></thead>
                  <tbody>@for (row of block.rows; track $index) { <tr>@for (cell of row; track $index) { <td>{{ cell }}</td> }</tr> }</tbody>
                </table></div>
              }
              @default { }
            }
          }
          @if (v.hidden) { <p class="psb-p muted">{{ 'PLUGIN_RUNTIME.Buttons.Hidden' | translate: { count: v.hidden } }}</p> }
        </div>
        <div class="psb-foot"><button type="button" class="btn btn-primary btn-sm" (click)="panel.set(null)">{{ 'PLUGIN_RUNTIME.Buttons.Close' | translate }}</button></div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: contents; }
    .psb-btn { position: relative; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 1px;
      border: none; border-radius: 8px; background: transparent; color: var(--po-text-secondary); cursor: pointer;
      transition: background .15s, color .15s, transform .1s; font-size: 15px; }
    .psb-btn:hover:not(:disabled) { background: rgba(129, 140, 248, .12); color: #a5b4fc; }
    :host-context([data-bs-theme="light"]) .psb-btn:hover:not(:disabled) { color: #4f46e5; }
    .psb-btn:active:not(:disabled) { transform: scale(.94); }
    .psb-btn:disabled { opacity: .35; cursor: not-allowed; }
    .psb-btn.busy { opacity: .6; animation: psb-pulse 1s ease-in-out infinite; }
    .psb-btn small { font-size: 9px; font-weight: 600; }
    .psb-mark { position: absolute; right: 1px; bottom: 1px; font-size: 8px; opacity: .7; }
    .psb-direct { position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--po-warning, #d29922); }
    @keyframes psb-pulse { 50% { opacity: .3; } }
    .psb-more-wrap { position: relative; display: inline-flex; }
    .psb-menu { position: absolute; bottom: calc(100% + 6px); right: 0; z-index: 30; min-width: 220px; padding: 4px;
      background: var(--promptops-body-bg); border: 1px solid var(--promptops-border-color); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    .psb-menu button { width: 100%; display: grid; grid-template-columns: 18px 1fr; gap: 0 8px; align-items: center; text-align: left;
      padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: .8rem; }
    .psb-menu button:hover:not(:disabled) { background: rgba(129, 140, 248, .12); }
    .psb-menu small { grid-column: 2; opacity: .6; font-size: .7rem; }
    .psb-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2001; }
    .psb-modal { position: fixed; z-index: 2002; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(680px, calc(100vw - 32px));
      max-height: min(80vh, 720px); display: flex; flex-direction: column; background: var(--promptops-body-bg); color: var(--promptops-body-color);
      border: 1px solid var(--promptops-border-color); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.35); text-align: left; }
    .psb-head { padding: 14px 16px 8px; }
    .psb-sub { font-size: .8rem; opacity: .7; }
    .psb-from, .psb-cap { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; opacity: .65; }
    .psb-cap { display: block; margin: 8px 0 4px; }
    .psb-body { padding: 0 16px 8px; overflow: auto; flex: 1 1 auto; }
    .psb-lead, .psb-p { font-size: .84rem; line-height: 1.5; margin: 0 0 8px; }
    .muted { opacity: .65; }
    .psb-select { max-width: 360px; }
    .psb-warn { font-size: .78rem; border: 1px solid var(--po-warning, #d29922); border-radius: 8px; padding: 6px 10px; margin-top: 8px; }
    .psb-text { font-size: .78rem; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 10px; border: 1px solid var(--promptops-border-color);
      border-radius: 8px; padding: 10px; font-family: var(--po-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); max-height: 320px; overflow: auto; }
    .psb-check { display: flex; align-items: center; gap: 8px; font-size: .8rem; margin: 4px 0; cursor: pointer; }
    .psb-foot { padding: 10px 16px; display: flex; justify-content: flex-end; align-items: center; gap: 8px; border-top: 1px solid var(--promptops-border-color); flex: none; }
    .psb-hint { margin-right: auto; font-size: .72rem; opacity: .6; }
    .psb-foot .btn { white-space: nowrap; }
    .psb-btn.psb-more { width: auto; padding: 0 6px; }
    /* Terminal bar: same bare buttons as review, echo and Chrome (24px, 14px icon). */
    :host(.psb-toolbar) .psb-btn { width: 24px; height: 24px; border-radius: 5px; font-size: 14px; opacity: .7; }
    :host(.psb-toolbar) .psb-btn:hover:not(:disabled) { opacity: 1; background: var(--po-bg-2); color: var(--po-accent, #a5b4fc); }
    :host(.psb-toolbar) .psb-btn.psb-more { width: auto; }
    :host(.psb-toolbar) .psb-menu { right: 0; bottom: calc(100% + 4px); }
    /* Session header: same badges as SSH, Database and Docker (icon + title). */
    :host(.psb-header) .psb-btn { width: auto; height: auto; gap: .3rem; padding: .2rem .5rem; border-radius: 6px; border: 1px solid rgba(129, 140, 248, .3);
      color: #818cf8; font-size: .72rem; font-weight: 600; }
    :host(.psb-header) .psb-btn:hover:not(:disabled) { background: rgba(129, 140, 248, .1); border-color: rgba(129, 140, 248, .45); color: #818cf8; }
    :host(.psb-header) .psb-btn i:first-child { font-size: 16px; }
    :host(.psb-header) .psb-menu { top: calc(100% + 6px); bottom: auto; }
    /* AI Squad / Goal / Worker row: same pill as the meta-chips. */
    :host(.psb-chip) { display: contents; }
    :host(.psb-chip) .psb-btn { flex: 1 1 0; min-width: 0; width: auto; height: 28px; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle); color: var(--po-text-secondary); font-size: .68rem; font-weight: 600; }
    :host(.psb-chip) .psb-btn:hover:not(:disabled) { background: rgba(129, 140, 248, .08); border-color: rgba(129, 140, 248, .35); color: var(--po-text-secondary); }
    :host(.psb-chip) .psb-btn i:first-child { font-size: 14px; }
    .psb-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    :host(.psb-header) .psb-mark, :host(.psb-chip) .psb-mark { position: static; font-size: 9px; opacity: .6; }
    @media (max-width: 480px) { .psb-hint { display: none; } }
    .psb-h { font-weight: 600; font-size: .9rem; margin: 10px 0 6px; }
    .psb-notice { font-size: .8rem; border-radius: 8px; padding: 6px 10px; margin: 0 0 8px; border: 1px solid var(--promptops-border-color); }
    .psb-notice[data-tone="warning"], .psb-notice[data-tone="danger"] { border-color: var(--po-warning, #d29922); }
    .psb-list { list-style: none; padding: 0; margin: 0 0 8px; border: 1px solid var(--promptops-border-color); border-radius: 8px; }
    .psb-list li { display: flex; flex-direction: column; padding: 6px 10px; font-size: .82rem; border-top: 1px solid var(--promptops-border-color); }
    .psb-list li:first-child { border-top: 0; }
    .psb-list small { opacity: .65; }
    .psb-stats { display: flex; flex-wrap: wrap; gap: 16px; margin: 0 0 8px; }
    .psb-stats div { display: flex; flex-direction: column; }
    .psb-stats small { opacity: .65; font-size: .72rem; }
    .psb-table { overflow: auto; margin: 0 0 8px; }
    .psb-table table { width: 100%; font-size: .78rem; border-collapse: collapse; }
    .psb-table th, .psb-table td { padding: 4px 8px; border-bottom: 1px solid var(--promptops-border-color); text-align: left; }
  `],
})
export class PluginSessionButtonsComponent {
  readonly runtime = inject(PluginRuntimeService);
  private sessions = inject(SessionService);
  private subAgents = inject(SubAgentService);
  private translate = inject(TranslateService);

  /** Main (parent) session the bar belongs to. */
  readonly sessionId = input<string | null>(null);
  /** Agent of the bar: `main` or the sub-agent id. */
  readonly paneAgentId = input<string>('main');
  readonly sessionName = input<string>('');
  readonly provider = input<string>('');
  readonly sessionStatus = input<string>('');
  readonly workspaceName = input<string>('');
  /** Draft text in the composer: reaches the plugin only if it has `composer:read` (filtered in Rust). */
  readonly composerText = input<string>('');
  /** Place in the app where the row is mounted: only buttons declared for this place are shown. */
  readonly place = input<SessionButtonPlace>('terminal');
  /** Look: `toolbar` (terminal bar), `composer` (composer tools), `header` (session badges), `chip` (AI Squad/Goal/Worker row). */
  readonly variant = input<'toolbar' | 'composer' | 'header' | 'chip'>('toolbar');
  @HostBinding('class.psb-toolbar') get isToolbar(): boolean { return this.variant() === 'toolbar'; }
  @HostBinding('class.psb-header') get isHeader(): boolean { return this.variant() === 'header'; }
  @HostBinding('class.psb-chip') get isChip(): boolean { return this.variant() === 'chip'; }
  readonly showLabel = computed(() => this.variant() === 'header' || this.variant() === 'chip');
  /** `insert` into the spawn composer (`composer` and `runtime` places): written by whoever hosts the row. */
  readonly insertText = output<string>();
  /**
   * Plugin Studio preview: buttons work even without an open session and a `spawn`
   * goes to whoever hosts the row (the Studio's fake composer) instead of the real composer.
   * A `prompt` without a session is not sent: it only shows what would be sent.
   */
  readonly preview = input(false);
  readonly spawnPreview = output<{ prompt: string; provider: string | null; mode: string | null; name: string | null }>();

  /** Only this plugin's buttons (Plugin Studio preview). */
  readonly onlyPluginId = input<string>('');

  /** A button appears on every agent terminal, main or sub-agent: no distinctions. */
  private readonly visible = computed(() => {
    const only = this.onlyPluginId();
    const place = this.place();
    return this.runtime.sessionButtons().filter((b) => (!only || b.pluginId === only) && (b.button.place ?? 'terminal') === place);
  });
  readonly inline = computed(() => this.visible().slice(0, MAX_INLINE));
  readonly overflow = computed(() => this.visible().slice(MAX_INLINE));
  readonly menuOpen = signal(false);
  readonly busyKey = signal<string | null>(null);

  readonly pending = signal<{ button: PluginSessionButton; text: string; sessionId: string } | null>(null);
  readonly targetId = signal('main');
  readonly rememberSession = signal(false);
  readonly sending = signal(false);
  /** The yes button activates shortly after appearing, like the other plugin confirmations. */
  readonly armed = signal(false);
  private armTimer: ReturnType<typeof setTimeout> | null = null;

  readonly panel = signal<{ view: PageView; hidden: number } | null>(null);
  readonly panelFrom = signal('');

  /** Agents of the session: the main one and the sub-agents still alive. */
  readonly agents = computed<SessionAgent[]>(() => {
    const sid = this.sessionId();
    if (!sid) return [];
    const main: SessionAgent = { id: 'main', name: this.sessionName() || this.translate.instant('PLUGIN_RUNTIME.Buttons.Main agent'), provider: this.provider(), status: this.sessionStatus(), isMain: true };
    const subs = this.subAgents.activeSubAgents()
      .filter((sa) => sa.parentSessionId === sid && !GONE.has(sa.status) && sa.executionMode !== 'worker')
      .map((sa) => ({ id: sa.id, name: sa.title, provider: sa.provider, status: sa.status, isMain: false }));
    return [main, ...subs];
  });
  readonly targetBlocked = computed(() => {
    const a = this.agents().find((x) => x.id === this.targetId());
    return !a || this.blocked(a);
  });

  constructor() {
    effect(() => {
      const open = this.pending() !== null;
      if (this.armTimer) clearTimeout(this.armTimer);
      this.armed.set(false);
      if (open) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        this.armTimer = setTimeout(() => this.armed.set(true), 700);
      }
    });
  }

  key(b: PluginSessionButton): string {
    return `${b.pluginId}/${b.button.id}`;
  }

  blocked(a: SessionAgent): boolean {
    return BLOCKED.has(a.status);
  }

  policyOf(b: PluginSessionButton) {
    return this.runtime.confirmPolicy(b);
  }

  needsConfirmFor(b: PluginSessionButton): boolean {
    const sid = this.sessionId();
    return !sid || this.runtime.needsConfirm(b, sid);
  }

  async run(b: PluginSessionButton): Promise<void> {
    const sid = this.sessionId() || (this.preview() ? PREVIEW_SESSION : null);
    if (!sid || this.busyKey()) return;
    this.busyKey.set(this.key(b));
    const context = {
      sessionId: sid,
      sessionName: this.sessionName(),
      provider: this.provider(),
      status: this.sessionStatus(),
      workspaceName: this.workspaceName(),
      paneAgentId: this.paneAgentId(),
      agents: this.agents().map((a) => ({ id: a.id, name: a.name, slug: agentSlug(a.name), provider: a.provider, status: a.status, isMain: a.isMain })),
      composerText: this.composerText(),
    };
    try {
      const proposal = normalizeSessionAction(await this.runtime.runSessionButton(b.pluginId, b.button.id, context));
      if (!proposal) {
        this.runtime.pushToast(b.pluginName, b.pluginId, `${b.button.title}: the plugin returned nothing PromptOps can use.`);
        return;
      }
      await this.apply(b, sid, proposal);
    } catch (e) {
      this.runtime.pushToast(b.pluginName, b.pluginId, `${b.button.title} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busyKey.set(null);
    }
  }

  private async apply(b: PluginSessionButton, sid: string, p: SessionActionProposal): Promise<void> {
    switch (p.kind) {
      case 'insert': {
        // In the spawn composer: the text goes into the new sub-agent's prompt, launching stays with the user.
        if (this.place() === 'composer' || this.place() === 'runtime') {
          this.insertText.emit(p.text);
          return;
        }
        if (sid === PREVIEW_SESSION) {
          this.runtime.pushToast(b.pluginName, b.pluginId, this.translate.instant('PLUGIN_RUNTIME.Buttons.Preview paste', { text: p.text.slice(0, 160) }));
          return;
        }
        // Pasted into THIS agent's input without submitting. Never inside a permission dialog.
        this.targetId.set(this.paneAgentId());
        if (this.targetBlocked()) {
          this.runtime.pushToast(b.pluginName, b.pluginId, this.translate.instant('PLUGIN_RUNTIME.Buttons.Not pasted'));
          return;
        }
        await this.deliver(sid, p.text, false);
        return;
      }
      case 'spawn':
        if (this.preview()) {
          this.spawnPreview.emit({ prompt: p.prompt, provider: p.provider ?? null, mode: p.mode ?? null, name: p.name ?? null });
          return;
        }
        this.runtime.composerPrefill.set({ seq: Date.now(), prompt: p.prompt, provider: p.provider, mode: p.mode, name: p.name });
        this.runtime.pushToast(b.pluginName, b.pluginId, this.translate.instant('PLUGIN_RUNTIME.Buttons.Spawn ready'));
        return;
      case 'toast':
        this.runtime.pushToast(b.pluginName, b.pluginId, p.message);
        return;
      case 'panel': {
        const shown = new Set(['heading', 'text', 'notice', 'divider', 'output', 'list', 'stats', 'table']);
        this.panelFrom.set(b.pluginName);
        this.panel.set({ view: p.view, hidden: p.view.blocks.filter((x) => !shown.has(x.type)).length });
        return;
      }
      case 'prompt': {
        if (sid === PREVIEW_SESSION) {
          this.runtime.pushToast(b.pluginName, b.pluginId, this.translate.instant('PLUGIN_RUNTIME.Buttons.Preview send', { text: p.text.slice(0, 160) }));
          return;
        }
        this.targetId.set(this.resolveTarget(b, p.target));
        if (!this.runtime.needsConfirm(b, sid)) {
          if (this.targetBlocked()) {
            this.runtime.pushToast(b.pluginName, b.pluginId, this.translate.instant('PLUGIN_RUNTIME.Buttons.Not sent'));
            return;
          }
          await this.deliver(sid, p.text);
          return;
        }
        this.rememberSession.set(false);
        this.pending.set({ button: b, text: p.text, sessionId: sid });
        return;
      }
    }
  }

  /** Recipient suggested by the plugin (id or name), otherwise the agent of this bar. */
  private resolveTarget(_b: PluginSessionButton, target: string | null): string {
    const agents = this.agents();
    if (target) {
      const wanted = agentSlug(target);
      const hit = agents.find((a) => a.id === target || (target === 'main' && a.isMain) || agentSlug(a.name) === wanted);
      if (hit) return hit.id;
    }
    const pane = this.paneAgentId();
    return agents.some((a) => a.id === pane) ? pane : 'main';
  }

  async send(): Promise<void> {
    const p = this.pending();
    if (!p || !this.armed() || this.targetBlocked() || this.sending()) return;
    this.sending.set(true);
    try {
      if (this.rememberSession()) this.runtime.allowForSession(p.button, p.sessionId);
      await this.deliver(p.sessionId, p.text);
      this.pending.set(null);
    } catch (e) {
      this.runtime.pushToast(p.button.pluginName, p.button.pluginId, `Not sent: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.sending.set(false);
    }
  }

  /** Pastes as a single block (bracketed paste) and, if `submit`, submits, like the app's other sends. */
  private async deliver(sessionId: string, text: string, submit = true): Promise<void> {
    const target = this.targetId();
    const pasted = `\x1b[200~${text}\x1b[201~`;
    if (target === 'main') {
      await this.sessions.writeSession(sessionId, pasted);
      if (submit) setTimeout(() => { void this.sessions.writeSession(sessionId, '\r'); }, 120);
    } else {
      await this.subAgents.writeToSubAgent(target, pasted);
      if (submit) setTimeout(() => { void this.subAgents.writeToSubAgent(target, '\r'); }, 120);
    }
  }

  cancel(): void {
    this.pending.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.pending()) this.cancel();
    else if (this.panel()) this.panel.set(null);
    else if (this.menuOpen()) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.enter', ['$event'])
  onEnter(ev: Event): void {
    if (!this.pending()) return;
    ev.preventDefault();
    void this.send();
  }
}
