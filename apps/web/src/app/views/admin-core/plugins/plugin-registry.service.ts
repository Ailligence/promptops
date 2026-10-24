import { Injectable, inject } from '@angular/core';
import { OFFICIAL_INDEX_URL } from './plugin-section-guide';
import { LOCAL_MODE } from '@core/local-mode';

export type PublisherKind = 'user' | 'team';
export type PluginStatus = 'draft' | 'published' | 'revoked';
export type VersionStatus = 'submitted' | 'approved' | 'rejected';

export interface PluginManifest {
  id: string;
  version: string;
  category: string;
  entry: string;
  permissions: string[];
  /** AI providers the author declares the plugin works with. Optional. */
  providers?: string[];
  config?: { fields?: PluginConfigField[] };
  [k: string]: unknown;
}

export interface PluginConfigField {
  key: string;
  type: 'text' | 'secret' | 'number' | 'boolean' | 'select' | 'multiselect' | 'url';
  label?: string;
  required?: boolean;
  default?: unknown;
  options?: { value: string; label: string }[];
}

export interface ScanCheck {
  id: string;
  status: 'pass' | 'info' | 'warn' | 'fail';
  title: string;
  detail: string;
  evidence: { file: string; line: number; excerpt: string }[];
}

export interface ScanReport {
  commit_sha: string;
  scanned_at: string;
  files: { path: string; size: number; sha256: string }[];
  checks: ScanCheck[];
  blocking: number;
  warnings: number;
  verdict: 'clean' | 'review' | 'blocked';
}

export interface PluginVersionInfo {
  id: number;
  version: string;
  status: VersionStatus;
  commit_sha: string;
  bundle_sha256: string;
  source_dir: string | null;
  permissions: string[];
  /** Extra permissions compared to the active version: the first thing to look at in review. */
  permissions_added: string[];
  permissions_removed: string[];
  review_note: string | null;
  scanned_at: string | null;
  scan_verdict: ScanReport['verdict'] | null;
  manifest?: PluginManifest;
  scan?: ScanReport | null;
}

/** Plugin installed in the desktop runtime (shape returned by Rust, camelCase). */
export interface InstalledPlugin {
  pluginId: string;
  name: string;
  version: string;
  category: string;
  commitSha: string;
  bundleSha256: string;
  permissions: string[];
  enabled: boolean;
  dev: boolean;
  source: string;
  /** GitHub repository declared in the manifest: used to show owner and avatar. */
  repository?: string | null;
  installedAt: number;
  disabledReason: string | null;
  /** Menu items declared in the approved manifest. `pages` section only. */
  pages?: PluginPageDecl[];
  /** AI providers declared in the manifest. */
  providers?: string[];
  /** Buttons of the row below the composer, from the approved manifest (`session:buttons` permission). */
  sessionButtons?: PluginSessionButtonDecl[];
}

export interface PluginPageDecl { id: string; title: string; icon: string; place?: 'menu' | 'sidebar' }
export type SessionButtonPlace = 'terminal' | 'header' | 'composer' | 'runtime';
export interface PluginSessionButtonDecl { id: string; title: string; icon: string; target: 'main' | 'subagent' | 'both'; place?: SessionButtonPlace }

export interface AuditEntry {
  ts: number;
  plugin: string;
  method: string;
  target?: unknown;
  ok: boolean;
  error?: string | null;
  ms?: number;
}

/** Readable description of a permission, for the approval screen. */
/** Permissions with a translated description (PLUGINS_PERMS.<id>). */
const KNOWN_PERMISSIONS = new Set([
  'secrets', 'storage', 'notify', 'sessions:read', 'tasks:read', 'tasks:write', 'prompt:propose',
  'git:read', 'workspace:write', 'ai:generate', 'ai:benchmark', 'session:buttons', 'composer:read',
]);

/**
 * What a permission lets a plugin do, in the UI language. `t` is the translate
 * function (TranslateService.instant); unknown permissions come back as their id.
 */
export function describePermission(p: string, t: (key: string, params?: Record<string, string>) => string): string {
  if (p.startsWith('net:')) return t('PLUGINS_PERMS.net', { host: p.slice(4) });
  return KNOWN_PERMISSIONS.has(p) ? t('PLUGINS_PERMS.' + p) : p;
}

export interface PluginPublisher {
  id: number;
  kind: PublisherKind;
  handle: string;
  display_name: string;
  website: string | null;
  avatar_url: string | null;
  /** true = blue check, granted only by an admin. */
  verified: boolean;
  verified_at: string | null;
  plugins_count: number;
  // Only in admin responses
  owner_label?: string;
  verification_note?: string | null;
  created_at?: string;
}

