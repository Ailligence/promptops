import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BROWSER_HOME_URL, BrowserAgentService, BrowserProvider, ChromeProfileHit, ChromeTarget, MirrorEvent } from './browser.service';

/** CDP modifier bitmask (Input.dispatchKeyEvent / dispatchMouseEvent). */
const MOD_ALT = 1, MOD_CTRL = 2, MOD_META = 4, MOD_SHIFT = 8;

/**
 * Live mirror of a REAL Chrome tab (CDP screencast) with tabs strip, address
 * bar and full input forwarding. Used by the Browser page and by the
 * per-agent "Browser mode" modal. Chrome status/launch live in
 * BrowserAgentService so the setup guide shares the same truth.
 */
@Component({
  selector: 'app-chrome-mirror',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  templateUrl: './chrome-mirror.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './chrome-mirror.component.scss',
})
export class ChromeMirrorComponent implements OnInit, OnDestroy {
  readonly svc = inject(BrowserAgentService);
  private readonly translate = inject(TranslateService);

  /** Label of the provider driving Chrome (setup card copy). */
  @Input() providerLabel = 'the agent';
  /** Provider id (integration probe + extension import). */
  @Input() providerId: BrowserProvider = 'claude-code-cli';

  /** Mirror mode but the extension lives in the normal Chrome: import it here. */
  async importFromNormalChrome(hit: ChromeProfileHit): Promise<void> {
    await this.svc.importAndRelaunch(hit, this.providerId);
  }
  /** Emits the current page URL (navigation + tab switch). */
  @Output() urlChange = new EventEmitter<string>();
  /** The setup card asks the host to show the provider guide. */
  @Output() openGuide = new EventEmitter<void>();

  @ViewChild('mirrorImg') mirrorImg?: ElementRef<HTMLImageElement>;
  @ViewChild('mirrorHost') mirrorHost?: ElementRef<HTMLDivElement>;

  readonly status = this.svc.status;
  readonly targets = computed(() => this.status()?.targets ?? []);
  readonly activeTargetId = signal<string | null>(null);
  readonly activeTarget = computed(() => this.targets().find((t) => t.id === this.activeTargetId()) ?? null);
  readonly mirrorId = signal<string | null>(null);
  readonly frameSrc = signal<string | null>(null);
  readonly pageUrl = signal('');
  readonly urlInput = signal('');
  readonly urlFocused = signal(false);
  readonly fps = signal(0);
  readonly error = signal<string | null>(null);

  private frameMeta = { deviceWidth: 0, deviceHeight: 0 };
  private fpsCount = 0;
  private fpsTimer: ReturnType<typeof setInterval> | null = null;
  private moveRaf = 0;
  private pendingMove: { x: number; y: number; mods: number } | null = null;
  private destroyed = false;
  private attaching = false;

  // ── "My Chrome" live view (window capture of the user's normal Chrome) ──
  readonly liveView = computed(() => this.svc.chromeMode() === 'own');
  readonly windowMirrorId = signal<string | null>(null);
  readonly windowStatus = signal<{ message: string; permission: boolean } | null>(null);

  constructor() {
    // Follow the shared status: attach to the first tab, drop vanished tabs.
    effect(() => {
      const st = this.status();
      if (!st) return;
      void this.reconcile(st.reachable, st.targets);
    });
    // Mode switch: CDP mirror (agent profile) ⇄ window capture (normal Chrome).
    effect(() => {
      if (this.svc.chromeMode() === 'own') void this.startWindowMirror();
      else void this.stopWindowMirror();
    });
  }

