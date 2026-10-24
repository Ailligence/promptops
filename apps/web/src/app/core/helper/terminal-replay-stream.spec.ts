import { liveTextAfterSnapshot, TerminalReplayStream } from './terminal-replay-stream';

describe('liveTextAfterSnapshot', () => {
  it('drops a message the snapshot already holds', () => {
    expect(liveTextAfterSnapshot('old', 100, 100)).toBeNull();
    expect(liveTextAfterSnapshot('older', 40, 100)).toBeNull();
  });

  it('keeps a multibyte message whole instead of cutting it by bytes', () => {
    // 'é😀中' is 9 bytes but 4 UTF-16 units: the old byte-delta slice cut it.
    const text = 'é😀中';
    expect(liveTextAfterSnapshot(text, 109, 100)).toBe(text);
  });
});

describe('TerminalReplayStream', () => {
  it('joins a character split between the snapshot and the next chunk', () => {
    const emoji = new TextEncoder().encode('😀');
    const stream = new TerminalReplayStream();
    const head = stream.snapshot({ data: '', bytes: emoji.subarray(0, 2), endOffset: 2 });
    const tail = stream.output({ data: '', bytes: emoji.subarray(2), endOffset: 4 });
    expect(head + tail).toBe('😀');
  });

  it('skips the bytes of a straddling chunk already in the snapshot', () => {
    const enc = new TextEncoder();
    const stream = new TerminalReplayStream();
    expect(stream.snapshot({ data: '', bytes: enc.encode('ab'), endOffset: 2 })).toBe('ab');
    expect(stream.output({ data: '', bytes: enc.encode('bc'), endOffset: 3 })).toBe('c');
    expect(stream.output({ data: '', bytes: enc.encode('c'), endOffset: 3 })).toBe('');
  });
});
