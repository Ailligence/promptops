import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseCtl, context, runCtl, CtlError } from '../ctl.mjs';
const exec = promisify(execFile);
const main = fileURLToPath(new URL('../main.mjs', import.meta.url));
const env = { PROMPTOPS_HOOK_PORT: '5123', PROMPTOPS_CTL_TOKEN: 'secret', PROMPTOPS_SESSION_ID: 'parent-1' };
const reply = result => new Response(JSON.stringify({ ok: true, result }));
function recorder(responses) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return responses.shift(); } };
}

test('flags parse anywhere, unknown flags are syntax errors', () => {
  assert.deepEqual(parseCtl(['a', '--wait', 'b', '--timeout', '5'], { bool: ['wait'], values: ['timeout'] }), { flags: { wait: true, timeout: '5' }, rest: ['a', 'b'] });
  assert.deepEqual(parseCtl(['--', '--literal']).rest, ['--literal']);
  assert.throws(() => parseCtl(['--nope']), error => error instanceof CtlError && error.exit === 2);
});

test('refuses to run outside a PromptOps terminal', async () => {
  assert.throws(() => context({}), error => error.code === 'not_in_promptops');
  assert.equal((await runCtl(['env'], { env: {} })).inPromptOps, false);
  await assert.rejects(runCtl(['agent', 'list'], { env: {} }), error => error.code === 'not_in_promptops');
});

test('every call carries token and caller, never in the URL', async () => {
  const { calls, fetchImpl } = recorder([reply({ agents: [] })]);
  assert.deepEqual(await runCtl(['agent', 'list'], { env, fetchImpl }), { agents: [] });
  assert.equal(calls[0].url, 'http://127.0.0.1:5123/ctl/agent/list');
  assert.equal(calls[0].headers['x-promptops-token'], 'secret');
  assert.deepEqual(calls[0].body, { caller: 'parent-1' });
});

test('prompt --wait re-polls wait slices with the turn returned by prompt', async () => {
  const agent = { id: 'abc123', state: 'working' };
  const { calls, fetchImpl } = recorder([reply({ agent, sinceTurn: 3 }), reply({ pending: true, agent }), reply({ pending: false, agent: { ...agent, state: 'idle', lastMessage: 'done' } })]);
  const result = await runCtl(['agent', 'prompt', 'reviewer', 'check', 'the', 'tests', '--wait'], { env, fetchImpl });
  assert.equal(result.agent.lastMessage, 'done');
  assert.deepEqual(calls[0].body, { target: 'reviewer', text: 'check the tests', caller: 'parent-1' });
  assert.deepEqual(calls.slice(1).map(c => [c.url.split('/ctl/')[1], c.body.target, c.body.sinceTurn]), [['agent/wait', 'abc123', 3], ['agent/wait', 'abc123', 3]]);
});

test('server errors keep their code; blocked agents surface as agent_blocked', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ ok: false, error: { code: 'agent_blocked', message: 'dialog open' } }), { status: 409 });
  await assert.rejects(runCtl(['agent', 'prompt', 'x', 'hi'], { env, fetchImpl }), error => error.code === 'agent_blocked' && error.exit === 1);
  await assert.rejects(runCtl(['agent', 'get', 'x'], { env, fetchImpl: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); } }), error => error.code === 'app_unreachable');
});

test('read prints plain text, --json keeps metadata; missing args are exit 2', async () => {
  const body = { source: 'recent', text: 'hello', cols: 80, rows: 24 };
  assert.deepEqual(await runCtl(['agent', 'read', 'x'], { env, fetchImpl: async () => reply(body) }), { text: 'hello' });
  assert.deepEqual(await runCtl(['agent', 'read', 'x', '--json'], { env, fetchImpl: async () => reply(body) }), body);
  await assert.rejects(runCtl(['agent', 'read'], { env }), error => error.exit === 2);
  await assert.rejects(runCtl(['agent', 'read', 'x', '--lines', '0'], { env }), error => error.exit === 2);
});

test('end to end through main.mjs against a local server', async t => {
  const seen = [];
  const server = http.createServer((req, res) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { seen.push({ url: req.url, token: req.headers['x-promptops-token'], body: JSON.parse(raw) }); res.end(JSON.stringify({ ok: true, result: { agents: [{ id: 'a1', state: 'idle' }] } })); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const childEnv = { ...process.env, ...env, PROMPTOPS_HOOK_PORT: String(server.address().port) };
  const { stdout } = await exec(process.execPath, [main, 'ctl', 'agent', 'list'], { env: childEnv });
  assert.equal(JSON.parse(stdout).agents[0].id, 'a1');
  assert.deepEqual(seen[0], { url: '/ctl/agent/list', token: 'secret', body: { caller: 'parent-1' } });
  const help = await exec(process.execPath, [main, 'ctl', '--help'], { env: childEnv });
  assert.match(help.stdout, /promptops ctl agent spawn/);
  const failure = await exec(process.execPath, [main, 'ctl', 'agent', 'bogus'], { env: childEnv }).catch(error => error);
  assert.equal(failure.code, 2);
  assert.equal(JSON.parse(failure.stderr).error.code, 'invalid_syntax');
  const skill = await exec(process.execPath, [main, 'ctl', 'skill', 'print'], { env: childEnv });
  assert.match(skill.stdout, /^---\nname: promptops\n/);
});
