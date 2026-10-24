#!/usr/bin/env node
// PromptOps CLI. Copyright Shellonback S.r.l. Licensed under the Apache License 2.0.
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { terminalInput } from './input.mjs';
import { loadConfig } from './config.mjs';
import { ChatClient } from './transport.mjs';
import { runAgent, systemPrompt } from './agent.mjs';
import { executeTool } from './tools.mjs';
import { createUI, answerRenderer, clean } from './ui.mjs';
export function parseArgs(argv) {
  const result = {};
  const bool = new Set(['help', 'version', 'models', 'yes']);
  const values = new Set(['config', 'provider', 'model', 'base-url', 'tool-mode', 'timeout', 'context-chars', 'prompt']);
  for (let i = 0; i < argv.length; i++) {
    const flag = ({ '-h': '--help', '-v': '--version', '-m': '--model', '-p': '--prompt' })[argv[i]] || argv[i];
    const key = flag.slice(2);
    if (!flag.startsWith('--')) throw new Error(`Unknown argument: ${flag}`);
    if (bool.has(key)) result[key] = true;
    else if (values.has(key) && argv[i + 1] !== undefined) result[key] = argv[++i];
    else throw new Error(`Unknown option or missing value: ${flag}`);
  }
  return result;
}
const HELP = `PromptOps CLI 2.0 — coding assistant for local and hosted open models

node main.mjs [--config FILE] [--model ID] [--base-url URL]
  --provider ID          Provider name (any compatible server can use --base-url)
  --prompt TEXT, -p     One non-interactive turn; write/command tools denied by default
  --models              List models offered by the configured server
  --tool-mode MODE      auto (default), native, text, off
  --timeout SECONDS     Total time limit per turn (default 120)
  --context-chars N     History budget in characters (default 48000)
  --yes                 Approve write and shell tools automatically
  --help / --version    No configuration or network required

Agent control: promptops ctl --help (list, spawn, prompt, wait and read sibling agents)
MCP server:    promptops mcp (same control plane as tools for Claude Code, Codex and any MCP client)
Commands: /help /models /clear /status /tokens /exit
Local tools: /read FILE /ls [DIR] /search TEXT /run COMMAND /git ARGS /diff
API key: PROMPTOPS_LLM_API_KEY (never pass secrets as command arguments).
Requires Node.js 18.17+; search_files uses ripgrep. NO_COLOR disables ANSI styling.`;

