import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { attachUnicode11, attachWebglRenderer } from '../../../../core/helper/xterm-renderer';
import { SshService, SshConnectionPublic, SshTarget } from '../services/ssh.service';
import { openTerminalLink } from '@core/helper/terminal-link-handler';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

/**
 * Interactive SSH terminal — opens an SSH shell in the desktop process and
 * pipes I/O through an xterm.js instance.
 */
@Component({
  selector: 'app-ssh-terminal',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="ssh-term">
      <div class="ssh-term-head">
        <span class="ssh-term-title">
          <iconify-icon icon="solar:server-square-bold-duotone" width="13"></iconify-icon>
          {{ connection.username }}&#64;{{ connection.host }}
          @if (status() === 'connecting') {
            <span class="ssh-term-dot connecting"></span>
          } @else if (status() === 'connected') {
            <span class="ssh-term-dot connected"></span>
          } @else if (status() === 'closed') {
            <span class="ssh-term-dot closed"></span>
          } @else if (status() === 'error') {
            <span class="ssh-term-dot error"></span>
          }
        </span>
        <div class="ssh-term-actions">
          <button class="btn-ssh-term" (click)="reconnect()" [title]="'SSH.Reconnect' | translate" [attr.aria-label]="'SSH.Reconnect' | translate" [disabled]="status() === 'connecting'">
            <iconify-icon icon="solar:refresh-bold" width="12"></iconify-icon>
          </button>
          <button class="btn-ssh-term close" (click)="close()" [title]="'BUTTONS.Close' | translate" [attr.aria-label]="'BUTTONS.Close' | translate">
            <iconify-icon icon="solar:close-circle-bold" width="12"></iconify-icon>
          </button>
        </div>
      </div>
      @if (errorMsg()) {
        <div class="ssh-term-error">{{ errorMsg() }}</div>
      }
      <div class="ssh-term-body" #termHost></div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .ssh-term {
      border: 1px solid var(--bs-border-color);
      border-radius: 6px;
      overflow: hidden;
      background: #0b0d12;
    }
    .ssh-term-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 4px 8px; background: var(--bs-tertiary-bg);
      font-size: 11px; font-weight: 600;
    }
    .ssh-term-title { display: inline-flex; gap: 5px; align-items: center; }
    .ssh-term-dot {
      width: 7px; height: 7px; border-radius: 50%; margin-left: 4px;
    }
    .ssh-term-dot.connecting { background: #eab308; animation: ssh-pulse 1s ease-in-out infinite; }
    .ssh-term-dot.connected { background: #22c55e; }
    .ssh-term-dot.closed { background: #9ca3af; }
    .ssh-term-dot.error { background: #ef4444; }
    @keyframes ssh-pulse { 50% { opacity: 0.4; } }
    .btn-ssh-term {
      border: 0; background: transparent; padding: 2px 4px; border-radius: 4px;
      color: var(--bs-body-color); cursor: pointer;
    }
    .btn-ssh-term:hover { background: var(--bs-body-bg); }
    .btn-ssh-term.close:hover { color: var(--bs-danger); }
    .ssh-term-error { padding: 4px 8px; font-size: 10.5px; color: #ef4444; background: rgba(239,68,68,0.1); }
    .ssh-term-body { height: 280px; padding: 4px; }
  `],
})
export class SshTerminalComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) connection!: SshConnectionPublic;
  @Input({ required: true }) uid!: string;
  @Output() closed = new EventEmitter<void>();

  @ViewChild('termHost', { static: false }) termHost?: ElementRef<HTMLDivElement>;

  readonly status = signal<'idle' | 'connecting' | 'connected' | 'closed' | 'error'>('idle');
  readonly errorMsg = signal<string | null>(null);

  private ssh = inject(SshService);
  private translate = inject(TranslateService);
  private xterm: Terminal | null = null;
  private fit: FitAddon | null = null;
  private sshSessionId: string | null = null;
  /** Sessions this terminal closed: their late events are ignored. */
  private readonly retiredSessions = new Set<string>();
  private unsubOutput: (() => void) | null = null;
  private unsubClosed: (() => void) | null = null;
  private unsubError: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  async ngAfterViewInit(): Promise<void> {
    if (!this.termHost) return;
    this.initXterm();
    await this.connect();
  }

  private initXterm(): void {
    if (!this.termHost) return;
    this.xterm = new Terminal({
      fontFamily: 'ui-monospace, Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: { background: '#0b0d12' },
      convertEol: true,
    });
    this.fit = new FitAddon();
    this.xterm.loadAddon(this.fit);
    attachUnicode11(this.xterm);
    this.xterm.loadAddon(new WebLinksAddon(openTerminalLink));
    this.xterm.open(this.termHost.nativeElement);
    attachWebglRenderer(this.xterm);

    requestAnimationFrame(() => {
      try { this.fit?.fit(); } catch { /* noop */ }
    });

    this.xterm.onData((data) => {
      if (!this.sshSessionId) return;
      this.ssh.write(this.sshSessionId, data);
    });

    this.xterm.onResize(({ cols, rows }) => {
      if (!this.sshSessionId) return;
      this.ssh.resize(this.sshSessionId, cols, rows);
    });

    this.resizeObserver = new ResizeObserver(() => {
      try { this.fit?.fit(); } catch { /* noop */ }
    });
    this.resizeObserver.observe(this.termHost.nativeElement);
  }

  private async connect(): Promise<void> {
    if (!this.xterm) return;
    this.status.set('connecting');
    this.errorMsg.set(null);

    const cols = this.xterm.cols;
    const rows = this.xterm.rows;

    // Listen BEFORE spawning: the server's banner and first prompt arrive
    // while the spawn call is still returning. Events are matched on this
    // terminal's own target id, known up front.
    // A reconnect reuses the target id: events of the session it replaced
    // (its late "closed", for one) are told apart by their session id.
    const mine = (evt: { sessionId: string; target?: SshTarget }) =>
      evt.target?.kind === 'terminal' &&
      evt.target.terminalId === this.uid &&
      !this.retiredSessions.has(evt.sessionId) &&
      (!this.sshSessionId || evt.sessionId === this.sshSessionId);
    this.unsubOutput = this.ssh.onOutput((evt) => {
      if (!mine(evt)) return;
      this.xterm?.write(evt.data);
    });
    this.unsubClosed = this.ssh.onClosed((evt) => {
      if (!mine(evt)) return;
      this.status.set('closed');
      this.xterm?.write('\r\n\x1b[33m[connection closed]\x1b[0m\r\n');
    });
    this.unsubError = this.ssh.onError((evt) => {
      if (!mine(evt)) return;
      this.status.set('error');
      this.errorMsg.set(evt.error);
    });

    const res = await this.ssh.spawn({
      connId: this.connection.id,
      target: { kind: 'terminal', terminalId: this.uid },
      cols,
      rows,
    });

    if (!res.ok || !res.sessionId) {
      this.status.set('error');
      this.errorMsg.set(res.error ?? this.translate.instant('SSH.Connection failed'));
      return;
    }

    this.sshSessionId = res.sessionId;
    if (this.status() === 'connecting') this.status.set('connected');
  }

  async reconnect(): Promise<void> {
    await this.teardownSession();
    this.xterm?.reset();
    await this.connect();
  }

  async close(): Promise<void> {
    await this.teardownSession();
    this.closed.emit();
  }

  private async teardownSession(): Promise<void> {
    this.unsubOutput?.(); this.unsubOutput = null;
    this.unsubClosed?.(); this.unsubClosed = null;
    this.unsubError?.(); this.unsubError = null;
    if (this.sshSessionId) {
      this.retiredSessions.add(this.sshSessionId);
      try { await this.ssh.close(this.sshSessionId); } catch { /* noop */ }
      this.sshSessionId = null;
    }
  }

  async ngOnDestroy(): Promise<void> {
    await this.teardownSession();
    this.resizeObserver?.disconnect();
    this.xterm?.dispose();
    this.xterm = null;
  }
}
