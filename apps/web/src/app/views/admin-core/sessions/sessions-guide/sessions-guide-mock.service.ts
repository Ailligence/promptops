import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const MOCK_ID = 'sessions-guide-mock';

/** The mock markup goes through innerHTML: every translated string is escaped first. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds and choreographs a self-contained MOCK session used only by the
 * Sessions First-Run Guide. Dedicated (not the global tutorial's mock) so the
 * guide can drive a precise, animated demo:
 *
 *   step 0  new-workspace button (empty state)
 *   step 1  workspace opened (header)
 *   step 2  main session terminal
 *   step 3  spawn composer — animated typing into a real-looking input
 *   step 4  sub-agents — 3 terminal columns streaming in parallel
 *
 * All DOM is plain markup with inline styles; everything is torn down on cleanup.
 */
@Injectable({ providedIn: 'root' })
export class SessionsGuideMockService {
  private root: HTMLElement | null = null;
  private hidden: HTMLElement[] = [];
  private timers: ReturnType<typeof setInterval | typeof setTimeout>[] = [];
  private restorePosition: HTMLElement | null = null;
  private typingActive = false;
  private streaming = false;

  private readonly translate = inject(TranslateService);

  /** Demo task typed into the composer (input.value: plain text, no escaping needed). */
  private get PROMPT(): string {
    return this.tr('Prompt');
  }

  /** Translated mock label, raw (callers escape it before it reaches innerHTML). */
  private tr(key: string): string {
    return String(this.translate.instant('SESSIONS_GUIDE.mock.' + key) ?? '');
  }

  /** Escaped translation of any full key, safe to interpolate into the markup. */
  private x(fullKey: string): string {
    return escapeHtml(this.translate.instant(fullKey));
  }

  inject(): void {
    if (this.root) return;
    const host =
      document.querySelector('.sessions-main') ||
      document.querySelector('.sessions-page') ||
      document.querySelector('.po-main');
    if (!host) return;

    // Hide the real welcome/empty placeholder so the mock isn't stacked under it.
    document.querySelectorAll('.welcome-main, .empty-main').forEach(el => {
      (el as HTMLElement).style.display = 'none';
      el.setAttribute('data-sg-hidden', 'true');
      this.hidden.push(el as HTMLElement);
    });
    // Real sessions open (guide replayed from the app tour): cover them instead
    // of hiding them, so live terminals never get resized to zero.
    const hasContent = !!host.querySelector('.main-pane, .terminal-area');

    const wrap = document.createElement('div');
    wrap.id = MOCK_ID;
    wrap.style.cssText = hasContent
      ? 'position:absolute; inset:0; z-index:50; display:flex; flex-direction:column; overflow:hidden; background:var(--bs-body-bg, #fff);'
      : 'flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden;';
    if (hasContent && getComputedStyle(host).position === 'static') {
      (host as HTMLElement).style.position = 'relative';
      this.restorePosition = host as HTMLElement;
    }
    wrap.innerHTML = this.html();
    host.appendChild(wrap);
    this.root = wrap;
    this.applyStep(0);
  }

  cleanup(): void {
    this.clearTimers();
    this.typingActive = false;
    this.streaming = false;
    if (this.root) { this.root.remove(); this.root = null; }
    if (this.restorePosition) { this.restorePosition.style.position = ''; this.restorePosition = null; }
    this.hidden.forEach(el => { el.style.display = ''; el.removeAttribute('data-sg-hidden'); });
    this.hidden = [];
  }

  /** Deterministically set the mock to the phase matching the given step. */
  applyStep(idx: number): void {
    if (!this.root) return;
    const empty = this.q('.sg-mock-empty');
    const session = this.q('.sg-mock-session');
    const agents = this.q('.sg-mock-agents');
    const input = this.q<HTMLTextAreaElement>('.sg-mock-input');

    // Phase: empty (step 0) vs session open (>=1)
    if (empty) empty.style.display = idx === 0 ? 'flex' : 'none';
    if (session) session.style.display = idx >= 1 ? 'flex' : 'none';

    // Sub-agents columns appear only at the last step
    this.clearTimers();
    this.streaming = false;
    if (agents) {
      agents.style.display = idx >= 4 ? 'grid' : 'none';
      if (idx >= 4) this.startStreaming();
    }

    // Composer input: typed only from the spawn step onward
    if (input) {
      this.typingActive = false;
      if (idx === 3) {
        input.value = '';
        this.typePrompt(input);
      } else {
        input.value = idx > 3 ? this.PROMPT : '';
      }
    }
  }