export async function main(argv = process.argv.slice(2)) {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node.js 18.17 or newer is required.');
  if (argv[0] === 'ctl') return (await import('./ctl.mjs')).ctlMain(argv.slice(1));
  if (argv[0] === 'mcp') return (await import('./mcp.mjs')).mcpMain(argv.slice(1));
  const options = parseArgs(argv);
  if (options.help) { console.log(HELP); return; }
  if (options.version) { console.log('PromptOps CLI 2.0.0'); return; }
  const config = await loadConfig(options);
  const client = new ChatClient(config), ui = createUI(), cwd = process.cwd();
  if (options.models) { console.log((await client.models(AbortSignal.timeout(config.timeoutMs))).join('\n')); return; }
  ui.banner(config, cwd);
  const interactive = !!process.stdin.isTTY && ui.tty;
  const inputStream = interactive ? terminalInput(process.stdin) : process.stdin;
  const rl = readline.createInterface({ input: inputStream, output: process.stdout, terminal: interactive });
  inputStream.on('error', error => { ui.line(error.message); rl.close(); });
  if (interactive) process.stdout.write('\x1b[?2004h');
  const lines = rl[Symbol.asyncIterator]();
  let controller, timer, closed = false, pendingLine;
  const ask = async (prompt, signal) => {
    ui.stop(); if (ui.tty) process.stdout.write(prompt);
    if (signal?.aborted) throw signal.reason;
    pendingLine ??= lines.next();
    let abort;
    try {
      const next = await (signal ? Promise.race([pendingLine, new Promise((_, reject) => {
        abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
      })]) : pendingLine);
      pendingLine = null;
      return next.done ? null : next.value.replaceAll('\u2028', '\n');
    } finally { if (abort) signal.removeEventListener('abort', abort); }
  };
  const cancel = () => { if (controller) controller.abort(new Error('Canceled.')); else { closed = true; rl.close(); } };
  rl.on('SIGINT', cancel); process.on('SIGINT', cancel);
  const messages = [{ role: 'system', content: systemPrompt(cwd, config.toolMode) }];
  let turns = 0, tokens = 0;
  const approve = async (name, args) => {
    if (controller.signal.aborted) return false;
    if (options.yes) return true;
    if (!process.stdin.isTTY || options.prompt !== undefined) return false;
    const preview = args.command || args.args || args.path;
    const answer = await ask(`\n${clean(name)} · ${clean(preview)}\nAllow? [y/N] `, controller.signal);
    return /^y(es)?$/i.test(answer?.trim() || '');
  };
  try {
    while (!closed) {
      const input = options.prompt ?? await ask(ui.style('1', '› '));
      if (input === null) break;
      if (!input.trim()) { if (options.prompt !== undefined) break; continue; }
      if (['/exit', '/quit'].includes(input)) break;
      if (input === '/help') { ui.line(HELP); if (options.prompt !== undefined) break; continue; }
      if (input === '/clear') { messages.splice(1); ui.line('Conversation cleared.'); if (options.prompt !== undefined) break; continue; }
      if (input === '/tokens') { ui.line(`${turns} turns · ${tokens} reported tokens (providers may omit usage).`); if (options.prompt !== undefined) break; continue; }
      const before = messages.length;
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(new Error('Turn timed out. Increase --timeout for a cold local model.')), config.timeoutMs);
      const started = Date.now();
      let usage;
      const renderer = answerRenderer(text => ui.text(text));
      try {
        if (input === '/models') ui.line((await client.models(controller.signal)).join('\n'));
        else {
          const match = input.match(/^\/(read|ls|search|run|git|diff|status)(?:\s+(.*))?$/s);
          if (match) {
            const [, command, arg = ''] = match;
            const [name, args] = {
              read: ['read_file', { path: arg }], ls: ['list_files', { path: arg || '.' }],
              search: ['search_files', { pattern: arg }], run: ['run_command', { command: arg }],
              git: ['git', { args: arg }], diff: ['git', { args: 'diff' }], status: ['git', { args: 'status --short' }],
            }[command];
            ui.line(await executeTool(name, args, { cwd, signal: controller.signal }));
          } else {
            messages.push({ role: 'user', content: input }); ui.start();
            await runAgent(client, messages, { cwd, signal: controller.signal, approve,
              onText: text => renderer.push(text), onTool: (name, _args, state) => ui.line(`\n  ${state === 'denied' ? 'Skipped' : '↳'} ${name}`),
              onUsage: value => { usage = value; if (value) tokens += value.total_tokens ?? ((value.prompt_tokens || 0) + (value.completion_tokens || 0)); },
            });
            turns++; renderer.end(); ui.summary(Date.now() - started, usage);
          }
        }
      } catch (error) {
        // Keep completed tool results: an interrupted turn may have already changed files.
        if (messages.length > before) messages.push({ role: 'assistant', content: 'Turn interrupted. Some approved tools may already have completed; inspect their results and current files before continuing.' });
        ui.stop(); ui.line(`\n${controller.signal.aborted ? controller.signal.reason?.message || 'Canceled.' : error.message}`);
        if (options.prompt !== undefined) process.exitCode = 1;
      } finally { renderer.end(); ui.stop(); clearTimeout(timer); controller = null; }
      if (options.prompt !== undefined) break;
    }
  } finally { rl.close(); process.removeListener('SIGINT', cancel); ui.stop(); clearTimeout(timer);
    if (interactive) { process.stdout.write('\x1b[?2004l'); process.stdin.unpipe(inputStream); inputStream.destroy(); process.stdin.pause(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`PromptOps: ${clean(error.message)}`); process.exitCode = 1; });
}
