'use strict';
// Sub-agents with the same role and title (several "Terminal" shells) must
// keep their own place in the saved pane order.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.join(__dirname, '../src/app/views/admin-core/sessions/services/agent-display-order.ts');
const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const m = {};
new Function('exports', out)(m);
const { orderAgents, rememberAgentOrder, agentOrderKey } = m;

const t1 = { id: 'a', role: 'shell', title: 'Terminal', createdAt: '2026-01-01T00:00:01Z' };
const cx = { id: 'b', role: 'codex', title: 'Codex', createdAt: '2026-01-01T00:00:02Z' };
const t2 = { id: 'c', role: 'shell', title: 'Terminal', createdAt: '2026-01-01T00:00:03Z' };

test('dragging the second twin to the top sticks', () => {
  const saved = rememberAgentOrder([t1, cx, t2], ['c', 'a', 'b']);
  assert.equal(new Set(saved).size, 3, 'each twin has its own key');
  assert.deepEqual(orderAgents([t1, cx, t2], saved).map((a) => a.id), ['c', 'a', 'b']);
});

test('the order survives regenerated ids after a restart', () => {
  const saved = rememberAgentOrder([t1, cx, t2], ['c', 'b', 'a']);
  const restored = [
    { ...t1, id: 'a2' }, { ...cx, id: 'b2' }, { ...t2, id: 'c2' },
  ];
  assert.deepEqual(orderAgents(restored, saved).map((a) => a.id), ['c2', 'b2', 'a2']);
});

test('an order saved before twins were told apart still applies to the first twin', () => {
  const legacy = [agentOrderKey(cx), agentOrderKey(t1)];
  assert.deepEqual(orderAgents([t1, cx], legacy).map((a) => a.id), ['b', 'a']);
});
