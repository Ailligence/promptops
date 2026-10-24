'use strict';
// Every method the web app may call through DataBackend (core/data/data-methods.ts)
// must be handled by the desktop shell's local data dispatcher, otherwise the call
// rejects with `unknown_method` at runtime and callers that swallow errors lose data
// silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const contract = fs.readFileSync(path.join(root, 'web/src/app/core/data/data-methods.ts'), 'utf8');
const rustDir = path.join(root, 'desktop/src-tauri/src');

function dispatched() {
  const names = new Set();
  for (const file of fs.readdirSync(rustDir)) {
    if (!file.endsWith('.rs')) continue;
    const src = fs.readFileSync(path.join(rustDir, file), 'utf8');
    for (const m of src.matchAll(/"([a-zA-Z]+\.[a-zA-Z]+)"\s*=>/g)) names.add(m[1]);
  }
  return names;
}

test('every DataBackend method in the contract is dispatched by local_data.rs', () => {
  const methods = [...contract.matchAll(/^\s+'([a-zA-Z]+\.[a-zA-Z]+)':/gm)].map((m) => m[1]);
  assert.ok(methods.length > 40, 'contract parsed');
  assert.ok(methods.includes('store.health'));
  const handled = dispatched();
  const missing = methods.filter((m) => !handled.has(m));
  assert.deepEqual(missing, []);
});
