import { Injectable, computed, signal } from '@angular/core';

/**
 * Browser page — facade over the Tauri v2 `window.promptops.browser*` API.
 *
 * The right pane of the Browser page is a CDP screencast of the REAL Chrome
 * (launched with --remote-debugging-port). Frames arrive on a Channel and
 * user input goes back as CDP commands, so the user sees exactly the tab the
 * provider (Claude Code / Codex) is driving through its Chrome extension.
 *
 * Safe outside the desktop app: every method checks `isDesktop()` and the
 * page shows a "desktop only" notice elsewhere.
 */

export interface ChromeTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export interface ChromeStatus {
  reachable: boolean;
  port: number;
  browser?: string | null;
  targets: ChromeTarget[];
  error?: string | null;
  chromeInstalled: boolean;
  chromeRunning: boolean;
  /** Plain-words explanation when not reachable. */
  reason?: string | null;
}

export interface ExtensionInfo { id: string; name: string; version: string }

export interface ChromeProfileHit {
  /** Folder name (`Default`, `Profile 9`…). */
  dir: string;
  /** Display name of the profile. */
  name: string;
  lastUsed: boolean;
  extension: ExtensionInfo;
}

export interface IntegrationProbe {
  provider: string;
  cliInstalled: boolean;
  cliCommand: string;
  extension: ExtensionInfo | null;
  extensions: ExtensionInfo[];
  mcpConfigured: boolean;
  mcpConfigPath: string;
  /** Bundled Chrome DevTools MCP config (written by the desktop) used by the mirror mode launch command. */
  bundledMcpPath: string;
  profileDir: string;
  /** Profiles of the user's normal Chrome that already have the extension. */
  extensionElsewhere: ChromeProfileHit[];
}

export interface GuideStep {
  /** i18n key */
  title: string;
  /** i18n key */
  text: string;
  /** Shell command shown in a copyable block. */
  cmd?: string;
  /** Config snippet shown in a copyable block. */
  snippet?: string;
  /** `label` is an i18n key (brand names pass through the translate pipe unchanged). */
  links?: { label: string; url: string }[];
}

export type MirrorEvent =
  | { kind: 'frame'; data: string; deviceWidth: number; deviceHeight: number; pageScale: number; scrollX: number; scrollY: number }
  | { kind: 'nav'; url: string }
  | { kind: 'result'; id: number; result: unknown }
  | { kind: 'status'; message: string; permission: boolean }
  | { kind: 'closed'; reason: string };

export type BrowserProvider = 'claude-code-cli' | 'codex';

export interface BrowserProviderDef {
  id: BrowserProvider;
  label: string;
  icon: string;
  /** Shell command for "My Chrome": the CLI drives the user's normal Chrome through its extension. */
  launch: string;
  /**
   * Shell command for "Agent Chrome + mirror": the CLI starts with the Chrome
   * DevTools MCP attached to the mirrored Chrome (bundled config in the
   * terminal cwd), so it acts for sure in the tab shown on the right — with
   * the extension alone the CLI binds to whichever Chrome answers first
   * (usually the user's normal one) and the mirror shows nothing.
   */
  launchMirror: string;
  /** Short hint about the Chrome extension the CLI relies on (i18n key). */
  hint: string;
  /** Name of the Chrome extension (as shown in the Web Store), if any. */
  extensionName: string | null;
  docsUrl: string;
  /** Setup guide: CLI install, Chrome, browser integration, launch. */
  guide: { cli: GuideStep; integration: GuideStep; launch: GuideStep };
}

/** Providers that can drive Chrome today (each through its own extension). */
const CDP_URL = 'http://127.0.0.1:9222';
/** File written by `browser_terminal_cwd` / the probe in the terminal cwd (relative path in the launch command). */
export const BUNDLED_MCP_FILE = 'chrome-devtools.mcp.json';
/** Typed once per app run before the mirror-mode launch: warms the npx cache so the MCP server starts within Claude's timeout. */
export const MCP_PREWARM_CMD = 'npx -y chrome-devtools-mcp@1.10.1 --version';

