import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
const START = '\x1b[200~', END = '\x1b[201~';
// Readline submits on literal newlines. Keep pasted newlines as Unicode line
// separators until Enter, then restore them when returning the complete prompt.
export function pasteNormalizer(write) {
  let buffer = '', pasted = '', inside = false;
  return {
    push(text) {
      buffer += text;
      for (;;) {
        const marker = inside ? END : START;
        const at = buffer.indexOf(marker);
        if (at >= 0) {
          if (inside) { pasted += buffer.slice(0, at); if (pasted.length > 1024 * 1024) throw new Error('Paste exceeds 1 MiB.'); write(pasted.replace(/\r\n?|\n/g, '\u2028')); pasted = ''; }
          else write(buffer.slice(0, at));
          buffer = buffer.slice(at + marker.length); inside = !inside; continue;
        }
        let keep = 0;
        for (let i = 1; i < marker.length; i++) if (buffer.endsWith(marker.slice(0, i))) keep = i;
        const part = buffer.slice(0, buffer.length - keep);
        if (inside) pasted += part; else if (part) write(part);
        buffer = keep ? buffer.slice(-keep) : '';
        if (pasted.length > 1024 * 1024) throw new Error('Paste exceeds 1 MiB.');
        return;
      }
    },
    end() { if (!inside && buffer) write(buffer); buffer = ''; pasted = ''; },
  };
}
export function terminalInput(source) {
  const decoder = new StringDecoder('utf8');
  let normalizer;
  const stream = new Transform({
    transform(chunk, _encoding, done) { try { normalizer.push(decoder.write(chunk)); done(); } catch (error) { done(error); } },
    flush(done) { normalizer.push(decoder.end()); normalizer.end(); done(); },
  });
  normalizer = pasteNormalizer(text => stream.push(text));
  stream.isTTY = source.isTTY;
  stream.setRawMode = raw => source.setRawMode?.(raw);
  source.pipe(stream);
  return stream;
}
