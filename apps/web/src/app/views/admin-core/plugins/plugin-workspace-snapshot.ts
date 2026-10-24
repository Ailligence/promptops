import { SessionSummary } from '@/store/sessions/session.state';
import { WorkspaceSummary } from '@/store/workspaces/workspace.state';
import { SidebarFolder } from '../sessions/services/sidebar-folder-api.service';
import { SubAgent } from '../sessions/services/sub-agent.service';

/**
 * Snapshot of folders, workspaces, sessions and agents passed to the `sidebar` pages of plugins with
 * `sessions:read`. Only NAMES and STATES, as the permission promises: no paths, prompts, output or stored ids.
 * The ids are the session's local ones, which the plugin can only send back in a `floorplan` block.
 */
export type SnapshotStatus = 'working' | 'waiting' | 'idle' | 'standby' | 'error' | 'off';
export interface SnapshotAgent { id: string; name: string; provider: string; status: SnapshotStatus; isMain: boolean }
export interface SnapshotSession {
  id: string; name: string; provider: string; status: SnapshotStatus; standby: boolean;
  workspaceId: string | null; folderId: string | null; pending: number; agents: SnapshotAgent[];
}
export interface SnapshotWorkspace { id: string; name: string; folderId: string | null }
export interface SnapshotFolder { id: string; name: string; color: string | null }
export interface WorkspaceSnapshot { folders: SnapshotFolder[]; workspaces: SnapshotWorkspace[]; sessions: SnapshotSession[]; takenAt: string }

function sessionStatus(s: SessionSummary): SnapshotStatus {
  if (s.standbyAt) return 'standby';
  switch (s.status) {
    case 'running': case 'in_progress': return 'working';
    case 'waiting_input': return 'waiting';
    case 'error': return 'error';
    case 'exited': case 'completed': return 'off';
    default: return 'idle';
  }
}

function agentStatus(a: SubAgent): SnapshotStatus {
  switch (a.status) {
    case 'running': case 'in_progress': case 'spawning': return 'working';
    case 'waiting_input': return 'waiting';
    case 'error': return 'error';
    case 'exited': case 'completed': return 'off';
    default: return 'idle';
  }
}

export function buildWorkspaceSnapshot(folders: SidebarFolder[], workspaces: WorkspaceSummary[], sessions: SessionSummary[], subAgents: SubAgent[]): WorkspaceSnapshot {
  const wsFolder = new Map<string, string>();
  const sessionFolder = new Map<string, string>();
  for (const f of folders) {
    for (const id of f.workspaceIds) wsFolder.set(id, f.id);
    for (const id of f.sessionIds) sessionFolder.set(id, f.id);
  }
  // Same join as the sidebar: by id, or by project folder (which stays here, it does not go to the plugin).
  const wsOf = (s: SessionSummary): WorkspaceSummary | undefined =>
    workspaces.find((w) => s.workspaceId === w.id) ?? workspaces.find((w) => !!s.workspace?.path && s.workspace.path === w.projectPath);
  const used = new Set<string>();
  const out: SnapshotSession[] = sessions.map((s) => {
    const ws = wsOf(s);
    if (ws) used.add(ws.id);
    const status = sessionStatus(s);
    const agents: SnapshotAgent[] = [
      { id: 'main', name: s.name, provider: s.provider, status, isMain: true },
      ...subAgents.filter((a) => a.parentSessionId === s.id).map((a) => ({
        id: a.id, name: (a.title || a.role || 'Agent').slice(0, 80), provider: a.provider, status: s.standbyAt ? 'standby' as const : agentStatus(a), isMain: false,
      })),
    ];
    return {
      id: s.id, name: s.name, provider: s.provider, status, standby: !!s.standbyAt,
      workspaceId: ws?.id ?? null,
      folderId: ws ? wsFolder.get(ws.id) ?? null : (s.dbId ? sessionFolder.get(s.dbId) ?? null : null),
      pending: s.pendingInteractionCount || 0, agents,
    };
  });
  return {
    folders: folders.map((f) => ({ id: f.id, name: f.name, color: f.color })),
    workspaces: workspaces.filter((w) => used.has(w.id)).map((w) => ({ id: w.id, name: w.name, folderId: wsFolder.get(w.id) ?? null })),
    sessions: out,
    takenAt: new Date().toISOString(),
  };
}
