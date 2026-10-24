import { setTimeout as delay } from 'node:timers/promises';

export async function* sse(body) {
  const decoder = new TextDecoder();
  let buffer = '', data = [];
  const line = value => {
    if (!value) { const event = data.join('\n'); data = []; return event; }
    if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
    return null;
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 8 * 1024 * 1024) throw new Error('Stream event exceeds 8 MiB.');
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const event = line(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1);
      if (event === '[DONE]') return;
      if (event) yield JSON.parse(event);
    }
  }
  buffer += decoder.decode();
  if (buffer) line(buffer.replace(/\r$/, ''));
  const event = data.join('\n');
  if (event && event !== '[DONE]') yield JSON.parse(event);
}

export function textContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(p => p.text || '').join('');
  return '';
}

export class ChatClient {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; this.nativeTools = config.toolMode !== 'text' && config.toolMode !== 'off'; this.stream = true; this.systemRole = true; }
  headers() { return { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) }; }
  async models(signal) {
    const response = await this.fetch(`${this.config.baseUrl}/models`, { headers: this.headers(), signal });
    if (!response.ok) throw new Error(`Model discovery failed (HTTP ${response.status}).`);
    const data = await response.json();
    return (data.data || []).map(m => m.id).filter(Boolean);
  }
  async complete(messages, tools, { signal, onText = () => {}, onThinking = () => {} } = {}) {
    let failures = 0;
    for (;;) {
      let requestMessages = messages;
      if (!this.systemRole) {
        const instructions = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        requestMessages = messages.filter(m => m.role !== 'system').map(m => ({ ...m }));
        if (instructions) {
          if (requestMessages[0]?.role === 'user') requestMessages[0].content = `${instructions}\n\n${requestMessages[0].content}`;
          else requestMessages.unshift({ role: 'user', content: instructions });
        }
      }
      const body = { model: this.config.model, messages: requestMessages, stream: this.stream };
      if (this.nativeTools && tools.length) body.tools = tools;
      const response = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 1500);
        if ([400, 422].includes(response.status) && this.systemRole && /system/i.test(detail) && /not support|unsupported|not allowed/i.test(detail)) { this.systemRole = false; continue; }
        if ([400, 422].includes(response.status) && this.config.toolMode === 'auto' && this.nativeTools && /tools?|function.call/i.test(detail) && /support|unknown|unrecognized|not allowed/i.test(detail)) {
          this.nativeTools = false; continue;
        }
        if ([400, 422].includes(response.status) && this.stream && /stream/i.test(detail) && /support|unknown|not allowed/i.test(detail)) { this.stream = false; continue; }
        if ([429, 502, 503, 504].includes(response.status) && failures++ < 2) {
          const retry = Number(response.headers.get('retry-after'));
          await delay(Math.min(5000, Math.max(250, (retry || failures) * 1000)), undefined, { signal }); continue;
        }
        const safe = this.config.apiKey ? detail.replaceAll(this.config.apiKey, '[redacted]') : detail;
        throw new Error(`HTTP ${response.status}: ${safe}`);
      }
      const streaming = response.headers.get('content-type')?.includes('text/event-stream');
      const result = { content: '', reasoning: '', calls: [], usage: null, finishReason: null };
      const calls = new Map();
      const accept = (chunk, streaming) => {
        if (chunk.error) throw new Error(chunk.error.message || 'Provider returned a stream error.');
        if (chunk.usage) result.usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) return;
        result.finishReason = choice.finish_reason || result.finishReason;
        const delta = streaming ? choice.delta : choice.message;
        if (!delta) return;
        const content = textContent(delta.content);
        result.content += content; if (content) onText(content);
        const thinking = delta.reasoning_content || delta.reasoning || '';
        result.reasoning += thinking; if (thinking) onThinking(thinking);
        for (const [i, tc] of (delta.tool_calls || []).entries()) {
          const index = tc.index ?? i;
          const call = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) call.id = tc.id;
          if (tc.function?.name) call.function.name += tc.function.name;
          if (tc.function?.arguments) call.function.arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
          calls.set(index, call);
          if (calls.size > 16) throw new Error('Model requested more than 16 tools in one step.');
        }
      };
      if (streaming) {
        for await (const chunk of sse(response.body)) accept(chunk, true);
      } else accept(await response.json(), false);
      if (streaming && calls.size && !result.finishReason) throw new Error('Stream ended before the tool request completed; no tools were executed.');
      result.calls = [...calls.values()].map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
      if (!result.content && !result.calls.length) throw new Error(result.reasoning ? 'The model returned reasoning but no answer. Increase its output budget or disable reasoning on the server.' : 'The model returned an empty answer. Check its chat template and model configuration.');
      return result;
    }
  }
}
