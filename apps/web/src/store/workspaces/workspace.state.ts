export interface WorkspaceSummary {
  id: string;
  name: string;
  projectPath: string;
  activeSessionsCount: number;
  teamId?: number | null;
  teamName?: string | null;
  projectId?: number | null;
  projectName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacesState {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  loading: boolean;
  error: string | null;
}

export const initialWorkspacesState: WorkspacesState = {
  workspaces: [],
  activeWorkspaceId: null,
  loading: false,
  error: null,
};

/**
 * Local cache of the last successfully-loaded workspace list. Mirrors the
 * sessions cache (session.state.ts): the sidebar groups sessions by workspace,
 * so an empty workspace list at boot makes every cached session render as
 * standalone until the first local store fetch lands, then everything re-groups.
 * Hydrating synchronously keeps the initial paint already organized.
 */
const WORKSPACES_CACHE_KEY = 'promptops_workspaces_cache_v1';

export function readWorkspacesCache(): WorkspaceSummary[] | null {
  try {
    const raw = localStorage.getItem(WORKSPACES_CACHE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as WorkspaceSummary[];
    if (!Array.isArray(list)) return null;
    return list;
  } catch {
    return null;
  }
}

export function writeWorkspacesCache(workspaces: WorkspaceSummary[]): void {
  try {
    localStorage.setItem(WORKSPACES_CACHE_KEY, JSON.stringify(workspaces));
  } catch { /* quota/serialization issues are non-critical */ }
}

export function clearWorkspacesCache(): void {
  try {
    localStorage.removeItem(WORKSPACES_CACHE_KEY);
  } catch { /* non-critical */ }
}

/** Boot-time state hydrated from the local cache (see hydratedSessionsState). */
export const hydratedWorkspacesState: WorkspacesState = (() => {
  const cached = readWorkspacesCache();
  return cached
    ? { ...initialWorkspacesState, workspaces: cached }
    : initialWorkspacesState;
})();
