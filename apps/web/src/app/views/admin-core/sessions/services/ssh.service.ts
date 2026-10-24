import { Injectable, signal } from '@angular/core';

export interface SshConnectionPublic {
  id: string;
  sessionId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  hasPassphrase: boolean;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SshConnectionInput {
  id?: string;
  sessionId: string | null;
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: 'password' | 'key';
  secret: string;
  passphrase?: string;
  cwd?: string;
}

export type SshTarget =
  | { kind: 'agent'; agentId: string }
  | { kind: 'terminal'; terminalId: string };

export interface SshOutputEvent {
  sessionId: string;
  target: SshTarget;
  data: string;
}

export interface SshCloseEvent {
  sessionId: string;
  target: SshTarget;
}

export interface SshErrorEvent {
  sessionId: string;
  target: SshTarget;
  error: string;
}

/** Message of a rejected IPC call (Tauri rejects with the error string). */
function errorText(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e) return e;
  const msg = (e as { message?: unknown } | null)?.message;
  return typeof msg === 'string' && msg ? msg : fallback;
}

/**
 * Renderer-side facade over `window.promptops` SSH IPC.
 * All secrets (password, private key, passphrase) are passed OUT only — never
 * returned back to renderer by SSH_LIST/SSH_SAVE.
 *
 * The desktop commands answer with plain values (`ssh_list` → array,
 * `ssh_save` → the saved connection, `ssh_test` → true, `ssh_spawn` → the
 * session id) and reject with an error string. This facade turns both into
 * the `{ ok, … }` results the panel works with; `{ ok, … }` envelopes are
 * accepted too.
 */
@Injectable({ providedIn: 'root' })
export class SshService {
  readonly connections = signal<SshConnectionPublic[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private get api(): any {
    const a = (window as any).promptops;
    if (!a) throw new Error('SSH requires the desktop app');
    return a;
  }

  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  async refresh(sessionId: string | null): Promise<void> {
    if (!this.isDesktop) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.sshList(sessionId);
      if (Array.isArray(res)) this.connections.set(res);
      else if (res?.ok) this.connections.set(res.connections ?? []);
      else this.error.set(res?.error ?? 'Failed to load');
    } catch (e) {
      this.error.set(errorText(e, 'Failed to load'));
    } finally {
      this.loading.set(false);
    }
  }

  async save(input: SshConnectionInput): Promise<SshConnectionPublic | null> {
    let saved: SshConnectionPublic | null;
    try {
      const res = await this.api.sshSave(input);
      saved = res && typeof res === 'object' && 'ok' in res
        ? (res.ok ? res.connection : null)
        : res;
      if (!saved) {
        this.error.set(res?.error ?? 'Save failed');
        return null;
      }
    } catch (e) {
      this.error.set(errorText(e, 'Save failed'));
      return null;
    }
    await this.refresh(input.sessionId);
    return saved;
  }

  async delete(id: string, sessionId: string | null): Promise<boolean> {
    try {
      const res = await this.api.sshDelete(id);
      const ok = res === true || !!res?.ok;
      if (ok) await this.refresh(sessionId);
      return ok;
    } catch (e) {
      this.error.set(errorText(e, 'Delete failed'));
      return false;
    }
  }

  async test(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.api.sshTest(id);
      if (res === true) return { ok: true };
      if (res && typeof res === 'object') return { ok: !!res.ok, error: res.error };
      return { ok: false, error: 'Connection test failed' };
    } catch (e) {
      return { ok: false, error: errorText(e, 'Connection test failed') };
    }
  }

  async spawn(args: {
    connId: string;
    target: SshTarget;
    cols?: number;
    rows?: number;
  }): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
    try {
      const res = await this.api.sshSpawn(args);
      if (typeof res === 'string' && res) return { ok: true, sessionId: res };
      if (res && typeof res === 'object') return res;
      return { ok: false, error: 'Connection failed' };
    } catch (e) {
      return { ok: false, error: errorText(e, 'Connection failed') };
    }
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.api.sshWrite(sessionId, data);
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.api.sshResize(sessionId, cols, rows);
  }

  async close(sessionId: string): Promise<void> {
    await this.api.sshClose(sessionId);
  }

  onOutput(cb: (e: SshOutputEvent) => void): () => void {
    return this.api.onSshOutput((_ev: unknown, data: SshOutputEvent) => cb(data));
  }

  onClosed(cb: (e: SshCloseEvent) => void): () => void {
    return this.api.onSshClosed((_ev: unknown, data: SshCloseEvent) => cb(data));
  }

  onError(cb: (e: SshErrorEvent) => void): () => void {
    return this.api.onSshError((_ev: unknown, data: SshErrorEvent) => cb(data));
  }
}
