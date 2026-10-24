import { Injectable, computed, inject, signal } from '@angular/core';
import { OrgPolicyService } from '@core/services/org-policy.service';
import { AuditEntry, InstalledPlugin, PluginConfigField, PluginRegistryService, PluginSessionButtonDecl, RegistryPlugin } from './plugin-registry.service';
import { ABSORBED_BY_BUILTIN } from './builtin-plugins.service';

interface TauriApi {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> };
}

export interface PluginToast { pluginId: string; name: string; message: string }
export interface PluginProposal { pluginId: string; name: string; title: string; text: string; untrusted: true }
/** What a plugin registered at startup: section contract, events, actions. */
export interface PluginContributions {
  contributions: { kind: string; methods: string[] }[];
  events: string[];
  actions: string[];
}

/** Menu item added by an active plugin of the `pages` section. */
export interface PluginMenuPage { pluginId: string; pluginName: string; pageId: string; title: string; icon: string; dev?: boolean; sessionsRead?: boolean }
/** Button of an active plugin in the row below the session composer. */
export interface PluginSessionButton { pluginId: string; pluginName: string; dev: boolean; fingerprint: string; button: PluginSessionButtonDecl }
/**
 * When to ask for confirmation before sending a button's proposed prompt to an agent.
 * It is chosen by whoever uses the plugin, NEVER the plugin: it lives in the main window's localStorage,
 * which plugin code (in another view, sandboxed) cannot reach.
 */
export type SessionButtonConfirmPolicy = 'always' | 'session' | 'never';

/** Zones where a plugin created in the Studio can act (real extension points of the app). */
export type StudioZone = 'session-buttons' | 'header-buttons' | 'composer-buttons' | 'runtime-buttons' | 'page' | 'sidebar' | 'tasks';
export interface StudioPlugin { path: string; pluginId: string; name: string; zone: StudioZone; reused: boolean }

/** Repository the user chose for a plugin: the plugin sees the handle, never the path. */
export interface PluginRepoGrant { handle: string; name: string; branch: string }
/** Confirmation request: writing a file or running a prompt on the user's model. */
export type PluginConfirmRequest =
  | { id: string; pluginId: string; name: string; kind: 'write'; repo: string; path: string; exists: boolean; bytes: number; content: string }
  | { id: string; pluginId: string; name: string; kind: 'ai'; provider: string; model: string | null; promptChars: number; prompt: string }
  | { id: string; pluginId: string; name: string; kind: 'benchmark'; samples: number; calls: number; models: { id: string; label: string; providerLabel: string }[] }
  /** A plugin that can read a repository talks to a host for the first time, in this app launch. */
  | { id: string; pluginId: string; name: string; kind: 'egress'; host: string; method: string; repo: string | null; bytes: number; content: string; truncated: boolean };
export interface PluginPageUpdate { pluginId: string; pageId: string; view: unknown; seq: number }
/** What the page sends to the plugin: a click or a field change, plus all the form values. */
export interface PluginPageEvent { type: 'action' | 'change'; id: string; values: Record<string, unknown> }

/** How the app stores the plugin's credentials. `keychain` = encrypted, with the key in the system keychain. */
/** 'vault': sealed with the Session Vault key (vault.key) where no system keychain is available. */
export interface PluginSecretStorage { storage: 'keychain' | 'vault' | 'file' | 'none'; lost: boolean; reason: string | null }
export interface PluginConfig { values: Record<string, unknown>; secretsSet: string[]; fields: PluginConfigField[] | null; secretStorage?: PluginSecretStorage }

/**
 * Bridge to the Tauri v2 desktop plugin runtime. On web the
 * runtime doesn't exist: `available` is false and every method is a safe no-op.
 *
 * The webapp is the TRUSTED part: it talks to the registry and passes
 * Rust the approved version. Plugin code never goes through here.
 */
const AUTO_UPDATE_KEY = 'po.plugins.autoUpdate';
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
/** On by default: updates still go through scanning and admin approval. */
function readAutoUpdate(): boolean {
  try { return localStorage.getItem(AUTO_UPDATE_KEY) !== '0'; } catch { return true; }
}

@Injectable({ providedIn: 'root' })
export class PluginRuntimeService {
  private orgPolicy = inject(OrgPolicyService);

