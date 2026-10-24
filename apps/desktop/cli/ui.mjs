import { stripVTControlCharacters } from 'node:util';
export const clean = text => stripVTControlCharacters(String(text)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
export function createUI(output = process.stdout, env = process.env) {
  const tty = !!output.isTTY;
  const color = tty && !('NO_COLOR' in env) && env.TERM !== 'dumb';
  const style = (code, value) => color ? `\x1b[${code}m${value}\x1b[0m` : value;
  let timer, shown = false, ticks = 0;
  return {
    tty, style,
    banner(config, cwd) {
      if (!tty) return;
      output.write(`\n  ${style('1', '◈ PromptOps')} ${style('90', 'CLI · 2.0')}\n  ${clean(config.model)} ${style('90', `· ${clean(config.provider || 'custom')}`)}\n  ${style('90', clean(cwd))}\n  ${style('90', '/help · /models · /clear · Ctrl+C to cancel')}\n\n`);
    },
    start() {
      if (!tty) return;
      shown = true;
      timer = setInterval(() => output.write(`\r\x1b[2K${style('90', ['·', '··', '···'][ticks++ % 3] + ' Working')}`), 120);
    },
    stop() { clearInterval(timer); if (shown) output.write('\r\x1b[2K'); shown = false; },
    text(value) { this.stop(); output.write(clean(value)); },
    line(value) { this.stop(); output.write(`${clean(value)}\n`); },
    summary(ms, usage) {
      if (tty) output.write(`\n${style('90', `  ${(ms / 1000).toFixed(1)}s${usage ? ` · ${usage.total_tokens ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0))} tokens` : ''}`)}\n\n`);
      else output.write('\n');
    },
  };
}
// Some open models return inline reasoning tags split across arbitrary chunks.
export function answerRenderer(write) {
  let buffer = '', thinking = false;
  const flush = final => {
    for (;;) {
      const tag = thinking ? '</think>' : '<think>';
      const index = buffer.indexOf(tag);
      if (index >= 0) { if (!thinking) write(buffer.slice(0, index)); buffer = buffer.slice(index + tag.length); thinking = !thinking; continue; }
      let keep = 0;
      if (!final) for (let i = 1; i < tag.length; i++) if (buffer.endsWith(tag.slice(0, i))) keep = i;
      const text = buffer.slice(0, buffer.length - keep);
      if (!thinking && text) write(text);
      buffer = keep ? buffer.slice(-keep) : '';
      return;
    }
  };
  return { push(text) { buffer += text; flush(false); }, end() { flush(true); } };
}
