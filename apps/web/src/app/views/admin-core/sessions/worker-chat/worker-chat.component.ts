import {
  AfterViewChecked,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { GoalLoopService, GoalLoopPhase } from '../services/goal-loop.service';

interface WorkerTranscriptItem {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'error' | 'notice';
  text: string;
  toolName?: string;
  at: string;
}

/**
 * Minimal markdown → HTML for assistant prose: bold, inline code, fenced
 * code blocks, headings, bullets. Input is HTML-escaped FIRST, so the
 * output only ever contains tags we generate here (strong/em/code/pre).
 */
function renderMarkdown(src: string): string {
  let s = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Protect fenced code blocks from inline transforms
  const codeBlocks: string[] = [];
  s = s.replace(/```\w*\n?([\s\S]*?)```/g, (_m, code: string) => {
    codeBlocks.push(code.replace(/\n$/, ''));
    return `\u0000${codeBlocks.length - 1}\u0000`;
  });

  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<em>$2</em>');
  s = s.replace(/^#{1,4}\s+(.+)$/gm, '<strong>$1</strong>');
  s = s.replace(/^(\s*)[-*]\s+/gm, '$1• ');

  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<pre>${codeBlocks[+i]}</pre>`);
  return s;
}

/**
 * Chat surface for worker sub-agents (headless runtime). Renders the
 * structured transcript instead of a PTY: user messages, streaming assistant
 * prose, tool calls as compact devtool rows, plus a composer with send/stop.
 * Goodboy-style density: conversation reads as conversation, tool calls read
 * as a devtool.
 */
@Component({
  selector: 'app-worker-chat',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="worker-chat">
      @if (goal(); as g) {
        <div class="wc-goal" [attr.data-phase]="g.phase">
          <div class="wc-goal-row">
            <span class="wc-goal-badge">
              <iconify-icon icon="solar:target-bold-duotone" width="12"></iconify-icon>
              {{ phaseLabel(g.phase) }}
            </span>
            <span class="wc-goal-meta">{{ 'SUBAGENTS.WORKER.Iteration' | translate: { current: g.iteration, max: g.maxIterations } }}</span>
            <span class="wc-goal-meta">{{ 'SUBAGENTS.WORKER.Tokens' | translate: { count: formatTokens(g.totalTokens) } }}</span>
            <span class="wc-goal-progress">{{ g.bestProgress }}%</span>
            @if (g.phase === 'running' || g.phase === 'evaluating') {
              <button class="wc-goal-stop" (click)="stopGoal()">
                <iconify-icon icon="solar:stop-bold" width="10"></iconify-icon>
                {{ 'SUBAGENTS.WORKER.Stop goal' | translate }}
              </button>
            }
          </div>
          <div class="wc-goal-bar">
            <div class="wc-goal-fill" [style.width.%]="g.bestProgress"></div>
          </div>
          @if (g.stopReason) {
            <div class="wc-goal-reason">{{ g.stopReason }}</div>
          } @else if (g.lastVerdict) {
            <div class="wc-goal-feedback" [title]="g.lastVerdict.feedback">{{ g.lastVerdict.feedback }}</div>
          }
        </div>
      }
      <div class="wc-transcript" #scrollArea>
        @if (items().length === 0) {
          <div class="wc-empty">
            <iconify-icon icon="solar:bolt-circle-bold-duotone" width="24"></iconify-icon>
            <span>{{ 'SUBAGENTS.WORKER.Empty' | translate }}</span>
          </div>
        }
        @for (item of items(); track item.id) {
          @switch (item.type) {
            @case ('user') {
              <div class="wc-user">
                <div class="wc-user-bubble">{{ item.text }}</div>
              </div>
            }
            @case ('assistant') {
              <div class="wc-assistant" [innerHTML]="html(item)"></div>
            }
            @case ('tool') {
              <div class="wc-tool">
                <iconify-icon icon="solar:settings-bold" width="11"></iconify-icon>
                <span class="wc-tool-name">{{ item.toolName }}</span>
                @if (item.text) {
                  <span class="wc-tool-detail">{{ item.text }}</span>
                }
              </div>
            }
            @case ('error') {
              <div class="wc-error">
                <iconify-icon icon="solar:danger-triangle-bold" width="12"></iconify-icon>
                {{ item.text }}
              </div>
            }
            @case ('notice') {
              <div class="wc-notice">{{ item.text }}</div>
            }
          }
        }
        @if (running()) {
          <div class="wc-thinking">
            <span class="wc-thinking-dot"></span>
            <span class="wc-thinking-dot"></span>
            <span class="wc-thinking-dot"></span>
          </div>
        }
      </div>

      @if (resumable()) {
        <div class="wc-resume-row">
          <button class="wc-resume" (click)="resume()">
            <iconify-icon icon="solar:play-bold" width="12"></iconify-icon>
            {{ 'SUBAGENTS.WORKER.Resume work' | translate }}
          </button>
        </div>
      }
      @if (sendError()) {
        <div class="wc-send-error">{{ sendError() }}</div>
      }
      <div class="wc-composer">
        <textarea
          #composer
          class="wc-input"
          rows="1"
          [placeholder]="(running() ? 'SUBAGENTS.WORKER.Placeholder running' : 'SUBAGENTS.WORKER.Placeholder') | translate"
          [attr.aria-label]="'SUBAGENTS.WORKER.Placeholder' | translate"
          [disabled]="running()"
          [value]="draft()"
          (input)="draft.set($any($event.target).value)"
          (keydown.enter)="onEnter($event)"
        ></textarea>
        @if (running()) {
          <button class="wc-btn wc-stop" (click)="stop()" [attr.aria-label]="'SUBAGENTS.WORKER.Stop turn' | translate" [title]="'SUBAGENTS.WORKER.Stop turn' | translate">
            <iconify-icon icon="solar:stop-bold" width="14"></iconify-icon>
          </button>
        } @else {
          <button class="wc-btn wc-send" (click)="send()" [disabled]="!draft().trim()" [attr.aria-label]="'SUBAGENTS.WORKER.Send message' | translate" [title]="'SUBAGENTS.WORKER.Send message' | translate">
            <iconify-icon icon="solar:plain-bold" width="14"></iconify-icon>
          </button>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: block; height: 100%; min-height: 0; }

    .worker-chat {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--po-bg-0);
      border-radius: var(--po-radius-lg);
      border: 1px solid var(--po-border-subtle);
      overflow: hidden;
      font-family: var(--po-font-body);
    }

    /* ── Goal HUD (goal-driven workers) ── */
    .wc-goal {
      padding: var(--po-space-1) var(--po-space-3);
      border-bottom: 1px solid var(--po-border-subtle);
      background: var(--po-bg-1);
      --goal-color: var(--po-accent);
    }
    .wc-goal[data-phase='done'] { --goal-color: var(--po-success, #22c55e); }
    .wc-goal[data-phase='stuck'],
    .wc-goal[data-phase='budget'] { --goal-color: var(--po-warning); }
    .wc-goal[data-phase='error'] { --goal-color: var(--po-error); }
    .wc-goal[data-phase='stopped'] { --goal-color: var(--po-text-tertiary); }
    .wc-goal-row {
      display: flex; align-items: center; gap: var(--po-space-2);
      min-width: 0;
    }
    .wc-goal-badge {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 0 var(--po-space-1);
      border-radius: var(--po-radius-pill);
      border: 1px solid var(--goal-color);
      color: var(--goal-color);
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }
    .wc-goal-meta {
      color: var(--po-text-tertiary);
      font-size: var(--po-text-xs);
      font-family: var(--po-font-mono);
      white-space: nowrap;
    }
    .wc-goal-progress {
      margin-inline-start: auto;
      color: var(--goal-color);
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-semibold);
      font-family: var(--po-font-mono);
    }
    .wc-goal-stop {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 0 var(--po-space-1);
      border-radius: var(--po-radius-pill);
      border: 1px solid var(--po-error);
      background: var(--po-error-bg);
      color: var(--po-error);
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-semibold);
      cursor: pointer;
      white-space: nowrap;
    }
    .wc-goal-stop:hover { background: var(--po-error); color: var(--po-accent-on); }
    .wc-goal-bar {
      height: 3px;
      margin-top: 3px;
      border-radius: var(--po-radius-pill);
      background: var(--po-bg-2);
      overflow: hidden;
    }
    .wc-goal-fill {
      height: 100%;
      border-radius: var(--po-radius-pill);
      background: var(--goal-color);
      transition: width var(--po-duration-fast) var(--po-ease-out);
    }
    .wc-goal-feedback,
    .wc-goal-reason {
      margin-top: 2px;
      color: var(--po-text-tertiary);
      font-size: var(--po-text-xs);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .wc-goal-reason { color: var(--goal-color); }

    /* ── Transcript ── */
    .wc-transcript {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: var(--po-space-3) var(--po-space-4);
      display: flex;
      flex-direction: column;
      gap: var(--po-space-2);
    }
    .wc-transcript::-webkit-scrollbar { width: 6px; }
    .wc-transcript::-webkit-scrollbar-thumb {
      background: var(--po-border-subtle);
      border-radius: var(--po-radius-pill);
    }

    .wc-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--po-space-2);
      padding: var(--po-space-6) 0;
      color: var(--po-text-tertiary);
      font-size: var(--po-text-sm);
    }

    /* User message — right-aligned bubble, accent-muted */
    .wc-user { display: flex; justify-content: flex-end; }
    .wc-user-bubble {
      max-width: 85%;
      padding: var(--po-space-1) var(--po-space-3);
      border-radius: var(--po-radius-lg);
      background: var(--po-accent-muted-bg);
      border: 1px solid color-mix(in srgb, var(--po-accent) 25%, transparent);
      color: var(--po-text-primary);
      font-size: var(--po-text-base);
      line-height: var(--po-leading-body);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Assistant prose — comfortable, built for reading */
    .wc-assistant {
      color: var(--po-text-primary);
      font-size: var(--po-text-base);
      line-height: var(--po-leading-loose);
      white-space: pre-wrap;
      word-break: break-word;
    }
    /* Markdown elements generated by renderMarkdown (innerHTML → ng-deep) */
    :host ::ng-deep .wc-assistant strong { font-weight: var(--po-weight-bold); color: var(--po-text-primary); }
    :host ::ng-deep .wc-assistant code {
      font-family: var(--po-font-mono);
      font-size: 0.92em;
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: var(--po-radius-xs);
      padding: 0 4px;
    }
    :host ::ng-deep .wc-assistant pre {
      display: block;
      margin: var(--po-space-1) 0;
      padding: var(--po-space-2);
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: var(--po-radius-md);
      font-family: var(--po-font-mono);
      font-size: var(--po-text-sm);
      line-height: var(--po-leading-body);
      overflow-x: auto;
      white-space: pre;
    }

    .wc-send-error {
      padding: var(--po-space-1) var(--po-space-3);
      background: var(--po-warning-bg);
      color: var(--po-warning);
      font-size: var(--po-text-xs);
      border-top: 1px solid var(--po-border-subtle);
    }

    /* Resume after a stopped/failed turn */
    .wc-resume-row {
      display: flex;
      justify-content: center;
      padding: var(--po-space-1) 0;
      border-top: 1px solid var(--po-border-subtle);
      background: var(--po-bg-1);
    }
    .wc-resume {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-1);
      padding: 2px var(--po-space-3);
      border-radius: var(--po-radius-pill);
      border: 1px solid var(--po-accent);
      background: var(--po-accent-muted-bg);
      color: var(--po-accent);
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-semibold);
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out),
                  color var(--po-duration-fast) var(--po-ease-out);
    }
    .wc-resume:hover { background: var(--po-accent); color: var(--po-accent-on); }

    /* Tool call — cozy devtool row, mono texture */
    .wc-tool {
      display: flex; align-items: baseline; gap: var(--po-space-1);
      padding: 2px var(--po-space-2);
      border-inline-start: 2px solid var(--po-border-subtle);
      color: var(--po-text-tertiary);
      font-size: var(--po-text-xs);
      font-family: var(--po-font-mono);
    }
    .wc-tool iconify-icon { align-self: center; flex-shrink: 0; }
    .wc-tool-name { font-weight: var(--po-weight-semibold); color: var(--po-text-secondary); }
    .wc-tool-detail {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      min-width: 0;
    }

    .wc-error {
      display: flex; align-items: center; gap: var(--po-space-1);
      padding: var(--po-space-1) var(--po-space-2);
      border-radius: var(--po-radius-md);
      background: var(--po-error-bg);
      color: var(--po-error);
      font-size: var(--po-text-sm);
    }

    .wc-notice {
      color: var(--po-text-tertiary);
      font-size: var(--po-text-xs);
      text-align: center;
    }

    /* Streaming indicator */
    .wc-thinking { display: flex; gap: 4px; padding: var(--po-space-1) 0; }
    .wc-thinking-dot {
      width: 5px; height: 5px; border-radius: var(--po-radius-pill);
      background: var(--po-text-tertiary);
    }
    @media (prefers-reduced-motion: no-preference) {
      .wc-thinking-dot { animation: wc-pulse 1.2s var(--po-ease-in-out) infinite; }
      .wc-thinking-dot:nth-child(2) { animation-delay: 0.2s; }
      .wc-thinking-dot:nth-child(3) { animation-delay: 0.4s; }
    }
    @keyframes wc-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

    /* ── Composer ── */
    .wc-composer {
      display: flex; align-items: flex-end; gap: var(--po-space-2);
      padding: var(--po-space-2) var(--po-space-3);
      border-top: 1px solid var(--po-border-subtle);
      background: var(--po-bg-1);
    }
    .wc-input {
      flex: 1;
      resize: none;
      max-height: 120px;
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: var(--po-radius-md);
      color: var(--po-text-primary);
      font-size: var(--po-text-base);
      font-family: var(--po-font-body);
      line-height: var(--po-leading-body);
      padding: var(--po-space-1) var(--po-space-2);
      outline: none;
      transition: border-color var(--po-duration-fast) var(--po-ease-out);
    }
    .wc-input:focus { border-color: var(--po-accent); }
    .wc-input::placeholder { color: var(--po-text-tertiary); }
    .wc-input:disabled { opacity: 0.6; }

    .wc-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; flex-shrink: 0;
      border-radius: var(--po-radius-md);
      border: 1px solid transparent;
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out);
    }
    .wc-send { background: var(--po-accent); color: var(--po-accent-on); }
    .wc-send:hover { background: var(--po-accent-hover); }
    .wc-send:disabled { opacity: 0.35; cursor: default; }
    .wc-stop { background: var(--po-error-bg); color: var(--po-error); border-color: var(--po-error); }
    .wc-stop:hover { background: var(--po-error-bg); opacity: 0.85; }
  `],
})
export class WorkerChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @Input({ required: true }) subAgentId!: string;
  @Input() set status(value: string | undefined) {
    this.running.set(value === 'running' || value === 'in_progress' || value === 'spawning');
  }

  @ViewChild('scrollArea') scrollArea?: ElementRef<HTMLDivElement>;

  private goalService = inject(GoalLoopService);
  private translate = inject(TranslateService);
  /** Goal HUD state — present only for goal-driven workers. */
  goal = computed(() => this.goalService.states()[this.subAgentId]);

  items = signal<WorkerTranscriptItem[]>([]);
  draft = signal('');
  running = signal(false);
  /** Transient feedback when a send is rejected (e.g. turn already running). */
  sendError = signal<string | null>(null);

  /**
   * The last turn ended without a clean finish (stopped, errored, timed out)
   * or the worker was restored idle — offer one-click resume on the same
   * vendor conversation instead of forcing the user to retype.
   */
  resumable = computed(() => {
    if (this.running()) return false;
    const list = this.items();
    const last = list[list.length - 1];
    return !!last && (last.type === 'error' || last.type === 'notice');
  });

  private unsubItem?: () => void;
  private destroyed = false;
  private sendErrorTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldScroll = false;
  private mdCache = new Map<string, { src: string; html: string }>();

  /** Cached markdown rendering — recomputed only when the item text grows. */
  html(item: WorkerTranscriptItem): string {
    const cached = this.mdCache.get(item.id);
    if (cached && cached.src === item.text) return cached.html;
    const rendered = renderMarkdown(item.text);
    this.mdCache.set(item.id, { src: item.text, html: rendered });
    return rendered;
  }

  private get api(): any {
    return (window as any).promptops;
  }

  phaseLabel(phase: GoalLoopPhase): string {
    return this.translate.instant(`SUBAGENTS.WORKER.Phase.${phase}`);
  }

  formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return String(n);
  }

  async stopGoal(): Promise<void> {
    await this.goalService.stop(this.subAgentId);
  }

  async ngOnInit(): Promise<void> {
    // Goal HUD rehydrate — no-op for plain workers.
    void this.goalService.hydrate(this.subAgentId);
    // History first (reopen / late mount), then live stream.
    try {
      const res = await this.api?.getWorkerTranscript?.(this.subAgentId);
      if (res?.ok && Array.isArray(res.items)) {
        this.items.set(res.items);
        this.shouldScroll = true;
      }
    } catch { /* transcript unavailable — stream will fill in */ }

    // Destroyed while the transcript was loading: subscribing now would leak
    // a listener that ngOnDestroy can no longer remove.
    if (this.destroyed) return;
    this.unsubItem = this.api?.onWorkerItem?.((_ev: unknown, data: {
      subAgentId: string;
      item: WorkerTranscriptItem;
      replace: boolean;
    }) => {
      if (data.subAgentId !== this.subAgentId) return;
      this.items.update((list) => {
        if (data.replace) {
          return list.map((i) => (i.id === data.item.id ? data.item : i));
        }
        return [...list, data.item];
      });
      this.shouldScroll = true;
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.unsubItem?.();
    this.unsubItem = undefined;
    if (this.sendErrorTimer) { clearTimeout(this.sendErrorTimer); this.sendErrorTimer = null; }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll && this.scrollArea) {
      this.shouldScroll = false;
      const el = this.scrollArea.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  onEnter(event: Event): void {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey || ke.isComposing) return; // Shift+Enter = newline; IME composition confirms text
    ke.preventDefault();
    this.send();
  }

  async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.running()) return;
    if (await this.sendText(text)) {
      this.draft.set('');
    }
  }

  /** Continue the interrupted work on the same vendor conversation. */
  async resume(): Promise<void> {
    if (this.running()) return;
    await this.sendText(
      'Continue from where you stopped: pick up the interrupted work and finish it. ' +
      'If everything was already completed, summarize the final state instead.',
    );
  }

  private async sendText(text: string): Promise<boolean> {
    let res: { ok?: boolean; error?: string } | undefined;
    try {
      res = await this.api?.sendWorkerMessage?.(this.subAgentId, text);
    } catch (err) {
      res = { ok: false, error: (err as Error)?.message };
    }
    if (res?.ok) {
      // Optimistic — the status push will confirm; closes the double-send window.
      this.running.set(true);
      return true;
    }
    this.showSendError(res?.error || this.translate.instant('SUBAGENTS.WORKER.Message not sent'));
    return false;
  }

  private showSendError(message: string): void {
    if (this.destroyed) return;
    this.sendError.set(message);
    if (this.sendErrorTimer) clearTimeout(this.sendErrorTimer);
    this.sendErrorTimer = setTimeout(() => { this.sendErrorTimer = null; this.sendError.set(null); }, 3000);
  }

  async stop(): Promise<void> {
    try {
      await this.api?.cancelWorkerTurn?.(this.subAgentId);
    } catch (err) {
      this.showSendError((err as Error)?.message || this.translate.instant('SUBAGENTS.WORKER.Stop failed'));
    }
  }
}
