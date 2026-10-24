import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endpoint, loadConfig, DEFAULTS } from '../config.mjs';
import { ChatClient, sse } from '../transport.mjs';
import { executeTool, workspacePath, textToolCalls, TOOLS, childEnv } from '../tools.mjs';
import { runAgent, trimHistory } from '../agent.mjs';
import { answerRenderer, createUI } from '../ui.mjs';
import { parseArgs } from '../main.mjs';
const exec = promisify(execFile);
const main = fileURLToPath(new URL('../main.mjs', import.meta.url));
const config = { baseUrl: 'http://localhost:1234/v1', model: 'any/model', toolMode: 'auto', contextChars: 48000 };
const jsonResponse = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const answer = content => ({ choices: [{ message: { content }, finish_reason: 'stop' }] });
function streamResponse(events, fragmented = false) {
  const bytes = new TextEncoder().encode(events.map(e => `data:${JSON.stringify(e)}\r\n\r\n`).join('') + 'data:[DONE]\n\n');
  return new Response(new ReadableStream({ start(c) { if (fragmented) for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); else c.enqueue(bytes); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'promptops-cli-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }

test('normalizes local, LAN, IPv6 and complete endpoint URLs without duplicating versions', () => {
  for (const host of ['localhost:1234', '127.0.0.1:1234', '[::1]:1234', '192.168.1.9:8080']) assert.equal(endpoint({ baseUrl: `http://${host}/` }), `http://${host}/v1`);
  assert.equal(endpoint({ baseUrl: 'https://example.test/api/v4/chat/completions/' }), 'https://example.test/api/v4');
  for (const provider of Object.keys(DEFAULTS)) assert.ok(endpoint({ provider }).startsWith('http'));
  for (const baseUrl of ['file:///secret', 'https://user:password@example.test', 'http://example.test?key=secret']) assert.throws(() => endpoint({ baseUrl }));
  assert.throws(() => endpoint({ provider: 'unknown' }), /base URL/);
});
test('loads explicit configuration and respects model/env overrides', async t => {
  const dir = await temp(t), file = path.join(dir, 'config.json');
  await fs.writeFile(file, JSON.stringify({ provider: 'ollama', model: 'old', apiKey: 'saved' }));
  const c = await loadConfig({ config: file, model: 'new' }, { PROMPTOPS_LLM_API_KEY: 'override' });
  assert.equal(c.model, 'new'); assert.equal(c.apiKey, 'override'); assert.equal(c.baseUrl, DEFAULTS.ollama);
  await assert.rejects(loadConfig({ config: file, timeout: 'NaN' }, {}), /Timeout/);
  await fs.writeFile(file, 'bad json'); await assert.rejects(loadConfig({ config: file }, {}), /Cannot read/);
});
test('fetches a vault-held API key from the app and never falls back to the hosted edition folder', async t => {
  const dir = await temp(t), file = path.join(dir, 'config.json');
  await fs.writeFile(file, JSON.stringify({ provider: 'open_router', model: 'm', hasApiKey: true }));
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return jsonResponse({ ok: true, result: { apiKey: 'from-vault' } }); };
  const env = { PROMPTOPS_HOOK_PORT: '4321', PROMPTOPS_CTL_TOKEN: 'tok', PROMPTOPS_SESSION_ID: 'sess-1' };
  const c = await loadConfig({ config: file }, env, { fetchImpl });
  assert.equal(c.apiKey, 'from-vault');
  assert.equal(calls[0].url, 'http://127.0.0.1:4321/ctl/cli/llm-key');
  assert.equal(calls[0].init.headers['x-promptops-token'], 'tok');
  // An explicit env key wins and the app is not asked.
  const before = calls.length;
  assert.equal((await loadConfig({ config: file }, { ...env, PROMPTOPS_LLM_API_KEY: 'env' }, { fetchImpl })).apiKey, 'env');
  assert.equal(calls.length, before);
  // Outside a PromptOps terminal the error says how to provide the key.
  await assert.rejects(loadConfig({ config: file }, {}, { fetchImpl }), /PromptOps terminal or set PROMPTOPS_LLM_API_KEY/);
  // Default search paths: the OSS data folder only, never promptops-desktop.
  const src = await fs.readFile(new URL('../config.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('promptops-oss/fcc-config.json'));
  assert.ok(!src.includes('promptops-desktop'));
});
test('SSE handles byte fragmentation, UTF-8, CRLF and tool argument fragments', async () => {
  const client = new ChatClient(config, async () => streamResponse([
    { choices: [{ delta: { content: 'Ciao ☀', reasoning_content: 'plan' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"path":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ], true));
  const result = await client.complete([], TOOLS);
  assert.equal(result.content, 'Ciao ☀'); assert.equal(result.reasoning, 'plan'); assert.equal(result.usage.total_tokens, 15);
  assert.equal(result.calls.length, 1); assert.deepEqual(JSON.parse(result.calls[0].function.arguments), { path: 'README.md' });
});
test('SSE flushes a final event without a newline', async () => {
  const response = new Response('data:{"choices":[]}'); const events = [];
  for await (const value of sse(response.body)) events.push(value);
  assert.deepEqual(events, [{ choices: [] }]);
});
test('native tools fall back once and remain disabled on subsequent calls', async () => {
  const requests = [];
  const client = new ChatClient(config, async (_, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length === 1 ? new Response('This model does not support tools', { status: 400 }) : jsonResponse(answer('ok'));
  });
  await client.complete([], TOOLS); await client.complete([], TOOLS);
  assert.ok(requests[0].tools); assert.equal(requests[1].tools, undefined); assert.equal(requests[2].tools, undefined);
});
test('unsupported streaming falls back to a normal JSON response', async () => {
  let count = 0;
  const client = new ChatClient(config, async (_, init) => {
    if (++count === 1) return new Response('stream is not supported', { status: 422 });
    assert.equal(JSON.parse(init.body).stream, false); return jsonResponse(answer([{ type: 'text', text: 'works' }]));
  });
  assert.equal((await client.complete([], [])).content, 'works'); assert.equal(count, 2);
});
test('authentication errors are not retried and secrets are redacted', async () => {
  let count = 0;
  const client = new ChatClient({ ...config, apiKey: 'test-secret' }, async () => { count++; return new Response('Invalid key test-secret', { status: 401 }); });
  await assert.rejects(client.complete([], []), error => !error.message.includes('test-secret') && error.message.includes('[redacted]'));
  assert.equal(count, 1);
});
test('retryable overload recovers with bounded retries', async () => {
  let count = 0;
  const client = new ChatClient(config, async () => ++count < 3 ? new Response('busy', { status: 503, headers: { 'retry-after': '0.001' } }) : jsonResponse(answer('ok')));
  assert.equal((await client.complete([], [])).content, 'ok'); assert.equal(count, 3);
});
test('cancellation interrupts retries without additional requests', async () => {
  const controller = new AbortController(); let count = 0;
  const client = new ChatClient(config, async () => { count++; controller.abort(); return new Response('busy', { status: 503 }); });
  await assert.rejects(client.complete([], [], { signal: controller.signal })); assert.equal(count, 1);
});
test('discovery sends authentication and keeps arbitrary model IDs', async () => {
  const client = new ChatClient({ ...config, apiKey: 'key' }, async (url, init) => {
    assert.equal(url, `${config.baseUrl}/models`); assert.equal(init.headers.Authorization, 'Bearer key'); return jsonResponse({ data: [{ id: 'org/new-open-model:q4' }] });
  });
  assert.deepEqual(await client.models(), ['org/new-open-model:q4']);
});
test('agent executes a native tool once and returns its proper tool result', async () => {
  let count = 0, executed = 0;
  const client = new ChatClient(config, async (_, init) => {
    if (++count === 1) return jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }, finish_reason: 'tool_calls' }] });
    const body = JSON.parse(init.body); assert.equal(body.messages.at(-1).role, 'tool'); assert.equal(body.messages.at(-1).tool_call_id, 'x');
    return jsonResponse(answer('done'));
  });
  assert.equal(await runAgent(client, [{ role: 'user', content: 'read' }], { execute: async () => { executed++; return 'file content'; } }), 'done');
  assert.equal(executed, 1);
});
test('denied writes and git commands never execute', async () => {
  for (const [name, args] of [['write_file', { path: 'x', content: 'x' }], ['git', { args: 'reset --hard' }]]) {
    let round = 0;
    const client = { config, complete: async () => ({ content: round++ === 0 ? JSON.stringify({ name, arguments: args }) : 'denied', calls: [] }) };
    const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'task' }];
    await runAgent(client, messages, { approve: async () => false, execute: async () => assert.fail('must not execute') });
    assert.ok(messages.some(m => m.content?.includes('Denied by the user')));
  }
});
test('text fallback does not execute examples or duplicate fenced calls', () => {
  const call = '{"name":"read_file","arguments":{"path":"a"}}';
  assert.equal(textToolCalls('```json\n' + call + '\n```').length, 1);
  assert.equal(textToolCalls('For example:\n' + call).length, 0);
  assert.equal(textToolCalls('{"name":"unknown","arguments":{}}').length, 0);
});
test('disabled tools reject unexpected native tool calls', async () => {
  const client = { config: { ...config, toolMode: 'off' }, complete: async () => ({ content: '', calls: [{ function: { name: 'run_command', arguments: '{"command":"bad"}' } }] }) };
  await assert.rejects(runAgent(client, [], { execute: async () => assert.fail('must not execute') }), /disabled/);
});
test('context trimming keeps entire tool exchanges and rejects oversized current task', () => {
  const history = [{ role: 'system', content: 's' }, { role: 'user', content: 'a'.repeat(500) }, { role: 'assistant', content: 'tool' }, { role: 'tool', content: 'result' }, { role: 'user', content: 'latest' }];
  assert.deepEqual(trimHistory(history, 150), [history[0], history[4]]);
  assert.throws(() => trimHistory([history[0], history[1]], 50), /context budget/);
});
test('workspace boundary rejects traversal and external symlinks', async t => {
  const dir = await temp(t); await fs.mkdir(path.join(dir, 'work')); await fs.writeFile(path.join(dir, 'outside'), 'secret');
  await assert.rejects(workspacePath(path.join(dir, 'work'), '../outside'), /outside/);
  await fs.symlink(path.join(dir, 'outside'), path.join(dir, 'work/link'));
  await assert.rejects(workspacePath(path.join(dir, 'work'), 'link'), /Symlink/);
});
test('file tools edit unique matches literally and validate arguments', async t => {
  const cwd = await temp(t);
  await executeTool('write_file', { path: 'x', content: 'hello world' }, { cwd });
  await executeTool('edit_file', { path: 'x', old_string: 'world', new_string: '$&' }, { cwd });
  assert.equal(await fs.readFile(path.join(cwd, 'x'), 'utf8'), 'hello $&');
  await assert.rejects(executeTool('read_file', { path: 'x', limit: -1 }, { cwd }), /range/);
});
test('reasoning tags fragmented at every character are hidden', () => {
  let output = ''; const renderer = answerRenderer(value => output += value);
  for (const char of '<think>private plan</think>Hello <b>world</b>') renderer.push(char);
  renderer.end(); assert.equal(output, 'Hello <b>world</b>');
});
test('redirected output has no ANSI, spinners or banner', () => {
  let output = ''; const ui = createUI({ isTTY: false, write: value => output += value });
  ui.banner(config, '/test'); ui.start(); ui.text('answer'); ui.stop(); assert.equal(output, 'answer');
});
test('CLI options reject unknown flags and preserve model names', () => {
  assert.equal(parseArgs(['--model', 'org/model:q4', '-p', 'hello']).model, 'org/model:q4');
  assert.throws(() => parseArgs(['--secret']), /Unknown/);
});
test('actual CLI help and version run with no config or provider', async () => {
  const help = await exec(process.execPath, [main, '--help']); assert.match(help.stdout, /PromptOps CLI 2.0/); assert.doesNotMatch(help.stdout, /\x1b/);
  const version = await exec(process.execPath, [main, '--version']); assert.equal(version.stdout.trim(), 'PromptOps CLI 2.0.0');
});
test('actual non-interactive CLI completes against a mocked provider', async t => {
  const dir = await temp(t), mock = path.join(dir, 'mock.mjs');
  await fs.writeFile(mock, `globalThis.fetch = async (url, init) => { const body=JSON.parse(init.body); if(body.model!=='qa-model') throw new Error('wrong model'); return new Response(JSON.stringify({choices:[{message:{content:'QA passed'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}}); };`);
  const cfg = path.join(dir, 'config.json'); await fs.writeFile(cfg, '{}');
  const result = await exec(process.execPath, ['--import', pathToFileURL(mock).href, main, '--config', cfg, '--model', 'qa-model', '--base-url', 'http://localhost:9999', '--prompt', 'hello', '--tool-mode', 'off'], { env: { ...process.env, PROMPTOPS_CLI_CONFIG: '', PROMPTOPS_LLM_API_KEY: '' } });
  assert.equal(result.stdout, 'QA passed\n'); assert.equal(result.stderr, '');
});
test('truncated native tool streams do not execute valid-looking partial requests', async () => {
  const client = new ChatClient(config, async () => streamResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'run_command', arguments: '{"command":"echo unsafe"}' } }] } }] }]));
  await assert.rejects(runAgent(client, [], { approve: async () => true, execute: async () => assert.fail('must not execute') }), /before the tool request completed/);
});
test('reasoning-only inline output is reported instead of silently succeeding', async () => {
  const client = { config, complete: async () => ({ content: '<think>plan only</think>', calls: [] }) };
  await assert.rejects(runAgent(client, []), /without an answer/);
});
test('actual bundled invocation forwards command arguments without shell interpolation', async () => {
  const script = "import(require('node:url').pathToFileURL(process.env.PROMPTOPS_CLI_ENTRY).href).then(m=>m.main(process.argv.slice(1))).catch(e=>{console.error(e.message);process.exitCode=1})";
  const result = await exec(process.execPath, ['-e', script, '--', '--version'], { env: { ...process.env, PROMPTOPS_CLI_ENTRY: main } });
  assert.equal(result.stdout.trim(), 'PromptOps CLI 2.0.0');
});
test('models without a system role retain instructions in the user turn', async () => {
  let count = 0;
  const client = new ChatClient(config, async (_, init) => {
    if (++count === 1) return new Response('System role is not supported', { status: 400 });
    const body = JSON.parse(init.body);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'instructions\n\nquestion' }]);
    return jsonResponse(answer('answer'));
  });
  assert.equal((await client.complete([{ role: 'system', content: 'instructions' }, { role: 'user', content: 'question' }], [])).content, 'answer');
});
test('fragmented bracketed paste keeps multiline text as one pending prompt', async () => {
  const { pasteNormalizer } = await import('../input.mjs');
  let output = ''; const input = pasteNormalizer(text => output += text);
  for (const char of '\x1b[200~first\r\nsecond\nthird\x1b[201~') input.push(char);
  assert.equal(output.includes('\n'), false);
  assert.equal(output.replaceAll('\u2028', '\n'), 'first\nsecond\nthird');
  input.push('\r'); assert.equal(output.at(-1), '\r');
});
test('ordinary terminal keys pass through without being interpreted as paste', async () => {
  const { pasteNormalizer } = await import('../input.mjs');
  let output = ''; const input = pasteNormalizer(text => output += text);
  input.push('hello\r\x1b[A'); input.end(); assert.equal(output, 'hello\r\x1b[A');
});
test('shell and git tools do not hand the model API key to their children', async t => {
  assert.deepEqual(childEnv({ PATH: '/bin', PROMPTOPS_LLM_API_KEY: 'k' }), { PATH: '/bin' });
  const cwd = await temp(t);
  process.env.PROMPTOPS_LLM_API_KEY = 'leak-check';
  t.after(() => { delete process.env.PROMPTOPS_LLM_API_KEY; });
  const out = await executeTool('run_command', { command: 'echo "[$PROMPTOPS_LLM_API_KEY]"' }, { cwd });
  assert.equal(out.trim(), '[]');
});
