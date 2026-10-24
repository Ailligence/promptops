const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const calls = [];
  const listeners = {};
  let logged = 0;
  const window = {
    __TAURI__: { core: { invoke: (command, args) => {
      calls.push({ command, args });
      return Promise.resolve();
    } }, event: {} },
    addEventListener: (name, handler) => { listeners[name] = handler; },
  };
  const console = { error: () => { logged++; } };
  const source = fs.readFileSync(path.join(__dirname, '../src-tauri/src/promptops_bridge.js'), 'utf8');
  // Run the actual bridge's early error hooks, without booting the UI/PTY bridge.
  const prefix = source.slice(0, source.indexOf('  // ── helpers')) + '\n})();';
  vm.runInNewContext(prefix, { window, console, Error, Date });
  return { calls, listeners, console, logged: () => logged };
}

test('global errors transmit coordinates, never messages, paths or tokens', () => {
  const h = harness();
  h.listeners.error({ error: new Error('secret prompt'), filename: 'https://localhost/main-ABC.js', lineno: 12, colno: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), {
    command: 'diagnostics_report', args: { kind: 'frontend_error', location: 'main-ABC.js:12:3' },
  });
  h.listeners.unhandledrejection({ reason: { token: 'secret', prompt: 'private' } });
  assert.equal(h.calls[1].args.location, 'unknown');
  assert.ok(!JSON.stringify(h.calls).includes('secret'));
});

test('Angular console errors preserve console behavior and reporting is bounded', () => {
  const h = harness();
  const error = new Error('private');
  error.stack = 'Error: private\nfunction@http://localhost/main-ABC.js:12:3';
  for (let i = 0; i < 30; i++) h.console.error('ERROR', error);
  assert.equal(h.logged(), 30);
  assert.equal(h.calls.length, 10);
  assert.equal(h.calls[0].args.location, 'main-ABC.js:12:3');
});
