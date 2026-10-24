import { inject, Injectable, signal } from '@angular/core';
import { DataBackend } from '@core/data/data-backend';
import { MenuShortcutInterface } from '@core/interfaces/menu-shortcut.interface';

@Injectable({ providedIn: 'root' })
export class QuickAccessService {
  shortcuts = signal<MenuShortcutInterface[]>([]);
  loading = signal<boolean>(false);

  private data = inject(DataBackend);

  private readonly sessionStorageKey = 'promptops_session_shortcuts';

  async loadShortcuts(): Promise<void> {
    this.loading.set(true);
    try {
      const stored = await this.data.call<MenuShortcutInterface[]>('shortcuts.list');
      const promptShortcuts: MenuShortcutInterface[] = (stored ?? []).map(
        (s: MenuShortcutInterface) => ({ ...s, type: 'prompt' as const })
      );
      const sessionShortcuts = this.loadSessionShortcuts();
      this.shortcuts.set([...promptShortcuts, ...sessionShortcuts]);
    } catch (error) {
    } finally {
      this.loading.set(false);
    }
  }

  private loadSessionShortcuts(): MenuShortcutInterface[] {
    try {
      const raw = localStorage.getItem(this.sessionStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private saveSessionShortcuts(items: MenuShortcutInterface[]): void {
    localStorage.setItem(this.sessionStorageKey, JSON.stringify(items));
  }

  async addShortcut(
    promptId: number,
    label: string,
    icon: string = 'ti-bolt'
  ): Promise<MenuShortcutInterface | null> {
    try {
      const shortcut = await this.data.call<MenuShortcutInterface>('shortcuts.create', { prompt_id: promptId, label, icon });
      this.shortcuts.update((current) => [...current, shortcut]);
      return shortcut;
    } catch (error) {
      return null;
    }
  }

  async updateShortcut(
    id: number,
    data: { label?: string; icon?: string }
  ): Promise<void> {
    try {
      await this.data.call('shortcuts.update', { ...data, id });
      this.shortcuts.update((current) =>
        current.map((s) => (s.id === id ? { ...s, ...data } : s))
      );
    } catch (error) {
    }
  }

  async removeShortcut(id: number): Promise<void> {
    try {
      await this.data.call('shortcuts.delete', { id });
      this.shortcuts.update((current) => current.filter((s) => s.id !== id));
    } catch (error) {
    }
  }

  addSessionShortcut(sessionId: string, label: string, type: 'session' | 'workspace' = 'session'): void {
    const existing = this.loadSessionShortcuts();
    if (existing.some((s) => s.target_id === sessionId && s.type === type)) return;

    const newShortcut: MenuShortcutInterface = {
      id: -Date.now(),
      user_id: 0,
      prompt_id: 0,
      label,
      icon: type === 'workspace' ? 'ti-folder-code' : 'ti-terminal-2',
      sort_order: this.shortcuts().length,
      type,
      target_id: sessionId,
    };

    const updated = [...existing, newShortcut];
    this.saveSessionShortcuts(updated);
    this.shortcuts.update((current) => [...current, newShortcut]);
  }

  removeSessionShortcut(id: number): void {
    const updated = this.loadSessionShortcuts().filter((s) => s.id !== id);
    this.saveSessionShortcuts(updated);
    this.shortcuts.update((current) => current.filter((s) => s.id !== id));
  }

  async reorder(orderedIds: number[]): Promise<void> {
    // Optimistic update first
    this.shortcuts.update((current) => {
      const map = new Map(current.map((s) => [s.id, s]));
      return orderedIds
        .map((id, index) => {
          const item = map.get(id);
          return item ? { ...item, sort_order: index } : null;
        })
        .filter((s): s is MenuShortcutInterface => s !== null);
    });

    try {
      await this.data.call('shortcuts.reorder', { order: orderedIds });
    } catch (error) {
      // Reload on failure to restore the stored order
      await this.loadShortcuts();
    }
  }
}
