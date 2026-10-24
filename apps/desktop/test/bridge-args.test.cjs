// The bridge must wrap arguments under the Rust parameter names: Tauri maps
// each command parameter (snake_case in Rust) to a camelCase key of the args
// object, so passing the struct itself fails deserialization or is ignored.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBridge() {
  const calls = [];
  const listened = [];
  const window = {
    addEventListener() {},
    __TAURI__: {
      core: {
        Channel: class {},
        invoke(command, args) {
          calls.push({ command, args });
          return Promise.resolve({});
        },
      },
      event: {
        listen(channel) {
          listened.push(channel);
          return Promise.resolve(() => {});
        },
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src-tauri/src/promptops_bridge.js'), 'utf8'), {
    window, navigator: { platform: 'Linux', userAgent: '' }, console,
    TextDecoder, TextEncoder, ArrayBuffer, Uint8Array, DataView, URL,
    setTimeout, clearTimeout,
  });
  // JSON round-trip: objects built inside the vm context have another Object prototype.
  const last = (command) => JSON.parse(JSON.stringify(calls.filter((c) => c.command === command).pop()));
  return { api: window.promptops, last, listened };
}

test('struct-taking commands wrap their payload under the Rust parameter name', async () => {
  const { api, last } = loadBridge();
  const cfg = { provider: 'ollama' };
  await api.saveFccConfig(cfg);
  assert.deepEqual(last('fcc_config_save').args, { config: cfg });

  const ssh = { name: 'box', host: 'h', username: 'u', authType: 'password', secret: 's' };
  await api.sshSave(ssh);
  assert.deepEqual(last('ssh_save').args, { input: ssh });

  const state = { activeSessionName: null, subAgentsExpanded: false, focusedSubAgentRole: null };
  await api.saveDesktopState(state);
  assert.deepEqual(last('desktop_state_save').args, { data: state });

  const profile = { name: 'p', provider: 'claude', config: {} };
  await api.createProfile(profile);
  assert.deepEqual(last('profile_create').args, { data: profile });

  const patch = { sessionId: 's1', subAgentSlot: null, subAgentId: null };
  await api.setActiveFocus(patch);
  assert.deepEqual(last('focus_set_active').args, { patch });
  await api.setActiveFocus();
  assert.deepEqual(last('focus_set_active').args, { patch: null });

  await api.scanHardwareForModels({ limit: 6 });
  assert.deepEqual(last('hardware_scan').args, { options: { limit: 6 } });

  const selection = { mcp: [], skills: [], plugins: [] };
  await api.materializeExtensions('/w', 'claude', selection);
  assert.deepEqual(last('extensions_materialize').args, {
    req: { workspacePath: '/w', provider: 'claude', selection },
  });
});

test('unregistered commands and never-emitted events are gone', () => {
  const { api } = loadBridge();
  for (const name of ['getLogs', 'onLogStream', 'getSystemInfo', 'onAccessControlStatus', 'onSmartActionSuggestion']) {
    assert.equal(api[name], undefined, name);
  }
});

test('usage center refreshes on the event the token tracker emits', () => {
  const { api, listened } = loadBridge();
  api.onUsageUpdated(() => {});
  assert.equal(listened[listened.length - 1], 'token:usage-updated');
});
