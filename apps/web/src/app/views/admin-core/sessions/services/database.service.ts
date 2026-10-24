import { Injectable, signal, computed } from '@angular/core';

export interface DbConnectionInfo {
  type: string;
  host?: string;
  port?: number;
  database?: string;
}

export interface SavedDbConnection {
  id: string;
  name: string;
  type: string;
  host?: string;
  port?: number;
  database?: string;
}

export interface DbFilter {
  column: string;
  operator: '=' | 'like' | '>' | '<' | '>=' | '<=';
  value: string;
}

export interface DbQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
}

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private get api(): any {
    return (window as any).promptops;
  }

  get isDesktop(): boolean {
    return !!(window as any).promptops;
  }

  // State signals
  status = signal<'idle' | 'detecting' | 'connecting' | 'connected' | 'error'>('idle');
  dbType = signal<string>('');
  dbName = signal<string>('');
  error = signal<string | null>(null);
  tables = signal<string[]>([]);
  selectedTable = signal<string | null>(null);
  loading = signal(false);
  queryLoading = signal(false);
  fromStorage = signal(false);

  // Multi-connection state
  savedConnections = signal<SavedDbConnection[]>([]);
  activeId = signal<string | null>(null);

  // Natural-language query state
  nlQuestion = signal<string>('');
  nlLoading = signal(false);
  nlError = signal<string | null>(null);
  nlGeneratedQuery = signal<string | null>(null);
  nlColumns = signal<string[]>([]);
  nlRows = signal<Record<string, unknown>[]>([]);
  nlHasResult = signal(false);

  // Query result state
  columns = signal<string[]>([]);
  rows = signal<Record<string, unknown>[]>([]);
  total = signal(0);
  currentOffset = signal(0);
  pageSize = signal(50);
  filters = signal<DbFilter[]>([]);
  orderBy = signal<string | null>(null);
  orderDir = signal<'ASC' | 'DESC'>('ASC');

  // Computed
  hasNextPage = computed(() => this.currentOffset() + this.pageSize() < this.total());
  hasPrevPage = computed(() => this.currentOffset() > 0);
  currentPage = computed(() => Math.floor(this.currentOffset() / this.pageSize()) + 1);
  totalPages = computed(() => Math.ceil(this.total() / this.pageSize()) || 1);

  /**
   * Detect and connect to the database.
   * 1. Checks stored config (from previous success)
   * 2. If none, scans .env files
   * 3. If still none, uses AI provider to find DB config in the project
   *
   * @param forceRefresh - skip stored config and re-scan with AI
   */
  async detectAndConnect(cwd: string, provider: string, forceRefresh = false, sessionKey?: string): Promise<void> {
    if (!this.isDesktop || !cwd) return;

    this.status.set('detecting');
    this.error.set(null);
    this.tables.set([]);
    this.selectedTable.set(null);
    this.columns.set([]);
    this.rows.set([]);
    this.fromStorage.set(false);

    try {
      // Saved connections first, whatever happens next: on a failed auto-connect
      // the user must still see (and be able to re-attach) what they saved.
      await this.refreshConnections(cwd, sessionKey);

      // Detect (uses stored config, .env fast-path, or AI fallback)
      const detectResult = await this.api.dbDetect(cwd, provider, forceRefresh, sessionKey);
      if (!detectResult.ok) {
        this.status.set('error');
        this.error.set(detectResult.error);
        return;
      }

      this.dbType.set(detectResult.config.type);
      this.dbName.set(detectResult.config.database || 'unknown');
      this.fromStorage.set(!!detectResult.fromStorage);

      // Connect
      this.status.set('connecting');
      const connectResult = await this.api.dbConnect(cwd, sessionKey);
      if (!connectResult.ok) {
        this.status.set('error');
        this.error.set(connectResult.error);
        return;
      }

      this.status.set('connected');
      this.dbType.set(connectResult.type);
      this.dbName.set(connectResult.database);
      if (connectResult.id) this.activeId.set(connectResult.id);

      // Refresh saved connections + load tables
      await this.refreshConnections(cwd, sessionKey);
      await this.loadTables(cwd, sessionKey);
    } catch (err) {
      this.status.set('error');
      this.error.set((err as Error).message);
    }
  }

  /** Load the saved-connections catalog (global) with this caller's active id. */
  async refreshConnections(cwd: string, sessionKey?: string): Promise<void> {
    if (!this.isDesktop || !cwd) return;
    try {
      const result = await this.api.dbListConfigs(cwd, sessionKey);
      if (result.ok) {
        this.savedConnections.set(result.connections || []);
        this.activeId.set(result.activeId ?? null);
      }
    } catch { /* ignore */ }
  }

  /** Switch to another saved connection and reload its tables. */
  async switchConnection(cwd: string, id: string, sessionKey?: string): Promise<void> {
    // Re-attaching the (failed) active connection from the error state is
    // legitimate — only skip the no-op switch while already connected.
    if (!this.isDesktop || !cwd || (id === this.activeId() && this.status() === 'connected')) return;

    this.status.set('connecting');
    this.error.set(null);
    this.tables.set([]);
    this.selectedTable.set(null);
    this.columns.set([]);
    this.rows.set([]);
    this.total.set(0);
    this.currentOffset.set(0);
    this.filters.set([]);

    try {
      const result = await this.api.dbSwitchConfig(cwd, id, sessionKey);
      if (!result.ok) {
        this.status.set('error');
        this.error.set(result.error);
        return;
      }
      this.status.set('connected');
      this.dbType.set(result.type);
      this.dbName.set(result.database);
      this.activeId.set(result.id);
      this.fromStorage.set(true);
      await this.loadTables(cwd, sessionKey);
    } catch (err) {
      this.status.set('error');
      this.error.set((err as Error).message);
    }
  }

  /** Delete a saved connection. */
  async deleteConnection(cwd: string, id: string, sessionKey?: string): Promise<void> {
    if (!this.isDesktop || !cwd) return;
    const wasActive = id === this.activeId();
    try {
      const result = await this.api.dbDeleteConfig(cwd, id, sessionKey);
      if (result.ok) {
        this.savedConnections.set(result.connections || []);
        // If we deleted the active connection, fall back to another or go idle
        if (wasActive) {
          if (result.activeId) {
            this.activeId.set(null); // force switchConnection to run
            await this.switchConnection(cwd, result.activeId, sessionKey);
          } else {
            this.reset();
          }
        } else {
          this.activeId.set(result.activeId ?? null);
        }
      }
    } catch { /* ignore */ }
  }

  async loadTables(cwd: string, sessionKey?: string): Promise<void> {
    this.loading.set(true);
    try {
      const result = await this.api.dbTables(cwd, sessionKey);
      if (result.ok) {
        this.tables.set(result.tables);
      } else {
        this.error.set(result.error);
      }
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  async selectTable(cwd: string, table: string, sessionKey?: string): Promise<void> {
    this.selectedTable.set(table);
    this.currentOffset.set(0);
    this.filters.set([]);
    this.orderBy.set(null);
    this.orderDir.set('ASC');
    await this.fetchRows(cwd, sessionKey);
  }

  async fetchRows(cwd: string, sessionKey?: string): Promise<void> {
    const table = this.selectedTable();
    if (!table) return;

    this.queryLoading.set(true);
    this.error.set(null);
    try {
      const activeFilters = this.filters().filter(f => f.value.trim() !== '');
      const result = await this.api.dbQuery(cwd, table, {
        limit: this.pageSize(),
        offset: this.currentOffset(),
        filters: activeFilters.length > 0 ? activeFilters : undefined,
        orderBy: this.orderBy() || undefined,
        orderDir: this.orderDir(),
      }, sessionKey);

      if (result.ok) {
        this.columns.set(result.columns);
        this.rows.set(result.rows);
        this.total.set(result.total);
      } else {
        this.error.set(result.error);
      }
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.queryLoading.set(false);
    }
  }

  async nextPage(cwd: string, sessionKey?: string): Promise<void> {
    if (!this.hasNextPage()) return;
    this.currentOffset.update(v => v + this.pageSize());
    await this.fetchRows(cwd, sessionKey);
  }

  async prevPage(cwd: string, sessionKey?: string): Promise<void> {
    if (!this.hasPrevPage()) return;
    this.currentOffset.update(v => Math.max(0, v - this.pageSize()));
    await this.fetchRows(cwd, sessionKey);
  }

  toggleSort(cwd: string, column: string, sessionKey?: string): void {
    if (this.orderBy() === column) {
      this.orderDir.update(d => d === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.orderBy.set(column);
      this.orderDir.set('ASC');
    }
    this.currentOffset.set(0);
    this.fetchRows(cwd, sessionKey);
  }

  addFilter(): void {
    if (this.columns().length === 0) return;
    this.filters.update(f => [...f, { column: this.columns()[0], operator: '=', value: '' }]);
  }

  updateFilter(index: number, updates: Partial<DbFilter>): void {
    this.filters.update(f => {
      const next = [...f];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }

  removeFilter(index: number): void {
    this.filters.update(f => f.filter((_, i) => i !== index));
  }

  async applyFilters(cwd: string, sessionKey?: string): Promise<void> {
    this.currentOffset.set(0);
    await this.fetchRows(cwd, sessionKey);
  }

  /**
   * Connect using user-provided config (manual entry).
   */
  async manualConnect(cwd: string, config: {
    type: string; host?: string; port?: number; database?: string;
    username?: string; password?: string; uri?: string; path?: string;
  }, name?: string, id?: string, sessionKey?: string): Promise<void> {
    if (!this.isDesktop || !cwd) return;

    this.status.set('connecting');
    this.error.set(null);
    this.tables.set([]);
    this.selectedTable.set(null);
    this.columns.set([]);
    this.rows.set([]);
    this.fromStorage.set(false);

    try {
      const result = await this.api.dbManualConnect(cwd, config, name, id, sessionKey);
      if (!result.ok) {
        this.status.set('error');
        this.error.set(result.error);
        return;
      }

      this.status.set('connected');
      this.dbType.set(result.type);
      this.dbName.set(result.database);
      if (result.id) this.activeId.set(result.id);
      await this.refreshConnections(cwd, sessionKey);
      await this.loadTables(cwd, sessionKey);
    } catch (err) {
      this.status.set('error');
      this.error.set((err as Error).message);
    }
  }

  /**
   * Run a natural-language query: AI translates it to a read-only query,
   * executes it and returns the results. `provider` is the active CLI provider.
   */
  async runNlQuery(cwd: string, question: string, provider: string, sessionKey?: string): Promise<void> {
    if (!this.isDesktop || !cwd || !question.trim()) return;

    this.nlLoading.set(true);
    this.nlError.set(null);
    try {
      const result = await this.api.dbNlQuery(cwd, question.trim(), provider, sessionKey);
      if (!result.ok) {
        this.nlError.set(result.error || 'Query failed.');
        this.nlHasResult.set(false);
        return;
      }
      this.nlGeneratedQuery.set(result.query || null);
      this.nlColumns.set(result.columns || []);
      this.nlRows.set(result.rows || []);
      this.nlHasResult.set(true);
    } catch (err) {
      this.nlError.set((err as Error).message);
      this.nlHasResult.set(false);
    } finally {
      this.nlLoading.set(false);
    }
  }

  clearNlQuery(): void {
    this.nlQuestion.set('');
    this.nlError.set(null);
    this.nlGeneratedQuery.set(null);
    this.nlColumns.set([]);
    this.nlRows.set([]);
    this.nlHasResult.set(false);
  }

  async disconnect(cwd: string, sessionKey?: string): Promise<void> {
    try {
      await this.api.dbDisconnect(cwd, sessionKey);
    } catch { /* ignore */ }
    this.reset();
  }

  reset(): void {
    this.status.set('idle');
    this.dbType.set('');
    this.dbName.set('');
    this.error.set(null);
    this.tables.set([]);
    this.selectedTable.set(null);
    this.columns.set([]);
    this.rows.set([]);
    this.total.set(0);
    this.currentOffset.set(0);
    this.filters.set([]);
    this.orderBy.set(null);
    this.orderDir.set('ASC');
    this.fromStorage.set(false);
    this.savedConnections.set([]);
    this.activeId.set(null);
    this.clearNlQuery();
    this.nlQuestion.set('');
  }
}
