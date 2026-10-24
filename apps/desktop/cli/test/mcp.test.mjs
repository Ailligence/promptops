import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createServer, readLines, resolveContext, runTool, TOOLS, PROTOCOL_VERSIONS, MAX_WAIT_MS, INSTRUCTIONS } from '../mcp.mjs';
import { call } from '../ctl.mjs';
const main = fileURLToPath(new URL('../main.mjs', import.meta.url));
const ctx = { port: 5123, token: 'secret', caller: 'parent-1' };
const reply = result => new Response(JSON.stringify({ ok: true, result }));
function recorder(responses) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url: url.split('/ctl/')[1], full: url, redirect: init.redirect, headers: init.headers, body: JSON.parse(init.body) }); return responses.shift(); } };
}
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

test('initialize negotiates the protocol version and advertises tools only', async () => {
  const server = createServer({ resolveCtx: async () => ctx });
  const init = await server.handle(request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test' } }));
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.deepEqual(Object.keys(init.result.capabilities), ['tools']);
  assert.match(init.result.instructions, /promptops_agent_spawn/);
  assert.equal((await server.handle(request(2, 'initialize', { protocolVersion: '1999-01-01' }))).result.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepEqual((await server.handle(request(3, 'ping'))).result, {});
  const list = await server.handle(request(4, 'tools/list'));
  assert.deepEqual(list.result.tools.map(t => t.name), TOOLS.map(t => t.name));
  assert.ok(list.result.tools.every(t => t.inputSchema.type === 'object' && t.inputSchema.additionalProperties === false));
  assert.equal((await server.handle(request(5, 'nope/method'))).error.code, -32601);
  assert.equal((await server.handle(request(6, 'tools/call', { name: 'bogus' }))).error.code, -32602);
});

test('spawn opens a terminal through the control plane and can wait for it', async () => {
  const agent = { id: 'abc123', name: 'reviewer', state: 'starting' };
  const { calls, fetchImpl } = recorder([reply({ agent }), reply({ pending: true, agent }), reply({ pending: false, agent: { ...agent, state: 'idle', lastMessage: 'done' } })]);
  const server = createServer({ resolveCtx: async () => ctx, fetchImpl });
  const response = await server.handle(request(7, 'tools/call', { name: 'promptops_agent_spawn', arguments: { name: 'reviewer', prompt: 'Review the diff', provider: 'codex', wait: true, timeout_ms: 120000 } }));
  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.agent.lastMessage, 'done');
  assert.equal(calls[0].url, 'agent/spawn');
  assert.equal(calls[0].headers['x-promptops-token'], 'secret');
  assert.deepEqual(calls[0].body, { name: 'reviewer', prompt: 'Review the diff', provider: 'codex', caller: 'parent-1' });
  assert.deepEqual(calls.slice(1).map(c => [c.url, c.body.target, c.body.sinceTurn]), [['agent/wait', 'abc123', 0], ['agent/wait', 'abc123', 0]]);
});

test('read returns terminal text as content; server errors become tool errors with their code', async () => {
  const fetchImpl = async () => reply({ source: 'recent', text: 'hello', cols: 80, rows: 24 });
  const server = createServer({ resolveCtx: async () => ctx, fetchImpl });
  const read = await server.handle(request(8, 'tools/call', { name: 'promptops_agent_read', arguments: { target: 'reviewer', lines: 40 } }));
  assert.deepEqual(read.result.content, [{ type: 'text', text: 'hello' }]);
  const blocked = createServer({ resolveCtx: async () => ctx, fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: { code: 'agent_blocked', message: 'dialog open' } }), { status: 409 }) });
  const response = await blocked.handle(request(9, 'tools/call', { name: 'promptops_agent_prompt', arguments: { target: 'x', text: 'hi' } }));
  assert.equal(response.result.isError, true);
  assert.equal(JSON.parse(response.result.content[0].text).error.code, 'agent_blocked');
  const missing = await blocked.handle(request(10, 'tools/call', { name: 'promptops_agent_prompt', arguments: { target: 'x' } }));
  assert.equal(JSON.parse(missing.result.content[0].text).error.code, 'invalid_params');
  const alias = recorder([reply({ agent: { id: 'x', state: 'working' }, sinceTurn: 1 })]);
  await runTool(ctx, 'promptops_agent_prompt', { target: 'x', prompt: 'via alias' }, { fetchImpl: alias.fetchImpl });
  assert.deepEqual(alias.calls[0].body, { target: 'x', text: 'via alias', caller: 'parent-1' });
  await assert.rejects(runTool(ctx, 'nope', {}), error => error.code === 'unknown_tool');
});

