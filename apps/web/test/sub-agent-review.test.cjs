const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function setup() {
  const timers = new Map();
  let seq = 0;
  const notices = [];
  const api = {};
  const angular = {
    Injectable: () => target => target,
    inject: () => ({ show: (...args) => notices.push(args) }),
    signal: initial => {
      let value = initial;
      const s = () => value;
      s.set = next => value = next;
      s.update = fn => value = fn(value);
      return s;
    },
    computed: fn => fn,
  };
  function load(name) {
    const source = fs.readFileSync(path.join(__dirname, '../src/app/views/admin-core/sessions/services/', name + '.ts'), 'utf8');
    const exports = {};
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText, {
      exports, require: id => id === '@angular/core' ? angular : {}, window: { promptops: api },
      setInterval: fn => { timers.set(++seq, fn); return seq; }, clearInterval: id => timers.delete(id),
      setTimeout: (fn, ms) => { assert.equal(ms, 5000); timers.set(++seq, fn); return seq; },
    });
    return exports;
  }
  return { api, notices, timers, load };
}
const run = (status = 'done') => ({ id: 'r1', subAgentId: 'a', parentSessionId: 's', reviewerProviderId: 'codex', focus: 'free', status, startedAt: 1, output: 'report' });

test('fast completion survives optimistic registration and reopening, notifies once', async () => {
  const ctx = setup();
  ctx.api.onSubAgentReviewOutput = () => {};
  ctx.api.onSubAgentReviewDone = () => {};
  ctx.api.requestSubAgentReview = async () => ({ ok: true, runId: 'r1' });
  ctx.api.listSubAgentReviews = async () => ({ ok: true, runs: [run()] });
  const service = new (ctx.load('sub-agent-review.service').SubAgentReviewService)();
  let opened = false;
  service.registerOpener('a', () => opened = true);
  await service.start('a', 'codex', 'free');
  service.registerOptimistic({ ...run('running'), output: '' });
  await service.hydrateTask('a');
  assert.equal(service.runsForTask('a')().length, 1);
  assert.equal(service.latestForTask('a')().status, 'done');
  assert.equal(service.latestForTask('a')().output, 'report');
  assert.equal(ctx.notices.length, 1);
  ctx.notices[0][2]();
  assert.equal(opened, true);
  assert.equal(ctx.timers.size, 0);
});

test('polling recovers a missed completion in background without notifying historical reviews', async () => {
  const ctx = setup();
  let status = 'running';
  ctx.api.listSubAgentReviews = async () => ({ ok: true, runs: [{ ...run(), id: 'old' }, run(status)] });
  const service = new (ctx.load('sub-agent-review.service').SubAgentReviewService)();
  await service.hydrateTask('a');
  assert.equal(ctx.notices.length, 0);
  status = 'error';
  await [...ctx.timers.values()][0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.latestForTask('a')().status, 'error');
  assert.equal(ctx.notices.length, 1);
  assert.equal(ctx.timers.size, 0);
});

test('notice lasts five seconds and an older timer cannot hide a replacement', () => {
  const ctx = setup();
  const service = new (ctx.load('agent-action-notice.service').AgentActionNoticeService)();
  let opened = false;
  service.show('a', 'one', () => {});
  service.show('a', 'two', () => opened = true);
  [...ctx.timers.values()][0]();
  assert.equal(service.notices().length, 1);
  service.activate(service.notices()[0]);
  assert.equal(opened, true);
  assert.equal(service.notices().length, 0);
  service.show('a', 'three', () => {});
  [...ctx.timers.values()].at(-1)();
  assert.equal(service.notices().length, 0);
});
