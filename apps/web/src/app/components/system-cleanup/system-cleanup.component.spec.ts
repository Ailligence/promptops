import { cleanupAreas, DEFAULT_CLEANUP_AREAS, AREA_IDS } from './system-cleanup.component';

describe('System cleanup areas', () => {
  it('cleans only what the audit marks cleanable', () => {
    const entries = [
      { area: 'webview-cache', label: 'Web view cache', sizeBytes: 10, cleanable: true },
      { area: 'local-data', label: 'Sessions and settings', sizeBytes: 10, cleanable: false },
      { area: 'usage-exports', label: 'Usage exports', sizeBytes: 1, cleanable: true },
    ];
    expect(cleanupAreas(entries)).toEqual(['webview-cache', 'usage-exports']);
  });

  it('falls back to caches and exports only, never sessions or history', () => {
    expect(cleanupAreas(null)).toEqual(DEFAULT_CLEANUP_AREAS);
    for (const id of ['local-data', 'terminal-history', 'usage-history', 'pre-import-copies']) {
      expect(DEFAULT_CLEANUP_AREAS).not.toContain(id);
      expect(AREA_IDS as readonly string[]).toContain(id);
    }
  });
});