  ngOnInit(): void {
    this.svc.startPolling();
    this.fpsTimer = setInterval(() => { this.fps.set(this.fpsCount); this.fpsCount = 0; }, 1000);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.fpsTimer) clearInterval(this.fpsTimer);
    void this.stopMirror();
    void this.stopWindowMirror();
    this.svc.stopPolling();
  }

  private async startWindowMirror(): Promise<void> {
    if (this.windowMirrorId() || this.destroyed || !this.svc.isDesktop()) return;
    this.frameSrc.set(null);
    this.windowStatus.set(null);
    try {
      const id = await this.svc.windowMirrorStart({ fps: 4 }, (ev) => this.onWindowEvent(ev));
      this.windowMirrorId.set(id);
    } catch (e: any) {
      this.windowStatus.set({ message: e?.message ?? String(e), permission: false });
    }
  }

  private async stopWindowMirror(): Promise<void> {
    const id = this.windowMirrorId();
    if (!id) return;
    this.windowMirrorId.set(null);
    this.frameSrc.set(null);
    try { await this.svc.windowMirrorStop(id); } catch { /* already gone */ }
  }

  private onWindowEvent(ev: MirrorEvent): void {
    if (this.destroyed || !this.liveView()) return;
    switch (ev.kind) {
      case 'frame':
        this.frameSrc.set(`data:image/jpeg;base64,${ev.data}`);
        this.windowStatus.set(null);
        this.fpsCount++;
        break;
      case 'status':
        this.windowStatus.set({ message: ev.message, permission: ev.permission });
        break;
      case 'closed':
        this.windowMirrorId.set(null);
        break;
      default:
        break;
    }
  }

  focusChrome(): void { void this.svc.chromeFocus().catch(() => {}); }

  // ── Tabs ─────────────────────────────────────────────────────────

  private async reconcile(reachable: boolean, targets: ChromeTarget[]): Promise<void> {
    if (this.destroyed || this.attaching) return;
    // "My Chrome" mode: nothing to mirror.
    if (this.svc.chromeMode() !== 'agent') {
      if (this.mirrorId()) await this.stopMirror();
      return;
    }
    if (!reachable) {
      if (this.mirrorId()) await this.stopMirror();
      this.activeTargetId.set(null);
      return;
    }
    const active = this.activeTargetId();
    if (active && !targets.some((t) => t.id === active)) {
      this.activeTargetId.set(null);
      if (this.mirrorId()) await this.stopMirror();
    }
    // Follow the ACTIVE tab: Chrome lists targets by last activity, so the
    // tab the agent just opened or focused comes first. A manual pick in the
    // strip activates that tab in Chrome too, so it also ends up first.
    if (targets.length > 0 && targets[0].id !== this.activeTargetId()) await this.attach(targets[0]);
  }

  async newTab(url = BROWSER_HOME_URL): Promise<void> {
    try {
      const t = await this.svc.chromeOpenTab(url);
      await this.svc.refreshStatus();
      await this.attach(t);
    } catch (e: any) {
      this.error.set(e?.message ?? String(e));
    }
  }

  async closeTab(t: ChromeTarget, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    try {
      if (t.id === this.activeTargetId()) await this.stopMirror();
      await this.svc.chromeCloseTab(t.id);
      await this.svc.refreshStatus();
    } catch (e: any) {
      this.error.set(e?.message ?? String(e));
    }
  }

  async selectTab(t: ChromeTarget): Promise<void> {
    if (t.id === this.activeTargetId()) return;
    await this.attach(t);
  }

  /** Navigate the mirrored tab (or open one) to a URL — used by the guide. */
  openUrl(url: string): void {
    if (this.mirrorId()) this.send('Page.navigate', { url });
    else void this.newTab(url);
  }

  launchChrome(): void { void this.svc.launchChrome(); }

  // ── Mirror lifecycle ─────────────────────────────────────────────

  private async attach(t: ChromeTarget): Promise<void> {
    if (!t.webSocketDebuggerUrl) { this.error.set(this.translate.instant('BROWSER_PAGE.No devtools socket')); return; }
    this.attaching = true;
    try {
      await this.stopMirror();
      this.activeTargetId.set(t.id);
      this.setUrl(t.url);
      this.frameSrc.set(null);
      // Frame at the pane's device-pixel size (retina): a smaller JPEG scaled
      // up reads as blur. The host may not be laid out yet → generous fallback.
      const host = this.mirrorHost?.nativeElement;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = host?.clientWidth ? host.clientWidth * dpr : 1920;
      const height = host?.clientHeight ? host.clientHeight * dpr : 1440;
      const id = await this.svc.mirrorStart(
        {
          wsUrl: t.webSocketDebuggerUrl,
          maxWidth: Math.round(Math.max(width, 1280)),
          maxHeight: Math.round(Math.max(height, 960)),
          quality: 80,
        },
        (ev) => this.onMirrorEvent(ev),
      );
      this.mirrorId.set(id);
      // The provider's extension acts on the active tab: keep Chrome in sync.
      void this.svc.chromeActivateTab(t.id).catch(() => {});
    } catch (e: any) {
      this.error.set(e?.message ?? String(e));
      this.activeTargetId.set(null);
    } finally {
      this.attaching = false;
    }
  }

  private onMirrorEvent(ev: MirrorEvent): void {
    if (this.destroyed) return;
    switch (ev.kind) {
      case 'frame':
        this.frameMeta = { deviceWidth: ev.deviceWidth, deviceHeight: ev.deviceHeight };
        this.frameSrc.set(`data:image/jpeg;base64,${ev.data}`);
        this.fpsCount++;
        break;
      case 'nav':
        this.setUrl(ev.url);
        break;
      case 'closed':
        this.mirrorId.set(null);
        this.frameSrc.set(null);
        break;
      case 'result':
        break;
    }
  }

  private setUrl(url: string): void {
    this.pageUrl.set(url);
    if (!this.urlFocused()) this.urlInput.set(url === 'about:blank' ? '' : url);
    this.urlChange.emit(url);
  }

  private async stopMirror(): Promise<void> {
    const id = this.mirrorId();
    if (!id) return;
    this.mirrorId.set(null);
    try { await this.svc.mirrorStop(id); } catch { /* already gone */ }
  }

  private send(method: string, params?: Record<string, unknown>): void {
    const id = this.mirrorId();
    if (!id) return;
    void this.svc.mirrorSend(id, method, params).catch(() => {});
  }

  // ── Navigation controls ──────────────────────────────────────────

  navigate(): void {
    const raw = this.urlInput().trim();
    if (!raw) return;
    let url = raw;
    const looksLikeUrl = /^[a-z]+:\/\//i.test(raw) || (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw) && !raw.includes(' '));
    if (!/^[a-z]+:\/\//i.test(raw)) {
      url = looksLikeUrl ? `https://${raw}` : `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
    }
    this.send('Page.navigate', { url });
    this.urlFocused.set(false);
    this.mirrorHost?.nativeElement.focus();
  }

  goBack(): void { this.send('Runtime.evaluate', { expression: 'history.back()' }); }
  goForward(): void { this.send('Runtime.evaluate', { expression: 'history.forward()' }); }
  reload(): void { this.send('Page.reload', {}); }

  // ── Input forwarding ─────────────────────────────────────────────

  private mods(ev: MouseEvent | KeyboardEvent): number {
    return (ev.altKey ? MOD_ALT : 0) | (ev.ctrlKey ? MOD_CTRL : 0) | (ev.metaKey ? MOD_META : 0) | (ev.shiftKey ? MOD_SHIFT : 0);
  }

  /** Viewport CSS coords: the <img> fills the pane width, so its rect maps 1:1. */
  private toPage(ev: MouseEvent): { x: number; y: number } | null {
    const img = this.mirrorImg?.nativeElement;
    if (!img || !this.frameMeta.deviceWidth) return null;
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: Math.round(((ev.clientX - r.left) / r.width) * this.frameMeta.deviceWidth),
      y: Math.round(((ev.clientY - r.top) / r.height) * this.frameMeta.deviceHeight),
    };
  }

  private cdpButton(ev: MouseEvent): string {
    return ev.button === 1 ? 'middle' : ev.button === 2 ? 'right' : 'left';
  }

  onMouseMove(ev: MouseEvent): void {
    const p = this.toPage(ev);
    if (!p) return;
    this.pendingMove = { ...p, mods: this.mods(ev) };
    if (this.moveRaf) return;
    this.moveRaf = requestAnimationFrame(() => {
      this.moveRaf = 0;
      const m = this.pendingMove;
      this.pendingMove = null;
      if (m) this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: m.x, y: m.y, modifiers: m.mods });
    });
  }

  onMouseDown(ev: MouseEvent): void {
    ev.preventDefault();
    this.mirrorHost?.nativeElement.focus();
    const p = this.toPage(ev);
    if (!p) return;
    this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', ...p, button: this.cdpButton(ev), clickCount: ev.detail || 1, modifiers: this.mods(ev),
    });
  }

  onMouseUp(ev: MouseEvent): void {
    const p = this.toPage(ev);
    if (!p) return;
    this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', ...p, button: this.cdpButton(ev), clickCount: ev.detail || 1, modifiers: this.mods(ev),
    });
  }

  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const p = this.toPage(ev);
    if (!p) return;
    this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', ...p, deltaX: Math.round(ev.deltaX), deltaY: Math.round(ev.deltaY), modifiers: this.mods(ev),
    });
  }

  onContextMenu(ev: MouseEvent): void { ev.preventDefault(); }

  onKey(ev: KeyboardEvent): void {
    if (!this.mirrorId()) return;
    // Let the app keep its own global shortcuts (Cmd+R reload, Cmd+Q…).
    if (ev.metaKey && !['c', 'v', 'x', 'a', 'z'].includes(ev.key.toLowerCase())) return;
    ev.preventDefault();
    ev.stopPropagation();
    const down = ev.type === 'keydown';
    const printable = ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey;
    const text = ev.key === 'Enter' ? '\r' : printable ? ev.key : undefined;
    const params: Record<string, unknown> = {
      type: down ? (text ? 'keyDown' : 'rawKeyDown') : 'keyUp',
      key: ev.key,
      code: ev.code,
      windowsVirtualKeyCode: ev.keyCode,
      nativeVirtualKeyCode: ev.keyCode,
      modifiers: this.mods(ev),
      autoRepeat: ev.repeat,
    };
    if (down && text) { params['text'] = text; params['unmodifiedText'] = text; }
    // Cmd/Ctrl shortcuts (copy/paste/select-all) travel as editing commands.
    if (down && (ev.metaKey || ev.ctrlKey)) {
      const cmd = { c: 'Copy', v: 'Paste', x: 'Cut', a: 'SelectAll', z: ev.shiftKey ? 'Redo' : 'Undo' }[ev.key.toLowerCase()];
      if (cmd) params['commands'] = [cmd];
    }
    this.send('Input.dispatchKeyEvent', params);
  }

  // ─────────────────────────────────────────────────────────────────

  trackTarget(_i: number, t: ChromeTarget): string { return t.id; }

  shortTitle(t: ChromeTarget): string {
    const s = (t.title || t.url || this.translate.instant('BROWSER_PAGE.New tab')).trim();
    return s.length > 28 ? `${s.slice(0, 26)}…` : s;
  }
}