  /** Organization policy (Enterprise): registry and local plugins can be switched off. */
  private assertPluginsAllowed(): void {
    if (!this.orgPolicy.canInstallPlugins()) {
      throw new Error(this.orgPolicy.deniedMessage('Installing plugins'));
    }
  }

  private registry = inject(PluginRegistryService);
  private started = false;

  readonly installed = signal<InstalledPlugin[]>([]);
  readonly developerMode = signal(false);
  readonly contributions = signal<Record<string, PluginContributions>>({});
  readonly updates = signal<{ pluginId: string; installed: string; available: string }[]>([]);
  /** Approved updates applied automatically, if they don't ask for new permissions. A per-device choice. */
  readonly autoUpdate = signal(readAutoUpdate());
  /** Plugins being updated right now: the button shows the wait. */
  readonly updating = signal<string[]>([]);
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  /** Latest plugin messages, shown by the layout. */
  readonly toasts = signal<(PluginToast & { id: number })[]>([]);
  readonly proposal = signal<PluginProposal | null>(null);
  /** Queued confirmations: the first one is shown. */
  readonly confirms = signal<PluginConfirmRequest[]>([]);
  readonly pageUpdate = signal<PluginPageUpdate | null>(null);
  /** Menu items of active plugins. Title and icon come from the approved manifest, not from the running code. */
  readonly menuPages = computed<PluginMenuPage[]>(() =>
    this.installed()
      .filter((p) => p.enabled && p.category === 'pages')
      .flatMap((p) => (p.pages ?? []).filter((page) => page.place !== 'sidebar')
        .map((page) => ({ pluginId: p.pluginId, pluginName: p.name, pageId: page.id, title: page.title, icon: page.icon }))));
  /**
   * `place: "sidebar"` items: at the top of the sessions sidebar, above folders and workspaces.
   * `sessionsRead`: the page receives a snapshot of folders, workspaces, sessions and agents (names and states only).
   */
  readonly sidebarPages = computed<PluginMenuPage[]>(() =>
    this.installed()
      .filter((p) => p.enabled && p.category === 'pages')
      .flatMap((p) => (p.pages ?? []).filter((page) => page.place === 'sidebar').map((page) => ({
        pluginId: p.pluginId, pluginName: p.name, pageId: page.id, title: page.title, icon: page.icon, dev: p.dev,
        sessionsRead: p.permissions.includes('sessions:read'),
      }))));

  /**
   * Session buttons of active plugins. Title and icon come from the approved manifest.
   * `fingerprint` changes with version and permissions: a "don't ask" policy does not survive an update.
   */
  readonly sessionButtons = computed<PluginSessionButton[]>(() =>
    this.installed()
      .filter((p) => p.enabled)
      .flatMap((p) => (p.sessionButtons ?? []).map((button) => ({
        pluginId: p.pluginId, pluginName: p.name, dev: p.dev,
        fingerprint: `${p.version}|${[...p.permissions].sort().join(',')}|${p.bundleSha256 || 'dev'}`, button,
      }))));
  /**
   * A button's proposal: a new sub-agent to prefill in the spawn composer.
   * The terminal row writes it, the Action Center consumes it: starting it stays with the user.
   */
  readonly composerPrefill = signal<{ seq: number; prompt: string; provider: string | null; mode: string | null; name: string | null } | null>(null);
  /** "Ask once per session" permissions already granted, in memory: reset when the app closes. */
  private readonly sessionAllowances = new Set<string>();

  private get tauri(): TauriApi | null {
    const t = (window as any).__TAURI__;
    return t?.core?.invoke ? (t as TauriApi) : null;
  }

  get available(): boolean {
    return this.tauri !== null;
  }

