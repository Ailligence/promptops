import { TestBed } from '@angular/core/testing';
import { appTestProviders } from '@/app/testing/app-test-providers';
import { SubAgentService } from '../services/sub-agent.service';
import { SessionSidebarComponent } from './session-sidebar.component';

/**
 * 200 sessions x 10 sub-agents. Measures one change-detection pass of the
 * sidebar with the grouped lookup against the old per-call filter over the
 * whole sub-agent list, and checks both render the same rows.
 */
describe('SessionSidebarComponent with 200 sessions x 10 agents', () => {
  const SESSIONS = 200;
  const AGENTS = 10;

  function data() {
    const sessions = Array.from({ length: SESSIONS }, (_, i) => ({
      id: `s${i}`, name: `Session ${i}`, provider: 'claude-code-cli', status: 'idle',
      workspaceId: `w${i % 20}`, workspace: { path: `/p/${i % 20}`, name: `p${i % 20}` },
      createdAt: '2026-01-01T00:00:00Z', pendingInteractionCount: 0,
    })) as any[];
    const workspaces = Array.from({ length: 20 }, (_, i) => ({
      id: `w${i}`, name: `p${i}`, projectPath: `/p/${i}`, activeSessionsCount: 10, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    })) as any[];
    const agents = sessions.flatMap((s) => Array.from({ length: AGENTS }, (_, j) => ({
      id: `${s.id}-a${j}`, sessionId: `${s.id}-pty${j}`, parentSessionId: s.id, role: 'dev',
      title: `Agent ${j}`, status: 'running', autoPrompt: '', provider: 'claude-code-cli',
    }))) as any[];
    return { sessions, workspaces, agents };
  }

  function timePasses(fixture: any, passes: number): number {
    const t0 = performance.now();
    for (let i = 0; i < passes; i++) {
      fixture.componentRef.setInput('activeSessionId', `s${i % SESSIONS}`);
      fixture.detectChanges();
    }
    return (performance.now() - t0) / passes;
  }

  it('renders every session and keeps a change-detection pass cheap', () => {
    TestBed.configureTestingModule({ imports: [SessionSidebarComponent], providers: appTestProviders });
    const { sessions, workspaces, agents } = data();
    TestBed.inject(SubAgentService).allSubAgents.set(agents);
    const fixture = TestBed.createComponent(SessionSidebarComponent);
    fixture.componentRef.setInput('sessions', sessions);
    fixture.componentRef.setInput('workspaces', workspaces);
    fixture.detectChanges();

    const grouped = timePasses(fixture, 10);
    const rowsGrouped = fixture.nativeElement.querySelectorAll('*').length;

    // Old behavior: filter the whole list on every call.
    const comp = fixture.componentInstance as any;
    const svc = TestBed.inject(SubAgentService);
    spyOn(comp, 'getSubAgents').and.callFake((id: string) => svc.allSubAgents().filter((sa) => sa.parentSessionId === id));
    const filtered = timePasses(fixture, 10);
    const rowsFiltered = fixture.nativeElement.querySelectorAll('*').length;

    // eslint-disable-next-line no-console
    console.log(`[sidebar perf] ${SESSIONS} sessions x ${AGENTS} agents: grouped ${grouped.toFixed(1)} ms/pass, per-call filter ${filtered.toFixed(1)} ms/pass`);
    expect(rowsGrouped).toBe(rowsFiltered);
    expect(grouped).toBeLessThan(filtered);
  });
});
