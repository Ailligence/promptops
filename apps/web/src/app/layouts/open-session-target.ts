import type { Router } from '@angular/router';
import type { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { setActiveSession } from '@/store/sessions/session.actions';
import { getSessionsByWorkspaceId } from '@/store/sessions/session.selectors';
import { setActiveWorkspace } from '@/store/workspaces/workspace.actions';

/**
 * Key the Sessions view reads on start to pick the session to show
 * (session-view.component.ts, ACTIVE_SESSION_KEY). Written here too, so the
 * view's own restore does not switch back to the previous session.
 */
const ACTIVE_SESSION_KEY = 'promptops_active_session';

/**
 * Opens a session or a workspace from outside the Sessions view (topbar search,
 * Quick Access). Navigating with `?session=<id>` alone did nothing: the view acts
 * only on `session` + `focus`, and never on `?workspace=`. A workspace opens its
 * oldest session, as the voice command "open workspace" does.
 */
export async function openSessionTarget(router: Router, store: Store, type: 'session' | 'workspace', id: string): Promise<boolean> {
  if (type === 'workspace') {
    store.dispatch(setActiveWorkspace({ workspaceId: id }));
    const sessions = await firstValueFrom(store.select(getSessionsByWorkspaceId(id)));
    const first = [...(sessions ?? [])].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))[0];
    if (!first) return router.navigate(['/admin/sessions']);
    id = first.id;
  }
  try { localStorage.setItem(ACTIVE_SESSION_KEY, id); } catch { /* storage unavailable: the query param still opens it */ }
  store.dispatch(setActiveSession({ sessionId: id }));
  return router.navigate(['/admin/sessions'], { queryParams: { session: id, focus: true } });
}
