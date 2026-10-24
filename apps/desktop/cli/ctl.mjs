// PromptOps CLI. Copyright Shellonback S.r.l. Licensed under the Apache License 2.0.
// `promptops ctl …`: control plane for agents running inside PromptOps terminals.
// Talks to the desktop app's local hook server (127.0.0.1:$PROMPTOPS_HOOK_PORT).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const CTL_HELP = `PromptOps ctl — drive sibling agents from inside a PromptOps terminal

promptops ctl agent list
promptops ctl agent spawn --name NAME --prompt TEXT [--provider ID] [--model ID] [--mode ID] [--role ID] [--effort LEVEL] [--cwd DIR] [--wait]
promptops ctl agent get TARGET
promptops ctl agent prompt TARGET TEXT [--wait] [--timeout MS]
promptops ctl agent wait TARGET [--until settled|idle|blocked] [--timeout MS]
promptops ctl agent read TARGET [--source recent|screen|last-message] [--lines N] [--json]
promptops ctl agent keys TARGET KEY... | --text LITERAL
promptops ctl env
promptops ctl skill print | install [--project]

TARGET is an agent id, a unique id prefix (6+ chars) or its name (slug of the title).
Scope is the caller's session: only agents under the same parent session are visible.
Every command prints one JSON document (read prints plain text unless --json); errors go to stderr as JSON with exit status 1
(2 for invalid syntax). --timeout defaults to no limit for wait, in milliseconds.
A blocked agent (permission or question dialog) never receives input from ctl.`;

export class CtlError extends Error {
  constructor(code, message, exit = 1) { super(message); this.code = code; this.exit = exit; }
}
const usage = message => new CtlError('invalid_syntax', message, 2);

// Flags may appear anywhere; everything else is positional. Values never reach a shell.
export function parseCtl(argv, { bool = [], values = [] } = {}) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--')) { rest.push(arg); continue; }
    const key = arg.slice(2);
    if (bool.includes(key)) flags[key] = true;
    else if (values.includes(key) && argv[i + 1] !== undefined) flags[key] = argv[++i];
    else throw usage(`Unknown option or missing value: ${arg}`);
  }
  return { flags, rest };
}

export function context(env = process.env) {
  const port = Number(env.PROMPTOPS_HOOK_PORT), token = env.PROMPTOPS_CTL_TOKEN, caller = env.PROMPTOPS_SESSION_ID;
  if (!validPort(port) || !token || !caller) {
    throw new CtlError('not_in_promptops', 'Not running inside a PromptOps terminal (PROMPTOPS_HOOK_PORT, PROMPTOPS_CTL_TOKEN and PROMPTOPS_SESSION_ID are required).');
  }
  return { port, token, caller };
}

export const validPort = port => Number.isInteger(port) && port > 0 && port < 65536;

// The token only ever goes to the loopback address of the desktop app, and never follows a redirect.
export async function call(ctx, endpoint, payload = {}, { fetchImpl = fetch } = {}) {
  if (!validPort(ctx.port)) throw new CtlError('not_in_promptops', 'Invalid PromptOps control port.');
  let response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${ctx.port}/ctl/${endpoint}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-promptops-token': ctx.token },
      body: JSON.stringify({ ...payload, caller: ctx.caller }),
    });
  } catch (error) {
    throw new CtlError('app_unreachable', `PromptOps desktop app is not reachable on port ${ctx.port}: ${error.cause?.code || error.message}`);
  }
  const data = await response.json().catch(() => null);
  if (!data) throw new CtlError('bad_response', `Unexpected response (HTTP ${response.status}); the desktop app may predate ctl support.`);
  if (!data.ok) throw new CtlError(data.error?.code || 'error', data.error?.message || `HTTP ${response.status}`);
  return data.result;
}

// The server answers `wait` in slices (long-poll); loop until settled or the caller's deadline.
export async function waitFor(ctx, target, { until, sinceTurn, timeoutMs } = {}, options) {
  const deadline = timeoutMs ? Date.now() + timeoutMs : Infinity;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) throw new CtlError('timeout', `Timed out waiting for '${target}'. A timeout does not prove nothing happened: read the agent before retrying.`);
    const result = await call(ctx, 'agent/wait', { target, until, sinceTurn, sliceMs: Number.isFinite(left) ? Math.min(left, 45000) : undefined }, options);
    if (!result.pending) return result;
  }
}

const number = (value, name) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw usage(`--${name} must be a positive integer`);
  return parsed;
};
const need = (value, what) => { if (!value) throw usage(`${what} required`); return value; };

async function agent(ctx, argv, options) {
  const [action, ...tail] = argv;
  if (action === 'list') return call(ctx, 'agent/list', {}, options);
  if (action === 'spawn') {
    const { flags } = parseCtl(tail, { bool: ['wait'], values: ['name', 'prompt', 'provider', 'model', 'mode', 'role', 'effort', 'cwd', 'timeout'] });
    const created = await call(ctx, 'agent/spawn', { ...flags, prompt: need(flags.prompt, '--prompt'), wait: undefined, timeout: undefined }, options);
    if (!flags.wait) return created;
    return waitFor(ctx, created.agent.id, { sinceTurn: 0, timeoutMs: number(flags.timeout, 'timeout') }, options);
  }
  if (action === 'get') return call(ctx, 'agent/get', { target: need(tail[0], 'TARGET') }, options);
  if (action === 'prompt') {
    const { flags, rest } = parseCtl(tail, { bool: ['wait'], values: ['timeout'] });
    const target = need(rest[0], 'TARGET'), text = need(rest.slice(1).join(' '), 'TEXT');
    const sent = await call(ctx, 'agent/prompt', { target, text }, options);
    if (!flags.wait) return sent;
    return waitFor(ctx, sent.agent.id, { sinceTurn: sent.sinceTurn, timeoutMs: number(flags.timeout, 'timeout') }, options);
  }
  if (action === 'wait') {
    const { flags, rest } = parseCtl(tail, { values: ['until', 'timeout'] });
    return waitFor(ctx, need(rest[0], 'TARGET'), { until: flags.until, timeoutMs: number(flags.timeout, 'timeout') }, options);
  }
  if (action === 'read') {
    const { flags, rest } = parseCtl(tail, { bool: ['json'], values: ['source', 'lines'] });
    const result = await call(ctx, 'agent/read', { target: need(rest[0], 'TARGET'), source: flags.source, lines: number(flags.lines, 'lines') }, options);
    return flags.json ? result : { text: result.text };
  }
  if (action === 'keys') {
    const { flags, rest } = parseCtl(tail, { values: ['text'] });
    return call(ctx, 'agent/keys', { target: need(rest[0], 'TARGET'), keys: rest.slice(1), text: flags.text }, options);
  }
  throw usage(`Unknown agent command: ${action || '(none)'}. Run: promptops ctl --help`);
}

async function skill(argv) {
  const { flags, rest } = parseCtl(argv, { bool: ['project'] });
  const source = await readFile(new URL('./skill.md', import.meta.url), 'utf8');
  if (rest[0] === 'print') return { text: source };
  if (rest[0] !== 'install') throw usage('Usage: promptops ctl skill print | install [--project]');
  const dir = path.join(flags.project ? process.cwd() : os.homedir(), '.claude', 'skills', 'promptops');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), source);
  return { installed: path.join(dir, 'SKILL.md') };
}

export async function runCtl(argv, { env = process.env, fetchImpl } = {}) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') return { text: CTL_HELP };
  const [group, ...tail] = argv;
  if (group === 'skill') return skill(tail);
  if (group === 'env') {
    return { inPromptOps: Boolean(env.PROMPTOPS_HOOK_PORT && env.PROMPTOPS_CTL_TOKEN && env.PROMPTOPS_SESSION_ID), sessionId: env.PROMPTOPS_SESSION_ID || null, workspace: env.PROMPTOPS_WORKSPACE || null, hookPort: Number(env.PROMPTOPS_HOOK_PORT) || null };
  }
  if (group === 'agent') return agent(context(env), tail, { fetchImpl });
  throw usage(`Unknown ctl command: ${group}. Run: promptops ctl --help`);
}

// Text results (help, skill print, read) print raw; everything else is JSON.
export async function ctlMain(argv) {
  try {
    const result = await runCtl(argv);
    const raw = result && Object.keys(result).length === 1 && typeof result.text === 'string';
    console.log(raw ? result.text : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: { code: error.code || 'error', message: error.message } }));
    process.exitCode = error.exit || 1;
  }
}
