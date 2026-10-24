import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Forward Ports — VS Code's "Ports" panel next to the agents.
 *
 * The desktop app (Tauri) exposes `portsList` (ports in LISTEN + active tunnels) and
 * `portsForward`/`portsStop` (local TCP proxy). This is where the view state lives:
 * forwarded ports per workspace (label, protocol, visibility, origin),
 * auto-forward of ports opened by processes in the folder, ports "closed"
 * by the user ignored until they stop listening (like VS Code).
 * Without the commands (plain browser) → `isAvailable` false, the tab doesn't show up.
 */

export type PortOrigin = 'auto' | 'user';
export type PortVisibility = 'private' | 'public';
export type PortProtocol = 'http' | 'https';

export interface ForwardedPort {
  /** Service port ("Port" column). */
  port: number;
  /** Service host: localhost, or the remote host if the user typed host:port. */
  host: string;
  /** Local port of the forwarded address (= port if there is no proxy). */
  localPort: number;
  label?: string;
  origin: PortOrigin;
  visibility: PortVisibility;
  protocol: PortProtocol;
  /** True if there is an active Rust proxy for this entry. */
  tunneled: boolean;
}

export interface ListeningPort {
  port: number;
  host: string;
  pid: number;
  process: string;
  command: string;
  inWorkspace: boolean;
}

export interface PortRow extends ForwardedPort {
  running?: ListeningPort;
  address: string;
}

/** Service proposed by the AI: port + command to start it. */
export interface AiPortSuggestion {
  port: number;
  label: string;
  command: string;
  description?: string;
}

interface AiCache {
  at: number;
  items: AiPortSuggestion[];
}

const AI_CACHE_KEY = 'po.forwardPorts.ai.v1';
const AI_TTL_MS = 24 * 60 * 60 * 1000;

