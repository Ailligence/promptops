import { Component, HostListener, OnInit, computed, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PluginConfirmRequest, PluginRuntimeService } from './plugin-runtime.service';

/**
 * Plugin messages to the user, mounted once in the layout.
 *  - toast: text only, never HTML;
 *  - prompt proposal: the plugin NEVER writes to an agent. The user sees the
 *    text, marked as untrusted content, and decides whether to copy it;
 *  - confirmation: writing a file or starting a prompt on the user's model requires their yes,
 *    with the content shown in full. Esc or no answer count as no.
 * Outside Tauri the runtime does not exist and the component stays empty.
 */
@Component({
  selector: 'app-plugin-runtime-overlay',
  standalone: true,
  imports: [DecimalPipe, TranslateModule],
  template: `
    <div class="pro-toasts">
      @for (t of runtime.toasts(); track t.id) {
        <div class="pro-toast">
          <div class="pro-from">{{ 'PLUGIN_RUNTIME.From' | translate: { name: t.name } }}</div>
          <div>{{ t.message }}</div>
        </div>
      }
    </div>

    @if (confirm(); as c) {
      <div class="pro-backdrop"></div>
      <div class="pro-modal pro-confirm" role="alertdialog" aria-modal="true" aria-labelledby="pro-confirm-title">
        <div class="pro-head">
          <div class="pro-from"><i class="ti ti-puzzle" aria-hidden="true"></i> {{ 'PLUGIN_RUNTIME.From' | translate: { name: c.name } }}</div>
          <div class="fw-semibold" id="pro-confirm-title">{{ titleOf(c) }}</div>
        </div>
        <div class="pro-body">
          @if (c.kind === 'benchmark') {
            <p class="pro-lead">{{ 'PLUGIN_RUNTIME.Overlay.Bench lead' | translate }}</p>
            <div class="pro-facts"><span>{{ 'PLUGIN_RUNTIME.Overlay.Calls total' | translate: { count: c.calls } }}</span><span>{{ 'PLUGIN_RUNTIME.Overlay.Per model' | translate: { count: c.samples } }}</span></div>
            <div class="pro-cap">{{ 'PLUGIN_RUNTIME.Overlay.Models' | translate }}</div>
            <ul class="pro-models">
              @for (m of c.models; track m.id) { <li><span>{{ m.label }}</span><small>{{ m.providerLabel }}</small></li> }
            </ul>
          } @else if (c.kind === 'egress') {
            <p class="pro-lead">{{ (c.repo ? 'PLUGIN_RUNTIME.Overlay.Egress lead read' : 'PLUGIN_RUNTIME.Overlay.Egress lead') | translate: { repo: c.repo, host: c.host } }}</p>
            <div class="pro-facts"><span><strong>{{ c.method }}</strong> https://{{ c.host }}</span><span>{{ 'PLUGIN_RUNTIME.Overlay.Bytes first' | translate: { count: (c.bytes | number) } }}</span></div>
            @if (c.bytes) {
              <div class="pro-cap">{{ 'PLUGIN_RUNTIME.Overlay.First sends' | translate }}@if (c.truncated) { · {{ 'PLUGIN_RUNTIME.Overlay.Beginning' | translate }}}</div>
              <pre class="pro-text">{{ c.content }}</pre>
            }
            <p class="pro-lead pro-after">{{ 'PLUGIN_RUNTIME.Overlay.Egress after' | translate: { host: c.host } }}</p>
          } @else if (c.kind === 'ai') {
            <p class="pro-lead">{{ 'PLUGIN_RUNTIME.Overlay.AI lead' | translate }}</p>
            <div class="pro-facts"><span>{{ 'PLUGIN_RUNTIME.Overlay.Model' | translate: { model: c.model || ('PLUGIN_RUNTIME.Overlay.Your default' | translate) } }}</span><span>{{ 'PLUGIN_RUNTIME.Overlay.Characters' | translate: { count: (c.promptChars | number) } }}</span></div>
            <div class="pro-cap">{{ 'PLUGIN_RUNTIME.Overlay.Everything sent' | translate }}</div>
            <pre class="pro-text">{{ c.prompt }}</pre>
          } @else {
            <p class="pro-lead">{{ 'PLUGIN_RUNTIME.Overlay.Writes' | translate: { path: c.path, repo: c.repo } }}@if (c.exists) { <span class="pro-danger"> {{ 'PLUGIN_RUNTIME.Overlay.Exists' | translate }}</span> }</p>
            <div class="pro-cap">{{ 'PLUGIN_RUNTIME.Overlay.File content' | translate: { count: (c.bytes | number) } }}</div>
            <pre class="pro-text">{{ c.content }}</pre>
          }
        </div>
        <div class="pro-foot">
          @if (waiting() > 1) { <span class="pro-more">{{ 'PLUGIN_RUNTIME.Overlay.More waiting' | translate: { count: waiting() - 1 } }}</span> }
          <button type="button" class="btn btn-light btn-sm" (click)="answer(false)">{{ noOf(c) }}</button>
          <button type="button" class="btn btn-primary btn-sm" [disabled]="!armed()" (click)="answer(true)">{{ yesOf(c) }}</button>
        </div>
      </div>
    }

    @if (runtime.proposal(); as p) {
      <div class="pro-backdrop" (click)="dismiss()"></div>
      <div class="pro-modal" role="dialog" aria-modal="true">
        <div class="pro-head">
          <div class="fw-semibold">{{ p.title || ('PLUGIN_RUNTIME.Overlay.Proposal title' | translate) }}</div>
          <div class="pro-from">{{ 'PLUGIN_RUNTIME.Overlay.From name' | translate: { name: p.name } }}</div>
        </div>
        <div class="pro-body">
          <div class="pro-warn">
            {{ 'PLUGIN_RUNTIME.Overlay.Untrusted' | translate }}
          </div>
          <pre class="pro-text">{{ p.text }}</pre>
        </div>
        <div class="pro-foot">
          <button class="btn btn-light btn-sm" (click)="dismiss()">{{ 'PLUGIN_RUNTIME.Overlay.Dismiss' | translate }}</button>
          <button class="btn btn-primary btn-sm" (click)="copy(p.text)">{{ (copied() ? 'PLUGIN_RUNTIME.Overlay.Copied' : 'PLUGIN_RUNTIME.Overlay.Copy') | translate }}</button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .pro-toasts { position: fixed; right: 16px; bottom: 16px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; max-width: 340px; pointer-events: none; }
    .pro-toast { background: var(--promptops-body-bg); color: var(--promptops-body-color); border: 1px solid var(--promptops-border-color);
      border-left: 3px solid var(--po-accent, #4f46e5); border-radius: 8px; padding: 8px 12px; font-size: .82rem; box-shadow: 0 6px 20px rgba(0,0,0,.18);
      overflow-wrap: anywhere; }
    .pro-from { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; opacity: .65; }
    .pro-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2001; }
    .pro-modal { position: fixed; z-index: 2002; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(620px, calc(100vw - 32px));
      max-height: min(70vh, 640px); display: flex; flex-direction: column; background: var(--promptops-body-bg); color: var(--promptops-body-color);
      border: 1px solid var(--promptops-border-color); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
    .pro-head { padding: 14px 16px 8px; }
    .pro-body { padding: 0 16px; overflow: auto; flex: 1 1 auto; }
    .pro-warn { font-size: .78rem; border: 1px solid var(--po-warning, #d29922); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; }
    .pro-text { font-size: .8rem; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 12px; }
    .pro-foot { padding: 10px 16px; display: flex; justify-content: flex-end; align-items: center; gap: 8px; border-top: 1px solid var(--promptops-border-color); flex: none; }
    .pro-confirm { width: min(720px, calc(100vw - 32px)); max-height: min(80vh, 760px); z-index: 2004; }
    .pro-confirm + .pro-backdrop, .pro-backdrop:has(+ .pro-confirm) { z-index: 2003; }
    .pro-lead { font-size: .84rem; line-height: 1.5; margin: 0 0 10px; }
    .pro-after { margin: 10px 0 6px; color: var(--po-text-secondary, #697089); }
    .pro-danger { color: var(--po-error, #cf222e); font-weight: 600; }
    .pro-facts { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .78rem; opacity: .8; margin-bottom: 10px; }
    .pro-cap { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; opacity: .65; margin-bottom: 4px; }
    .pro-confirm .pro-text { border: 1px solid var(--promptops-border-color); border-radius: 8px; padding: 10px; font-family: var(--po-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: .76rem; }
    .pro-more { margin-right: auto; font-size: .75rem; opacity: .65; }
    .pro-models { list-style: none; margin: 0 0 12px; padding: 0; border: 1px solid var(--promptops-border-color); border-radius: 8px; }
    .pro-models li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 10px; font-size: .82rem; border-top: 1px solid var(--promptops-border-color); }
    .pro-models li:first-child { border-top: 0; }
    .pro-models small { opacity: .65; }
  `],
})
export class PluginRuntimeOverlayComponent implements OnInit {
  readonly runtime = inject(PluginRuntimeService);
  copied = signal(false);
  readonly confirm = computed(() => this.runtime.confirms()[0] ?? null);
  readonly waiting = computed(() => this.runtime.confirms().length);
  /**
   * The yes becomes active shortly after it appears: an Enter typed while writing elsewhere,
   * a moment before the window appeared, must not approve anything.
   */
  readonly armed = signal(false);
  private armTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const id = this.confirm()?.id;
      if (this.armTimer) clearTimeout(this.armTimer);
      this.armed.set(false);
      if (id) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        this.armTimer = setTimeout(() => this.armed.set(true), 700);
      }
    });
  }

  private translate = inject(TranslateService);
  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant('PLUGIN_RUNTIME.Overlay.' + key, params);
  }

  noOf(c: PluginConfirmRequest): string {
    if (c.kind === 'egress') return this.t('No egress');
    return this.t(c.kind === 'write' ? 'No write' : 'No run');
  }

  titleOf(c: PluginConfirmRequest): string {
    if (c.kind === 'egress') return this.t('Title egress', { name: c.name, host: c.host });
    if (c.kind === 'benchmark') return this.t(c.models.length === 1 ? 'Title bench one' : 'Title bench many', { count: c.models.length });
    if (c.kind === 'ai') return this.t('Title ai', { provider: c.provider });
    return this.t(c.exists ? 'Title replace' : 'Title save');
  }

  yesOf(c: PluginConfirmRequest): string {
    if (c.kind === 'egress') return this.t('Yes egress');
    if (c.kind === 'benchmark') return this.t('Yes bench');
    if (c.kind === 'ai') return this.t('Yes ai');
    return this.t(c.exists ? 'Yes replace' : 'Yes save');
  }

  answer(approved: boolean): void {
    const c = this.confirm();
    if (!c || (approved && !this.armed())) return;
    void this.runtime.answerConfirm(c.id, approved);
  }

  @HostListener('document:keydown.enter', ['$event'])
  onEnter(ev: Event): void {
    if (!this.confirm()) return;
    ev.preventDefault();
    this.answer(true);
  }

  ngOnInit(): void {
    this.runtime.start().catch(() => undefined);
  }

  @HostListener('document:keydown.escape')
  dismiss(): void {
    if (this.confirm()) {
      this.answer(false);
      return;
    }
    if (!this.runtime.proposal()) return;
    this.runtime.proposal.set(null);
    this.copied.set(false);
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
