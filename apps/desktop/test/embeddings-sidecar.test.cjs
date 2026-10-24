// The embeddings sidecar must load @xenova/transformers only from the places
// the app chooses, never from the directory the app was launched from: a
// node_modules there belongs to whatever repository the user was in.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SIDECAR = path.join(__dirname, '../src-tauri/resources/embeddings-sidecar.js');

/** A node_modules with a fake @xenova/transformers that leaves a marker when loaded. */
function fakeModules(root, marker) {
  const dir = path.join(root, 'node_modules', '@xenova', 'transformers');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@xenova/transformers', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), `
require('fs').writeFileSync(${JSON.stringify(marker)}, 'loaded');
exports.pipeline = async () => async (batch) => ({
  dims: [batch.length, 2],
  data: Float32Array.from(batch.flatMap((_, i) => [i, 1])),
});
`);
  return path.join(root, 'node_modules');
}

function runSidecar(cwd, env) {
  const childEnv = { ...process.env, ...env };
  if (!env.PROMPTOPS_SIDECAR_NODE_MODULES) delete childEnv.PROMPTOPS_SIDECAR_NODE_MODULES;
  const result = spawnSync(process.execPath, [SIDECAR], {
    cwd, env: childEnv, input: JSON.stringify({ texts: ['a', 'b'] }), encoding: 'utf8', timeout: 20000,
  });
  return JSON.parse(result.stdout.trim());
}

test('a node_modules in the launch directory (or its parent) is never loaded', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptops-sidecar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'loaded.txt');
  fakeModules(root, marker);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  fakeModules(repo, marker);

  const reply = runSidecar(repo, {});
  assert.match(reply.error, /@xenova\/transformers not found/);
  assert.equal(fs.existsSync(marker), false, 'the module from the cwd was executed');
});

test('PROMPTOPS_SIDECAR_NODE_MODULES is used and returns one vector per text', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptops-sidecar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'loaded.txt');
  const modules = fakeModules(path.join(root, 'app'), marker);
  const reply = runSidecar(root, { PROMPTOPS_SIDECAR_NODE_MODULES: modules });
  assert.deepEqual(reply.vectors, [[0, 1], [1, 1]]);
  assert.equal(fs.existsSync(marker), true);
});
