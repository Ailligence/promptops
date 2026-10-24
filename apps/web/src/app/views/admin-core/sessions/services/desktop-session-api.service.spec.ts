import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { DataBackend } from '@core/data/data-backend';
import { DesktopSessionApiService } from './desktop-session-api.service';

class FakeBackend extends DataBackend {
  calls: Array<{ method: string; params: any }> = [];
  result: any = null;
  error: any = null;
  async call<T>(method: string, params?: object): Promise<T> {
    this.calls.push({ method, params });
    if (this.error) throw this.error;
    return this.result as T;
  }
}

function dto(over: Record<string, unknown> = {}) {
  return {
    id: 's1', name: 'One', provider: 'claude-code-cli', status: 'idle',
    workspace_path: null, workspace_name: null, workspace_id: null, config: null,
    repo_url: null, repo_branch: null, team_id: null, project_id: null, category_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('DesktopSessionApiService', () => {
  let backend: FakeBackend;
  let api: DesktopSessionApiService;

  beforeEach(() => {
    backend = new FakeBackend();
    TestBed.configureTestingModule({ providers: [{ provide: DataBackend, useValue: backend }] });
    api = TestBed.inject(DesktopSessionApiService);
  });

  it('update() sends `_lookup_name` as the `lookup_name` the local store reads', async () => {
    backend.result = dto();
    await firstValueFrom(api.update('live-id', { provider: 'codex', _lookup_name: 'One' }));
    expect(backend.calls[0].method).toBe('sessions.update');
    expect(backend.calls[0].params).toEqual({ provider: 'codex', lookup_name: 'One', id: 'live-id' });
  });

  it('update() keeps an explicit lookup_name and passes other fields unchanged', async () => {
    backend.result = dto();
    await firstValueFrom(api.update('id', { view_state: { a: 1 }, lookup_name: 'X', _lookup_name: 'Y' }));
    expect(backend.calls[0].params).toEqual({ view_state: { a: 1 }, lookup_name: 'X', id: 'id' });
  });

  it('update() resolves null on failure unless rethrow is asked', async () => {
    backend.error = { code: 'not_found', message: 'Session not found.' };
    expect(await firstValueFrom(api.update('id', { status: 'idle' }))).toBeNull();
    await expectAsync(firstValueFrom(api.update('id', { status: 'idle' }, { rethrow: true })))
      .toBeRejectedWith(jasmine.objectContaining({ code: 'not_found' }));
  });

  it('names a workspace from a Windows path when the store has no name', async () => {
    backend.result = dto({ workspace_path: 'C:\\Users\\me\\proj\\' });
    const s = await firstValueFrom(api.show('s1'));
    expect(s?.workspace?.name).toBe('proj');
  });
});
