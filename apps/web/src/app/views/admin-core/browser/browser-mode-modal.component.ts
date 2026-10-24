import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SessionTerminalComponent } from '../sessions/session-terminal/session-terminal.component';
import { SubAgentTerminalComponent } from '../sessions/sub-agent-terminal/sub-agent-terminal.component';
import { SessionService } from '../sessions/services/session.service';
import { SubAgentService } from '../sessions/services/sub-agent.service';
import { ChromeMirrorComponent } from './chrome-mirror.component';
import { BrowserAgentService, BrowserProvider } from './browser.service';

/**
 * Kick-off prompt typed into the agent when Browser mode opens: the agent
 * must answer the hand-shake question (`BROWSER_PAGE.Handshake`, in the
 * user's language) with a short proposal, then wait.
 */
export const browserModeKickoff = (handshake: string): string =>
  'Browser mode is on: from now on use your Chrome browser tools (Claude in Chrome extension or the Chrome DevTools MCP) on the Chrome tab currently open (Google). ' +
  'If the browser tools are not available in this session, say so in one line and tell me to run /chrome and enable Chrome by default. ' +
  `Otherwise reply now with exactly "${handshake}" followed by 2-3 short, concrete proposals (in the user\'s language) of what to open or do in the browser for the current task, then wait for my request.`;

/**
 * Full-screen "Browser mode" for one agent: its terminal on the left, the
 * real Chrome tab mirrored on the right, plus a prompt bar. Opened from the
 * Chrome button in the terminal toolbar (left of Auto-Approve).
 */
@Component({
  selector: 'app-browser-mode-modal',
  standalone: true,
  imports: [TranslateModule, SessionTerminalComponent, SubAgentTerminalComponent, ChromeMirrorComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA], // <iconify-icon>
  templateUrl: './browser-mode-modal.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './browser-mode-modal.component.scss',
})
export class BrowserModeModalComponent implements OnInit {
  readonly svc = inject(BrowserAgentService);
  private readonly sessionService = inject(SessionService);
  private readonly subAgentService = inject(SubAgentService);
  private readonly activeModal = inject(NgbActiveModal);
  private readonly translate = inject(TranslateService);
  /** Hand-shake question the agent is asked to answer (user's language). */
  readonly handshake = this.translate.instant('BROWSER_PAGE.Handshake') as string;

  /** Session-backed terminal (main pane / promoted sub-agent). */
  @Input() sessionId: string | null = null;
  /** PTY sub-agent terminal (when not session-backed). */
  @Input() subAgentId: string | null = null;
  @Input() workspacePath: string | null = null;
  @Input() title = 'Agent';
  @Input() providerLabel = 'Claude Code';
  @Input() providerId: BrowserProvider = 'claude-code-cli';
  /** Type the kick-off prompt (hand-shake question) when the modal opens. */
  @Input() kickoff = true;

  readonly connecting = signal(false);
  readonly kickoffSent = signal(false);

  ngOnInit(): void {
    void this.boot();
  }

  /** Chrome up first (Google), then the kick-off prompt lands in the CLI. */
  private async boot(): Promise<void> {
    void this.svc.runProbe(this.providerId);
    this.connecting.set(true);
    try {
      await this.svc.ensureChrome();
    } finally {
      this.connecting.set(false);
    }
    if (this.kickoff) {
      await this.sleep(300);
      await this.write(browserModeKickoff(this.handshake));
      this.kickoffSent.set(true);
    }
  }

  close(): void { this.activeModal.dismiss('user'); }

  /** Writes text + Enter into whichever terminal backs this agent. */
  private async write(text: string): Promise<void> {
    if (this.sessionId) {
      await this.sessionService.writeSession(this.sessionId, text);
      await this.sleep(120);
      await this.sessionService.writeSession(this.sessionId, '\r');
    } else if (this.subAgentId) {
      await this.subAgentService.writeToSubAgent(this.subAgentId, text);
      await this.sleep(120);
      await this.subAgentService.writeToSubAgent(this.subAgentId, '\r');
    }
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
}