test('context comes from the environment, or from --session plus ctl.json when the client cleans the env (Codex)', async () => {
  const env = { PROMPTOPS_HOOK_PORT: '5123', PROMPTOPS_CTL_TOKEN: 'secret', PROMPTOPS_SESSION_ID: 'parent-1' };
  assert.deepEqual(await resolveContext({ env }), ctx);
  const readFileImpl = async () => JSON.stringify({ port: 6001, token: 'from-file' });
  assert.deepEqual(await resolveContext({ env: {}, argv: ['--session', 'sub-9'], readFileImpl }), { port: 6001, token: 'from-file', caller: 'sub-9' });
  const noFile = async () => { throw new Error('ENOENT'); };
  assert.deepEqual(await resolveContext({ env: { PROMPTOPS_HOOK_PORT: '5123', PROMPTOPS_CTL_TOKEN: 'secret' }, argv: ['--session', 'sub-9'], readFileImpl: noFile }), { port: 5123, token: 'secret', caller: 'sub-9' });
  await assert.rejects(resolveContext({ env: {}, argv: [], readFileImpl }), error => error.code === 'not_in_promptops');
  await assert.rejects(resolveContext({ env: {}, argv: ['--session', 'sub-9'], readFileImpl: async () => { throw new Error('ENOENT'); } }), error => error.code === 'not_in_promptops');
  const lazy = createServer({ resolveCtx: async () => { throw Object.assign(new Error('outside'), { code: 'not_in_promptops' }); } });
  assert.equal((await lazy.handle(request(11, 'tools/list'))).result.tools.length, TOOLS.length);
  assert.equal(JSON.parse((await lazy.handle(request(12, 'tools/call', { name: 'promptops_agent_list', arguments: {} }))).result.content[0].text).error.code, 'not_in_promptops');
});

