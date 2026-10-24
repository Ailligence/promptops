// PromptOps CLI. Copyright Shellonback S.r.l. Licensed under the Apache License 2.0.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { call, context } from './ctl.mjs';
export const DEFAULTS = {
  ollama: 'http://localhost:11434/v1', lm_studio: 'http://localhost:1234/v1',
  llamacpp: 'http://localhost:8080/v1', open_router: 'https://openrouter.ai/api/v1',
  opencode: 'https://opencode.ai/zen/v1', nvidia_nim: 'https://integrate.api.nvidia.com/v1',
  zai: 'https://api.z.ai/api/coding/paas/v4', kimi: 'https://api.moonshot.cn/v1', wafer: 'https://pass.wafer.ai/v1',
  deepseek: 'https://api.deepseek.com/v1', fireworks: 'https://api.fireworks.ai/inference/v1',
};
export function endpoint(config) {
  const raw = config.baseUrl?.trim() || DEFAULTS[config.provider];
  if (!raw) throw new Error('Set a base URL for this provider (OpenAI-compatible Chat Completions).');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTP(S) base URL without credentials, query or fragment.');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') || '/v1';
  return url.toString().replace(/\/+$/, '');
}
// The desktop app keeps the API key in its encrypted store and only records
// `hasApiKey` in the JSON file: inside a PromptOps terminal the CLI asks the app
// for it over the loopback control plane, so the key never sits in a file.
async function vaultKey(saved, env, fetchImpl) {
  if (!saved.hasApiKey) return undefined;
  let ctx;
  try { ctx = context(env); }
  catch { throw new Error('The API key is kept in the PromptOps app: run the CLI from a PromptOps terminal or set PROMPTOPS_LLM_API_KEY.'); }
  const result = await call(ctx, 'cli/llm-key', {}, fetchImpl ? { fetchImpl } : undefined);
  return result?.apiKey || undefined;
}
export async function loadConfig(options = {}, env = process.env, deps = {}) {
  const home = os.homedir();
  const data = process.platform === 'darwin' ? path.join(home, 'Library/Application Support')
    : process.platform === 'win32' ? env.APPDATA : env.XDG_DATA_HOME || path.join(home, '.local/share');
  const explicit = options.config || env.PROMPTOPS_CLI_CONFIG;
  const paths = explicit ? [explicit] : [path.join(data || home, 'promptops-oss/fcc-config.json'),
    path.join(home, '.promptops/fcc-config.json'), path.join(home, '.config/promptops/cli-config.json')];
  let saved = {};
  for (const file of paths) {
    try { saved = JSON.parse(await readFile(file, 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT' || explicit) throw new Error(`Cannot read CLI configuration: ${file}`); }
  }
  const config = {
    ...saved,
    provider: options.provider || env.PROMPTOPS_LLM_PROVIDER || saved.provider,
    model: options.model || env.PROMPTOPS_LLM_MODEL || saved.model,
    baseUrl: options['base-url'] || env.PROMPTOPS_LLM_BASE_URL || saved.baseUrl,
    apiKey: env.PROMPTOPS_LLM_API_KEY || saved.apiKey || await vaultKey(saved, env, deps.fetchImpl),
    toolMode: options['tool-mode'] || saved.toolMode || 'auto',
    timeoutMs: Number(options.timeout || 120) * 1000,
    contextChars: Number(options['context-chars'] || 48000),
  };
  if (!config.model && !options.models) throw new Error('Configure a model in AI Accounts → PromptOps CLI, or pass --model and --base-url.');
  if (!['auto', 'native', 'text', 'off'].includes(config.toolMode)) throw new Error('Tool mode must be auto, native, text or off.');
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 1800000) throw new Error('Timeout must be between 1 and 1800 seconds.');
  if (!Number.isInteger(config.contextChars) || config.contextChars < 4000) throw new Error('Context budget must be at least 4000 characters.');
  config.baseUrl = endpoint(config);
  return config;
}