export function launchFor(def: BrowserProviderDef, mode: 'agent' | 'own'): string {
  return mode === 'own' ? def.launch : def.launchMirror;
}
/** Page the agent Chrome opens on (launch + new tab). */
export const BROWSER_HOME_URL = 'https://www.google.com';

/**
 * Typed into the CLI right after it boots (page + Browser-mode modal): without
 * it the agent answers in prose and asks the user to "open Chrome" instead of
 * driving it. Ends with a hand-shake question in the user's language
 * (`BROWSER_PAGE.Handshake`, e.g. "What should we browse?").
 */
export const browserKickoff = (handshake: string): string =>
  'Browser mode is on. For every request I type here, act directly with your Chrome browser tools ' +
  '(Chrome DevTools MCP: list_pages/select_page, navigate_page, take_snapshot, click, fill… — or the Claude in Chrome extension): navigate, click, read and fill pages yourself in the ' +
  'Chrome tab that is currently active — never ask me to open Chrome and never just describe the steps. ' +
  'Keep working in that tab; open a new tab only when a task really needs it. ' +
  'Be fast and terse: act first, then report in at most 3 short lines (max 3 items, one line each, no tables) and ask one short question only if you really need a choice. ' +
  'If the browser tools are not available in this session, say so in one line and tell me to run /chrome and enable Chrome by default. ' +
  `Otherwise reply now with exactly "${handshake}" and wait for my request.`;