test('end to end over stdio through main.mjs against a local server', async t => {
  const seen = [];
  const server = http.createServer((req, res) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { seen.push({ url: req.url, token: req.headers['x-promptops-token'], body: JSON.parse(raw) }); res.end(JSON.stringify({ ok: true, result: { agents: [{ id: 'a1', state: 'idle' }] } })); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const env = { ...process.env, PROMPTOPS_HOOK_PORT: String(server.address().port), PROMPTOPS_CTL_TOKEN: 'secret', PROMPTOPS_SESSION_ID: 'parent-1' };
  const child = spawn(process.execPath, [main, 'mcp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const replies = [];
  let buffered = '';
  const waitFor = count => new Promise(resolve => { const check = () => replies.length >= count ? resolve() : child.stdout.once('data', check); check(); });
  child.stdout.on('data', chunk => { buffered += chunk; const parts = buffered.split('\n'); buffered = parts.pop(); for (const part of parts) if (part.trim()) replies.push(JSON.parse(part)); });
  child.stdin.write(JSON.stringify(request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } })) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write('not json\n');
  child.stdin.write(JSON.stringify([request(9, 'ping')]) + '\n');
  child.stdin.write(JSON.stringify(request(2, 'tools/call', { name: 'promptops_agent_list', arguments: {} })) + '\n');
  await waitFor(4);
  child.stdin.end();
  assert.equal(replies[0].result.serverInfo.name, 'promptops');
  assert.equal(replies[1].error.code, -32700);
  assert.equal(replies[2].error.code, -32600);
  assert.equal(replies[3].result.structuredContent.agents[0].id, 'a1');
  assert.deepEqual(seen[0], { url: '/ctl/agent/list', token: 'secret', body: { caller: 'parent-1' } });
  await new Promise(resolve => child.on('exit', resolve));
});

test('arguments from the model are validated and only known fields reach the app', async () => {
  const agent = { id: 'abc123', state: 'starting' };
  const { calls, fetchImpl } = recorder([reply({ agent })]);
  await runTool(ctx, 'promptops_agent_spawn', { name: 'reviewer', prompt: 'go', caller: 'someone-else', parentSessionId: 'other', executionMode: 'worker', goalSpec: {}, customConfig: { risk_tolerance: 'HIGH' } }, { fetchImpl });
  assert.deepEqual(calls[0].body, { name: 'reviewer', prompt: 'go', caller: 'parent-1' });
  const none = { fetchImpl: async () => { throw new Error('must not reach the app'); } };
  const bad = [
    ['promptops_agent_spawn', { name: 'x', prompt: 42 }],
    ['promptops_agent_spawn', { name: 'x'.repeat(81), prompt: 'go' }],
    ['promptops_agent_spawn', { name: 'x', prompt: 'go', effort: 'ludicrous' }],
    ['promptops_agent_spawn', { name: 'x', prompt: 'go', wait: 'yes' }],
    ['promptops_agent_spawn', { name: 'x', prompt: 'go', timeout_ms: MAX_WAIT_MS + 1 }],
    ['promptops_agent_prompt', { target: ['a'], text: 'hi' }],
    ['promptops_agent_wait', { target: 'a', until: 'forever' }],
    ['promptops_agent_read', { target: 'a', lines: 99999 }],
    ['promptops_agent_read', { target: 'a', source: '../etc' }],
    ['promptops_agent_keys', { target: 'a', keys: 'enter' }],
    ['promptops_agent_keys', { target: 'a', keys: Array(65).fill('up') }],
    ['promptops_agent_get', {}],
    ['promptops_agent_get', []],
  ];
  for (const [name, args] of bad) await assert.rejects(runTool(ctx, name, args, none), error => error.code === 'invalid_params', `${name} ${JSON.stringify(args).slice(0, 60)}`);
});

test('the token only goes to loopback, never follows a redirect, and the port must be a port', async () => {
  const { calls, fetchImpl } = recorder([reply({ agents: [] })]);
  await call(ctx, 'agent/list', {}, { fetchImpl });
  assert.equal(calls[0].full, 'http://127.0.0.1:5123/ctl/agent/list');
  assert.equal(calls[0].redirect, 'error');
  for (const port of [0, -1, 70000, 1.5, NaN, '5123@evil.example']) {
    await assert.rejects(call({ ...ctx, port }, 'agent/list', {}, { fetchImpl: async () => { throw new Error('must not fetch'); } }), error => error.code === 'not_in_promptops', String(port));
  }
  const readFileImpl = async () => JSON.stringify({ port: '80@evil.example', token: 't' });
  await assert.rejects(resolveContext({ env: {}, argv: ['--session', 'sub-9'], readFileImpl }), error => error.code === 'not_in_promptops');
  await assert.rejects(resolveContext({ env: {}, argv: ['--session', '../../x'], readFileImpl: async () => JSON.stringify({ port: 6001, token: 't' }) }), error => error.code === 'not_in_promptops');
  await assert.rejects(resolveContext({ env: {}, argv: ['--session', 'sub-9'], readFileImpl: async () => JSON.stringify({ port: 6001, token: 42 }) }), error => error.code === 'not_in_promptops');
});

test('stdin lines are capped: an oversize message is dropped once and the stream keeps working', async () => {
  const collect = async (chunks, max) => { const out = []; for await (const entry of readLines(Readable.from(chunks), max)) out.push(entry); return out; };
  assert.deepEqual(await collect(['{"a":1}\n{"b"', ':2}\n', 'tail'], 100), [{ line: '{"a":1}' }, { line: '{"b":2}' }, { line: 'tail' }]);
  assert.deepEqual(await collect(['x'.repeat(30), 'y'.repeat(30), 'z\nok\n'], 20), [{ oversize: true }, { line: 'ok' }]);
  assert.deepEqual(await collect(['x'.repeat(30) + '\nok\n'], 20), [{ oversize: true }, { line: 'ok' }]);
});

test('move_to_session asks the user for the name via elicitation, then moves the caller', async () => {
  const sent = [];
  const { calls, fetchImpl } = recorder([reply({ moving: true, name: 'Refactor auth' })]);
  const server = createServer({ resolveCtx: async () => ctx, fetchImpl, send: message => sent.push(message) });
  await server.handle(request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: { elicitation: {} } }));
  const pending = server.handle(request(2, 'tools/call', { name: 'promptops_agent_move_to_session', arguments: {} }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent[0].method, 'elicitation/create');
  assert.deepEqual(sent[0].params.requestedSchema.required, ['name']);
  assert.equal(await server.handle({ jsonrpc: '2.0', id: sent[0].id, result: { action: 'accept', content: { name: '  Refactor auth ' } } }), null);
  const response = await pending;
  assert.equal(response.result.structuredContent.moving, true);
  assert.equal(calls[0].url, 'agent/move');
  assert.deepEqual(calls[0].body, { name: 'Refactor auth', caller: 'parent-1' });
});

test('move_to_session: declined name moves nothing; without elicitation the model must ask', async () => {
  const sent = [];
  const { calls, fetchImpl } = recorder([]);
  const server = createServer({ resolveCtx: async () => ctx, fetchImpl, send: message => sent.push(message) });
  await server.handle(request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: { elicitation: {} } }));
  const pending = server.handle(request(2, 'tools/call', { name: 'promptops_agent_move_to_session', arguments: {} }));
  await new Promise(resolve => setImmediate(resolve));
  await server.handle({ jsonrpc: '2.0', id: sent[0].id, result: { action: 'decline' } });
  assert.equal((await pending).result.structuredContent.canceled, true);
  assert.equal(calls.length, 0);
  const plain = createServer({ resolveCtx: async () => ctx, fetchImpl });
  await plain.handle(request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} }));
  const refused = await plain.handle(request(2, 'tools/call', { name: 'promptops_agent_move_to_session', arguments: {} }));
  assert.equal(JSON.parse(refused.result.content[0].text).error.code, 'name_required');
});

test('the open-source server lists only local tools', async () => {
  const server = createServer({ resolveCtx: async () => ctx, fetchImpl: async () => { throw new Error('no call expected'); } });
  await server.handle(request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} }));
  const listed = await server.handle(request(2, 'tools/list', {}));
  const names = listed.result.tools.map(tool => tool.name);
  assert.ok(names.every(name => name.startsWith('promptops_agent_')), names.join(', '));
  assert.ok(!/board|team/i.test(INSTRUCTIONS));
});
