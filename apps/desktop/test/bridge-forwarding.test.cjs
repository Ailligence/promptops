// The bridge must forward every argument the web app passes: dropped
// arguments silently disable features (branch start point, AI git options,
// Git Writer model/timeout, user-initiated usage probes).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBridge() {
  const calls = [];
  const window = {
    addEventListener() {},
    __TAURI__: {
      core: {
        Channel: class {},
        invoke(command, args) {
          calls.push({ command, args });
          if (command === 'terminal_open') return Promise.resolve('t1');
          return Promise.resolve({});
        },
      },
      event: { listen() { return Promise.resolve(() => {}); } },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src-tauri/src/promptops_bridge.js'), 'utf8'), {
    window, navigator: { platform: 'Linux', userAgent: '' }, console,
    TextDecoder, TextEncoder, ArrayBuffer, Uint8Array, DataView, URL,
    setTimeout, clearTimeout,
  });
  const last = (command) => {
    const c = calls.filter((x) => x.command === command).pop();
    const { onOutput, ...rest } = c.args;
    return JSON.parse(JSON.stringify(rest));
  };
  const outputChannel = () => calls.filter((x) => x.command === 'terminal_open').pop().args.onOutput;
  return { api: window.promptops, last, outputChannel };
}

test('git branch start point and AI options reach the Rust commands', async () => {
  const { api, last } = loadBridge();
  await api.gitCreateBranch('/r', 'feat/x', 'abc1234');
  assert.deepEqual(last('git_create_branch'), { cwd: '/r', branch: 'feat/x', startPoint: 'abc1234' });
  await api.gitCreateBranch('/r', 'feat/y');
  assert.deepEqual(last('git_create_branch'), { cwd: '/r', branch: 'feat/y', startPoint: null });

  const opts = { convention: 'plain', language: 'it', instructions: 'short', style: 'gitflow' };
  await api.gitGenerateCommitMsg('/r', 'claude', opts);
  assert.deepEqual(last('git_generate_commit_msg'), { cwd: '/r', provider: 'claude', options: opts });
  await api.gitGenerateBranchName('/r', 'codex', opts);
  assert.deepEqual(last('git_generate_branch_name'), { cwd: '/r', provider: 'codex', options: opts });
  await api.gitGenerateBranchName('/r', 'codex');
  assert.deepEqual(last('git_generate_branch_name'), { cwd: '/r', provider: 'codex', options: null });
});

test('aiGenerateText forwards the Git Writer timeout and model', async () => {
  const { api, last } = loadBridge();
  await api.aiGenerateText('p', 'claude', '/repo', 600000, 'opus');
  assert.deepEqual(last('ai_generate_text'), {
    prompt: 'p', provider: 'claude', cwd: '/repo', timeoutMs: 600000, model: 'opus',
  });
  await api.aiGenerateText('p', 'codex');
  assert.deepEqual(last('ai_generate_text'), {
    prompt: 'p', provider: 'codex', timeoutMs: null, model: null,
  });
});

test('usage probes launch the CLI only when the user asked', async () => {
  const { api, last } = loadBridge();
  await api.probeProviderUsage('s1', 'claude', true);
  assert.deepEqual(last('provider_usage_probe'), { sessionId: 's1', provider: 'claude', userInitiated: true });
  await api.probeProviderUsage('s1');
  assert.deepEqual(last('provider_usage_probe'), { sessionId: 's1', provider: null, userInitiated: false });
  await api.probeProviderUsage('s1', 'codex', 'yes');
  assert.equal(last('provider_usage_probe').userInitiated, false);
});

test('closing a terminal drops its decoder state (offsets restart for a reused id)', async () => {
  const { api, outputChannel } = loadBridge();
  const offsets = [];
  api.onTerminalOutput((_e, p) => offsets.push(p.offset));
  await api.openTerminal({});
  outputChannel().onmessage(new Uint8Array([104, 105]).buffer);
  assert.deepEqual(offsets, [2]);
  await api.closeTerminal('t1');
  await api.openTerminal({});
  outputChannel().onmessage(new Uint8Array([111, 107, 33]).buffer);
  assert.deepEqual(offsets, [2, 3]);
});

test('run-in-terminal forwards the parent session id', async () => {
  const { api, last } = loadBridge();
  await api.runSmartActionTerminal('api', 'build', 'npm run build', 'sess-1');
  assert.deepEqual(last('smart_action_run_terminal'), {
    parentSessionName: 'api', label: 'build', command: 'npm run build', parentSessionId: 'sess-1',
  });
  await api.runSmartActionTerminal('api', 'build', 'npm run build');
  assert.equal(last('smart_action_run_terminal').parentSessionId, null);
});
