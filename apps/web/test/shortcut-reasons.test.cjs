// Every reserved-shortcut reason id must have its translated sentence in all
// locales (they used to be hard-coded English inside translated notices).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('shortcut conflict reasons and messages exist in every locale', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/app/views/admin-core/sessions/services/session-shortcuts.service.ts'), 'utf8');
  const ids = [...src.matchAll(/^\s+(?:Key[A-Z]|Equal|Minus|Period):\s*'(\w+)',/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 20, `found ${ids.length} reason ids`);
  const dir = path.join(__dirname, '../src/assets/i18n');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const sc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).SESSIONS.SHORTCUTS;
    for (const k of ['ConflictMac', 'ConflictTerminal', ...ids.map((id) => `Reason ${id}`)]) {
      assert.equal(typeof sc[k], 'string', `${f}: SESSIONS.SHORTCUTS.${k}`);
    }
    assert.match(sc.ConflictMac, /\{\{key\}\}.*\{\{why\}\}/s, f);
    assert.match(sc.ConflictTerminal, /\{\{key\}\}.*\{\{why\}\}/s, f);
  }
});

test('every storage area id has a label in every locale', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/app/components/system-cleanup/system-cleanup.component.ts'), 'utf8');
  const block = src.match(/AREA_IDS = \[([\s\S]*?)\] as const/)[1];
  const ids = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 13);
  const dir = path.join(__dirname, '../src/assets/i18n');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const sec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).SECURITY;
    for (const id of ids) assert.equal(typeof sec[`Area ${id}`], 'string', `${f}: SECURITY.Area ${id}`);
  }
});
