import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TerminalManagerService } from '../terminal/services/terminal-manager.service';
import { TerminalInstanceComponent } from '../terminal/terminal-instance/terminal-instance.component';
import { TerminalBootLoaderComponent } from '../terminal/terminal-boot-loader.component';
import { ChromeMirrorComponent } from './chrome-mirror.component';
import { browserKickoff, BROWSER_PROVIDERS, BrowserAgentService, BrowserProvider, ChromeProfileHit, launchFor, MCP_PREWARM_CMD } from './browser.service';

/** Terminal bucket of the Browser page (one shell shared across visits). */
const BROWSER_TERMINAL_SESSION = 'browser-agent';
/** Max wait for the shell prompt before the CLI is typed anyway (PowerShell/cmd never signal it). */
const SHELL_READY_TIMEOUT_MS = 4000;
/** Max wait for the CLI TUI (banner) before giving up on the browser-mode preamble (npx download + MCP boot on first run). */
const CLI_READY_TIMEOUT_MS = 45000;
/** Settle time after the banner: the TUI must own stdin (raw mode) before a long paste. */
const CLI_SETTLE_MS = 1500;
/**
 * Shell prompt ready: zle/readline/fish enable bracketed paste at every
 * prompt. (A bare trailing ">" would also match Claude's own input box while
 * it is still exiting on Ctrl+C, so no prompt-char fallback.)
 */
