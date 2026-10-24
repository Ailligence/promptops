import { Route } from "@angular/router";
import { cloudFeatureRoute, externalLinkRoute } from "@core/guard/cloud-feature.guard";
import { GITHUB_ISSUES_URL } from "@core/local-mode";
import { PROMPT_LIBRARY_ROUTES } from "./prompt-library/prompt-library-routing.module";
import { SESSION_ROUTES } from "./sessions/session-routing.module";
import { USER_SETTINGS_ROUTES } from "./user-settings/user-settings-routing.module";
import { PROVIDER_ACCOUNTS_ROUTES } from "./provider-accounts/provider-accounts-routing.module";
import { ONBOARDING_ROUTES } from "./onboarding/onboarding-routing.module";
import { USAGE_CENTER_ROUTES } from "./usage-center/usage-center-routing.module";

export const ADMIN_ROUTES: Route[] = [
  { path: "", redirectTo: "sessions", pathMatch: "full" },
  {
    path: "onboarding",
    children: ONBOARDING_ROUTES,
    data: { title: "Welcome" },
  },
  {
    path: "prompt-library",
    children: PROMPT_LIBRARY_ROUTES,
    data: { title: "Prompt Library" },
  },
  cloudFeatureRoute("ranking", "ranking"),
  cloudFeatureRoute("profile", "profile"),
  {
    path: "sessions",
    children: SESSION_ROUTES,
    data: { title: "Sessions" },
  },
  cloudFeatureRoute("teams", "teams"),
  {
    // Terminal is no longer a top-level page — kept as a redirect so old
    // bookmarks and saved quick-access links land on Sessions, where the
    // terminal modal lives now. See SessionViewComponent.openTerminalsPanel().
    path: "terminal",
    redirectTo: "/admin/sessions",
    pathMatch: "full",
  },
  {
    path: "usage",
    children: USAGE_CENTER_ROUTES,
    data: { title: "Usage Center" },
  },
  cloudFeatureRoute("organization", "organization"),

  {
    // Browser: prompt bar + provider CLI (Claude Code / Codex) on the left,
    // live mirror of the real Chrome tab on the right. Desktop app only.
    path: "browser",
    loadComponent: () =>
      import("./browser/browser.component").then((m) => m.BrowserPageComponent),
    data: { title: "Browser" },
  },
  {
    path: "plugin-page/:pluginId/:pageId",
    loadComponent: () =>
      import("./plugins/plugin-page.component").then(
        (m) => m.PluginPageComponent
      ),
    data: { title: "Plugin" },
  },
  {
    path: "plugins/create",
    loadComponent: () =>
      import("./plugins/plugin-studio.component").then(
        (m) => m.PluginStudioComponent
      ),
    data: { title: "Create a plugin" },
  },
  {
    path: "plugins",
    loadComponent: () =>
      import("./plugins/plugins.component").then((m) => m.PluginsComponent),
    data: { title: "Plugins" },
  },
  {
    path: "mcp",
    loadComponent: () =>
      import("./mcp-guide/mcp-guide.component").then((m) => m.McpGuideComponent),
    data: { title: "MCP" },
  },

  {
    path: "speed-test",
    loadComponent: () =>
      import("./speed-test/speed-test.component").then(
        (m) => m.SpeedTestComponent
      ),
    data: { title: "AI Agent Evals" },
  },
  // Feedback goes to GitHub Issues, where the community can see and discuss it.
  externalLinkRoute("feedback", GITHUB_ISSUES_URL),
  {
    path: "settings",
    children: USER_SETTINGS_ROUTES,
    data: { title: "Settings" },
  },
  {
    path: "provider-accounts",
    children: PROVIDER_ACCOUNTS_ROUTES,
    data: { title: "AI Accounts" },
  },
  {
    // PromptOps CLI now lives as a tab inside AI Accounts — keep old deep links working.
    path: "fcc-setup",
    redirectTo: "/admin/provider-accounts?tab=cli",
  },
  {
    path: "git-writer",
    loadComponent: () =>
      import("./git-writer/git-writer.component").then(
        (m) => m.GitWriterComponent
      ),
    data: { title: "AI Git Writer" },
  },
  // Pre-rename URL (bookmarks, release notes) → new home.
  {
    path: "mail-writer",
    redirectTo: "git-writer",
  },
  cloudFeatureRoute("morning", "morning"),

  cloudFeatureRoute("morning/:slug", "morning"),

];
