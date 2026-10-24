export interface TerminalReplayChunk {
  data: string;
  bytes?: Uint8Array;
  endOffset?: number;
}

/** One decoder/cursor per renderer, shared by snapshot and subsequent output. */
export class TerminalReplayStream {
  private readonly decoder = new TextDecoder();
  private offset = 0;

  snapshot(chunk: TerminalReplayChunk): string {
    if (!chunk.bytes || chunk.endOffset === undefined) return chunk.data;
    this.offset = chunk.endOffset;
    // Keep an incomplete UTF-8 character at the snapshot boundary for live output.
    return this.decoder.decode(chunk.bytes, { stream: true });
  }

  output(chunk: TerminalReplayChunk): string {
    if (!chunk.bytes || chunk.endOffset === undefined) return chunk.data;
    if (chunk.endOffset <= this.offset) return '';
    const start = chunk.endOffset - chunk.bytes.length;
    const bytes = chunk.bytes.subarray(Math.max(0, this.offset - start));
    this.offset = chunk.endOffset;
    return this.decoder.decode(bytes, { stream: true });
  }
}

/**
 * Live text of a standalone terminal (terminal_open) once its replay snapshot is
 * on screen: null when the snapshot already holds it.
 *
 * Offsets count bytes, while `data` is decoded text (UTF-16), so the text must
 * never be cut by a byte delta: that split characters and duplicated or dropped
 * output around emoji and box drawing. It does not need to be cut: the native
 * side feeds the replay one channel message at a time, so the snapshot cursor
 * always falls between two messages and a message is either entirely in the
 * snapshot or entirely after it.
 */
export function liveTextAfterSnapshot(data: string, endOffset: number, cursor: number): string | null {
  return endOffset <= cursor ? null : data;
}