  // ---- choreography ----------------------------------------------------------

  private typePrompt(input: HTMLTextAreaElement): void {
    this.typingActive = true;
    const prompt = this.PROMPT;
    let i = 0;
    const tick = () => {
      if (!this.typingActive || !this.root) return;
      input.value = prompt.slice(0, i);
      i++;
      if (i <= prompt.length) {
        this.timers.push(setTimeout(tick, 45));
      }
    };
    this.timers.push(setTimeout(tick, 250));
  }

  private startStreaming(): void {
    if (this.streaming) return;
    this.streaming = true;
    const cols = [
      { sel: '.sg-col-0 .sg-col-body', lines: [
        'scanning src/auth/…', 'found 7 files', 'reading auth.service.ts',
        'mapping dependencies', 'auth.guard.ts ✓', 'building call graph', 'done — 7 files indexed',
      ] },
      { sel: '.sg-col-1 .sg-col-body', lines: [
        'reading diff…', 'check auth.service.ts', '⚠ null deref @ line 88',
        'suggest guard clause', 'check token refresh', 'no leaks found', '2 issues, 1 fix',
      ] },
      { sel: '.sg-col-2 .sg-col-body', lines: [
        'generating tests…', 'auth.spec.ts created', 'refresh.spec.ts created',
        'running suite', '✓ 14 passing', '✓ coverage 92%', 'tests green',
      ] },
    ];
    cols.forEach((col, c) => {
      const body = this.q(col.sel);
      if (!body) return;
      body.innerHTML = '';
      let n = 0;
      const push = () => {
        if (!this.streaming || !this.root) return;
        const line = document.createElement('div');
        line.textContent = '› ' + col.lines[n % col.lines.length];
        line.style.cssText = 'opacity:0; animation:sgLineIn .25s forwards;';
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
        while (body.childElementCount > 6) body.removeChild(body.firstChild!);
        n++;
        this.timers.push(setTimeout(push, 520 + c * 130));
      };
      this.timers.push(setTimeout(push, 200 + c * 160));
    });
  }

