/**
 * Detached Tauri windows (Floor plan): the same web app in a window of its own, to drag to another
 * screen. Rust opens only the sections it knows (detached_window.rs); this file only bridges.
 */
export type DetachedKind = 'floor-plan';

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: {
    emit(event: string, payload?: unknown): Promise<void>;
    listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void>;
  };
  window?: { getCurrentWindow(): { close(): Promise<void> } };
}

export function tauri(): TauriGlobal | null {
  const t = (window as any).__TAURI__;
  return t?.core?.invoke && t?.event?.emit ? (t as TauriGlobal) : null;
}

/** Label of the current Tauri window: `main`, `detached-teams`, … (null outside Tauri). */
export function windowLabel(): string | null {
  return (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null;
}

export function isDetachedWindow(): boolean {
  return (windowLabel() ?? '').startsWith('detached-');
}

/** Detached windows can be opened: Tauri desktop, from the main window. */
export function canDetach(): boolean {
  return tauri() !== null && !isDetachedWindow();
}

export function openDetached(kind: DetachedKind): Promise<void> {
  const t = tauri();
  return t ? t.core.invoke('open_detached_window', { kind }) : Promise.resolve();
}

export function focusMainWindow(): Promise<void> {
  const t = tauri();
  return t ? t.core.invoke('focus_main_window') : Promise.resolve();
}

/** A session in its own child window of the main window (from the main window only). */
export function openSessionWindow(sessionId: string, name: string): Promise<void> {
  const t = tauri();
  return t ? t.core.invoke('open_session_window', { sessionId, name }) : Promise.resolve();
}

/** Closes a session's child window: the terminals go back to the main window. */
export function closeSessionWindow(sessionId: string): Promise<void> {
  const t = tauri();
  return t ? t.core.invoke('close_session_window', { sessionId }) : Promise.resolve();
}

/** Session id if this is its child window (`detached-session-<id>`). */
export function sessionWindowId(): string | null {
  const label = windowLabel() ?? '';
  return label.startsWith('detached-session-') ? label.slice('detached-session-'.length) : null;
}
