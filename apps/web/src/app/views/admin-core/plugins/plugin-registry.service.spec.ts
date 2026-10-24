import { describePermission } from './plugin-registry.service';

describe('describePermission', () => {
  const calls: { key: string; params?: Record<string, string> }[] = [];
  const t = (key: string, params?: Record<string, string>) => {
    calls.push({ key, params });
    return `[${key}${params ? ' ' + JSON.stringify(params) : ''}]`;
  };

  beforeEach(() => (calls.length = 0));

  it('translates known permissions through PLUGINS_PERMS', () => {
    expect(describePermission('sessions:read', t)).toBe('[PLUGINS_PERMS.sessions:read]');
    expect(describePermission('ai:generate', t)).toBe('[PLUGINS_PERMS.ai:generate]');
  });

  it('passes the host of net:<host> as a parameter', () => {
    expect(describePermission('net:api.example.com', t)).toBe('[PLUGINS_PERMS.net {"host":"api.example.com"}]');
  });

  it('returns unknown permissions as their id without asking for a key', () => {
    expect(describePermission('custom:thing', t)).toBe('custom:thing');
    expect(calls.length).toBe(0);
  });
});
