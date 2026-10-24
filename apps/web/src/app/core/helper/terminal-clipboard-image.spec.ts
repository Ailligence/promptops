import { readClipboardImageAsFile } from './terminal-clipboard-image';

/**
 * Reading an image from the clipboard under Tauri.
 *
 * Pure function over the bridge, no TestBed: `window.promptops` and
 * `fetch` are stubbed. The case that matters is the `null` return in every "there is no
 * image" branch: it is what lets the paste continue on the text branch instead
 * of swallowing it — the regression that had made Cmd+V silent in desktop terminals.
 */
describe('readClipboardImageAsFile', () => {
  const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
  let originalPromptops: unknown;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalPromptops = (window as any).promptops;
    originalFetch = window.fetch;
  });

  afterEach(() => {
    (window as any).promptops = originalPromptops;
    window.fetch = originalFetch;
  });

  function stubBridge(impl: (() => Promise<string | null>) | undefined): void {
    (window as any).promptops = impl ? { clipboardReadImage: impl } : {};
  }

  function stubFetch(): void {
    window.fetch = (() =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob([1, 2, 3] as any)) })) as any;
  }

  it('returns a PNG File when the clipboard contains an image', async () => {
    stubBridge(() => Promise.resolve(PNG_DATA_URL));
    stubFetch();

    const file = await readClipboardImageAsFile();

    expect(file).not.toBeNull();
    expect(file!.type).toBe('image/png');
    expect(file!.name.endsWith('.png')).toBe(true);
  });

  it('returns null when the clipboard has no images', async () => {
    stubBridge(() => Promise.resolve(null));
    expect(await readClipboardImageAsFile()).toBeNull();
  });

  it('returns null when the bridge does not expose the command (older build/browser)', async () => {
    stubBridge(undefined);
    expect(await readClipboardImageAsFile()).toBeNull();
  });

  it('returns null instead of propagating a bridge error', async () => {
    stubBridge(() => Promise.reject(new Error('clipboard unavailable')));
    expect(await readClipboardImageAsFile()).toBeNull();
  });
});