export interface RegistryPlugin {
  id: number;
  plugin_id: string;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  repo_url: string | null;
  status: PluginStatus;
  /** ACTIVE version in the catalog: the one the client installs and verifies. */
  version: string | null;
  commit_sha: string | null;
  bundle_sha256: string | null;
  source_dir: string | null;
  manifest: PluginManifest | null;
  publisher: PluginPublisher;
  /** Users who have it installed right now. Missing if the server can't tell yet. */
  installs_count?: number | null;
  updated_at: string;
  // Only for the author and admins
  revoked_note?: string | null;
  pending_version?: PluginVersionInfo | null;
  versions?: { id: number; version: string; status: VersionStatus; review_note: string | null; reviewed_at: string | null }[];
}

export interface PublisherOptions {
  publishers: PluginPublisher[];
  can_create: { user: boolean; teams: { id: number; name: string; avatar_url: string | null }[] };
}

/**
 * Plugin sections whose host is not in local mode: task sources feed the Teams
 * board, which this edition does not have.
 */
export const HIDDEN_PLUGIN_CATEGORIES: readonly string[] = LOCAL_MODE ? ['tasks'] : [];

/** True when a plugin targets a section this edition does not have. */
export function pluginTargetsMissingHost(p: { category: string; manifest?: PluginManifest | null }): boolean {
  if (!LOCAL_MODE) return false;
  return HIDDEN_PLUGIN_CATEGORIES.includes(p.category)
    || (p.manifest?.permissions ?? []).some((perm) => perm.startsWith('tasks:'));
}

const ALL_PLUGIN_CATEGORIES: { id: string; label: string; icon: string; hint: string }[] = [
  { id: 'tasks', label: 'Tasks & projects', icon: 'solar:checklist-minimalistic-bold-duotone', hint: 'Teams board' },
  { id: 'code', label: 'Code & repos', icon: 'solar:code-square-bold-duotone', hint: 'Git Explorer, AI Git Writer' },
  { id: 'data', label: 'Data & infra', icon: 'solar:database-bold-duotone', hint: 'Session side panels' },
  { id: 'providers', label: 'AI providers', icon: 'solar:key-bold-duotone', hint: 'AI Accounts, Usage, Evals' },
  { id: 'agent', label: 'Agent extensions', icon: 'solar:magic-stick-3-bold-duotone', hint: 'Spawn composer' },
  { id: 'context', label: 'Context', icon: 'solar:notebook-bold-duotone', hint: 'Prompts, Project Brief' },
  { id: 'notify', label: 'Notifications', icon: 'solar:bell-bing-bold-duotone', hint: 'Session events' },
  { id: 'pages', label: 'Pages & tools', icon: 'solar:widget-add-bold-duotone', hint: 'Its own entry in the menu' },
];

export const PLUGIN_CATEGORIES = ALL_PLUGIN_CATEGORIES.filter((c) => !HIDDEN_PLUGIN_CATEGORIES.includes(c.id));

/**
 * Plugin catalog. In this edition it is the public index of official plugins
 * on GitHub (promptops-plugin-templates/registry/official.json), fetched with
 * no credentials. Installing a plugin is verified in Rust against the commit
 * and bundle hash listed in the index. No PromptOps server is involved.
 */
@Injectable({ providedIn: 'root' })
export class PluginRegistryService {
  private async officialIndex(): Promise<RegistryPlugin[]> {
    const res = await fetch(OFFICIAL_INDEX_URL, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error('official index unavailable');
    const data = await res.json();
    return (Array.isArray(data?.plugins) ? data.plugins : [])
      .filter((p: any) => p?.status === 'published' && typeof p.plugin_id === 'string' && p.manifest && p.commit_sha && p.bundle_sha256)
      .map((p: any, i: number) => ({
        ...p,
        id: -(i + 1),
        publisher: { id: -(i + 1), website: null, avatar_url: null, verified_at: null, plugins_count: 1, ...p.publisher },
      }));
  }

  /** Official plugins, filtered by section, search text and verified publishers. */
  async catalog(category?: string, q?: string, verifiedOnly = false): Promise<RegistryPlugin[]> {
    const term = (q ?? '').trim().toLowerCase();
    return (await this.officialIndex()).filter((p) =>
      // An explicit category still finds an installed plugin's entry.
      (category ? p.category === category : !pluginTargetsMissingHost(p))
      && (!verifiedOnly || p.publisher.verified)
      && (!term || [p.name, p.plugin_id, p.description ?? ''].some((t) => t.toLowerCase().includes(term))));
  }

  /**
   * Status of installed plugins, from the index. A plugin missing from the
   * index is not treated as revoked: revocation is always explicit.
   */
  async registryStatus(pluginIds: string[]): Promise<unknown[]> {
    if (!pluginIds.length) return [];
    const official = await this.officialIndex().catch(() => [] as RegistryPlugin[]);
    return official
      .filter((p) => pluginIds.includes(p.plugin_id))
      .map((p) => ({ plugin_id: p.plugin_id, status: 'published', version: p.version, commit_sha: p.commit_sha, bundle_sha256: p.bundle_sha256, revoked_note: null }));
  }
}