  private invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const t = this.tauri;
    if (!t) return Promise.reject(new Error('Plugin runtime is available in the desktop app only'));
    return t.core.invoke<T>(cmd, args);
  }

  /** Idempotent: listens to runtime events and syncs revocations and updates. */
  async start(): Promise<void> {
    const t = this.tauri;
    if (!t || this.started) return;
    this.started = true;
    let seq = 0;
    await t.event.listen<PluginToast>('plugin-toast', (e) => {
      const toast = { ...e.payload, id: ++seq };
      this.toasts.update((list) => [...list.slice(-3), toast]);
      setTimeout(() => this.toasts.update((list) => list.filter((x) => x.id !== toast.id)), 6000);
    });
    await t.event.listen<PluginProposal>('plugin-prompt-proposal', (e) => this.proposal.set(e.payload));
    await t.event.listen<PluginConfirmRequest>('plugin-confirm', (e) => this.confirms.update((list) => [...list, e.payload]));
    await t.event.listen<{ id: string }>('plugin-confirm-expired', (e) => this.confirms.update((list) => list.filter((c) => c.id !== e.payload.id)));
    await t.event.listen<Omit<PluginPageUpdate, 'seq'>>('plugin-page-update', (e) => this.pageUpdate.set({ ...e.payload, seq: ++seq }));
    await this.refresh();
    this.syncWithRegistry().catch(() => undefined);
    // An app left open for days must see new versions without a restart.
    this.syncTimer ??= setInterval(() => this.syncWithRegistry().catch(() => undefined), SYNC_EVERY_MS);
  }

  async refresh(): Promise<void> {
    if (!this.available) return;
    const res = await this.invoke<{ developerMode: boolean; plugins: InstalledPlugin[]; contributions: Record<string, PluginContributions> }>('plugin_runtime_list');
    this.installed.set(res.plugins);
    this.contributions.set(res.contributions ?? {});
    this.developerMode.set(res.developerMode);
    this.dropAbsorbed(res.plugins).catch(() => undefined);
  }

  /**
   * Registry plugins superseded by a built-in section (AI Agent Evals, AI Git Writer): the menu
   * item is the native one, so a registry install would stay mounted and invisible.
   * Uninstalled only once per id; if it fails (e.g. dev link) we don't insist.
   */
  private readonly absorbedDropped = new Set<string>();
  private async dropAbsorbed(plugins: InstalledPlugin[]): Promise<void> {
    const stale = plugins.filter((p) => ABSORBED_BY_BUILTIN[p.pluginId] && !this.absorbedDropped.has(p.pluginId));
    if (!stale.length) return;
    for (const p of stale) {
      this.absorbedDropped.add(p.pluginId);
      try { await this.invoke('plugin_runtime_uninstall', { pluginId: p.pluginId }); } catch { /* leave it as is */ }
    }
    const res = await this.invoke<{ developerMode: boolean; plugins: InstalledPlugin[]; contributions: Record<string, PluginContributions> }>('plugin_runtime_list');
    this.installed.set(res.plugins);
    this.contributions.set(res.contributions ?? {});
  }

  /** Disables plugins revoked in the registry and flags approved updates. */
  async syncWithRegistry(): Promise<void> {
    const ids = this.installed().filter((p) => !p.dev).map((p) => p.pluginId);
    if (!ids.length) return;
    const items = await this.registry.registryStatus(ids);
    const res = await this.invoke<{ revoked: string[]; updates: { pluginId: string; installed: string; available: string }[] }>(
      'plugin_runtime_apply_registry_status', { items });
    this.updates.set(res.updates);
    if (res.revoked.length) await this.refresh();
    if (this.autoUpdate()) {
      for (const u of res.updates) {
        // New permissions = consent needed: the update waits for the button.
        await this.update(u.pluginId).catch(() => undefined);
      }
    }
  }

  setAutoUpdate(on: boolean): void {
    this.autoUpdate.set(on);
    try { localStorage.setItem(AUTO_UPDATE_KEY, on ? '1' : '0'); } catch { /* stays in memory */ }
    if (on) this.syncWithRegistry().catch(() => undefined);
  }

  /** The approved version in the catalog, if different from the installed one. */
  async availableUpdate(pluginId: string): Promise<{ plugin: RegistryPlugin; newPermissions: string[] } | null> {
    const inst = this.installed().find((p) => p.pluginId === pluginId);
    if (!inst || inst.dev) return null;
    const plugin = (await this.registry.catalog(inst.category)).find((p) => p.plugin_id === pluginId);
    if (!plugin?.bundle_sha256 || plugin.bundle_sha256 === inst.bundleSha256) return null;
    const wanted = Array.isArray((plugin.manifest as any)?.permissions) ? ((plugin.manifest as any).permissions as string[]) : [];
    return { plugin, newPermissions: wanted.filter((perm) => !inst.permissions.includes(perm)) };
  }

  /**
   * Updates to the approved version keeping configuration, credentials and enabled state.
   * If the new version asks for more permissions it does NOT update: it returns 'needs-approval'
   * and the choice goes to the user (Catalog → Update, with the list of permissions).
   */
  async update(pluginId: string, approvedPermissions = false): Promise<'updated' | 'needs-approval' | 'up-to-date'> {
    if (this.updating().includes(pluginId)) return 'up-to-date';
    this.updating.update((list) => [...list, pluginId]);
    try {
      const found = await this.availableUpdate(pluginId);
      if (!found) {
        this.updates.update((list) => list.filter((u) => u.pluginId !== pluginId));
        return 'up-to-date';
      }
      if (found.newPermissions.length && !approvedPermissions) return 'needs-approval';
      const wasOn = !!this.installed().find((p) => p.pluginId === pluginId)?.enabled;
      await this.install(found.plugin);
      // Rust keeps it enabled only if permissions did not grow: here the user approved them.
      if (wasOn && !this.installed().find((p) => p.pluginId === pluginId)?.enabled) await this.setEnabled(pluginId, true);
      return 'updated';
    } finally {
      this.updating.update((list) => list.filter((id) => id !== pluginId));
    }
  }

  /** Installs (or updates to) the active version in the catalog. Does not enable the plugin. */
  async install(p: RegistryPlugin): Promise<InstalledPlugin> {
    this.assertPluginsAllowed();
    if (!p.version || !p.commit_sha || !p.bundle_sha256 || !p.manifest || !p.repo_url) {
      throw new Error('This plugin has no approved version');
    }
    const plugin = await this.invoke<InstalledPlugin>('plugin_runtime_install', {
      spec: {
        pluginId: p.plugin_id, name: p.name, version: p.version, category: p.category, repoUrl: p.repo_url,
        commitSha: p.commit_sha, bundleSha256: p.bundle_sha256, sourceDir: p.source_dir, manifest: p.manifest,
      },
    });
    this.updates.update((list) => list.filter((u) => u.pluginId !== p.plugin_id));
    await this.refresh();
    return plugin;
  }

  async uninstall(pluginId: string): Promise<void> {
    await this.invoke('plugin_runtime_uninstall', { pluginId });
    await this.refresh();
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    if (enabled) this.assertPluginsAllowed();
    await this.invoke('plugin_runtime_set_enabled', { pluginId, enabled });
    await this.refresh();
  }

  getConfig(pluginId: string): Promise<PluginConfig> {
    return this.invoke<PluginConfig>('plugin_runtime_get_config', { pluginId });
  }

  /** `secrets`: an empty string removes, a missing key leaves it as is. Values never come back. */
  setConfig(pluginId: string, values: Record<string, unknown>, secrets: Record<string, string>): Promise<void> {
    return this.invoke('plugin_runtime_set_config', { pluginId, values, secrets });
  }

  audit(pluginId: string | null, limit = 100): Promise<AuditEntry[]> {
    return this.invoke<AuditEntry[]>('plugin_runtime_audit', { pluginId, limit });
  }

  async setDeveloperMode(enabled: boolean): Promise<void> {
    if (enabled) this.assertPluginsAllowed();
    await this.invoke('plugin_runtime_set_developer_mode', { enabled });
    await this.refresh();
  }

  async linkLocal(path: string): Promise<void> {
    this.assertPluginsAllowed();
    await this.invoke('plugin_runtime_link_local', { path });
    await this.refresh();
  }

  /**
   * Calls a method of the section contract. The plugin only returns DATA:
   * whoever shows it must treat it as text, never as HTML.
   */
  invokeContract<T = unknown>(pluginId: string, kind: string, method: string, args: unknown[] = []): Promise<T> {
    return this.invoke<T>('plugin_runtime_invoke', { pluginId, kind, method, args });
  }

  /** Forwards an app event to the plugins. Metadata ONLY: never prompts, replies, paths or code. */
  emitEvent(name: string, payload: Record<string, unknown>): Promise<void> {
    return this.invoke('plugin_runtime_emit_event', { name, payload });
  }

  // ── `pages` section ────────────────────────────────────────────────────────

  /** `context`: for `sidebar` pages with `sessions:read`, `{ workspace: WorkspaceSnapshot }`. */
  openPage(pluginId: string, pageId: string, context: Record<string, unknown> = {}): Promise<unknown> {
    return this.invokeContract(pluginId, 'pages', 'open', [pageId, context]);
  }

  pageEvent(pluginId: string, pageId: string, event: PluginPageEvent & { workspace?: unknown }): Promise<unknown> {
    return this.invokeContract(pluginId, 'pages', 'event', [pageId, event]);
  }

  /** The user picked a folder in a plugin's page: Rust replies with the handle. */
  grantRepo(pluginId: string, path: string): Promise<PluginRepoGrant> {
    return this.invoke<PluginRepoGrant>('plugin_runtime_grant_repo', { pluginId, path });
  }

  async answerConfirm(id: string, approved: boolean): Promise<void> {
    this.confirms.update((list) => list.filter((c) => c.id !== id));
    await this.invoke('plugin_runtime_confirm', { id, approved }).catch(() => undefined);
  }

  // ── Session buttons ────────────────────────────────────────────────────────

  /** The plugin replies with ONE proposal (insert, prompt, spawn, panel or toast): the app executes it. */
  runSessionButton(pluginId: string, buttonId: string, context: Record<string, unknown>): Promise<unknown> {
    return this.invokeContract(pluginId, 'session', 'action', [buttonId, context]);
  }

  private policyKey(b: PluginSessionButton): string {
    return `po.plugin.confirmPolicy.${b.pluginId}.${b.button.id}`;
  }

  confirmPolicy(b: PluginSessionButton): SessionButtonConfirmPolicy {
    try {
      const saved = JSON.parse(localStorage.getItem(this.policyKey(b)) || 'null') as { policy?: string; fingerprint?: string } | null;
      if (saved?.fingerprint === b.fingerprint && (saved.policy === 'session' || saved.policy === 'never')) return saved.policy;
    } catch { /* corrupted value: fall back to the default */ }
    return 'always';
  }

  setConfirmPolicy(b: PluginSessionButton, policy: SessionButtonConfirmPolicy): void {
    try {
      if (policy === 'always') localStorage.removeItem(this.policyKey(b));
      else localStorage.setItem(this.policyKey(b), JSON.stringify({ policy, fingerprint: b.fingerprint }));
    } catch { /* storage unavailable: stays "ask every time" */ }
    if (policy === 'always') {
      for (const key of [...this.sessionAllowances]) if (key.startsWith(`${b.pluginId}/${b.button.id}/`)) this.sessionAllowances.delete(key);
    }
  }

  /** Is the confirmation window needed? `sessionId` is the session it is sent in. */
  needsConfirm(b: PluginSessionButton, sessionId: string): boolean {
    const policy = this.confirmPolicy(b);
    if (policy === 'never') return false;
    if (policy === 'session') return !this.sessionAllowances.has(`${b.pluginId}/${b.button.id}/${sessionId}`);
    return true;
  }

  allowForSession(b: PluginSessionButton, sessionId: string): void {
    this.sessionAllowances.add(`${b.pluginId}/${b.button.id}/${sessionId}`);
  }

  /** Message shown like plugin ones, for outcomes the app decides. */
  pushToast(name: string, pluginId: string, message: string): void {
    const toast = { pluginId, name, message, id: Date.now() + Math.random() };
    this.toasts.update((list) => [...list.slice(-3), toast]);
    setTimeout(() => this.toasts.update((list) => list.filter((x) => x.id !== toast.id)), 6000);
  }

  // ── Plugin Studio ──────────────────────────────────────────────────────────

  studioPrepare(request: { zone: StudioZone; name: string; slug: string; goal: string; unique?: boolean }): Promise<StudioPlugin> {
    return this.invoke<StudioPlugin>('plugin_studio_prepare', { request });
  }

  studioChanges(path: string): Promise<{ status: string; path: string }[]> {
    return this.invoke('plugin_studio_changes', { path });
  }

  studioRunTests(path: string): Promise<{ ok: boolean; output: string; timedOut: boolean }> {
    return this.invoke('plugin_studio_run_tests', { path });
  }

  runAction(pluginId: string, actionId: string, context?: unknown): Promise<void> {
    return this.invoke('plugin_runtime_run_action', { pluginId, actionId, context: context ?? null });
  }
}
