/**
 * Reading an image from the clipboard under Tauri v2.
 *
 * WKWebView exposes native images neither in `clipboardData` on paste nor to
 * `navigator.clipboard.read()` (which on top of that would show the system
 * "Allow paste" prompt): the only source is the Rust command
 * `clipboard_read_image`, exposed by the bridge as `clipboardReadImage`.
 *
 * Moreover, in terminals Cmd+V is canceled with preventDefault() so that
 * WKWebView does not paste the DOM selection line by line: without this helper
 * pasting a screenshot has no path at all.
 */
export async function readClipboardImageAsFile(): Promise<File | null> {
  const bridge = (window as { promptops?: { clipboardReadImage?: () => Promise<string | null> } })
    .promptops;
  if (!bridge?.clipboardReadImage) return null;
  try {
    const dataUrl = await bridge.clipboardReadImage();
    if (!dataUrl) return null;
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], `pasted-${Date.now()}.png`, { type: 'image/png' });
  } catch {
    // Clipboard without an image or bridge not available.
    return null;
  }
}