export const BROWSER_PROVIDERS: BrowserProviderDef[] = [
  {
    id: 'claude-code-cli',
    label: 'Claude Code',
    icon: 'simple-icons:anthropic',
    launch: 'claude --chrome',
    launchMirror: `claude --no-chrome --strict-mcp-config --mcp-config ${BUNDLED_MCP_FILE}`,
    hint: 'BROWSER_PAGE.Claude hint',
    extensionName: 'Claude in Chrome',
    docsUrl: 'https://code.claude.com/docs/en/chrome',
    guide: {
      cli: {
        title: 'BROWSER_PAGE.Claude cli title',
        text: 'BROWSER_PAGE.Claude cli text',
        cmd: 'npm install -g @anthropic-ai/claude-code',
        links: [
          { label: 'BROWSER_PAGE.Link claude docs', url: 'https://code.claude.com/docs/en/overview' },
          { label: 'BROWSER_PAGE.Link quickstart', url: 'https://code.claude.com/docs/en/quickstart' },
        ],
      },
      integration: {
        title: 'BROWSER_PAGE.Integration title',
        text: 'BROWSER_PAGE.Claude integration text',
        cmd: `claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@1.10.1 --browserUrl ${CDP_URL}`,
        links: [
          { label: 'Claude in Chrome', url: 'https://claude.ai/chrome' },
          { label: 'BROWSER_PAGE.Link chrome docs', url: 'https://code.claude.com/docs/en/chrome' },
          { label: 'Chrome DevTools MCP', url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp' },
        ],
      },
      launch: {
        title: 'BROWSER_PAGE.Claude launch title',
        text: 'BROWSER_PAGE.Claude launch text',
        cmd: `claude --no-chrome --strict-mcp-config --mcp-config ${BUNDLED_MCP_FILE}`,
      },
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    icon: 'simple-icons:openai',
    launch: 'codex',
    launchMirror: `codex -c 'mcp_servers.chrome-devtools.command="npx"' -c 'mcp_servers.chrome-devtools.args=["-y","chrome-devtools-mcp@1.10.1","--browserUrl","${CDP_URL}"]'`,
    hint: 'BROWSER_PAGE.Codex hint',
    extensionName: null,
    docsUrl: 'https://developers.openai.com/codex/mcp',
    guide: {
      cli: {
        title: 'BROWSER_PAGE.Codex cli title',
        text: 'BROWSER_PAGE.Codex cli text',
        cmd: 'npm install -g @openai/codex',
        links: [
          { label: 'BROWSER_PAGE.Link codex docs', url: 'https://developers.openai.com/codex/cli' },
          { label: 'GitHub', url: 'https://github.com/openai/codex' },
        ],
      },
      integration: {
        title: 'BROWSER_PAGE.Codex integration title',
        text: 'BROWSER_PAGE.Codex integration text',
        snippet: `[mcp_servers.chrome-devtools]
command = "npx"
args = ["-y", "chrome-devtools-mcp@1.10.1", "--browserUrl", "${CDP_URL}"]`,
        links: [
          { label: 'BROWSER_PAGE.Link codex mcp docs', url: 'https://developers.openai.com/codex/mcp' },
          { label: 'Chrome DevTools MCP', url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp' },
        ],
      },
      launch: {
        title: 'BROWSER_PAGE.Codex launch title',
        text: 'BROWSER_PAGE.Codex launch text',
        cmd: 'codex',
      },
    },
  },
];

@Injectable({ providedIn: 'root' })
export class BrowserAgentService {
  private readonly api = signal<any>((window as any).promptops ?? null);

  /** True only when the desktop bridge exposes the browser API. */
  readonly isDesktop = computed(() => !!this.api()?.browserMirrorStart);

  readonly port = 9222;

  /** Provider whose CLI is running in the page terminal (survives route changes). */
  readonly runningProvider = signal<BrowserProvider | null>(null);

  /**
   * Which Chrome the agent drives:
   *  - 'agent': dedicated profile with remote debugging → live mirror in the app.
   *  - 'own':   the user's normal Chrome window (extension already there) → no mirror.
   * Per-viewer convenience, remembered in localStorage.
   */
  readonly chromeMode = signal<'agent' | 'own'>(this.readMode());

  setChromeMode(mode: 'agent' | 'own'): void {
    this.chromeMode.set(mode);
    try { localStorage.setItem('po.browser.chromeMode', mode); } catch { /* storage blocked */ }
  }

  private readMode(): 'agent' | 'own' {
    try { return localStorage.getItem('po.browser.chromeMode') === 'own' ? 'own' : 'agent'; } catch { return 'agent'; }
  }

  // ── Chrome status (shared by the Browser page, the guide and every mirror) ──
  readonly status = signal<ChromeStatus | null>(null);
  readonly launching = signal(false);
  readonly launchInfo = signal<string | null>(null);
  readonly statusError = signal<string | null>(null);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollUsers = 0;

  /** Start polling Chrome (ref-counted: page + modal can both hold it). */
  startPolling(): void {
    if (!this.isDesktop()) return;
    this.pollUsers++;
    void this.refreshStatus();
    if (!this.pollTimer) this.pollTimer = setInterval(() => void this.refreshStatus(), 4000);
  }

  stopPolling(): void {
    this.pollUsers = Math.max(0, this.pollUsers - 1);
    if (this.pollUsers === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async refreshStatus(): Promise<ChromeStatus | null> {
    if (!this.isDesktop()) return null;
    try {
      const st = await this.chromeStatus();
      this.status.set(st);
      this.statusError.set(null);
      return st;
    } catch (e: any) {
      this.statusError.set(e?.message ?? String(e));
      return null;
    }
  }

  /**
   * Make sure the agent Chrome is up BEFORE a CLI starts, so the CLI opens
   * already connected to the browser (Google as the default page).
   */
  async ensureChrome(): Promise<boolean> {
    const st = await this.refreshStatus();
    if (!st) return false;
    if (st.reachable) return true;
    if (!st.chromeInstalled) return false;
    return this.launchChrome(BROWSER_HOME_URL);
  }

  /** Launch the agent Chrome profile (or just open a tab if Chrome is up). */
  async launchChrome(url = BROWSER_HOME_URL): Promise<boolean> {
    this.launching.set(true);
    this.statusError.set(null);
    try {
      const res = await this.chromeLaunch(url);
      this.launchInfo.set(res.profileDir);
      const st = await this.refreshStatus();
      return !!st?.reachable;
    } catch (e: any) {
      this.statusError.set(e?.message ?? String(e));
      return false;
    } finally {
      this.launching.set(false);
    }
  }

  private get p(): any {
    const api = this.api();
    if (!api?.browserMirrorStart) throw new Error('Browser page requires the PromptOps desktop app');
    return api;
  }

  chromeStatus(): Promise<ChromeStatus> {
    return this.p.browserChromeStatus(this.port);
  }

  chromeLaunch(url?: string): Promise<{ binary: string; profileDir: string; port: number }> {
    return this.p.browserChromeLaunch(url, this.port);
  }

  chromeOpenTab(url?: string): Promise<ChromeTarget> {
    return this.p.browserChromeOpenTab(url, this.port);
  }

  chromeCloseTab(targetId: string): Promise<void> {
    return this.p.browserChromeCloseTab(targetId, this.port);
  }

  chromeActivateTab(targetId: string): Promise<void> {
    return this.p.browserChromeActivateTab(targetId, this.port);
  }

  mirrorStart(
    opts: { wsUrl: string; maxWidth?: number; maxHeight?: number; quality?: number },
    cb: (ev: MirrorEvent) => void,
  ): Promise<string> {
    return this.p.browserMirrorStart(opts, cb);
  }

  mirrorSend(id: string, method: string, params?: Record<string, unknown>): Promise<number> {
    return this.p.browserMirrorSend(id, method, params ?? {});
  }

  mirrorStop(id: string): Promise<void> {
    return this.p.browserMirrorStop(id);
  }

  /** "My Chrome" mode: live capture of the user's normal Chrome window (macOS). */
  windowMirrorStart(opts: { fps?: number }, cb: (ev: MirrorEvent) => void): Promise<string> {
    return this.p.browserWindowMirrorStart(opts, cb);
  }

  windowMirrorStop(id: string): Promise<void> {
    return this.p.browserWindowMirrorStop(id);
  }

  /** Bring the normal Chrome to the front (the live view is view-only). */
  chromeFocus(): Promise<void> {
    return this.p.browserChromeFocus();
  }

  integrationProbe(provider: BrowserProvider): Promise<IntegrationProbe> {
    return this.p.browserIntegrationProbe(provider);
  }

  // ── Integration probe (shared: page guide, mirror overlay, modal) ──
  readonly probe = signal<IntegrationProbe | null>(null);
  readonly probing = signal(false);

  async runProbe(provider: BrowserProvider): Promise<IntegrationProbe | null> {
    if (!this.isDesktop() || this.probing()) return this.probe();
    this.probing.set(true);
    try {
      const p = await this.integrationProbe(provider);
      this.probe.set(p);
      return p;
    } catch {
      return null;
    } finally {
      this.probing.set(false);
    }
  }

  /**
   * Mirror mode selected, but the provider's extension lives only in the
   * user's normal Chrome: the agent will act THERE, not in the mirrored one.
   */
  readonly mirrorMismatch = computed(() => {
    const p = this.probe();
    // The page CLI runs with the bundled DevTools MCP → it always acts in the mirrored Chrome.
    if (this.runningProvider()) return false;
    return this.chromeMode() === 'agent' && !!p && !p.extension && !p.mcpConfigured && p.extensionElsewhere.length > 0;
  });

  /** npx cache warmed once per app run (mirror mode launch). */
  readonly mcpWarmed = signal(false);

  readonly importing = signal(false);

  /** Import the extension into the agent profile, relaunch Chrome, refresh state. */
  async importAndRelaunch(hit: ChromeProfileHit, provider: BrowserProvider): Promise<boolean> {
    if (this.importing()) return false;
    this.importing.set(true);
    this.statusError.set(null);
    try {
      await this.importExtension(hit.dir, hit.extension.id);
      await this.refreshStatus();
      await this.runProbe(provider);
      return true;
    } catch (e: any) {
      this.statusError.set(e?.message ?? String(e));
      return false;
    } finally {
      this.importing.set(false);
    }
  }

  /** Dedicated, pre-trusted working folder for the page terminal (no "Do you trust this folder?" dialog). */
  terminalCwd(provider: BrowserProvider): Promise<string> {
    return this.p.browserTerminalCwd(provider);
  }

  /** Copy the extension (files + install record, no cookies/passwords) from a normal Chrome profile into the agent profile. */
  importExtension(sourceDir: string, extensionId: string): Promise<{ sourceDir: string; extensionId: string; relaunched: boolean }> {
    return this.p.browserProfileImportExtension(sourceDir, extensionId, this.port);
  }

  openExternal(url: string): void {
    const api = this.api();
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }
}
