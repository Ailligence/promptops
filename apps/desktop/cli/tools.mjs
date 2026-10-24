import fs from 'node:fs/promises';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(exec), runFile = promisify(execFile);
const string = { type: 'string' };
const definitions = [
  ['read_file', 'Read a text file with line numbers.', { path: string, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 400 } }, ['path']],
  ['list_files', 'List a directory in the workspace.', { path: string }, []],
  ['search_files', 'Search literal text in workspace files.', { pattern: string, path: string }, ['pattern']],
  ['write_file', 'Create or overwrite a file; requires approval.', { path: string, content: string }, ['path', 'content']],
  ['edit_file', 'Replace one unique exact match; requires approval.', { path: string, old_string: string, new_string: string }, ['path', 'old_string', 'new_string']],
  ['run_command', 'Run a shell command in the workspace; requires approval.', { command: string }, ['command']],
  ['git', 'Run a git command in the workspace; requires approval.', { args: string }, ['args']],
];
export const TOOLS = definitions.map(([name, description, properties, required]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }));
export const NEEDS_APPROVAL = new Set(['write_file', 'edit_file', 'run_command', 'git']);
export function validateTool(name, args) {
  const tool = TOOLS.find(t => t.function.name === name)?.function;
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
  for (const key of tool.parameters.required) if (!(key in args)) throw new Error(`Missing argument: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const spec = tool.parameters.properties[key];
    if (!spec || (spec.type === 'string' ? typeof value !== 'string' : !Number.isInteger(value))) throw new Error(`Invalid argument: ${key}`);
    if (spec.type === 'integer' && (value < spec.minimum || value > (spec.maximum ?? 10000000))) throw new Error(`Invalid range: ${key}`);
  }
}
export async function workspacePath(root, requested = '.') {
  const base = await fs.realpath(root);
  const candidate = path.resolve(base, requested);
  const inside = p => { const rel = path.relative(base, p); return !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel); };
  if (!inside(candidate)) throw new Error('Path is outside the workspace.');
  let existing = candidate;
  for (;;) {
    try { const real = await fs.realpath(existing); if (!inside(real)) throw new Error('Symlink points outside the workspace.'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(existing); if (parent === existing) throw error; existing = parent; }
  }
  return candidate;
}
// Shell and git children never need the model API key.
export function childEnv(env = process.env) {
  const { PROMPTOPS_LLM_API_KEY: _key, ...rest } = env;
  return rest;
}
export async function executeTool(name, args, { cwd = process.cwd(), signal } = {}) {
  validateTool(name, args);
  if (signal?.aborted) throw signal.reason;
  if (name === 'run_command' || name === 'git') {
    const { stdout, stderr } = await run(name === 'git' ? `git ${args.args}` : args.command, { cwd, env: childEnv(), timeout: 60000, maxBuffer: 1024 * 1024, signal });
    return (stdout + stderr).slice(0, 12000) || 'Done.';
  }
  const file = await workspacePath(cwd, args.path);
  if (name === 'list_files') return (await fs.readdir(file, { withFileTypes: true })).filter(e => !['.git', 'node_modules'].includes(e.name)).slice(0, 150).map(e => `${e.isDirectory() ? '/' : ' '} ${e.name}`).join('\n');
  if (name === 'search_files') {
    try {
      const { stdout } = await runFile('rg', ['--fixed-strings', '--line-number', '--max-count', '20', '--glob', '!node_modules/**', '--', args.pattern, file], { cwd, env: childEnv(), timeout: 10000, maxBuffer: 1024 * 1024, signal });
      return stdout.slice(0, 12000);
    } catch (error) { if (error.code === 1) return 'No matches.'; if (error.code === 'ENOENT') throw new Error('Search needs ripgrep (rg) on PATH.'); throw error; }
  }
  if (name === 'write_file') { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, args.content); return `Written ${path.relative(cwd, file)}`; }
  if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB; use a targeted shell command.');
  const content = await fs.readFile(file, 'utf8');
  if (name === 'read_file') { const offset = args.offset ?? 0; return content.split('\n').slice(offset, offset + (args.limit ?? 200)).map((l, i) => `${offset + i + 1}\t${l}`).join('\n').slice(0, 16000); }
  if (!args.old_string || !content.includes(args.old_string)) throw new Error('Exact text not found; read the file again.');
  if (content.indexOf(args.old_string) !== content.lastIndexOf(args.old_string)) throw new Error('Text matches multiple locations; include more context.');
  await fs.writeFile(file, content.replace(args.old_string, () => args.new_string));
  return `Edited ${path.relative(cwd, file)}`;
}
// Fallback accepts only an entire, explicit tool JSON response, never prose examples.
export function textToolCalls(text) {
  const raw = text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
  try {
    const value = JSON.parse(raw);
    const calls = Array.isArray(value) ? value : [value];
    return calls.map(c => {
      const name = c.name || c.tool || c.function?.name;
      const input = c.arguments ?? c.function?.arguments ?? {};
      const args = typeof input === 'string' ? JSON.parse(input) : input;
      validateTool(name, args); return { name, args };
    });
  } catch { return []; }
}
