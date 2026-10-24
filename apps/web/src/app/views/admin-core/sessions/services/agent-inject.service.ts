import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '@environment/environment';

// ── Plugin (MCP servers from external registry) ──────────────────

export interface MarketplacePlugin {
  name: string;
  package: string;
  description: string;
  icon: string;
  category: 'search' | 'dev-tools' | 'communication' | 'data' | 'ai' | 'other';
  author: string;
  downloads?: number;
  version?: string;
}

// ── Skill (built in or user-imported from GitHub) ─────────────

export interface AgentSkill {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: 'code' | 'review' | 'ops' | 'analysis' | 'custom';
  prompt_template?: string;
  source?: 'builtin' | 'custom';
  sourceUrl?: string;
}

// ── Catalog (curated MCP/Skills/Plugins) ───────────

export interface CatalogSecretSpec {
  key: string;
  label: string;
  envVar: string;
}

/** A catalog item (camelCase, as the desktop returns it). */
export interface CatalogItem {
  itemId: string;
  kind: 'mcp' | 'skill' | 'plugin';
  name: string;
  description?: string;
  icon?: string;
  sector?: string;
  trust?: 'official' | 'verified' | 'community';
  requiresSecrets?: CatalogSecretSpec[];
  /** Per-provider install recipes. Opaque to the webapp — consumed by the materializer. */
  install: Record<string, unknown>;
}

/** What gets passed to the spawn so the agent installs these for real. */
export interface ExtensionSelectionPayload {
  items: CatalogItem[];
  /** envVar → value. In-memory only; injected into the spawned process env. */
  secrets: Record<string, string>;
}

/** A skill found under `~/.agents` by the desktop app (extensions_local_skills). */
export interface LocalSkill {
  slug: string;
  name: string;
  description: string;
  dirPath: string;
  root: string;
}

const CUSTOM_SKILLS_STORAGE_KEY = 'promptops:custom-skills';

