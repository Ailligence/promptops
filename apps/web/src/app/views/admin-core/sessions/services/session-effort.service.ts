import { Injectable, signal } from '@angular/core';
import { parseTerminalEffort, switchTerminalEffort } from './terminal-effort';

@Injectable({ providedIn: 'root' })
export class SessionEffortService {
  readonly pending = signal<Record<string, string>>({});
  readonly confirmed = signal<Record<string, { provider: string; effort: string }>>({});
  private readers = new Map<string, { provider: string; text: string; submitted: boolean; resolve: (effort: string) => void; reject: (error: Error) => void }>();
  private tails = new Map<string, string>();

  noteTerminalOutput(sessionId: string, chunk: string): void {
    const reader = this.readers.get(sessionId);
    if (!reader) {
      // Keep the badge in sync with commands entered directly in the terminal.
      const text = (this.tails.get(sessionId) ?? '') + chunk;
      this.tails.set(sessionId, text.slice(-256));
      if (!/effort|reasoning/i.test(text)) return;
      for (const provider of ['claude-code-cli', 'codex']) {
        const effort = parseTerminalEffort(text, provider);
        if (!effort) continue;
        this.confirmed.update(map => ({ ...map, [sessionId]: { provider, effort } }));
        this.tails.delete(sessionId);
        break;
      }
      return;
    }
    if (!reader.submitted) return;
    reader.text = (reader.text + chunk).slice(-16384);
    const effort = parseTerminalEffort(reader.text, reader.provider);
    if (!effort) return;
    this.confirmed.update(map => ({ ...map, [sessionId]: { provider: reader.provider, effort } }));
    reader.resolve(effort);
  }

  async apply(sessionId: string, provider: string, effort: string, write: (data: string) => Promise<void>): Promise<void> {
    if (this.pending()[sessionId]) return;
    this.pending.update(map => ({ ...map, [sessionId]: effort }));
    const pause = () => new Promise<void>(resolve => setTimeout(resolve, 180));
    try {
      await switchTerminalEffort(provider, effort, async input => {
        if (input.startsWith('\x1b')) {
          await write(input);
          await pause();
          input = '/status';
        }
        // Subscribe before writing: a fast PTY can answer before IPC resolves.
        return new Promise<string>((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error, result?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            this.readers.delete(sessionId);
            if (error) reject(error); else resolve(result!);
          };
          const timer = setTimeout(() => finish(new Error('Effort confirmation timed out')), 8000);
          const reader = {
            provider, text: '', submitted: false,
            // Claude can repaint an older confirmation before rendering the
            // command's result. Wait for the requested value in that case.
            resolve: (value: string) => {
              if (provider !== 'claude-code-cli' || value === effort) finish(undefined, value);
            },
            reject: (error: Error) => finish(error),
          };
          this.readers.set(sessionId, reader);
          void (async () => {
            // Codex distinguishes typed slash commands from paste bursts.
            // A pause only before Enter does not prevent the command itself
            // from being classified as pasted text.
            const parts = provider === 'codex' ? [...input] : [input];
            for (const part of parts) {
              if (settled) return;
              await write(part);
              await pause();
            }
            if (settled) return;
            // Typing can redraw an earlier status. It must never complete the
            // exchange and skip Enter, leaving /status in the composer.
            reader.text = '';
            reader.submitted = true;
            await write('\r');
          })().catch(error => finish(error));
        });
      });
    } finally {
      this.pending.update(map => { const next = { ...map }; delete next[sessionId]; return next; });
    }
  }

  forget(sessionId: string): void {
    this.readers.get(sessionId)?.reject(new Error('Terminal closed'));
    this.tails.delete(sessionId);
    this.confirmed.update(map => { const next = { ...map }; delete next[sessionId]; return next; });
  }
}
