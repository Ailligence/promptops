import { environment } from "@environment/environment";

/**
 * Local mode: how the open-source edition of PromptOps works.
 *
 * Everything runs on this device. There is no account and no sign-in: the app
 * reads and writes its data through `DataBackend` (core/data), implemented
 * here by the desktop shell (`apps/desktop/src-tauri/src/local_data.rs`),
 * which keeps your sessions, workspaces and prompts in a local store
 * encrypted with the Session Vault (AES-256-GCM, key in your OS keychain).
 *
 * Features that only make sense with other people (teams, ranking, community
 * prompts, news) belong to PromptOps Desktop. Here they show a lock and a
 * link to download it, and no code for them runs.
 */
export const LOCAL_MODE: boolean = environment.localMode;

/** Token placeholder stored in local mode, so the app's session checks pass. It is never sent anywhere. */
export const LOCAL_SESSION_TOKEN = "local";

export const GITHUB_ISSUES_URL = "https://github.com/shellonback/promptops/issues";

/** Home page of PromptOps Desktop, the hosted edition. */
export const DESKTOP_SITE_URL = "https://www.promptoperations.ai/";

/** Opens a URL in the system browser (desktop shell), or a new tab as a fallback. */
export function openExternal(url: string): void {
  const api = (window as { promptops?: { openExternal?: (u: string) => unknown } }).promptops;
  if (api?.openExternal) {
    api.openExternal(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}