// ── Service ──────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AgentInjectService {
  private http = inject(HttpClient);

  plugins = signal<MarketplacePlugin[]>([]);
  skills = signal<AgentSkill[]>([]);
  customSkills = signal<AgentSkill[]>([]);
  loadingPlugins = signal(false);
  loadingSkills = signal(false);
  loadingCatalog = signal(false);
  importingSkill = signal(false);
  importError = signal<string | null>(null);

  constructor() {
    this.customSkills.set(this.loadCustomSkillsFromStorage());
  }

  /** Bridge to the native desktop process (only present inside the desktop app). */
  private get desktop(): {
    listCatalog?: (q: { kind: string; provider: string; sector?: string; search?: string }) => Promise<{ ok: boolean; items?: CatalogItem[]; error?: string }>;
    listLocalSkills?: () => Promise<{ ok: boolean; items?: LocalSkill[] }>;
  } | undefined {
    return (window as unknown as { promptops?: any }).promptops;
  }

  /**
   * Catalog items (MCP / Skills / Plugins) installable for `provider`. The
   * desktop catalog is empty in this edition, so the curated list below is
   * used; outside the desktop app or on any error it is used as well.
   */
  async fetchCatalog(kind: 'mcp' | 'skill' | 'plugin', provider: string): Promise<CatalogItem[]> {
    if (kind === 'skill') {
      const [local, remote] = await Promise.all([this.fetchLocalSkills(), this.fetchRemoteCatalog(kind, provider)]);
      return [...local, ...remote.filter(r => !local.some(l => l.name === r.name))];
    }
    return this.fetchRemoteCatalog(kind, provider);
  }

  /**
   * Skills the user keeps centralized in `~/.agents` (cross-harness convention,
   * linked into each CLI via symlinks). Desktop only; read-only scan. On spawn
   * the folder is linked into the workspace (`skill-link`), not copied, so the
   * skill's scripts/references come along and edits in ~/.agents show up live.
   */
  async fetchLocalSkills(): Promise<CatalogItem[]> {
    const bridge = this.desktop;
    if (!bridge?.listLocalSkills) return [];
    try {
      const res = await bridge.listLocalSkills();
      if (!res?.ok || !Array.isArray(res.items)) return [];
      return res.items.map(s => ({
        itemId: `skill.local.${s.slug}`,
        kind: 'skill' as const,
        name: s.name,
        description: s.description || `Local skill · ${s.dirPath}`,
        icon: 'solar:folder-with-files-bold-duotone',
        sector: 'local',
        trust: 'community' as const,
        install: {
          'claude-code-cli': {
            strategy: 'skill-link',
            targetRelPath: `.claude/skills/${s.slug}`,
            format: 'markdown',
            payload: s.dirPath,
          },
        },
      }));
    } catch {
      return [];
    }
  }

  private async fetchRemoteCatalog(kind: 'mcp' | 'skill' | 'plugin', provider: string): Promise<CatalogItem[]> {
    this.loadingCatalog.set(true);
    try {
      const bridge = this.desktop;
      if (bridge?.listCatalog) {
        try {
          const res = await bridge.listCatalog({ kind, provider });
          if (res?.ok && Array.isArray(res.items) && res.items.length > 0) return res.items;
        } catch {
          // fall through to the curated fallback
        }
      }
      // Empty desktop catalog → curated list.
      return this.getFallbackCatalog(kind, provider);
    } finally {
      this.loadingCatalog.set(false);
    }
  }

  /**
   * Build the spawn payload from selected catalog items + entered secret values.
   * Only secrets actually required by the selected items are forwarded.
   */
  buildExtensionSelection(items: CatalogItem[], secrets: Record<string, string>): ExtensionSelectionPayload {
    const neededEnvVars = new Set<string>();
    for (const item of items) {
      for (const spec of item.requiresSecrets ?? []) neededEnvVars.add(spec.envVar);
    }
    const filtered: Record<string, string> = {};
    for (const envVar of neededEnvVars) {
      const value = secrets[envVar];
      if (value != null && value !== '') filtered[envVar] = value;
    }
    return { items, secrets: filtered };
  }

  // ── Curated catalog (used while the desktop catalog is empty) ──
  // Recipes target claude-code-cli only.

  private fbMcpStdio(server: string, args: string[], env?: Record<string, string>): Record<string, unknown> {
    const entry: Record<string, unknown> = { command: 'npx', args: ['-y', ...args] };
    if (env) entry['env'] = env;
    return {
      'claude-code-cli': {
        strategy: 'config-file',
        targetRelPath: '.promptops/extensions/mcp.json',
        format: 'json',
        mergeKey: 'mcpServers',
        launchFlag: '--mcp-config',
        payload: { [server]: entry },
      },
    };
  }

  private fbMcpHttp(server: string, url: string): Record<string, unknown> {
    return {
      'claude-code-cli': {
        strategy: 'config-file',
        targetRelPath: '.promptops/extensions/mcp.json',
        format: 'json',
        mergeKey: 'mcpServers',
        launchFlag: '--mcp-config',
        payload: { [server]: { type: 'http', url } },
      },
    };
  }

  private fbSkill(slug: string, description: string, body: string): Record<string, unknown> {
    return {
      'claude-code-cli': {
        strategy: 'skill-folder',
        targetRelPath: `.claude/skills/${slug}/SKILL.md`,
        format: 'markdown',
        payload: `---\nname: ${slug}\ndescription: ${description}\n---\n\n${body}\n`,
      },
    };
  }

  private fbPlugin(marketplace: string, repo: string, plugin: string): Record<string, unknown> {
    return {
      'claude-code-cli': {
        strategy: 'config-file',
        targetRelPath: '.claude/settings.json',
        format: 'json',
        // no mergeKey → deep-merge marketplace + enabledPlugins into settings root
        payload: {
          extraKnownMarketplaces: { [marketplace]: { source: { repo, source: 'github' } } },
          enabledPlugins: { [`${plugin}@${marketplace}`]: true },
        },
      },
    };
  }

  private getFallbackCatalog(kind: 'mcp' | 'skill' | 'plugin', provider: string): CatalogItem[] {
    // Fallback recipes only target Claude Code.
    if (provider !== 'claude-code-cli') return [];

    const mcp: CatalogItem[] = [
      { itemId: 'mcp.github', kind: 'mcp', name: 'GitHub', sector: 'dev-tools', trust: 'official',
        description: 'Read/search repos, issues and PRs via the GitHub API.',
        requiresSecrets: [{ key: 'github_token', label: 'GitHub Personal Access Token', envVar: 'GITHUB_TOKEN' }],
        install: this.fbMcpStdio('github', ['@modelcontextprotocol/server-github'], { GITHUB_TOKEN: '${GITHUB_TOKEN}' }) },
      { itemId: 'mcp.filesystem', kind: 'mcp', name: 'Filesystem', sector: 'dev-tools', trust: 'official',
        description: 'Scoped file read/write access to the current workspace.',
        install: this.fbMcpStdio('filesystem', ['@modelcontextprotocol/server-filesystem', '${WORKSPACE}']) },
      { itemId: 'mcp.postgres', kind: 'mcp', name: 'PostgreSQL', sector: 'data', trust: 'official',
        description: 'Inspect schema and run read-only SQL queries.',
        requiresSecrets: [{ key: 'database_url', label: 'Postgres connection string', envVar: 'DATABASE_URL' }],
        install: this.fbMcpStdio('postgres', ['@modelcontextprotocol/server-postgres', '${DATABASE_URL}']) },
      { itemId: 'mcp.brave-search', kind: 'mcp', name: 'Brave Search', sector: 'research', trust: 'official',
        description: 'Web and local search via the Brave Search API.',
        requiresSecrets: [{ key: 'brave_api_key', label: 'Brave Search API key', envVar: 'BRAVE_API_KEY' }],
        install: this.fbMcpStdio('brave-search', ['@modelcontextprotocol/server-brave-search'], { BRAVE_API_KEY: '${BRAVE_API_KEY}' }) },
      { itemId: 'mcp.slack', kind: 'mcp', name: 'Slack', sector: 'comms', trust: 'official',
        description: 'Read channels and post messages to Slack.',
        requiresSecrets: [
          { key: 'slack_bot_token', label: 'Slack Bot Token', envVar: 'SLACK_BOT_TOKEN' },
          { key: 'slack_team_id', label: 'Slack Team ID', envVar: 'SLACK_TEAM_ID' },
        ],
        install: this.fbMcpStdio('slack', ['@modelcontextprotocol/server-slack'], { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}', SLACK_TEAM_ID: '${SLACK_TEAM_ID}' }) },
      { itemId: 'mcp.puppeteer', kind: 'mcp', name: 'Puppeteer', sector: 'dev-tools', trust: 'official',
        description: 'Drive headless Chrome to navigate and screenshot pages.',
        install: this.fbMcpStdio('puppeteer', ['@modelcontextprotocol/server-puppeteer']) },
      { itemId: 'mcp.memory', kind: 'mcp', name: 'Memory', sector: 'ai', trust: 'official',
        description: 'Persistent knowledge-graph memory across turns.',
        install: this.fbMcpStdio('memory', ['@modelcontextprotocol/server-memory']) },
      { itemId: 'mcp.sequential-thinking', kind: 'mcp', name: 'Sequential Thinking', sector: 'ai', trust: 'official',
        description: 'Structured step-by-step reasoning tool.',
        install: this.fbMcpStdio('sequential-thinking', ['@modelcontextprotocol/server-sequential-thinking']) },
      { itemId: 'mcp.context7', kind: 'mcp', name: 'Context7', sector: 'research', trust: 'verified',
        description: 'Up-to-date library/framework docs on demand.',
        install: this.fbMcpStdio('context7', ['@upstash/context7-mcp']) },
      { itemId: 'mcp.sentry', kind: 'mcp', name: 'Sentry', sector: 'devops', trust: 'verified',
        description: 'Query Sentry issues and stack traces.',
        install: this.fbMcpHttp('sentry', 'https://mcp.sentry.dev/mcp') },
      { itemId: 'mcp.gitlab', kind: 'mcp', name: 'GitLab', sector: 'dev-tools', trust: 'official',
        description: 'Merge requests, issues and pipelines via the GitLab API.',
        requiresSecrets: [{ key: 'gitlab_token', label: 'GitLab Personal Access Token', envVar: 'GITLAB_PERSONAL_ACCESS_TOKEN' }],
        install: this.fbMcpStdio('gitlab', ['@modelcontextprotocol/server-gitlab'], { GITLAB_PERSONAL_ACCESS_TOKEN: '${GITLAB_PERSONAL_ACCESS_TOKEN}' }) },
      { itemId: 'mcp.gdrive', kind: 'mcp', name: 'Google Drive', sector: 'data', trust: 'official',
        description: 'Search and read files from Google Drive.',
        install: this.fbMcpStdio('gdrive', ['@modelcontextprotocol/server-gdrive']) },
      { itemId: 'mcp.google-maps', kind: 'mcp', name: 'Google Maps', sector: 'data', trust: 'official',
        description: 'Geocoding, directions and place search.',
        requiresSecrets: [{ key: 'gmaps_key', label: 'Google Maps API key', envVar: 'GOOGLE_MAPS_API_KEY' }],
        install: this.fbMcpStdio('google-maps', ['@modelcontextprotocol/server-google-maps'], { GOOGLE_MAPS_API_KEY: '${GOOGLE_MAPS_API_KEY}' }) },
      { itemId: 'mcp.aws-kb', kind: 'mcp', name: 'AWS Knowledge Base', sector: 'devops', trust: 'official',
        description: 'Retrieve from an AWS Bedrock knowledge base.',
        requiresSecrets: [
          { key: 'aws_key', label: 'AWS Access Key ID', envVar: 'AWS_ACCESS_KEY_ID' },
          { key: 'aws_secret', label: 'AWS Secret Access Key', envVar: 'AWS_SECRET_ACCESS_KEY' },
        ],
        install: this.fbMcpStdio('aws-kb-retrieval', ['@modelcontextprotocol/server-aws-kb-retrieval'], { AWS_ACCESS_KEY_ID: '${AWS_ACCESS_KEY_ID}', AWS_SECRET_ACCESS_KEY: '${AWS_SECRET_ACCESS_KEY}' }) },
      { itemId: 'mcp.everart', kind: 'mcp', name: 'EverArt', sector: 'design', trust: 'official',
        description: 'AI image generation via the EverArt API.',
        requiresSecrets: [{ key: 'everart_key', label: 'EverArt API key', envVar: 'EVERART_API_KEY' }],
        install: this.fbMcpStdio('everart', ['@modelcontextprotocol/server-everart'], { EVERART_API_KEY: '${EVERART_API_KEY}' }) },
      { itemId: 'mcp.playwright', kind: 'mcp', name: 'Playwright', sector: 'dev-tools', trust: 'verified',
        description: 'Cross-browser automation and E2E via Playwright.',
        install: this.fbMcpStdio('playwright', ['@playwright/mcp@latest']) },
      { itemId: 'mcp.firecrawl', kind: 'mcp', name: 'Firecrawl', sector: 'research', trust: 'verified',
        description: 'Crawl and scrape websites into clean markdown.',
        requiresSecrets: [{ key: 'firecrawl_key', label: 'Firecrawl API key', envVar: 'FIRECRAWL_API_KEY' }],
        install: this.fbMcpStdio('firecrawl', ['firecrawl-mcp'], { FIRECRAWL_API_KEY: '${FIRECRAWL_API_KEY}' }) },
      { itemId: 'mcp.kubernetes', kind: 'mcp', name: 'Kubernetes', sector: 'devops', trust: 'verified',
        description: 'Inspect clusters, pods and deployments.',
        install: this.fbMcpStdio('kubernetes', ['mcp-server-kubernetes']) },
      { itemId: 'mcp.exa', kind: 'mcp', name: 'Exa Search', sector: 'research', trust: 'verified',
        description: 'Neural web search built for AI.',
        requiresSecrets: [{ key: 'exa_key', label: 'Exa API key', envVar: 'EXA_API_KEY' }],
        install: this.fbMcpStdio('exa', ['exa-mcp-server'], { EXA_API_KEY: '${EXA_API_KEY}' }) },
      { itemId: 'mcp.tavily', kind: 'mcp', name: 'Tavily', sector: 'research', trust: 'verified',
        description: 'Search and extract API tuned for LLMs.',
        requiresSecrets: [{ key: 'tavily_key', label: 'Tavily API key', envVar: 'TAVILY_API_KEY' }],
        install: this.fbMcpStdio('tavily', ['tavily-mcp@latest'], { TAVILY_API_KEY: '${TAVILY_API_KEY}' }) },
      { itemId: 'mcp.figma', kind: 'mcp', name: 'Figma', sector: 'design', trust: 'verified',
        description: 'Read Figma design files and export layout data.',
        requiresSecrets: [{ key: 'figma_key', label: 'Figma API key', envVar: 'FIGMA_API_KEY' }],
        install: this.fbMcpStdio('figma', ['figma-developer-mcp', '--stdio'], { FIGMA_API_KEY: '${FIGMA_API_KEY}' }) },
    ];

    const plugin: CatalogItem[] = [
      { itemId: 'plugin.superpowers', kind: 'plugin', name: 'Superpowers', sector: 'ai', trust: 'verified',
        description: 'Core skills library: TDD, debugging, collaboration and proven techniques.',
        install: this.fbPlugin('superpowers-marketplace', 'obra/superpowers-marketplace', 'superpowers') },
      { itemId: 'plugin.superpowers-chrome', kind: 'plugin', name: 'Superpowers Chrome', sector: 'dev-tools', trust: 'community',
        description: 'Direct Chrome DevTools Protocol access via a browsing skill.',
        install: this.fbPlugin('superpowers-marketplace', 'obra/superpowers-marketplace', 'superpowers-chrome') },
      { itemId: 'plugin.elements-of-style', kind: 'plugin', name: 'Elements of Style', sector: 'research', trust: 'community',
        description: 'Writing guidance based on Strunk’s The Elements of Style.',
        install: this.fbPlugin('superpowers-marketplace', 'obra/superpowers-marketplace', 'elements-of-style') },
      { itemId: 'plugin.episodic-memory', kind: 'plugin', name: 'Episodic Memory', sector: 'ai', trust: 'community',
        description: 'Semantic search over past Claude Code conversations.',
        install: this.fbPlugin('superpowers-marketplace', 'obra/superpowers-marketplace', 'episodic-memory') },
      { itemId: 'plugin.superpowers-lab', kind: 'plugin', name: 'Superpowers Lab', sector: 'ai', trust: 'community',
        description: 'Experimental skills: tmux automation, MCP discovery, Slack messaging.',
        install: this.fbPlugin('superpowers-marketplace', 'obra/superpowers-marketplace', 'superpowers-lab') },
      { itemId: 'plugin.impeccable', kind: 'plugin', name: 'Impeccable', sector: 'design', trust: 'community',
        description: 'Design vocabulary and frontend skills (/polish, /audit, /typeset…).',
        install: this.fbPlugin('impeccable', 'pbakaus/impeccable', 'impeccable') },
    ];

    const skill: CatalogItem[] = [
      { itemId: 'skill.code-review', kind: 'skill', name: 'Code Review', sector: 'dev-tools', trust: 'official',
        description: 'Review the current diff for correctness, security and clarity.',
        install: this.fbSkill('code-review', 'Review the current diff for correctness bugs, security issues and clarity.',
          'Review the changes in the working tree.\n\n1. Run `git diff` and `git diff --staged`.\n2. Check correctness, edge cases, error handling, security and obvious performance traps.\n3. Report findings by severity with `file:line` and a concrete fix. Skip praise.') },
      { itemId: 'skill.commit', kind: 'skill', name: 'Commit Message', sector: 'dev-tools', trust: 'official',
        description: 'Generate a conventional-commit message from the staged diff.',
        install: this.fbSkill('commit', 'Write a conventional-commit message for the staged changes.',
          'Produce a commit message for the staged changes.\n\n1. Run `git diff --staged`.\n2. Infer type (feat/fix/refactor/docs/test/chore) and optional scope.\n3. Output a single subject (<=72 chars) plus a short body explaining the why. Do not commit unless asked.') },
      { itemId: 'skill.test-gen', kind: 'skill', name: 'Test Generator', sector: 'dev-tools', trust: 'official',
        description: 'Generate focused unit tests for the file or function in context.',
        install: this.fbSkill('test-gen', 'Generate focused unit tests for the target file or function.',
          'Write unit tests for the code in context.\n\n1. Detect the test framework from existing tests.\n2. Cover the happy path, boundaries and main error cases.\n3. Match the existing test style and keep each test independent.') },
      { itemId: 'skill.security-review', kind: 'skill', name: 'Security Review', sector: 'devops', trust: 'official',
        description: 'Audit the current changes for common security vulnerabilities.',
        install: this.fbSkill('security-review', 'Audit the pending changes for security vulnerabilities.',
          'Perform a security review of the changes on the current branch.\n\n1. Gather the diff against the base branch.\n2. Look for injection, broken authz, hardcoded secrets, SSRF, path traversal and missing input validation.\n3. For each issue give `file:line`, the class, an exploit sketch and a remediation.') },
      { itemId: 'skill.plan', kind: 'skill', name: 'Plan', sector: 'analysis', trust: 'official',
        description: 'Produce a step-by-step implementation plan before coding.',
        install: this.fbSkill('plan', 'Create an implementation plan for the requested change.',
          'Design an implementation plan.\n\n1. Restate the goal and constraints.\n2. List the files/modules to touch and the order of changes.\n3. Call out risks, edge cases and a rollback path. Do not write code yet.') },
      { itemId: 'skill.refactor', kind: 'skill', name: 'Refactor', sector: 'code', trust: 'official',
        description: 'Restructure the code in context without changing behavior.',
        install: this.fbSkill('refactor', 'Refactor the code in context for clarity and structure, preserving behavior.',
          'Refactor the target code.\n\n1. Identify duplication, long functions and unclear names.\n2. Apply small, behavior-preserving changes; keep tests green.\n3. Explain each change briefly.') },
      { itemId: 'skill.explain', kind: 'skill', name: 'Explain Code', sector: 'analysis', trust: 'official',
        description: 'Explain what a file, function or snippet does and why.',
        install: this.fbSkill('explain', 'Explain the selected code clearly.',
          'Explain the code in context.\n\n1. Summarize its purpose in one sentence.\n2. Walk through the key steps and data flow.\n3. Note gotchas, side effects and assumptions.') },
      { itemId: 'skill.debug', kind: 'skill', name: 'Debug', sector: 'code', trust: 'official',
        description: 'Diagnose a failing test, error or unexpected behavior.',
        install: this.fbSkill('debug', 'Diagnose and fix the reported bug.',
          'Debug the reported issue.\n\n1. Reproduce and read the error/stack trace.\n2. Form a hypothesis, then confirm it by inspecting the relevant code.\n3. Propose the minimal fix and a regression test.') },
      { itemId: 'skill.optimize', kind: 'skill', name: 'Optimize Performance', sector: 'analysis', trust: 'official',
        description: 'Profile and improve the performance of the code in context.',
        install: this.fbSkill('optimize', 'Find and fix performance bottlenecks in the code in context.',
          'Optimize the target code.\n\n1. Identify the hot path and its complexity.\n2. Propose changes (algorithm, caching, batching, I/O) with expected impact.\n3. Avoid premature micro-optimizations; measure where possible.') },
      { itemId: 'skill.simplify', kind: 'skill', name: 'Simplify', sector: 'code', trust: 'official',
        description: 'Reduce complexity and dead code in the changed files.',
        install: this.fbSkill('simplify', 'Simplify the changed code: reuse, fewer branches, less indirection.',
          'Simplify the code in context.\n\n1. Remove dead code and redundant branches.\n2. Prefer existing helpers over new abstractions.\n3. Keep behavior identical; show before/after for non-trivial changes.') },
      { itemId: 'skill.docs', kind: 'skill', name: 'Docs', sector: 'ops', trust: 'official',
        description: 'Generate or update documentation for the code in context.',
        install: this.fbSkill('docs', 'Write or update docs for the code in context.',
          'Document the target code.\n\n1. Add concise docstrings/JSDoc for public APIs.\n2. Update the README/usage section if behavior changed.\n3. Include a short example.') },
      { itemId: 'skill.pr-description', kind: 'skill', name: 'PR Description', sector: 'ops', trust: 'official',
        description: 'Write a clear pull-request description from the branch diff.',
        install: this.fbSkill('pr-description', 'Write a PR description from the current branch changes.',
          'Draft a pull-request description.\n\n1. Summarize what changed and why.\n2. Add a bulleted list of notable changes and any breaking changes.\n3. Include test notes and a checklist.') },
      { itemId: 'skill.changelog', kind: 'skill', name: 'Changelog', sector: 'ops', trust: 'official',
        description: 'Generate a changelog entry from recent commits.',
        install: this.fbSkill('changelog', 'Generate a changelog entry from recent commits.',
          'Produce a changelog entry.\n\n1. Read recent commits since the last tag.\n2. Group changes under Added / Changed / Fixed / Removed.\n3. Write user-facing, concise bullet points.') },
      { itemId: 'skill.dockerfile', kind: 'skill', name: 'Dockerfile', sector: 'devops', trust: 'official',
        description: 'Write a production-ready Dockerfile for the project.',
        install: this.fbSkill('dockerfile', 'Write a multi-stage, production-ready Dockerfile for this project.',
          'Author a Dockerfile.\n\n1. Detect the stack and build/run commands.\n2. Use a multi-stage build, a slim base and a non-root user.\n3. Add a .dockerignore and document the build/run commands.') },
      { itemId: 'skill.ci-pipeline', kind: 'skill', name: 'CI Pipeline', sector: 'devops', trust: 'official',
        description: 'Generate a CI workflow (build, test, lint) for the repo.',
        install: this.fbSkill('ci-pipeline', 'Generate a CI workflow that builds, tests and lints the project.',
          'Create a CI pipeline.\n\n1. Detect the package manager and scripts.\n2. Write a workflow with cache, install, lint, test and build steps.\n3. Run on push and pull_request.') },
      { itemId: 'skill.api-design', kind: 'skill', name: 'API Design', sector: 'analysis', trust: 'official',
        description: 'Design a clean REST/GraphQL endpoint for a feature.',
        install: this.fbSkill('api-design', 'Design a clean API endpoint for the requested feature.',
          'Design the API.\n\n1. Define the resource, methods, request/response shapes and status codes.\n2. Cover validation, errors, pagination and auth.\n3. Provide an example request/response.') },
      { itemId: 'skill.sql-optimize', kind: 'skill', name: 'SQL Optimize', sector: 'data', trust: 'official',
        description: 'Analyze and optimize a slow SQL query.',
        install: this.fbSkill('sql-optimize', 'Optimize the SQL query in context.',
          'Optimize the SQL.\n\n1. Read the query and its EXPLAIN plan if available.\n2. Suggest indexes, rewrites and join order changes.\n3. Note trade-offs and verify correctness.') },
      { itemId: 'skill.regex', kind: 'skill', name: 'Regex Builder', sector: 'code', trust: 'official',
        description: 'Build or explain a regular expression for a pattern.',
        install: this.fbSkill('regex', 'Build or explain a regex for the described pattern.',
          'Work on the regex.\n\n1. Restate the matching requirement and edge cases.\n2. Provide the pattern with flags and a short explanation of each part.\n3. Add a few passing and failing examples.') },
      { itemId: 'skill.type-fix', kind: 'skill', name: 'Type Fixer', sector: 'code', trust: 'official',
        description: 'Resolve TypeScript type errors without using any.',
        install: this.fbSkill('type-fix', 'Fix TypeScript type errors in context without resorting to any.',
          'Fix the type errors.\n\n1. Read the compiler error and the involved types.\n2. Prefer precise types, generics or narrowing over casts/any.\n3. Keep runtime behavior unchanged.') },
      { itemId: 'skill.accessibility', kind: 'skill', name: 'Accessibility Audit', sector: 'design', trust: 'official',
        description: 'Audit UI for a11y issues (WCAG) and propose fixes.',
        install: this.fbSkill('accessibility', 'Audit the UI in context for accessibility (WCAG) issues.',
          'Run an accessibility audit.\n\n1. Check semantics, labels, focus order, contrast and keyboard support.\n2. Map each issue to a WCAG criterion.\n3. Propose a concrete fix per issue.') },
      { itemId: 'skill.i18n-extract', kind: 'skill', name: 'i18n Extract', sector: 'ops', trust: 'official',
        description: 'Extract hardcoded UI strings into translation keys.',
        install: this.fbSkill('i18n-extract', 'Extract hardcoded strings in context into i18n keys.',
          'Extract translatable strings.\n\n1. Find user-facing literals in the templates/components.\n2. Replace them with translation keys following the project convention.\n3. Add the keys to the locale files.') },
      { itemId: 'skill.dependency-audit', kind: 'skill', name: 'Dependency Audit', sector: 'devops', trust: 'official',
        description: 'Review dependencies for risk, staleness and bloat.',
        install: this.fbSkill('dependency-audit', 'Audit the project dependencies for risk and staleness.',
          'Audit dependencies.\n\n1. Flag unmaintained, deprecated or duplicate packages.\n2. Note known vulnerabilities and major version lags.\n3. Recommend safe upgrades or replacements.') },
      { itemId: 'skill.error-handling', kind: 'skill', name: 'Error Handling', sector: 'code', trust: 'official',
        description: 'Add robust error handling to the code in context.',
        install: this.fbSkill('error-handling', 'Add robust, consistent error handling to the code in context.',
          'Harden error handling.\n\n1. Identify unhandled failures and silent catches.\n2. Add typed errors, clear messages and proper propagation.\n3. Avoid swallowing errors; log where appropriate.') },
      { itemId: 'skill.naming', kind: 'skill', name: 'Naming', sector: 'code', trust: 'official',
        description: 'Improve names of variables, functions and types.',
        install: this.fbSkill('naming', 'Improve naming in the code in context for clarity.',
          'Improve naming.\n\n1. Find vague or misleading names.\n2. Propose precise, convention-matching names.\n3. Apply the renames consistently across the scope.') },
    ];

    if (kind === 'mcp') return mcp;
    if (kind === 'skill') return skill;
    return plugin;
  }

  /**
   * Import a custom skill from a GitHub URL (SKILL.md with YAML frontmatter).
   * Persists the result in localStorage and merges it into the active skills list.
   */
  async importCustomSkillFromGithub(url: string): Promise<AgentSkill> {
    this.importingSkill.set(true);
    this.importError.set(null);
    try {
      const trimmed = url.trim();
      if (!trimmed) throw new Error('Enter a GitHub URL');

      const rawUrl = this.resolveGithubRawUrl(trimmed);
      const markdown = await firstValueFrom(
        this.http.get(rawUrl, { responseType: 'text' }),
      );
      const { frontmatter, body } = this.parseFrontmatter(markdown);
      const name = (frontmatter['name'] || '').trim();
      const description = (frontmatter['description'] || '').trim();

      if (!name) {
        throw new Error('SKILL.md is missing a "name" field in frontmatter');
      }

      const slug = this.slugify(name);
      if (this.customSkills().some(s => s.slug === slug)) {
        throw new Error(`A custom skill with slug "${slug}" is already imported`);
      }

      const skill: AgentSkill = {
        id: this.nextCustomId(),
        slug,
        name,
        description: description || 'Custom skill imported from GitHub',
        icon: 'simple-icons:github',
        category: 'custom',
        prompt_template: body,
        source: 'custom',
        sourceUrl: trimmed,
      };

      const updated = [...this.customSkills(), skill];
      this.customSkills.set(updated);
      this.persistCustomSkills(updated);
      this.skills.update(list => [...list, skill]);

      return skill;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to import skill';
      this.importError.set(message);
      throw err;
    } finally {
      this.importingSkill.set(false);
    }
  }

  /**
   * Remove a previously imported custom skill.
   */
  removeCustomSkill(id: number): void {
    const updated = this.customSkills().filter(s => s.id !== id);
    this.customSkills.set(updated);
    this.persistCustomSkills(updated);
    this.skills.update(list => list.filter(s => s.id !== id));
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private loadCustomSkillsFromStorage(): AgentSkill[] {
    try {
      const raw = localStorage.getItem(CUSTOM_SKILLS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(s =>
        s && typeof s === 'object' && typeof s.slug === 'string' && typeof s.name === 'string',
      );
    } catch {
      return [];
    }
  }

  private persistCustomSkills(skills: AgentSkill[]): void {
    try {
      localStorage.setItem(CUSTOM_SKILLS_STORAGE_KEY, JSON.stringify(skills));
    } catch {
      // storage unavailable (quota/private mode) — silent
    }
  }

  private nextCustomId(): number {
    const existing = [...this.customSkills(), ...this.skills()].map(s => s.id);
    const base = 100_000; // leave room for builtin integer ids
    return Math.max(base, ...existing) + 1;
  }

  private slugify(value: string): string {
    const slug = value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return slug || 'custom-skill';
  }

  /**
   * Convert common GitHub URL shapes into a raw.githubusercontent.com URL.
   * Supported inputs:
   *  - https://github.com/user/repo/blob/<branch>/path/SKILL.md
   *  - https://github.com/user/repo/tree/<branch>/path           → appends /SKILL.md
   *  - https://github.com/user/repo                              → uses main/SKILL.md
   *  - https://raw.githubusercontent.com/user/repo/branch/.../SKILL.md (pass-through)
   */
  private resolveGithubRawUrl(input: string): string {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new Error('Invalid URL');
    }

    if (parsed.hostname === 'raw.githubusercontent.com') {
      return parsed.toString();
    }
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
      throw new Error('Only github.com URLs are supported');
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      throw new Error('URL must reference a GitHub repository');
    }
    const [user, repo, kind, branch, ...rest] = segments;

    if (kind === 'blob' || kind === 'tree') {
      if (!branch) throw new Error('Missing branch in GitHub URL');
      let filePath = rest.join('/');
      if (!filePath.toLowerCase().endsWith('.md')) {
        filePath = filePath ? `${filePath}/SKILL.md` : 'SKILL.md';
      }
      return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${filePath}`;
    }

    return `https://raw.githubusercontent.com/${user}/${repo}/main/SKILL.md`;
  }

  /**
   * Minimal YAML frontmatter parser — handles the simple `key: value` lines
   * that Claude Code's SKILL.md spec requires. Avoids pulling a YAML lib.
   */
  private parseFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content.trim() };
    const [, yamlBlock, body] = match;
    const frontmatter: Record<string, string> = {};
    for (const line of yamlBlock.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      frontmatter[key] = rawValue.trim().replace(/^["']|["']$/g, '');
    }
    return { frontmatter, body: body.trim() };
  }

}
