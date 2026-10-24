import { Injectable } from '@angular/core';

/**
 * Dev Links — discover the local dev URLs a project exposes (frontend dev
 * server, API, docs, storybook, …) and open them in the system browser.
 *
 * A fast heuristic scan runs on the native desktop side (cached, TTL 4h,
 * never on the hot path). The session's provider CLI can additionally refine
 * the list (AI). Local-only: nothing leaves the device.
 */

export interface DevLink {
  label: string;
  url: string;
  description?: string;
  source?: string;
}

interface ScanResult {
  links: DevLink[];
  aiSource: string;
  cached: boolean;
}

// Per-project cache of the *combined* (heuristic + AI) list, so reopening the
// modal is instant and the AI call is not repeated. Keyed by workspace path.
const CACHE_KEY = 'promptops_dev_links_cache';
const CACHE_MAX = 30;

export interface CachedDevLinks {
  links: DevLink[];
  aiGeneratedAt: number | null;
}

/**
 * True for a URL on this machine (localhost, 127.x, ::1, *.localhost).
 * The provider CLI reads the repository to propose links, and a repository can
 * steer it: only local dev servers are accepted from it.
 */
export function isLocalDevUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function readCache(): Record<string, CachedDevLinks> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

@Injectable({ providedIn: 'root' })
export class DevLinksService {
  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  private get api(): any {
    return (window as any).promptops;
  }

  get isAvailable(): boolean {
    return this.isDesktop && typeof this.api.devLinksScan === 'function';
  }

  /** Heuristic scan of the project's config files (cached in main, TTL 4h). */
  async scan(cwd: string, force = false): Promise<ScanResult> {
    if (!this.isAvailable) throw new Error('desktop_only');
    const res = await this.api.devLinksScan(cwd, force);
    if (!res?.ok) throw new Error(res?.error || 'scan_failed');
    return { links: res.links ?? [], aiSource: res.aiSource ?? '', cached: !!res.cached };
  }

  /** Open a dev URL in the system browser. */
  async open(url: string): Promise<void> {
    if (!this.isDesktop || typeof this.api.devLinksOpen !== 'function') throw new Error('desktop_only');
    const res = await this.api.devLinksOpen(url);
    if (!res?.ok) throw new Error(res?.error || 'open_failed');
  }

  private browserPromise: Promise<{ name: string; icon: string }> | null = null;

  /** Default browser name + iconify icon for the launcher button (memoized). */
  defaultBrowser(): Promise<{ name: string; icon: string }> {
    if (this.browserPromise) return this.browserPromise;
    const fallback = { name: 'Browser', icon: 'solar:global-linear' };
    if (!this.isDesktop || typeof this.api.devLinksDefaultBrowser !== 'function') {
      return Promise.resolve(fallback);
    }
    const p: Promise<{ name: string; icon: string }> = this.api
      .devLinksDefaultBrowser()
      .then((res: any) => res?.browser ?? fallback)
      .catch(() => fallback);
    this.browserPromise = p;
    return p;
  }

  /**
   * Ask the session's provider CLI to refine the list: it can grep the project
   * (runs in `cwd`) and returns clean JSON links. Never for plain shells.
   */
  async generateAiLinks(provider: string, cwd: string, aiSource: string): Promise<DevLink[]> {
    if (!this.isDesktop || typeof this.api.aiGenerateText !== 'function') throw new Error('desktop_only');
    const prompt =
      'You are analyzing a local software project to list the LOCAL dev URLs a developer would open in a browser ' +
      '(frontend dev server, API/backend, API docs/Swagger, Storybook, database admin UIs like Adminer/pgAdmin/Mailhog, etc).\n' +
      'Search the project files (docker-compose, package.json scripts, framework configs, .env, README) to find the exact ports.\n' +
      'Return ONLY a JSON array, no prose, no markdown fences. Each item: ' +
      '{"label": string, "url": "http://localhost:PORT", "description": string}. ' +
      'Use localhost URLs only. Max 12 items. If unsure of a port, omit the item.\n\n' +
      '=== HEURISTIC HINTS (already found by a quick scan) ===\n' +
      (aiSource || '(none)');
    const res = await this.api.aiGenerateText(prompt, provider, cwd);
    if (!res?.ok) throw new Error(res?.error || 'generate_failed');
    return this.parseAiLinks(res.text as string);
  }

  private parseAiLinks(text: string): DevLink[] {
    if (!text) return [];
    // Strip fences and pull the first JSON array out of the response.
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    try {
      const arr = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x.url === 'string' && isLocalDevUrl(x.url))
        .map((x) => ({
          label: String(x.label ?? x.url),
          url: String(x.url),
          description: x.description ? String(x.description) : undefined,
          source: 'ai',
        }));
    } catch {
      return [];
    }
  }

  /**
   * Silent background prefetch (mirrors the smart-action command scan): warms
   * the main-process cache and merges the heuristic links into the per-project
   * localStorage cache, so the modal opens already populated. Cheap + cached
   * (TTL 4h in main); safe to call on session load. Returns the merged list.
   */
  async prefetch(cwd: string): Promise<DevLink[]> {
    if (!this.isAvailable) return [];
    const res = await this.scan(cwd); // main-process TTL cache → usually no FS work
    const cached = this.getCached(cwd);
    const merged = this.mergeLists(cached?.links ?? [], res.links);
    this.saveCached(cwd, merged, cached?.aiGeneratedAt ?? null);
    return merged;
  }

  /** Merge lists de-duped by URL; AI-sourced entries win. */
  mergeLists(base: DevLink[], incoming: DevLink[]): DevLink[] {
    const byUrl = new Map<string, DevLink>();
    for (const l of base) byUrl.set(l.url, l);
    for (const l of incoming) {
      const existing = byUrl.get(l.url);
      if (!existing || l.source === 'ai') byUrl.set(l.url, l);
    }
    return [...byUrl.values()];
  }

  // ── Per-project cache (combined list) ──────────────────────────────

  getCached(cwd: string): CachedDevLinks | null {
    return readCache()[cwd] ?? null;
  }

  saveCached(cwd: string, links: DevLink[], aiGeneratedAt: number | null): void {
    const cache = readCache();
    cache[cwd] = { links, aiGeneratedAt };
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      keys.sort((a, b) => (cache[a]?.aiGeneratedAt ?? 0) - (cache[b]?.aiGeneratedAt ?? 0));
      for (const stale of keys.slice(0, keys.length - CACHE_MAX)) delete cache[stale];
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* quota — modal still holds the list */
    }
  }
}
