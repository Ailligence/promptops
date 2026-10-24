import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';

/** Terminal performance toggles, resolved from the user's UI preferences. */
export interface TerminalPerfPrefs {
  /** WebGL GPU renderer (vs the slower DOM renderer). */
  gpu: boolean;
  /** File/URL link detection on output (regex per chunk). */
  links: boolean;
  /** Blinking cursor (continuous repaint). */
  cursorBlink: boolean;
}

/**
 * Read the terminal performance toggles published by UiPreferencesService on
 * `window.__PO_UI_PREFS__`. Every flag defaults to ON (`true`) when unset, so a
 * missing/older preferences object keeps the full-featured behavior.
 */
export function readTerminalPerfPrefs(): TerminalPerfPrefs {
  const p = (window as any).__PO_UI_PREFS__ ?? {};
  return {
    gpu: p.terminal_gpu_acceleration !== false,
    links: p.terminal_link_detection !== false,
    cursorBlink: p.terminal_cursor_blink !== false,
  };
}

/**
 * Attach the WebGL renderer to an xterm instance.
 *
 * The default DOM renderer repaints per-keystroke and lags visibly on Windows
 * (no fast compositing as on macOS), so typing into a busy terminal stutters
 * and feels like keystrokes are being dropped. WebGL offloads the grid to the
 * GPU and removes that bottleneck.
 *
 * Must be called AFTER `xterm.open()` — the addon needs a live DOM element to
 * acquire a WebGL context. On context loss or init failure we dispose and let
 * xterm silently fall back to its built-in DOM renderer, so a missing/blocked
 * WebGL context never breaks the terminal.
 */
export function attachWebglRenderer(xterm: Terminal): void {
  webglTerminals.add(xterm);
  try {
    xterm.loadAddon({ activate() { /* noop */ }, dispose() { webglTerminals.delete(xterm); } });
  } catch { /* terminal already disposed */ }
  tryAttachWebgl(xterm, 3);
}

/** Live terminals with a WebGL renderer (for the coordinated atlas clear). */
const webglTerminals = new Set<Terminal>();

/**
 * Regenerates the WebGL glyph atlas SAFELY.
 *
 * The WebGL addon shares the same TextureAtlas across all terminals with the
 * same config (CharAtlasCache). `xterm.clearTextureAtlas()` on ONE terminal
 * empties the atlas for all of them, but only that terminal rebuilds its model: the
 * others keep stale glyph coordinates and show random characters until
 * the cells change (scroll) — the glitch of idle panes when the grid changes.
 * Here the atlas is emptied once and the model of EVERY WebGL terminal is invalidated in the
 * same tick (subsequent clears find the atlas empty and don't touch it).
 */
export function clearTextureAtlasShared(xterm: Terminal): void {
  const targets = webglTerminals.has(xterm) ? webglTerminals : new Set([xterm]);
  for (const t of Array.from(targets)) {
    try { t.clearTextureAtlas(); } catch { webglTerminals.delete(t); }
  }
}

/**
 * Switch xterm's cell-width tables from Unicode 6 (its default) to Unicode 11.
 * Under v6, emoji and many wide glyphs measure 1 cell instead of 2, so TUI
 * frames that use them (spinners, status icons) draw misaligned borders and
 * overlapping glyphs. Safe to call before or after `open()`.
 */
export function attachUnicode11(xterm: Terminal): void {
  try {
    xterm.loadAddon(new Unicode11Addon());
    xterm.unicode.activeVersion = '11';
  } catch {
    /* addon unavailable — keep xterm's built-in width tables */
  }
}

/**
 * WKWebView (Tauri/macOS) drops WebGL contexts far more readily than Chromium
 * — e.g. when many terminal canvases coexist across session switches. A lost
 * context used to silently demote the terminal to the DOM renderer mid-session
 * (visible repaint glitches). Instead, dispose the dead addon and re-attach a
 * fresh one after a short delay, up to `retriesLeft` times per loss chain.
 */
function tryAttachWebgl(xterm: Terminal, retriesLeft: number): void {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      try { webgl.dispose(); } catch { /* already gone */ }
      if (retriesLeft > 0) {
        setTimeout(() => tryAttachWebgl(xterm, retriesLeft - 1), 250);
      }
    });
    // Shared atlas: new pages / merges / removed pages change the
    // texture indices of glyphs already in use in the OTHER terminals, which however don't
    // redraw until their content changes (idle pane = random glyphs
    // until scroll, e.g. right after an agent spawns).
    webgl.onAddTextureAtlasCanvas(() => scheduleRepaintAllWebgl());
    webgl.onRemoveTextureAtlasCanvas(() => scheduleRepaintAllWebgl());
    xterm.loadAddon(webgl);
  } catch {
    /* WebGL unavailable or terminal disposed — xterm keeps its DOM renderer */
  }
}

let repaintAllRaf: number | null = null;
/** Full redraw (one frame, coalesced) of all live WebGL terminals. */
function scheduleRepaintAllWebgl(): void {
  if (repaintAllRaf !== null) return;
  repaintAllRaf = requestAnimationFrame(() => {
    repaintAllRaf = null;
    for (const t of Array.from(webglTerminals)) {
      try { t.refresh(0, t.rows - 1); } catch { webglTerminals.delete(t); }
    }
  });
}