function readAiCache(): Record<string, AiCache> {
  try {
    const parsed = JSON.parse(localStorage.getItem(AI_CACHE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

interface WorkspaceState {
  ports: ForwardedPort[];
  /** Auto ports closed by the user: they don't come back while they keep listening. */
  ignored: number[];
}

const STORE_KEY = 'po.forwardPorts.v1';
const POLL_MS = 4000;

function isPort(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 65535;
}

/** Host names the panel accepts (what parsePortInput lets the user type). */
const HOST_RE = /^(?:[\w.-]+|::1)$/;

/**
 * Only well-formed rows survive a read: localStorage is writable by anything
 * running in the webview origin, and these values end up in URLs opened with
 * the system browser.
 */
export function sanitizeForwardedPort(raw: unknown): ForwardedPort | null {
  const p = raw as Partial<ForwardedPort> | null;
  if (!p || typeof p !== 'object' || !isPort(p.port)) return null;
  const host = typeof p.host === 'string' && HOST_RE.test(p.host) ? p.host : null;
  if (!host) return null;
  return {
    port: p.port,
    host,
    localPort: isPort(p.localPort) ? p.localPort : p.port,
    ...(typeof p.label === 'string' ? { label: p.label.slice(0, 200) } : {}),
    origin: p.origin === 'auto' ? 'auto' : 'user',
    visibility: p.visibility === 'public' ? 'public' : 'private',
    protocol: p.protocol === 'https' ? 'https' : 'http',
    tunneled: p.tunneled === true,
  };
}

function readStore(): Record<string, WorkspaceState> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, WorkspaceState> = {};
    for (const [ws, st] of Object.entries(parsed as Record<string, any>)) {
      if (!st || typeof st !== 'object') continue;
      out[ws] = {
        ports: (Array.isArray(st.ports) ? st.ports : []).map(sanitizeForwardedPort).filter((p: ForwardedPort | null): p is ForwardedPort => !!p),
        ignored: (Array.isArray(st.ignored) ? st.ignored : []).filter(isPort),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** http(s)://localhost:<port> for a row, or null when the row is not well-formed. */
export function forwardedPortUrl(row: Pick<PortRow, 'protocol' | 'localPort'>): string | null {
  const protocol = row.protocol === 'https' ? 'https' : row.protocol === 'http' ? 'http' : null;
  return protocol && isPort(row.localPort) ? `${protocol}://localhost:${row.localPort}` : null;
}

@Injectable({ providedIn: 'root' })
export class ForwardPortsService {
  private readonly translate = inject(TranslateService);

  private get api(): any {
    return (window as any).promptops;
  }

  get isAvailable(): boolean {
    return typeof this.api?.portsList === 'function';
  }

  readonly workspace = signal<string | null>(null);
  readonly listening = signal<ListeningPort[]>([]);
  private readonly store = signal<Record<string, WorkspaceState>>(readStore());
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Just auto-forwarded ports: the panel shows the "Open in Browser" toast. */
  readonly lastAutoForwarded = signal<PortRow | null>(null);
  /** "Forward a Port" button in the bar: the panel opens the Add Port field. */
  readonly addRequests = signal(0);

  // ── AI detection (same flow as the commit message: the provider CLI in the background in the folder) ──
  readonly provider = signal<string | null>(null);
  readonly aiDetecting = signal(false);
  readonly aiError = signal<string | null>(null);
  private readonly aiCache = signal<Record<string, AiCache>>(readAiCache());
  readonly aiSuggestions = computed<AiPortSuggestion[]>(() => {
    const ws = this.workspace();
    return (ws && this.aiCache()[ws]?.items) || [];
  });
  readonly aiGeneratedAt = computed(() => {
    const ws = this.workspace();
    return (ws && this.aiCache()[ws]?.at) || null;
  });

  get canUseAi(): boolean {
    return typeof this.api?.aiGenerateText === 'function' && !!this.provider() && this.provider() !== 'shell';
  }

  setProvider(provider: string | null | undefined): void {
    this.provider.set(provider || null);
  }

  /** Automatic detection: once per project (TTL 24h), in the background. */
  autoDetect(): void {
    const at = this.aiGeneratedAt();
    if (at && Date.now() - at < AI_TTL_MS) return;
    void this.detectWithAi();
  }

  async detectWithAi(): Promise<void> {
    const ws = this.workspace();
    const provider = this.provider();
    if (!ws || !provider || !this.canUseAi || this.aiDetecting()) return;
    this.aiDetecting.set(true);
    this.aiError.set(null);
    try {
      let hints = '';
      if (typeof this.api.devLinksScan === 'function') {
        const scan = await this.api.devLinksScan(ws, false).catch(() => null);
        hints = scan?.aiSource ?? '';
      }
      const listening = this.listening()
        .map(l => `- port ${l.port}: ${l.command}${l.inWorkspace ? ' (this project)' : ''}`)
        .join('\n');
      const prompt =
        'You are analyzing a local software project to find the 3-4 MOST USEFUL local services a developer runs and ' +
        'opens in a browser (frontend dev server, API/backend, API docs, Storybook, DB admin UI, mail catcher...).\n' +
        'Inspect the project files (package.json scripts, docker-compose, framework configs, .env, Makefile, README) ' +
        'to find the exact port and the exact command to start each service from the project root.\n' +
        'Return ONLY a JSON array, no prose, no markdown fences. Each item: ' +
        '{"label": string (short, e.g. "Frontend"), "port": number, "command": string, "description": string (max 8 words)}. ' +
        'Max 4 items, most important first. Omit anything whose port you cannot determine.\n\n' +
        '=== PORTS CURRENTLY LISTENING ===\n' + (listening || '(none)') + '\n\n' +
        '=== HEURISTIC HINTS ===\n' + (hints || '(none)');
      const res = await this.api.aiGenerateText(prompt, provider, ws);
      if (!res?.ok) {
        throw new Error(!res?.error || res.error === 'generate_failed'
          ? this.translate.instant('FORWARD_PORTS.Generate failed')
          : res.error);
      }
      const items = this.parseAi(res.text as string);
      if (items.length === 0) throw new Error(this.translate.instant('FORWARD_PORTS.No services detected'));
      const next = { ...this.aiCache(), [ws]: { at: Date.now(), items } };
      this.aiCache.set(next);
      try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify(next)); } catch { /* quota */ }
    } catch (err) {
      if (ws === this.workspace()) this.aiError.set((err as Error).message);
    } finally {
      this.aiDetecting.set(false);
    }
  }

  dismissAiSuggestion(port: number): void {
    const ws = this.workspace();
    const cur = ws && this.aiCache()[ws];
    if (!ws || !cur) return;
    const next = { ...this.aiCache(), [ws]: { ...cur, items: cur.items.filter(i => i.port !== port) } };
    this.aiCache.set(next);
    try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }

  /** Forwards the chosen proposals, with the AI's label (like "Set Port Label"). */
  async applyAiSuggestions(items: AiPortSuggestion[]): Promise<void> {
    for (const it of items) {
      const existing = this.state().ports.find(p => p.port === it.port && this.isLocalHost(p.host));
      if (!existing) await this.forward(String(it.port));
      const row = this.state().ports.find(p => p.port === it.port && this.isLocalHost(p.host));
      if (row && !row.label) this.setLabel(row, it.label);
    }
  }

  private parseAi(text: string): AiPortSuggestion[] {
    const cleaned = (text ?? '').replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    try {
      const arr = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(arr)) return [];
      const seen = new Set<number>();
      return arr
        .map((x: any) => ({
          port: Number(x?.port),
          label: String(x?.label ?? '').slice(0, 40),
          command: String(x?.command ?? '').slice(0, 200),
          description: x?.description ? String(x.description).slice(0, 80) : undefined,
        }))
        .filter(x => Number.isInteger(x.port) && x.port > 0 && x.port < 65536 && !seen.has(x.port) && seen.add(x.port))
        .slice(0, 4);
    } catch {
      return [];
    }
  }

  requestAdd(): void {
    this.addRequests.update(n => n + 1);
  }

  private readonly state = computed<WorkspaceState>(() => {
    const ws = this.workspace();
    return (ws && this.store()[ws]) || { ports: [], ignored: [] };
  });

  readonly rows = computed<PortRow[]>(() => {
    const byPort = new Map(this.listening().map(l => [l.port, l]));
    return this.state().ports
      .map(p => ({
        ...p,
        running: this.isLocalHost(p.host) ? byPort.get(p.port) : undefined,
        address: `localhost:${p.localPort}`,
      }))
      .sort((a, b) => a.port - b.port);
  });

  readonly count = computed(() => this.rows().length);

  /** Listening ports not yet forwarded: suggestions for the "Add Port" field. */
  readonly suggestions = computed(() => {
    const taken = new Set(this.state().ports.map(p => p.port));
    return this.listening().filter(l => !taken.has(l.port));
  });

  /**
   * Folder change: state only, no scan. The search starts on demand
   * when the Ports panel is open (`attach`), never in the background with
   * terminals open. The last scan per folder stays cached.
   */
  setWorkspace(path: string | null | undefined): void {
    const ws = path || null;
    if (ws === this.workspace()) return;
    this.workspace.set(ws);
    this.listening.set((ws && this.listeningCache.get(ws)) || []);
    this.aiError.set(null);
    this.stopPolling();
    if (this.attached > 0) this.startPolling();
  }

  /** Ports panel mounted: scan right away + polling while it stays visible. */
  attach(): void {
    if (++this.attached === 1) this.startPolling();
  }

  detach(): void {
    this.attached = Math.max(0, this.attached - 1);
    if (this.attached === 0) this.stopPolling();
  }

  private attached = 0;
  private readonly listeningCache = new Map<string, ListeningPort[]>();

  private startPolling(): void {
    if (this.timer || !this.workspace() || !this.isAvailable) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private refreshing = false;
  async refresh(): Promise<void> {
    // One scan at a time: overlapping ticks would reconcile twice.
    if (!this.isAvailable || this.refreshing) return;
    const ws = this.workspace();
    let res: any;
    this.refreshing = true;
    try {
      res = await this.api.portsList(ws);
    } catch {
      return;
    } finally {
      this.refreshing = false;
    }
    if (!res?.ok || ws !== this.workspace()) return;
    const listening: ListeningPort[] = res.listening ?? [];
    if (ws) this.listeningCache.set(ws, listening);
    this.listening.set(listening);
    this.reconcileAuto(listening);
    this.restoreTunnels(new Set<number>((res.forwards ?? []).map((f: any) => f.localPort)));
  }

  /** Proxies live in the Rust process: after a restart they must be reopened. */
  private readonly restoring = new Set<string>();
  private restoreTunnels(active: Set<number>): void {
    for (const p of this.state().ports) {
      const key = `${p.host}:${p.port}`;
      if (!p.tunneled || active.has(p.localPort) || this.restoring.has(key)) continue;
      this.restoring.add(key);
      void this.retunnel({ ...p, tunneled: false }, {}).finally(() => this.restoring.delete(key));
    }
  }

  /** Auto Forwarded: appears when the folder's process opens the port, disappears when it closes it. */
  private reconcileAuto(listening: ListeningPort[]): void {
    const live = new Set(listening.map(l => l.port));
    const mine = listening.filter(l => l.inWorkspace);
    let added: ForwardedPort | null = null;
    this.update(st => {
      const ignored = st.ignored.filter(p => live.has(p));
      let ports = st.ports.filter(p => p.origin !== 'auto' || live.has(p.port) || p.tunneled);
      for (const l of mine) {
        if (ignored.includes(l.port) || ports.some(p => p.port === l.port)) continue;
        added = { port: l.port, host: 'localhost', localPort: l.port, origin: 'auto', visibility: 'private', protocol: 'http', tunneled: false };
        ports = [...ports, added];
      }
      return { ports, ignored };
    });
    if (added) {
      const port = (added as ForwardedPort).port;
      this.lastAutoForwarded.set(this.rows().find(r => r.port === port) ?? null);
    }
  }

  /** "Forward a Port": accepts `3000` or `host:3000` like the VS Code field. */
  async forward(input: string): Promise<{ ok: boolean; error?: string }> {
    const parsed = this.parsePortInput(input);
    if (!parsed) return { ok: false, error: this.translate.instant('FORWARD_PORTS.Invalid port') };
    const { host, port } = parsed;
    const key = `${host}:${port}`;
    if (this.forwarding.has(key) || this.state().ports.some(p => p.port === port && p.host === host)) {
      return { ok: false, error: this.translate.instant('FORWARD_PORTS.Already forwarded', { port }) };
    }
    this.forwarding.add(key);
    try {
      return await this.doForward(host, port);
    } finally {
      this.forwarding.delete(key);
    }
  }

  /** Forward in progress: double click/Enter doesn't open two tunnels on the same port. */
  private readonly forwarding = new Set<string>();

  private async doForward(host: string, port: number): Promise<{ ok: boolean; error?: string }> {
    let entry: ForwardedPort = { port, host, localPort: port, origin: 'user', visibility: 'private', protocol: 'http', tunneled: false };
    if (!this.isLocalHost(host)) {
      const res = await this.callForward({ targetPort: port, targetHost: host, localPort: port });
      if (!res?.ok) return { ok: false, error: this.forwardError(res?.error) };
      entry = { ...entry, localPort: res.localPort ?? port, tunneled: true };
    }
    this.update(st => ({
      ports: st.ports.some(p => p.port === port && p.host === host) ? st.ports : [...st.ports, entry],
      ignored: st.ignored.filter(p => p !== port),
    }));
    return { ok: true };
  }

  async stop(row: ForwardedPort): Promise<void> {
    if (row.tunneled) await this.api.portsStop(row.localPort).catch(() => undefined);
    this.update(st => ({
      ports: st.ports.filter(p => !(p.port === row.port && p.host === row.host)),
      ignored: row.origin === 'auto' && !st.ignored.includes(row.port) ? [...st.ignored, row.port] : st.ignored,
    }));
  }

  setLabel(row: ForwardedPort, label: string): void {
    this.patch(row, { label: label.trim() || undefined });
  }

  setProtocol(row: ForwardedPort, protocol: PortProtocol): void {
    this.patch(row, { protocol });
  }

  /** "Change Local Address Port" and "Port Visibility": both go through the proxy. */
  async retunnel(row: ForwardedPort, opts: { localPort?: number; visibility?: PortVisibility }): Promise<{ ok: boolean; error?: string }> {
    const localPort = opts.localPort ?? row.localPort;
    const visibility = opts.visibility ?? row.visibility;
    const needsTunnel = localPort !== row.port || visibility === 'public' || !this.isLocalHost(row.host);
    if (row.tunneled) await this.api.portsStop(row.localPort).catch(() => undefined);
    if (!needsTunnel) {
      this.patch(row, { localPort: row.port, visibility, tunneled: false });
      return { ok: true };
    }
    const res = await this.callForward({
      targetPort: row.port,
      targetHost: this.isLocalHost(row.host) ? '127.0.0.1' : row.host,
      localPort,
      public: visibility === 'public',
    });
    if (!res?.ok) {
      this.patch(row, { tunneled: false, localPort: row.port });
      return { ok: false, error: this.forwardError(res?.error) };
    }
    this.patch(row, { localPort: res.localPort ?? localPort, visibility, tunneled: true });
    return { ok: true };
  }

  url(row: PortRow): string {
    return forwardedPortUrl(row) ?? '';
  }

  /** Never rejects: it is bound straight to clicks. */
  async openInBrowser(row: PortRow): Promise<void> {
    const url = forwardedPortUrl(row);
    if (!url) return;
    try {
      if (typeof this.api?.devLinksOpen === 'function') await this.api.devLinksOpen(url);
      else window.open(url, '_blank');
    } catch {
      /* the address stays visible in the row to copy */
    }
  }

  /** The proxy command; a rejected call is reported like a refused one. */
  private async callForward(args: Record<string, unknown>): Promise<{ ok: boolean; localPort?: number; error?: string } | null> {
    try {
      return await this.api.portsForward(args);
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? String(err) };
    }
  }

  private forwardError(error: string | undefined): string {
    return !error || error === 'forward_failed' ? this.translate.instant('FORWARD_PORTS.Forward failed') : error;
  }

  private parsePortInput(input: string): { host: string; port: number } | null {
    const m = input.trim().match(/^(?:([\w.-]+):)?(\d{1,5})$/);
    if (!m) return null;
    const port = Number(m[2]);
    if (port < 1 || port > 65535) return null;
    return { host: m[1] || 'localhost', port };
  }

  private isLocalHost(h: string): boolean {
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  }

  private patch(row: ForwardedPort, changes: Partial<ForwardedPort>): void {
    this.update(st => ({
      ...st,
      ports: st.ports.map(p => (p.port === row.port && p.host === row.host ? { ...p, ...changes } : p)),
    }));
  }

  private update(fn: (st: WorkspaceState) => WorkspaceState): void {
    const ws = this.workspace();
    if (!ws) return;
    const st = fn(this.state());
    // Never two entries for the same host:port, whatever path added them.
    const seen = new Set<string>();
    const ports = st.ports.filter(p => {
      const k = `${p.host}:${p.port}`;
      return !seen.has(k) && !!seen.add(k);
    });
    const next = { ...this.store(), [ws]: { ...st, ports } };
    this.store.set(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked: the state stays in memory */
    }
  }
}