  private clearTimers(): void {
    this.timers.forEach(t => { clearTimeout(t as number); clearInterval(t as number); });
    this.timers = [];
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T | null {
    return this.root ? this.root.querySelector<T>(sel) : null;
  }

  // ---- markup ----------------------------------------------------------------

  html(): string {
    const border = 'var(--bs-border-color)';
    const muted = 'var(--bs-secondary-color)';
    return `
      <style>
        @keyframes sgLineIn { from { opacity:0; transform:translateY(3px);} to { opacity:1; transform:none; } }
        @keyframes sgBlink { 50% { opacity:0; } }
        @keyframes sgPulseBtn { 0%,100%{ box-shadow:0 0 0 0 rgba(99,102,241,.5);} 50%{ box-shadow:0 0 0 10px rgba(99,102,241,0);} }
      </style>

      <!-- PHASE: empty (no workspace yet) -->
      <div class="sg-mock-empty" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px;">
        <div style="font-size:38px;">📁</div>
        <div style="font-size:0.95rem; color:${muted}; text-align:center; max-width:320px;">${this.x('SESSIONS_GUIDE.mock.Empty')}</div>
        <button class="sg-mock-new-workspace" style="display:inline-flex; align-items:center; gap:8px; padding:10px 18px; border:none; border-radius:10px; background:linear-gradient(135deg,var(--po-accent),var(--po-accent)); color:#fff; font-weight:700; font-size:0.9rem; cursor:default; animation:sgPulseBtn 1.8s infinite;">
          <i class="ti ti-folder-plus"></i> ${this.x('SESSIONS.New workspace')}
        </button>
      </div>

      <!-- PHASE: session open -->
      <div class="sg-mock-session" style="flex:1; display:none; flex-direction:column; min-height:0; overflow:hidden;">
        <!-- header -->
        <div style="display:flex; align-items:center; gap:10px; padding:8px 14px; border-bottom:1px solid ${border}; flex-shrink:0;">
          <div style="width:26px; height:26px; border-radius:7px; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,var(--po-accent),var(--po-accent)); color:#fff;"><i class="ti ti-wand"></i></div>
          <span class="sg-mock-workspace" style="display:inline-flex; align-items:center; gap:5px; font-size:0.8rem; color:${muted};">
            <i class="ti ti-folder" style="font-size:14px;"></i> ~/projects/my-app
          </span>
          <span style="width:8px; height:8px; border-radius:50%; background:#22c55e;"></span>
          <span style="font-size:0.72rem; font-weight:600; color:#22c55e;">${this.x('SESSIONS_GUIDE.mock.Running')}</span>
        </div>

        <!-- body: main + sub-agents + composer -->
        <div style="flex:1; display:flex; min-height:0; overflow:hidden;">
          <div style="flex:1; display:flex; flex-direction:column; min-width:0;">
            <!-- main session terminal -->
            <div class="sg-mock-main" style="flex:1; min-height:0; background:var(--po-terminal-bg); margin:8px; border-radius:8px; padding:14px; font-family:'Fira Code',monospace; font-size:0.78rem; line-height:1.7; color:#c9d1d9; overflow:auto;">
              <div style="color:var(--po-accent); font-weight:600;">$ claude</div>
              <div style="color:#8b949e;">${this.x('SESSIONS_GUIDE.mock.Control room')}</div>
              <div style="margin-top:10px; color:var(--po-info);">&gt; ${this.x('SESSIONS_GUIDE.mock.User line')}</div>
              <div style="margin-top:6px;">${this.x('SESSIONS_GUIDE.mock.Assistant line')}</div>
              <div style="margin-top:10px; color:var(--po-info);">&gt; <span style="display:inline-block; width:7px; height:15px; background:var(--po-info); animation:sgBlink 1s step-end infinite;"></span></div>
            </div>

            <!-- sub-agents: 3 terminal columns -->
            <div class="sg-mock-agents" style="display:none; grid-template-columns:1fr 1fr 1fr; gap:8px; margin:0 8px 8px; flex-shrink:0;">
              ${this.col(0, this.tr('File Search'), '#bc8cff')}
              ${this.col(1, this.tr('Code Review'), '#58a6ff')}
              ${this.col(2, this.tr('Test Writer'), '#3fb950')}
            </div>
          </div>

          <!-- action center / spawn composer -->
          <div style="width:260px; flex-shrink:0; border-inline-start:1px solid ${border}; display:flex; flex-direction:column; padding:12px;">
            <div style="font-size:0.78rem; font-weight:700; display:flex; align-items:center; gap:6px; margin-bottom:10px;">
              <i class="ti ti-cpu"></i> ${this.x('SESSIONS_GUIDE.spawn.title')}
            </div>
            <div class="sg-mock-composer" style="border:1px solid ${border}; border-radius:10px; padding:8px; background:var(--bs-body-bg);">
              <textarea class="sg-mock-input" rows="3" readonly placeholder="${this.x('SESSIONS_GUIDE.mock.Placeholder')}" style="width:100%; border:none; outline:none; resize:none; background:transparent; color:var(--bs-body-color); font-size:0.8rem; font-family:inherit;"></textarea>
              <div style="display:flex; justify-content:flex-end; margin-top:6px;">
                <button class="sg-mock-spawn" style="display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border:none; border-radius:8px; background:var(--po-accent); color:#fff; font-weight:600; font-size:0.78rem; cursor:default;">
                  <i class="ti ti-player-play" style="font-size:13px;"></i> ${this.x('SESSIONS.Spawn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private col(i: number, name: string, color: string): string {
    return `
      <div class="sg-col-${i}" style="border:1px solid var(--bs-border-color); border-radius:8px; overflow:hidden; display:flex; flex-direction:column; height:128px;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:5px 9px; background:var(--bs-tertiary-bg); font-size:0.72rem; font-weight:600;">
          <span style="display:inline-flex; align-items:center; gap:5px; color:${color};"><i class="ti ti-cpu" style="font-size:12px;"></i> ${escapeHtml(name)}</span>
          <span style="font-size:0.62rem; color:#22c55e;">● ${this.x('SESSIONS_GUIDE.mock.Running')}</span>
        </div>
        <div class="sg-col-body" style="flex:1; background:var(--po-terminal-bg); padding:7px 9px; font-family:'Fira Code',monospace; font-size:0.66rem; line-height:1.55; color:#8b949e; overflow:hidden;"></div>
      </div>
    `;
  }
}
