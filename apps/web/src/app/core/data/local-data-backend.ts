import { Injectable } from '@angular/core';
import { DataBackend, DataError, DataParams, isDataError } from './data-backend';
import type { DataMethod } from './data-methods';

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;

/**
 * {@link DataBackend} that keeps the data on this device: every call goes to
 * the desktop shell (`local_call`, see apps/desktop/src-tauri/src/local_data.rs),
 * which stores the records encrypted on disk. Nothing here uses the network.
 */
@Injectable()
export class LocalDataBackend extends DataBackend {
  async call<T>(method: DataMethod, params?: DataParams): Promise<T> {
    const invoke = this.invoke();
    if (!invoke) {
      throw { code: 'unavailable', message: 'Local data is only available in the desktop app.' } satisfies DataError;
    }
    try {
      return (await invoke('local_call', { method, params: params ?? null })) as T;
    } catch (err) {
      if (isDataError(err)) throw err;
      throw { code: 'internal', message: typeof err === 'string' ? err : String((err as Error)?.message ?? err) } satisfies DataError;
    }
  }

  private invoke(): Invoke | null {
    const w = window as unknown as {
      promptops?: { localCall?: (method: string, params: unknown) => Promise<unknown> };
      __TAURI__?: { core?: { invoke?: Invoke } };
    };
    const bridge = w.promptops?.localCall;
    if (bridge) return (_cmd, args) => bridge((args as { method: string }).method, (args as { params: unknown }).params);
    return w.__TAURI__?.core?.invoke ?? null;
  }
}
