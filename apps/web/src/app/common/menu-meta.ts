export type MenuItemType = {
  key: string;
  label: string;
  isTitle?: boolean;
  icon?: string;
  url?: string;
  badge?: {
    variant: string;
    text: string;
  };
  parentKey?: string;
  isDisabled?: boolean;
  collapsed?: boolean;
  children?: MenuItemType[];
  custom?: boolean;
  roles?: string[];
  featureFlag?: string;
  /** Item added by a plugin: the plugin name. Shows the small puzzle piece instead of the badge. */
  fromPlugin?: string;
};

export type SubMenus = {
  item: MenuItemType;
  linkClassName?: string;
  subMenuClassName?: string;
  activeMenuItems?: Array<string>;
  toggleMenu?: (item: MenuItemType, status: boolean) => void;
  className?: string;
};

// The sidebar is grouped into intentional blocks (rendered via `isTitle`
// section headers). "Sessions", the core of the product, leads the list.
// Features that need a server live in a single collapsed "PromptOps Desktop"
// group at the bottom: each entry shows a lock and opens the dialog that
// explains it, so they never get in the way of the local workflow.
// NOTE: this is the Classic order. The minimal skin uses MENU_ITEMS_MINIMAL (below).
const DESKTOP_EDITION: MenuItemType = {
  key: "desktop-edition",
  label: "PromptOps Desktop",
  icon: "ti-cloud",
  custom: true,
  collapsed: true,
  children: [
    { key: "teams", label: "Teams", icon: "ti-users-group", url: "/admin/teams", custom: true, parentKey: "desktop-edition" },
    { key: "ranking", label: "Ranking", icon: "ti-trophy", url: "/admin/ranking", custom: true, parentKey: "desktop-edition" },
    { key: "morning-news", label: "AI & Tech News", icon: "ti-news", url: "/admin/morning", custom: true, parentKey: "desktop-edition" },
    { key: "explore", label: "Explore", icon: "ti-compass", url: "/admin/prompt-library/explore", custom: true, parentKey: "desktop-edition" },
    { key: "organization", label: "Organization", icon: "ti-building", url: "/admin/organization", custom: true, parentKey: "desktop-edition" },
  ],
};

export const MENU_ITEMS: MenuItemType[] = [
  // ── Workspace (core) — agent Sessions and the resources they use. ──
  {
    key: "sec-workspace",
    label: "Workspace",
    isTitle: true,
  },
  {
    key: "sessions",
    label: "Sessions",
    icon: "ti-terminal",
    url: "/admin/sessions",
    custom: true,
  },
  // ── Tools — sub-category: AI Accounts, Usage and MCP, the native tools the sessions rely on. ──
  {
    key: "tools",
    label: "Tools",
    icon: "ti-tool",
    custom: true,
    collapsed: true,
    children: [
      {
        key: "provider-accounts",
        label: "AI Accounts",
        icon: "ti-key",
        url: "/admin/provider-accounts",
        custom: true,
        parentKey: "tools",
      },
      {
        key: "usage",
        label: "Usage",
        icon: "ti-chart-donut-4",
        url: "/admin/usage",
        custom: true,
        parentKey: "tools",
      },
      {
        key: "mcp",
        label: "MCP",
        icon: "ti-plug-connected",
        url: "/admin/mcp",
        custom: true,
        parentKey: "tools",
        badge: {
          variant: "new-summer",
          text: "NEW",
        },
      },
    ],
  },
  // ── Plugins — sub-category: the catalog first, then the built-in plugins
  //    (Browser, AI Agent Evals, AI Git Writer: native pages, puzzle mark) and
  //    finally one entry per page contributed by the active registry plugins
  //    (injected at runtime by the sidebar). ──
  {
    key: "plugins",
    label: "Plugins",
    icon: "ti-puzzle",
    custom: true,
    collapsed: true,
    badge: {
      variant: "beta",
      text: "BETA",
    },
    children: [
      {
        key: "plugins-catalog",
        label: "Catalog",
        icon: "ti-layout-grid",
        url: "/admin/plugins",
        custom: true,
        parentKey: "plugins",
      },
      {
        key: "browser",
        label: "Browser",
        icon: "ti-world",
        url: "/admin/browser",
        custom: true,
        parentKey: "plugins",
      },
      {
        key: "speed-test",
        label: "AI Agent Evals",
        icon: "ti-gauge",
        url: "/admin/speed-test",
        custom: true,
        parentKey: "plugins",
      },
      {
        key: "git-writer",
        label: "AI Git Writer",
        icon: "ti-file-pencil",
        url: "/admin/git-writer",
        custom: true,
        parentKey: "plugins",
      },
    ],
  },

  // ── Settings — standalone entry right after the two sub-categories. ──
  {
    key: "user-settings",
    label: "Settings",
    icon: "ti-adjustments",
    url: "/admin/settings",
    custom: true,
  },

  // ── Prompts — your prompt library. ──
  {
    key: "sec-prompts",
    label: "Prompts",
    isTitle: true,
  },
  {
    key: "prompt-library",
    label: "My Prompts",
    icon: "ti-book",
    url: "/admin/prompt-library",
    custom: true,
    featureFlag: "prompt_library",
  },
  {
    key: "feedback",
    label: "Feedback",
    icon: "ti-message-report",
    url: "/admin/feedback",
    custom: true,
  },

  // ── Hosted edition — one collapsed group at the bottom. ──
  DESKTOP_EDITION,
];

// ── Minimal UI order (audit UX 10/2026) ──
// Same items as MENU_ITEMS (same key/url/roles/featureFlag), so role/flag
// filters, built-in plugins and plugin pages work the same way. In minimal:
//   1. "AI Agent Evals" leaves the Plugins group and becomes a standalone item ("Quality" section);
//   2. Feedback disappears from the sidebar: it is already in the user menu at the bottom of the rail.
const pickMenu = (key: string): MenuItemType => {
  const found = MENU_ITEMS.find((m) => m.key === key);
  if (!found) throw new Error(`menu-meta: item ${key} missing`);
  return found;
};
const pickChild = (parent: string, key: string): MenuItemType => {
  const found = pickMenu(parent).children?.find((c) => c.key === key);
  if (!found) throw new Error(`menu-meta: child ${parent}/${key} missing`);
  return found;
};

export const MENU_ITEMS_MINIMAL: MenuItemType[] = [
  ...["sec-workspace", "sessions", "tools"].map(pickMenu),
  {
    ...pickMenu("plugins"),
    children: (pickMenu("plugins").children ?? []).filter((c) => c.key !== "speed-test"),
  },
  pickMenu("user-settings"),

  // ── Quality — agent evaluations, outside the Workspace. ──
  { key: "sec-quality", label: "Quality", isTitle: true },
  { ...pickChild("plugins", "speed-test"), parentKey: undefined },

  // ── Prompts ──
  pickMenu("sec-prompts"),
  pickMenu("prompt-library"),

  pickMenu("desktop-edition"),
];

export const MENU_ITEMS_THEME: MenuItemType[] = [];

export const HORIZONTAL_MENU_ITEM: MenuItemType[] = [];