const SHELL_PROMPT_RE = /\x1b\[\?2004h/;
/** Provider TUI banner (typed command echo is lowercase, so it never matches). */
const CLI_READY_RE: Record<BrowserProvider, RegExp> = {
  'claude-code-cli': /Claude Code|Welcome to Claude|for shortcuts|\/help for help|shift\+tab to cycle/,
  codex: /OpenAI Codex|Codex \(v|Codex v/,
};

/**
 * Browser page — 50% terminal (Claude Code / Codex with browser tools),
 * 50% live mirror of the REAL Chrome tab the agent is working on.
 *
 * The CLI is the only input: the agent Chrome (Google as default page) is
 * brought up first, then the provider CLI starts already connected to it, and
 * the user types requests straight into the terminal.
 */
@Component({
  selector: 'app-browser-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, TerminalInstanceComponent, TerminalBootLoaderComponent, ChromeMirrorComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA], // <iconify-icon>
  templateUrl: './browser.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './browser.component.scss',
})
export class BrowserPageComponent implements OnInit, OnDestroy {
  readonly svc = inject(BrowserAgentService);
  private readonly terminals = inject(TerminalManagerService);
  private readonly translate = inject(TranslateService);

  @ViewChild(ChromeMirrorComponent) mirror?: ChromeMirrorComponent;

  readonly providers = BROWSER_PROVIDERS;
  readonly provider = signal<BrowserProvider>('claude-code-cli');
  readonly providerDef = computed(() => this.providers.find((p) => p.id === this.provider())!);
  /** Editable launch command (defaults per provider, user can tweak flags). */
  readonly launchCmd = signal(launchFor(this.providers[0], this.svc.chromeMode()));
  /** CLI of the selected provider is running in the terminal. */
  readonly cliStarted = computed(() => this.svc.runningProvider() === this.provider());
  /** Bringing Chrome up before the CLI starts. */
  readonly connecting = signal(false);

  // ── Terminal (left pane) ─────────────────────────────────────────
  readonly terminalId = signal<string | null>(null);
  /** The CLI is starting: the startup veil stays until its banner (or the timeout). */
  readonly cliBooting = signal(false);
  readonly terminalError = signal<string | null>(null);

  // ── Chrome (shared status) ───────────────────────────────────────
  readonly status = this.svc.status;
  readonly targets = computed(() => this.status()?.targets ?? []);
  readonly error = signal<string | null>(null);

  // ── Setup guide / integration checks ─────────────────────────────
  readonly probe = this.svc.probe;
  readonly probing = this.svc.probing;
  readonly importing = this.svc.importing;
  readonly guideOpen = signal<boolean | null>(null); // null = auto (open while something is missing)
  readonly chromeMode = this.svc.chromeMode;
  readonly ownChrome = computed(() => this.chromeMode() === 'own');
  readonly cliOk = computed(() => !!this.probe()?.cliInstalled);
  /** "My Chrome" mode needs no debug port: the mirror is off by choice. */
  readonly chromeOk = computed(() => this.ownChrome() || !!this.status()?.reachable);
  /**
   * Mirror mode: the bundled DevTools MCP is enough. "My Chrome": the
   * extension in the normal Chrome (or a configured MCP) counts.
   */
  readonly integrationOk = computed(() => {
    const p = this.probe();
    if (!p) return false;
    if (!this.ownChrome()) return !!p.bundledMcpPath || p.mcpConfigured;
    if (p.extension || p.mcpConfigured) return true;
    return p.extensionElsewhere.length > 0;
  });
  readonly allOk = computed(() => this.cliOk() && this.chromeOk() && this.integrationOk());
  readonly showGuide = computed(() => this.guideOpen() ?? (!!this.probe() && !this.allOk()));
  readonly copied = signal<string | null>(null);

  // ─────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    if (!this.svc.isDesktop()) return;
    this.terminals.init();
    void this.boot();
    void this.runProbe();
  }

  /** Chrome first (Google), then the CLI — so it opens already connected. */
  private async boot(): Promise<void> {
    if (!this.ownChrome()) {
      this.connecting.set(true);
      try {
        await this.svc.ensureChrome();
      } finally {
        this.connecting.set(false);
      }
    }
    await this.ensureTerminal();
  }

  /** Work with the normal Chrome window (extension already there), no mirror. */
  async useOwnChrome(): Promise<void> {
    if (this.ownChrome()) return;
    this.svc.setChromeMode('own');
    this.guideOpen.set(null);
    // Different launch flags per mode → the CLI restarts.
    this.launchCmd.set(launchFor(this.providerDef(), 'own'));
    if (this.terminalId()) await this.startCli();
  }

  /** Back to the dedicated agent profile with the live mirror. */
  async useAgentChrome(): Promise<void> {
    if (!this.ownChrome()) return;
    this.svc.setChromeMode('agent');
    this.guideOpen.set(null);
    this.launchCmd.set(launchFor(this.providerDef(), 'agent'));
    await this.svc.ensureChrome();
    await this.runProbe();
    if (this.terminalId()) await this.startCli();
  }

  ngOnDestroy(): void {
    // The PTY stays alive in TerminalManagerService: coming back re-attaches
    // with replay, and the CLI keeps running (same contract as session terminals).
  }

  // ─────────────────────────────────────────────────────────────────
  // Provider + prompt bar
  // ─────────────────────────────────────────────────────────────────

  /** Quick provider switch: the terminal restarts with the new CLI right away. */
  pickProvider(id: BrowserProvider): void {
    if (this.provider() === id) return;
    this.provider.set(id);
    this.launchCmd.set(launchFor(this.providers.find((p) => p.id === id)!, this.svc.chromeMode()));
    this.guideOpen.set(null);
    void this.runProbe();
    if (this.terminalId()) void this.startCli();
  }

  private async ensureTerminal(): Promise<void> {
    const existing = this.terminals.activeIdForSession(BROWSER_TERMINAL_SESSION);
    if (existing) { this.terminalId.set(existing); return; }
    try {
      // Dedicated folder, already trusted for the CLI: no "Do you trust…" dialog.
      const cwd = await this.svc.terminalCwd(this.provider()).catch(() => undefined);
      const id = await this.terminals.create({ sessionId: BROWSER_TERMINAL_SESSION, cwd });
      this.terminalId.set(id);
      this.svc.runningProvider.set(null);
      // Fresh shell → the provider CLI starts by itself (no click needed),
      // but only once the prompt is there: typed earlier, the lines are
      // echoed raw by the tty and run out of order.
      await this.waitForOutput(id, SHELL_PROMPT_RE, SHELL_READY_TIMEOUT_MS);
      await this.startCli();
    } catch (e: any) {
      this.terminalError.set(e?.message ?? String(e));
    }
  }

  /** Starts (or restarts) the provider CLI in the terminal. */
  async startCli(): Promise<void> {
    const id = this.terminalId();
    if (!id) return;
    if (!this.ownChrome() && !this.svc.status()?.reachable) await this.svc.ensureChrome();
    // Provider switch: trust the folder for the new CLI too.
    await this.svc.terminalCwd(this.provider()).catch(() => undefined);
    if (this.svc.runningProvider()) {
      // Ctrl+C twice leaves any TUI, then wait for the shell prompt to come back.
      const back = this.waitForOutput(id, SHELL_PROMPT_RE, SHELL_READY_TIMEOUT_MS);
      this.terminals.write(id, '\x03');
      await this.sleep(150);
      this.terminals.write(id, '\x03');
      await back;
    }
    let cmd = this.launchCmd().trim();
    if (!this.ownChrome() && !this.svc.mcpWarmed()) {
      // First mirror launch: warm the npx cache so the MCP server boots within
      // Claude's startup timeout. Same line → sequential by the shell itself.
      this.svc.mcpWarmed.set(true);
      cmd = `${MCP_PREWARM_CMD}; ${cmd}`;
    }
    const launched = this.provider();
    const tuiUp = this.waitForOutput(id, CLI_READY_RE[launched], CLI_READY_TIMEOUT_MS);
    this.terminals.write(id, `${cmd}\r`);
    this.svc.runningProvider.set(launched);
    this.cliBooting.set(true);
    void tuiUp.then(() => this.cliBooting.set(false));
    // Browser-mode preamble once the TUI is up: the agent then drives Chrome
    // by itself instead of asking the user to "open Chrome". Typed into a
    // shell prompt it would only produce zsh errors → skipped if the TUI
    // never shows. The TUI can swallow the first Enter while booting → a
    // second one 1.2 s later.
    const ready = await tuiUp;
    if (this.terminalId() !== id || this.svc.runningProvider() !== launched) return;
    if (!ready) {
      console.warn('[browser] CLI banner not detected — browser-mode preamble skipped');
      return;
    }
    await this.sleep(CLI_SETTLE_MS);
    if (this.terminalId() !== id || this.svc.runningProvider() !== launched) return;
    this.terminals.write(id, browserKickoff(this.translate.instant('BROWSER_PAGE.Handshake')));
    await this.sleep(150);
    this.terminals.write(id, '\r');
    await this.sleep(1200);
    if (this.terminalId() === id) this.terminals.write(id, '\r');
  }

  // ─────────────────────────────────────────────────────────────────
  // Setup guide
  // ─────────────────────────────────────────────────────────────────

  async runProbe(): Promise<void> {
    await this.svc.runProbe(this.provider());
  }

  async launchChrome(): Promise<void> {
    await this.svc.launchChrome();
    await this.runProbe();
  }

  toggleGuide(): void { this.guideOpen.set(!this.showGuide()); }

  openLink(ev: Event, url: string): void {
    ev.preventDefault();
    this.svc.openExternal(url);
  }

  /** Opens a URL (Web Store…) inside the mirrored Chrome. */
  openInMirror(url: string): void { this.mirror?.openUrl(url); }

  async copy(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
    this.copied.set(text);
    setTimeout(() => { if (this.copied() === text) this.copied.set(null); }, 1500);
  }

  /** Escapes values interpolated into translated HTML (names come from Chrome profiles on disk). */
  esc(value: unknown): string {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  extensionNames(): string {
    return (this.probe()?.extensions ?? []).map((e) => e.name).filter(Boolean).join(', ');
  }

  /** Import the provider extension from a normal Chrome profile into the agent profile (relaunches the agent Chrome). */
  async importExtension(hit: ChromeProfileHit): Promise<void> {
    const ok = await this.svc.importAndRelaunch(hit, this.provider());
    // The CLI must reconnect to the relaunched Chrome.
    if (ok && this.terminalId()) await this.startCli();
  }

  /**
   * Resolves true as soon as output produced from now on matches `re`
   * (chunks are joined, the window is capped), false on timeout or when the
   * page terminal changes meanwhile.
   */
  private waitForOutput(id: string, re: RegExp, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let tail = '';
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        untap();
        resolve(ok);
      };
      const untap = this.terminals.tapOutput(id, (data) => {
        tail = (tail + data).slice(-4096);
        if (re.test(tail)) finish(true);
      });
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
}
