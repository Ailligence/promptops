const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '../src/app/views/admin-core/sessions/services');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const source = fs.readFileSync(path.join(root, `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  const result = { exports: {} };
  const localRequire = id => id === '@angular/core' ? {
    Injectable: () => klass => klass,
    signal: value => {
      const read = () => value;
      read.update = fn => { value = fn(value); };
      return read;
    },
  } : id.startsWith('./') ? load(id.slice(2)) : require(id);
  new Function('require', 'module', 'exports', outputText)(localRequire, result, result.exports);
  cache.set(name, result.exports);
  return result.exports;
}
const { parseTerminalEffort, switchTerminalEffort } = load('terminal-effort');
const { SessionEffortService } = load('session-effort.service');

test('recognizes CLI confirmations with ANSI and ignores echoed commands', () => {
  assert.equal(parseTerminalEffort('/effort high\r', 'claude-code-cli'), null);
  assert.equal(parseTerminalEffort('Set effort level to \x1b[32mhigh\x1b[0m', 'claude-code-cli'), 'high');
  assert.equal(parseTerminalEffort('Effort set to low and saved as your default', 'claude-code-cli'), 'low');
  assert.equal(parseTerminalEffort('Model: gpt-5.5 (reasoning effort: xhigh, summaries auto)', 'codex'), 'xhigh');
  assert.equal(parseTerminalEffort('Model: gpt-5.5 (medium reasoning, summaries auto)', 'codex'), 'medium');
  assert.equal(parseTerminalEffort('reasoning effort high\nreasoning effort low', 'codex'), 'low');
});

test('Claude uses the native command and requires the requested confirmation', async () => {
  const sent = [];
  await switchTerminalEffort('claude-code-cli', 'high', async input => { sent.push(input); return 'high'; });
  assert.deepEqual(sent, ['/effort high']);
  await assert.rejects(switchTerminalEffort('claude-code-cli', 'high', async () => 'medium'));
});

test('Claude recognizes xhigh confirmations rendered with cursor spacing and wrapped lines', () => {
  const confirmation = 'Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning than high, just below maximum (Fable 5, Opus 4.7+, Sonnet 5)';
  assert.equal(parseTerminalEffort(confirmation, 'claude-code-cli'), 'xhigh');
  assert.equal(parseTerminalEffort(confirmation.replaceAll(' ', '\x1b[1C'), 'claude-code-cli'), 'xhigh');
  assert.equal(parseTerminalEffort('Set effort\r\nlevel to\x1b[Cxhigh', 'claude-code-cli'), 'xhigh');
});

test('Claude waits past an older confirmation for the requested effort in split TUI output', async () => {
  const service = new SessionEffortService();
  await service.apply('claude-redraw', 'claude-code-cli', 'xhigh', async data => {
    if (data !== '\r') return;
    service.noteTerminalOutput('claude-redraw', 'Set effort level to high');
    assert.equal(service.pending()['claude-redraw'], 'xhigh');
    service.noteTerminalOutput('claude-redraw', '\r\n  ⎿ Set\x1b[1Ceffort\x1b[');
    service.noteTerminalOutput('claude-redraw', '1Clevel\x1b[1Cto\x1b[1Cxhigh (saved as your default for new sessions): Deeper reasoning than high');
  });
  assert.equal(service.confirmed()['claude-redraw'].effort, 'xhigh');
  assert.equal(service.pending()['claude-redraw'], undefined);
});

test('Codex reads current effort and steps using confirmed states', async () => {
  const sent = [];
  const replies = ['low', 'medium', 'high'];
  await switchTerminalEffort('codex', 'high', async input => { sent.push(input); return replies.shift(); });
  assert.deepEqual(sent, ['/status', '\x1b.', '\x1b.']);
  const lower = ['xhigh', 'high', 'medium'];
  await switchTerminalEffort('codex', 'medium', async input => {
    assert.equal(input, lower.length === 3 ? '/status' : '\x1b,');
    return lower.shift();
  });
});

test('unavailable levels, no-op shortcuts and invalid inputs stop safely', async () => {
  await assert.rejects(switchTerminalEffort('codex', 'max', async () => assert.fail('must not write')));
  await assert.rejects(switchTerminalEffort('generic-shell', 'high', async () => assert.fail('must not write')));
  await assert.rejects(switchTerminalEffort('codex', 'high\r/quit', async () => assert.fail('must not write')));
  await assert.rejects(switchTerminalEffort('codex', 'high', async () => 'low'));
  const skipped = ['low', 'high'];
  await assert.rejects(switchTerminalEffort('codex', 'medium', async () => skipped.shift()));
});

test('effort confirmation is isolated to its terminal and handles split output', async () => {
  const service = new SessionEffortService();
  const writes = [];
  await service.apply('terminal-a', 'claude-code-cli', 'high', async data => {
    writes.push(data);
    if (data !== '\r') return;
    service.noteTerminalOutput('terminal-b', 'Set effort level to low');
    assert.equal(service.confirmed()['terminal-a'], undefined);
    service.noteTerminalOutput('terminal-a', 'Set effort le');
    service.noteTerminalOutput('terminal-a', 'vel to high');
  });
  assert.deepEqual(writes, ['/effort high', '\r']);
  assert.equal(service.confirmed()['terminal-a'].effort, 'high');
  assert.equal(service.pending()['terminal-a'], undefined);
});

test('Codex sends only shortcuts and status requests, confirming every step', async () => {
  const service = new SessionEffortService();
  let effort = 'low';
  const writes = [];
  await service.apply('codex-a', 'codex', 'medium', async data => {
    writes.push(data);
    if (data === '\x1b.') effort = 'medium';
    if (data === '\r') service.noteTerminalOutput('codex-a', `Model: gpt-5.5 (reasoning effort ${effort}, summaries auto)`);
  });
  assert.deepEqual(writes, [...'/status', '\r', '\x1b.', ...'/status', '\r']);
  assert.equal(service.confirmed()['codex-a'].effort, 'medium');
});

test('Codex status is typed without paste bursts and ignores status redraws before Enter', async () => {
  const service = new SessionEffortService();
  const writes = [];
  let composer = '';
  let lastKeyAt = 0;
  let submissions = 0;
  await service.apply('codex-redraw', 'codex', 'high', async data => {
    writes.push(data);
    if (data === '\r') {
      assert.equal(composer, '/status');
      submissions++;
      service.noteTerminalOutput('codex-redraw', 'Model: gpt-5.5 (high reasoning, summaries auto)');
      composer = '';
      return;
    }
    assert.equal(data.length, 1, 'slash command must not be sent as a paste burst');
    const now = performance.now();
    if (lastKeyAt) assert.ok(now - lastKeyAt >= 100, 'keys must be paced');
    lastKeyAt = now;
    composer += data;
    // A previous status may be redrawn on every keystroke, even when it
    // already reports the requested effort. Enter must still be sent.
    service.noteTerminalOutput('codex-redraw', 'Model: gpt-5.5 (high reasoning, summaries auto)');
    assert.equal(service.confirmed()['codex-redraw'], undefined);
  });
  assert.equal(submissions, 1);
  assert.equal(composer, '');
  assert.deepEqual(writes, [...'/status', '\r']);
});

test('closing Codex during command typing cancels all remaining keys and Enter', async () => {
  const service = new SessionEffortService();
  const writes = [];
  await assert.rejects(service.apply('codex-closed', 'codex', 'high', async data => {
    writes.push(data);
    service.forget('codex-closed');
  }), /Terminal closed/);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.deepEqual(writes, ['/']);
  assert.equal(service.pending()['codex-closed'], undefined);
});

test('failed write clears pending state without claiming a new effort', async () => {
  const service = new SessionEffortService();
  await assert.rejects(service.apply('failed', 'claude-code-cli', 'high', async () => { throw new Error('PTY gone'); }));
  assert.equal(service.pending().failed, undefined);
  assert.equal(service.confirmed().failed, undefined);
});

test('manual effort commands update the badge without a pending switch', () => {
  const service = new SessionEffortService();
  service.noteTerminalOutput('manual', 'Set effort level to high');
  assert.equal(service.confirmed().manual.effort, 'high');
  service.noteTerminalOutput('manual', 'Set effort level to low');
  assert.equal(service.confirmed().manual.effort, 'low');
  service.forget('manual');
  assert.equal(service.confirmed().manual, undefined);
});

test('closing the terminal cancels the pending confirmation', async () => {
  const service = new SessionEffortService();
  await assert.rejects(service.apply('closed', 'claude-code-cli', 'high', async () => service.forget('closed')));
  assert.equal(service.pending().closed, undefined);
});
