// Runs src/plugin.js outside PromptOps with a fake `promptops` global. Zero dependencies:
//   node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bundle = readFileSync(new URL('../src/plugin.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../promptops-plugin.json', import.meta.url), 'utf8'));

function load() {
  let impl;
  const context = vm.createContext({ promptops: { session: { registerButtons: (i) => { impl = i; } } } });
  vm.runInContext(bundle, context);
  // Every result crosses postMessage in PromptOps: plain data only.
  return async (id, ctx) => JSON.parse(JSON.stringify(await impl.action(id, ctx)));
}

const ctx = { sessionId: 's1', provider: 'claude-code-cli', status: 'idle', workspaceName: 'app', paneAgentId: 'sa1',
  agents: [{ id: 'main', name: 'Main', isMain: true }, { id: 'sa1', name: 'Fixer', isMain: false }] };

test('every declared button answers with a proposal', async () => {
  const action = load();
  for (const b of manifest.contributes.sessionButtons) {
    const out = await action(b.id, ctx);
    assert.ok(out.prompt || out.insert || out.spawn || out.panel || out.toast, b.id);
  }
});

test('the prompt goes to the agent of the terminal that was clicked', async () => {
  const out = await load()('run', ctx);
  assert.equal(out.target, 'sa1');
});
