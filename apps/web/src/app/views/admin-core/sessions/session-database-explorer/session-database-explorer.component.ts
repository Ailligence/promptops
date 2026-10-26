import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { DatabaseService, DbFilter } from '../services/database.service';
import { TooltipDirective } from '../../../../common/tooltip.directive';
import { EscCloseDirective } from '../../../../common/esc-close.directive';

/**
 * A connection URI without the password part (`scheme://user:pass@host` →
 * `scheme://user@host`). Pasted passwords are often not percent-encoded, so
 * the user info runs to the LAST `@` before the query: a `/` or `@` inside
 * the password must not leave the rest of it behind.
 */
export function withoutUriPassword(uri: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/is.exec(uri);
  if (!m) return uri;
  const rest = m[2];
  const queryAt = rest.search(/[?#]/);
  const authority = queryAt < 0 ? rest : rest.slice(0, queryAt);
  const at = authority.lastIndexOf('@');
  if (at < 0) return uri;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  if (colon < 0) return uri;
  return m[1] + userinfo.slice(0, colon) + rest.slice(at);
}

/** What may be written to disk for a draft: everything but the secrets. */
export function persistableDraft<T extends { password: string; uri: string }>(draft: T): T {
  return { ...draft, password: '', uri: withoutUriPassword(draft.uri) };
}

@Component({
  selector: 'app-session-database-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, TooltipDirective, EscCloseDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="db-explorer">
      <!-- Top bar -->
      <div class="db-topbar">
        <div class="db-topbar-left">
          <iconify-icon icon="mdi:database" width="18" class="db-icon"></iconify-icon>
          <span class="db-title">{{ 'DB_EXPLORER.Title' | translate }}</span>

          <!-- Connection status -->
          <span class="db-status" [class]="'status-' + db.status()">
            @switch (db.status()) {
              @case ('idle') { <iconify-icon icon="mdi:circle-outline" width="10"></iconify-icon> {{ 'DB_EXPLORER.Idle' | translate }} }
              @case ('detecting') { <iconify-icon icon="mdi:refresh" width="10" class="spinning"></iconify-icon> {{ 'DB_EXPLORER.Detecting' | translate }} }
              @case ('connecting') { <iconify-icon icon="mdi:refresh" width="10" class="spinning"></iconify-icon> {{ 'DB_EXPLORER.Connecting' | translate }} }
              @case ('connected') { <iconify-icon icon="mdi:check-circle" width="10"></iconify-icon> {{ 'DB_EXPLORER.Connected' | translate }} }
              @case ('error') { <iconify-icon icon="mdi:alert-circle" width="10"></iconify-icon> {{ 'DB_EXPLORER.Error' | translate }} }
            }
          </span>

          @if (db.dbType()) {
            <span class="db-type-badge">{{ db.dbType() | uppercase }}</span>
          }
          @if (db.dbName() && db.status() === 'connected') {
            <span class="db-name-badge">{{ db.dbName() }}</span>
          }
          @if (db.fromStorage() && db.status() === 'connected') {
            <span class="db-cached-badge">{{ 'DB_EXPLORER.Cached' | translate }}</span>
          }

          <!-- Connection switcher -->
          @if (db.savedConnections().length > 0 && db.status() !== 'detecting' && db.status() !== 'connecting') {
            <div class="db-conn-switch">
              <iconify-icon icon="mdi:swap-horizontal" width="13"></iconify-icon>
              <select
                class="db-conn-select"
                [ngModel]="db.activeId()"
                (ngModelChange)="onSwitch($event)"
                [appTooltip]="'SESSIONS.TOOLTIPS.Switch database connection' | translate"
              >
                @for (conn of db.savedConnections(); track conn.id) {
                  <option [value]="conn.id">{{ conn.name }} ({{ conn.type | uppercase }})</option>
                }
              </select>
            </div>
          }
        </div>
        <div class="db-topbar-right">
          @if (db.savedConnections().length > 0 && db.status() !== 'detecting' && db.status() !== 'connecting') {
            <button class="btn-db-action btn-add-conn" (click)="openAddConnection()" [appTooltip]="'SESSIONS.TOOLTIPS.Add database connection' | translate">
              <iconify-icon icon="mdi:database-plus" width="13"></iconify-icon> {{ 'DB_EXPLORER.Add' | translate }}
            </button>
            @if (db.activeId()) {
              <button class="btn-db-icon" (click)="deleteActive()" [appTooltip]="'SESSIONS.TOOLTIPS.Remove this connection' | translate">
                <iconify-icon icon="mdi:database-remove" width="15"></iconify-icon>
              </button>
            }
          }
          @if (db.status() === 'connected') {
            <button class="btn-db-action btn-rescan" (click)="rescan()" [appTooltip]="'SESSIONS.TOOLTIPS.Rescan DB' | translate">
              <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="13"></iconify-icon> {{ 'DB_EXPLORER.Rescan' | translate }}
            </button>
            <button class="btn-db-icon" (click)="reload()" [appTooltip]="'SESSIONS.TOOLTIPS.Reload tables' | translate">
              <iconify-icon icon="mdi:refresh" width="16" [class.spinning]="db.loading()"></iconify-icon>
            </button>
          }
          @if (db.status() === 'error') {
            <button class="btn-db-action btn-retry" (click)="retry()">
              <iconify-icon icon="mdi:refresh" width="13"></iconify-icon> {{ 'DB_EXPLORER.Retry' | translate }}
            </button>
          }
          <button class="btn-db-close" (click)="close()" [appTooltip]="'SESSIONS.TOOLTIPS.Close' | translate">
            <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
          </button>
        </div>
      </div>

      <!-- Error banner -->
      @if (db.error()) {
        <div class="db-error-banner">
          <iconify-icon icon="mdi:alert-circle" width="16"></iconify-icon>
          <span>{{ db.error() }}</span>
        </div>
      }

      <!-- Main content -->
      @if (db.status() === 'connected') {
        <div class="db-content">
          <!-- Left panel: Tables -->
          <div class="db-tables-panel">
            <div class="db-panel-header">
              <iconify-icon icon="mdi:table" width="14"></iconify-icon>
              <span>{{ 'DB_EXPLORER.Tables' | translate }}</span>
              <span class="table-count">({{ db.tables().length }})</span>
            </div>

            <div class="db-search-box">
              <iconify-icon icon="mdi:magnify" width="14"></iconify-icon>
              <input
                class="db-search-input"
                [placeholder]="'DB_EXPLORER.Search tables' | translate"
                [(ngModel)]="tableSearch"
              />
            </div>

            <div class="db-table-list">
              @if (db.loading()) {
                <div class="db-loading-small">
                  <iconify-icon icon="mdi:refresh" width="14" class="spinning"></iconify-icon>
                  {{ 'DB_EXPLORER.Loading' | translate }}
                </div>
              } @else {
                @for (table of filteredTables(); track table) {
                  <div
                    class="db-table-item"
                    [class.active]="db.selectedTable() === table"
                    (click)="selectTable(table)"
                  >
                    <iconify-icon [icon]="db.dbType() === 'mongodb' ? 'mdi:file-document-outline' : 'mdi:table'" width="14"></iconify-icon>
                    <span class="table-name">{{ table }}</span>
                  </div>
                }
                @if (filteredTables().length === 0 && db.tables().length > 0) {
                  <div class="db-empty-small">{{ 'DB_EXPLORER.No tables match' | translate: { query: tableSearch } }}</div>
                }
                @if (db.tables().length === 0) {
                  <div class="db-empty-small">{{ 'DB_EXPLORER.No tables found' | translate }}</div>
                }
              }
            </div>
          </div>

          <!-- Right panel: Data viewer -->
          <div class="db-data-panel">
            <!-- Natural-language query bar -->
            <div class="db-nl-bar">
              <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="16" class="db-nl-icon"></iconify-icon>
              <input
                class="db-nl-input"
                [placeholder]="'SESSIONS.DB.Ask in plain English...' | translate"
                [(ngModel)]="nlQuestion"
                (keydown.enter)="runNlQuery()"
                [disabled]="db.nlLoading()"
              />
              <button class="btn-db-nl-play" (click)="runNlQuery()" [disabled]="db.nlLoading() || !nlQuestion.trim()" [appTooltip]="'SESSIONS.TOOLTIPS.Run query' | translate">
                @if (db.nlLoading()) {
                  <iconify-icon icon="mdi:refresh" width="16" class="spinning"></iconify-icon>
                } @else {
                  <iconify-icon icon="mdi:play" width="18"></iconify-icon>
                }
              </button>
              @if (db.nlHasResult() || db.nlGeneratedQuery() || db.nlError()) {
                <button class="btn-db-icon" (click)="clearNl()" [appTooltip]="'SESSIONS.TOOLTIPS.Clear' | translate">
                  <iconify-icon icon="mdi:close" width="16"></iconify-icon>
                </button>
              }
            </div>

            @if (db.nlError()) {
              <div class="db-error-banner">
                <iconify-icon icon="mdi:alert-circle" width="16"></iconify-icon>
                <span>{{ db.nlError() }}</span>
              </div>
            }

            @if (db.nlGeneratedQuery()) {
              <div class="db-nl-query">
                <span class="db-nl-query-label">{{ 'DB_EXPLORER.Generated' | translate }}</span>
                <code>{{ db.nlGeneratedQuery() }}</code>
              </div>
            }

            @if (db.nlLoading()) {
              <div class="db-loading">
                <iconify-icon icon="mdi:refresh" width="20" class="spinning"></iconify-icon>
                {{ 'DB_EXPLORER.Generating' | translate }}
              </div>
            } @else if (db.nlHasResult()) {
              <!-- NL query results -->
              <div class="db-data-header">
                <div class="db-data-header-left">
                  <span class="db-data-table-name">{{ 'DB_EXPLORER.Query result' | translate }}</span>
                  <span class="db-data-count">{{ 'DB_EXPLORER.Rows' | translate: { count: db.nlRows().length } }}</span>
                </div>
              </div>
              @if (db.nlRows().length === 0) {
                <div class="db-data-empty-rows">
                  <iconify-icon icon="mdi:table-off" width="32" class="text-muted"></iconify-icon>
                  <p>{{ 'DB_EXPLORER.No rows returned' | translate }}</p>
                </div>
              } @else {
                <div class="db-table-wrapper">
                  <table class="db-data-table">
                    <thead>
                      <tr>
                        @for (col of db.nlColumns(); track col) {
                          <th>{{ col }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of db.nlRows(); track $index) {
                        <tr>
                          @for (col of db.nlColumns(); track col) {
                            <td [appTooltip]="cellValue(row[col])">{{ cellDisplay(row[col]) }}</td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            } @else if (!db.selectedTable()) {
              <div class="db-data-empty">
                <iconify-icon icon="mdi:table-arrow-left" width="48" class="text-muted"></iconify-icon>
                <p>{{ 'DB_EXPLORER.Select table' | translate }}</p>
              </div>
            } @else {
              <!-- Table header with info -->
              <div class="db-data-header">
                <div class="db-data-header-left">
                  <span class="db-data-table-name">{{ db.selectedTable() }}</span>
                  <span class="db-data-count">{{ 'DB_EXPLORER.Rows' | translate: { count: db.total() } }}</span>
                </div>
                <div class="db-data-header-right">
                  <button class="btn-db-sm" (click)="toggleFilters()">
                    <iconify-icon icon="mdi:filter" width="13"></iconify-icon>
                    {{ 'COMMON.Filters' | translate }}
                    @if (activeFilterCount() > 0) {
                      <span class="filter-badge">{{ activeFilterCount() }}</span>
                    }
                  </button>
                  <button class="btn-db-sm" (click)="refreshData()">
                    <iconify-icon icon="mdi:refresh" width="13" [class.spinning]="db.queryLoading()"></iconify-icon>
                    {{ 'DB_EXPLORER.Reload' | translate }}
                  </button>
                </div>
              </div>

              <!-- Filters section -->
              @if (showFilters) {
                <div class="db-filters">
                  @for (filter of db.filters(); track $index; let i = $index) {
                    <div class="db-filter-row">
                      <select class="db-filter-select" [ngModel]="filter.column" (ngModelChange)="db.updateFilter(i, { column: $event })">
                        @for (col of db.columns(); track col) {
                          <option [value]="col">{{ col }}</option>
                        }
                      </select>
                      <select class="db-filter-op" [ngModel]="filter.operator" (ngModelChange)="db.updateFilter(i, { operator: $event })">
                        <option value="=">=</option>
                        <option value="like">LIKE</option>
                        <option value=">">></option>
                        <option value="<"><</option>
                        <option value=">=">=</option>
                        <option value="<="><=</option>
                      </select>
                      <input
                        class="db-filter-input"
                        [placeholder]="'DB_EXPLORER.Value placeholder' | translate"
                        [ngModel]="filter.value"
                        (ngModelChange)="db.updateFilter(i, { value: $event })"
                        (keydown.enter)="applyFilters()"
                      />
                      <button class="btn-db-icon-sm" (click)="db.removeFilter(i)" [appTooltip]="'SESSIONS.TOOLTIPS.Remove filter' | translate">
                        <iconify-icon icon="mdi:close" width="12"></iconify-icon>
                      </button>
                    </div>
                  }
                  <div class="db-filter-actions">
                    <button class="btn-db-sm btn-add-filter" (click)="db.addFilter()">
                      <iconify-icon icon="mdi:plus" width="13"></iconify-icon> {{ 'DB_EXPLORER.Add filter' | translate }}
                    </button>
                    @if (db.filters().length > 0) {
                      <button class="btn-db-sm btn-apply-filter" (click)="applyFilters()">
                        <iconify-icon icon="mdi:check" width="13"></iconify-icon> {{ 'DB_EXPLORER.Apply' | translate }}
                      </button>
                    }
                  </div>
                </div>
              }

              <!-- Data table -->
              @if (db.queryLoading()) {
                <div class="db-loading">
                  <iconify-icon icon="mdi:refresh" width="20" class="spinning"></iconify-icon>
                  {{ 'DB_EXPLORER.Loading data' | translate }}
                </div>
              } @else if (db.rows().length === 0) {
                <div class="db-data-empty-rows">
                  <iconify-icon icon="mdi:table-off" width="32" class="text-muted"></iconify-icon>
                  <p>{{ 'DB_EXPLORER.No rows found' | translate }}</p>
                </div>
              } @else {
                <div class="db-table-wrapper">
                  <table class="db-data-table">
                    <thead>
                      <tr>
                        @for (col of db.columns(); track col) {
                          <th (click)="sortBy(col)" class="sortable-th">
                            {{ col }}
                            @if (db.orderBy() === col) {
                              <iconify-icon [icon]="db.orderDir() === 'ASC' ? 'mdi:arrow-up' : 'mdi:arrow-down'" width="11"></iconify-icon>
                            }
                          </th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of db.rows(); track $index) {
                        <tr>
                          @for (col of db.columns(); track col) {
                            <td [appTooltip]="cellValue(row[col])">{{ cellDisplay(row[col]) }}</td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>

                <!-- Pagination -->
                <div class="db-pagination">
                  <span class="db-page-info">
                    {{ 'DB_EXPLORER.Showing' | translate: { from: db.currentOffset() + 1, to: Math.min(db.currentOffset() + db.pageSize(), db.total()), total: db.total() } }}
                  </span>
                  <div class="db-page-buttons">
                    <button class="btn-db-sm" (click)="prevPage()" [disabled]="!db.hasPrevPage()">
                      <iconify-icon icon="mdi:chevron-left" width="14"></iconify-icon> {{ 'DB_EXPLORER.Prev' | translate }}
                    </button>
                    <span class="db-page-num">{{ db.currentPage() }} / {{ db.totalPages() }}</span>
                    <button class="btn-db-sm" (click)="nextPage()" [disabled]="!db.hasNextPage()">
                      {{ 'DB_EXPLORER.Next' | translate }} <iconify-icon icon="mdi:chevron-right" width="14"></iconify-icon>
                    </button>
                  </div>
                </div>
              }
            }
          </div>
        </div>
      } @else if (db.status() === 'detecting' || db.status() === 'connecting') {
        <div class="db-connecting">
          <iconify-icon icon="mdi:database-sync" width="48" class="spinning"></iconify-icon>
          <p>{{ (db.status() === 'detecting' ? 'DB_EXPLORER.Scanning' : 'DB_EXPLORER.Connecting db') | translate }}</p>
        </div>
      } @else if (db.status() === 'error') {
        <div class="db-error-state">
          <iconify-icon icon="mdi:database-off" width="48"></iconify-icon>
          <p>{{ db.error() }}</p>
          <div class="db-error-actions">
            <button class="btn-db-action btn-retry" (click)="retry()">
              <iconify-icon icon="mdi:refresh" width="14"></iconify-icon> {{ 'DB_EXPLORER.Retry' | translate }}
            </button>
            <button class="btn-db-action btn-manual" (click)="openAddConnection()">
              <iconify-icon icon="mdi:database-edit" width="14"></iconify-icon> {{ 'DB_EXPLORER.Manual connect' | translate }}
            </button>
          </div>
          @if (db.savedConnections().length > 0) {
            <div class="db-error-saved">
              <div class="db-error-saved-title">{{ 'DB_EXPLORER.Saved connections' | translate }}</div>
              @for (conn of db.savedConnections(); track conn.id) {
                <div class="db-error-saved-row" [class.was-active]="conn.id === db.activeId()">
                  <iconify-icon icon="mdi:database" width="14"></iconify-icon>
                  <span class="conn-label">{{ conn.name }} ({{ conn.type | uppercase }})</span>
                  @if (conn.id === db.activeId()) {
                    <span class="conn-last-badge">{{ 'DB_EXPLORER.Last used' | translate }}</span>
                  }
                  <button class="btn-db-action btn-retry" (click)="connectSaved(conn.id)">{{ 'DB_EXPLORER.Connect' | translate }}</button>
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <div class="db-connecting">
          <iconify-icon icon="mdi:database" width="48" class="text-muted"></iconify-icon>
          <p>{{ 'DB_EXPLORER.Initializing' | translate }}</p>
        </div>
      }

      <!-- Manual / Add connection form (available in any state) -->
      @if (showManualForm) {
          <div class="db-manual-overlay" (click)="showManualForm = false">
            <div class="db-manual-modal" (click)="$event.stopPropagation()" appEscClose (escClose)="showManualForm = false">
              <div class="db-manual-header">
                <iconify-icon icon="mdi:database-cog" width="18" class="db-icon"></iconify-icon>
                <span>{{ (editingId ? 'DB_EXPLORER.Edit connection' : 'DB_EXPLORER.Add connection') | translate }}</span>
                <button class="btn-db-close" (click)="showManualForm = false">
                  <iconify-icon icon="mdi:close" width="16"></iconify-icon>
                </button>
              </div>

              <div class="db-manual-body">
                @if (draftRestored) {
                  <div class="db-draft-banner">
                    <iconify-icon icon="mdi:history" width="14"></iconify-icon>
                    <span>{{ 'DB_EXPLORER.Draft restored' | translate }}</span>
                    <button class="btn-db-draft-clear" (click)="discardManualDraft()">{{ 'DB_EXPLORER.Clear' | translate }}</button>
                  </div>
                }
                <div class="db-field">
                  <label>{{ 'DB_EXPLORER.Connection name' | translate }}</label>
                  <input type="text" [ngModel]="manualConfig.name" (ngModelChange)="manualConfig.name = $event; saveManualDraft()" [placeholder]="'DB_EXPLORER.Name placeholder' | translate" />
                </div>
                <div class="db-field">
                  <label>{{ 'DB_EXPLORER.Type' | translate }}</label>
                  <select [ngModel]="manualConfig.type" (ngModelChange)="manualConfig.type = $event; onDbTypeChange(); saveManualDraft()">
                    <option value="mysql">MySQL / MariaDB</option>
                    <option value="pgsql">PostgreSQL</option>
                    <option value="sqlite">SQLite</option>
                    <option value="mongodb">MongoDB</option>
                  </select>
                </div>

                @if (manualConfig.type === 'mongodb') {
                  <div class="db-field">
                    <label>{{ 'DB_EXPLORER.Connection URI' | translate }}</label>
                    <input type="text" [ngModel]="manualConfig.uri" (ngModelChange)="manualConfig.uri = $event; saveManualDraft()" placeholder="mongodb://localhost:27017/mydb" />
                  </div>
                } @else if (manualConfig.type === 'sqlite') {
                  <div class="db-field">
                    <label>{{ 'DB_EXPLORER.Database path' | translate }}</label>
                    <input type="text" [ngModel]="manualConfig.path" (ngModelChange)="manualConfig.path = $event; saveManualDraft()" placeholder="database/database.sqlite" />
                  </div>
                } @else {
                  <div class="db-field-row">
                    <div class="db-field db-field-grow">
                      <label>{{ 'DB_EXPLORER.Host' | translate }}</label>
                      <input type="text" [ngModel]="manualConfig.host" (ngModelChange)="manualConfig.host = $event; saveManualDraft()" placeholder="127.0.0.1" />
                    </div>
                    <div class="db-field db-field-port">
                      <label>{{ 'DB_EXPLORER.Port' | translate }}</label>
                      <input type="number" [ngModel]="manualConfig.port" (ngModelChange)="manualConfig.port = $event; saveManualDraft()" [placeholder]="manualConfig.type === 'pgsql' ? '5432' : '3306'" />
                    </div>
                  </div>
                  <div class="db-field">
                    <label>{{ 'DB_EXPLORER.Database' | translate }}</label>
                    <input type="text" [ngModel]="manualConfig.database" (ngModelChange)="manualConfig.database = $event; saveManualDraft()" placeholder="my_database" />
                  </div>
                  <div class="db-field-row">
                    <div class="db-field db-field-grow">
                      <label>{{ 'DB_EXPLORER.Username' | translate }}</label>
                      <input type="text" [ngModel]="manualConfig.username" (ngModelChange)="manualConfig.username = $event; saveManualDraft()" [placeholder]="manualConfig.type === 'pgsql' ? 'postgres' : 'root'" />
                    </div>
                    <div class="db-field db-field-grow">
                      <label>{{ 'DB_EXPLORER.Password' | translate }}</label>
                      <input type="password" [ngModel]="manualConfig.password" (ngModelChange)="manualConfig.password = $event; saveManualDraft()" placeholder="••••••••" />
                    </div>
                  </div>
                }

                @if (manualError) {
                  <div class="db-manual-error">
                    <iconify-icon icon="mdi:alert-circle" width="14"></iconify-icon>
                    {{ manualError }}
                  </div>
                }
              </div>

              <div class="db-manual-footer">
                <button class="btn-db-action btn-cancel" (click)="showManualForm = false">{{ 'BUTTONS.Cancel' | translate }}</button>
                <button class="btn-db-action btn-connect" (click)="submitManualConnect()" [disabled]="manualConnecting">
                  @if (manualConnecting) {
                    <iconify-icon icon="mdi:refresh" width="14" class="spinning"></iconify-icon> {{ 'DB_EXPLORER.Connecting' | translate }}
                  } @else {
                    <iconify-icon icon="mdi:connection" width="14"></iconify-icon> {{ 'DB_EXPLORER.Connect' | translate }}
                  }
                </button>
              </div>
            </div>
          </div>
      }

      <!-- Read-only badge -->
      <div class="db-readonly-badge">
        <iconify-icon icon="mdi:lock" width="11"></iconify-icon> {{ 'DB_EXPLORER.Read only' | translate }}
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .db-explorer {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100vw;
      background: var(--po-bg-0);
      color: var(--po-text-primary);
      position: relative;
    }

    /* ── Top bar ── */
    .db-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid var(--po-border-subtle);
      flex-shrink: 0;
    }
    .db-topbar-left { display: flex; align-items: center; gap: 0.5rem; }
    .db-topbar-right { display: flex; align-items: center; gap: 0.4rem; }

    .db-icon { color: #f0883e; }
    .db-title { font-size: 0.85rem; font-weight: 700; letter-spacing: 0.02em; }

    .db-status {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.68rem; font-weight: 600; padding: 2px 8px; border-radius: 4px;
    }
    .status-idle { color: var(--po-text-secondary); background: var(--po-bg-2); }
    .status-detecting, .status-connecting { color: var(--po-warning); background: var(--po-warning-bg); }
    .status-connected { color: var(--po-success); background: var(--po-success-bg); }
    .status-error { color: var(--po-error); background: var(--po-error-bg); }

    .db-type-badge {
      font-size: 0.6rem; font-weight: 700; padding: 2px 6px; border-radius: 3px;
      background: rgba(240,136,62,0.15); color: #f0883e; letter-spacing: 0.04em;
    }
    .db-name-badge {
      font-size: 0.65rem; font-weight: 500; color: var(--po-text-secondary);
      font-family: monospace;
    }
    .db-cached-badge {
      font-size: 0.55rem; font-weight: 600; text-transform: uppercase;
      padding: 1px 5px; border-radius: 3px;
      background: var(--po-success-bg); color: var(--po-success); letter-spacing: 0.03em;
    }

    .btn-db-icon {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: none; border-radius: 4px;
      background: transparent; color: var(--po-text-secondary); cursor: pointer;
    }
    .btn-db-icon:hover { background: rgba(255,255,255,0.08); color: var(--po-text-primary); }

    .btn-db-close {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: none; border-radius: 4px;
      background: transparent; color: var(--po-text-secondary); cursor: pointer;
    }
    .btn-db-close:hover { background: var(--po-error-bg); color: var(--po-error); }

    .btn-db-action {
      display: flex; align-items: center; gap: 0.25rem;
      font-size: 0.7rem; font-weight: 600; padding: 4px 10px;
      border: 1px solid; border-radius: 4px; cursor: pointer;
    }
    .btn-retry { border-color: rgba(240,136,62,0.3); background: rgba(240,136,62,0.1); color: #f0883e; }
    .btn-retry:hover { background: rgba(240,136,62,0.2); }
    .btn-rescan { border-color: rgba(188,140,255,0.3); background: rgba(188,140,255,0.1); color: #bc8cff; }
    .btn-rescan:hover { background: rgba(188,140,255,0.2); }
    .btn-manual { border-color: rgba(63,185,80,0.3); background: var(--po-success-bg); color: var(--po-success); }
    .btn-manual:hover { background: rgba(63,185,80,0.2); }
    .btn-add-conn { border-color: rgba(63,185,80,0.3); background: var(--po-success-bg); color: var(--po-success); }
    .btn-add-conn:hover { background: rgba(63,185,80,0.2); }

    /* ── Connection switcher ── */
    .db-conn-switch {
      display: inline-flex; align-items: center; gap: 0.3rem;
      margin-left: 0.4rem; padding-left: 0.6rem;
      border-left: 1px solid var(--po-border-subtle); color: var(--po-text-secondary);
    }
    .db-conn-select {
      background: var(--po-bg-0);
      border: 1px solid var(--po-border-subtle); border-radius: 4px;
      color: var(--po-text-primary); font-size: 0.68rem; font-weight: 600;
      padding: 2px 6px; max-width: 220px; outline: none; cursor: pointer;
    }
    .db-conn-select:focus { border-color: rgba(240,136,62,0.5); }

    .db-error-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }

    /* ── Manual connect modal ── */
    .db-manual-overlay {
      position: fixed; inset: 0; z-index: 100;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(2px);
      display: flex; align-items: center; justify-content: center;
    }
    .db-manual-modal {
      width: 440px; max-width: 95vw;
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: 10px; overflow: hidden;
      box-shadow: 0 16px 48px rgba(0,0,0,0.4);
    }
    .db-manual-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.75rem 1rem; font-size: 0.85rem; font-weight: 700;
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .db-manual-header .btn-db-close { margin-left: auto; }
    .db-manual-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem; }
    .db-manual-footer {
      display: flex; justify-content: flex-end; gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--po-border-subtle);
    }

    .db-field { display: flex; flex-direction: column; gap: 0.2rem; }
    .db-field label {
      font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; color: var(--po-text-secondary);
    }
    .db-field input, .db-field select {
      background: var(--po-bg-0);
      border: 1px solid var(--po-border-subtle); border-radius: 5px;
      color: var(--po-text-primary); font-size: 0.78rem; padding: 0.4rem 0.6rem;
      outline: none; transition: border-color var(--po-duration-fast);
    }
    .db-field input:focus, .db-field select:focus {
      border-color: rgba(240,136,62,0.5);
    }
    .db-field input::placeholder { color: var(--po-text-secondary); opacity: 0.6; }

    .db-field-row { display: flex; gap: 0.5rem; }
    .db-field-grow { flex: 1; }
    .db-field-port { width: 90px; flex-shrink: 0; }

    .btn-cancel { border-color: var(--po-border-subtle); background: transparent; color: var(--po-text-secondary); }
    .btn-cancel:hover { background: rgba(255,255,255,0.06); color: var(--po-text-primary); }
    .btn-connect { border-color: rgba(240,136,62,0.4); background: rgba(240,136,62,0.15); color: var(--po-warning); }
    .btn-connect:hover:not(:disabled) { background: rgba(240,136,62,0.25); }
    .btn-connect:disabled { opacity: 0.5; cursor: not-allowed; }

    .db-manual-error {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.72rem; color: var(--po-error); padding: 0.4rem 0.6rem;
      background: var(--po-error-bg); border-radius: 5px;
    }

    .db-draft-banner {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.72rem; color: var(--po-text-secondary);
      padding: 0.4rem 0.6rem; border-radius: 5px;
      background: rgba(240,136,62,0.08);
      border: 1px dashed rgba(240,136,62,0.35);
    }
    .btn-db-draft-clear {
      margin-left: auto; border: none; cursor: pointer;
      background: transparent; color: var(--po-warning);
      font-size: 0.68rem; font-weight: 600; padding: 2px 6px; border-radius: 4px;
    }
    .btn-db-draft-clear:hover { background: rgba(240,136,62,0.15); }

    /* ── Error banner ── */
    .db-error-banner {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 1rem; font-size: 0.72rem;
      background: var(--po-error-bg); color: var(--po-error);
      border-bottom: 1px solid oklch(from var(--po-error) l c h / 15%);
      flex-shrink: 0;
    }

    /* ── Main content ── */
    .db-content { flex: 1; display: flex; min-height: 0; }

    /* ── Left panel ── */
    .db-tables-panel {
      width: 240px; flex-shrink: 0; display: flex; flex-direction: column;
      border-right: 1px solid var(--po-border-subtle);
      background: rgba(255,255,255,0.01);
    }

    .db-panel-header {
      display: flex; align-items: center; gap: 0.375rem;
      padding: 0.5rem 0.75rem; font-size: 0.72rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em;
      color: #f0883e; border-bottom: 1px solid var(--po-border-subtle);
      flex-shrink: 0;
    }
    .table-count { font-weight: 400; color: var(--po-text-secondary); }

    .db-search-box {
      display: flex; align-items: center; gap: 0.25rem;
      padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--po-border-subtle);
      flex-shrink: 0; color: var(--po-text-secondary);
    }
    .db-search-input {
      flex: 1; background: transparent; border: none; color: var(--po-text-primary);
      font-size: 0.72rem; outline: none;
    }
    .db-search-input::placeholder { color: var(--po-text-secondary); }

    .db-table-list { flex: 1; overflow-y: auto; }

    .db-table-item {
      display: flex; align-items: center; gap: 0.375rem;
      padding: 0.3rem 0.75rem; font-size: 0.72rem; cursor: pointer;
      color: var(--po-text-primary); transition: background var(--po-duration-instant);
    }
    .db-table-item:hover { background: rgba(255,255,255,0.04); }
    .db-table-item.active { background: rgba(240,136,62,0.12); color: #f0883e; font-weight: 600; }
    .table-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; font-size: 0.7rem; }

    .db-loading-small, .db-empty-small {
      display: flex; align-items: center; justify-content: center; gap: 0.375rem;
      padding: 1rem; font-size: 0.72rem; color: var(--po-text-secondary);
    }

    /* ── Right panel ── */
    .db-data-panel { flex: 1; display: flex; flex-direction: column; min-width: 0; }

    /* ── Natural-language query bar ── */
    .db-nl-bar {
      display: flex; align-items: center; gap: 0.4rem;
      padding: 0.45rem 0.75rem; flex-shrink: 0;
      border-bottom: 1px solid var(--po-border-subtle);
      background: rgba(188,140,255,0.04);
    }
    .db-nl-icon { color: #bc8cff; flex-shrink: 0; }
    .db-nl-input {
      flex: 1; background: var(--po-bg-0);
      border: 1px solid var(--po-border-subtle); border-radius: 6px;
      color: var(--po-text-primary); font-size: 0.78rem; padding: 0.4rem 0.6rem;
      outline: none; transition: border-color var(--po-duration-fast);
    }
    .db-nl-input:focus { border-color: rgba(188,140,255,0.5); }
    .db-nl-input::placeholder { color: var(--po-text-secondary); opacity: 0.7; }
    .db-nl-input:disabled { opacity: 0.6; }
    .btn-db-nl-play {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 30px; flex-shrink: 0;
      border: 1px solid rgba(188,140,255,0.4); border-radius: 6px;
      background: rgba(188,140,255,0.15); color: #bc8cff; cursor: pointer;
    }
    .btn-db-nl-play:hover:not(:disabled) { background: rgba(188,140,255,0.28); }
    .btn-db-nl-play:disabled { opacity: 0.4; cursor: not-allowed; }

    .db-nl-query {
      display: flex; align-items: flex-start; gap: 0.5rem;
      padding: 0.4rem 0.75rem; flex-shrink: 0;
      border-bottom: 1px solid var(--po-border-subtle);
      background: rgba(255,255,255,0.01);
    }
    .db-nl-query-label {
      font-size: 0.55rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 2px 6px; border-radius: 3px;
      background: rgba(188,140,255,0.15); color: #bc8cff; flex-shrink: 0;
    }
    .db-nl-query code {
      font-family: monospace; font-size: 0.7rem; color: var(--po-text-primary);
      white-space: pre-wrap; word-break: break-word;
    }

    .db-data-empty, .db-data-empty-rows {
      flex: 1; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 0.75rem; color: var(--po-text-secondary);
      font-size: 0.85rem;
    }

    .db-data-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--po-border-subtle);
      flex-shrink: 0;
    }
    .db-data-header-left { display: flex; align-items: center; gap: 0.5rem; }
    .db-data-header-right { display: flex; align-items: center; gap: 0.3rem; }
    .db-data-table-name { font-size: 0.78rem; font-weight: 700; font-family: monospace; color: #f0883e; }
    .db-data-count { font-size: 0.65rem; color: var(--po-text-secondary); }

    .btn-db-sm {
      display: flex; align-items: center; gap: 0.2rem;
      font-size: 0.65rem; font-weight: 600; padding: 3px 8px;
      border: 1px solid var(--po-border-subtle); border-radius: 4px;
      background: transparent; color: var(--po-text-secondary); cursor: pointer;
    }
    .btn-db-sm:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: var(--po-text-primary); }
    .btn-db-sm:disabled { opacity: 0.4; cursor: not-allowed; }

    .filter-badge {
      font-size: 0.55rem; min-width: 14px; height: 14px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(240,136,62,0.2); color: #f0883e;
    }

    /* ── Filters ── */
    .db-filters {
      padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--po-border-subtle);
      background: rgba(255,255,255,0.01); flex-shrink: 0;
    }
    .db-filter-row {
      display: flex; align-items: center; gap: 0.25rem; margin-bottom: 0.25rem;
    }
    .db-filter-select, .db-filter-op, .db-filter-input {
      background: var(--po-bg-0);
      border: 1px solid var(--po-border-subtle); border-radius: 3px;
      color: var(--po-text-primary); font-size: 0.68rem; padding: 3px 6px;
    }
    .db-filter-select { width: 140px; }
    .db-filter-op { width: 65px; }
    .db-filter-input { flex: 1; }
    .db-filter-select:focus, .db-filter-op:focus, .db-filter-input:focus {
      outline: none; border-color: rgba(240,136,62,0.4);
    }

    .btn-db-icon-sm {
      display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border: none; border-radius: 3px;
      background: transparent; color: var(--po-text-secondary); cursor: pointer;
    }
    .btn-db-icon-sm:hover { background: var(--po-error-bg); color: var(--po-error); }

    .db-filter-actions { display: flex; gap: 0.3rem; margin-top: 0.3rem; }
    .btn-add-filter { color: #f0883e; border-color: rgba(240,136,62,0.2); }
    .btn-add-filter:hover { background: rgba(240,136,62,0.1); }
    .btn-apply-filter { color: var(--po-success); border-color: rgba(63,185,80,0.2); }
    .btn-apply-filter:hover { background: rgba(63,185,80,0.1); }

    /* ── Data table ── */
    .db-table-wrapper { flex: 1; overflow: auto; min-height: 0; }

    .db-data-table {
      width: 100%; border-collapse: collapse; font-size: 0.7rem; font-family: monospace;
    }
    .db-data-table th {
      position: sticky; top: 0; z-index: 1;
      padding: 0.35rem 0.5rem; text-align: left; font-weight: 700; font-size: 0.65rem;
      text-transform: uppercase; letter-spacing: 0.03em;
      background: var(--po-bg-2); color: var(--po-text-secondary);
      border-bottom: 1px solid var(--po-border-subtle);
      white-space: nowrap;
    }
    .sortable-th { cursor: pointer; user-select: none; }
    .sortable-th:hover { color: #f0883e; }

    .db-data-table td {
      padding: 0.3rem 0.5rem; border-bottom: 1px solid rgba(48,54,61,0.4);
      max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .db-data-table tr:hover td { background: rgba(255,255,255,0.02); }

    /* ── Pagination ── */
    .db-pagination {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.4rem 0.75rem; border-top: 1px solid var(--po-border-subtle);
      flex-shrink: 0;
    }
    .db-page-info { font-size: 0.65rem; color: var(--po-text-secondary); }
    .db-page-buttons { display: flex; align-items: center; gap: 0.3rem; }
    .db-page-num { font-size: 0.65rem; color: var(--po-text-secondary); padding: 0 0.25rem; }

    /* ── Loading / Error states ── */
    .db-connecting, .db-error-state, .db-loading {
      flex: 1; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 0.75rem; color: var(--po-text-secondary);
      font-size: 0.85rem;
    }
    .db-error-state { color: var(--po-error); }

    /* Saved connections offered from the error state */
    .db-error-saved {
      display: flex; flex-direction: column; gap: 0.4rem;
      margin-top: 1rem; padding: 0.75rem 1rem;
      width: 420px; max-width: 90%;
      background: var(--po-bg-2); border: 1px solid var(--po-border-subtle);
      border-radius: 8px;
    }
    .db-error-saved-title {
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--po-text-secondary);
    }
    .db-error-saved-row {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.75rem; color: var(--po-text-primary);
      padding: 0.3rem 0.4rem; border-radius: 5px;
    }
    .db-error-saved-row .conn-label {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .db-error-saved-row .conn-last-badge {
      font-size: 0.58rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--po-warning);
      background: rgba(240,136,62,0.12); padding: 2px 6px; border-radius: 4px;
    }
    .db-error-saved-row.was-active { background: rgba(240,136,62,0.06); }

    /* ── Read-only badge ── */
    .db-readonly-badge {
      position: absolute; bottom: 0.75rem; right: 0.75rem;
      display: flex; align-items: center; gap: 4px;
      font-size: 0.55rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; padding: 3px 8px; border-radius: 4px;
      background: var(--po-warning-bg); color: var(--po-warning);
      pointer-events: none;
    }

    /* ── Spinner ── */
    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .text-muted { color: var(--po-text-secondary) !important; }
  `,
})
export class SessionDatabaseExplorerComponent implements OnInit, OnDestroy {
  // Draft of the manual-connect form, kept across modal closes so credentials
  // pasted piecewise never have to be re-typed. The full draft (password
  // included) stays in memory for this run only; what survives a restart in
  // localStorage has no password and no password inside the URI: browser
  // storage is a plain file on disk, while saved connections live in the
  // encrypted local store.
  private static readonly DRAFT_KEY = 'po-db-manual-draft';
  private static memoryDraft: SessionDatabaseExplorerComponent['manualConfig'] | null = null;

  protected db = inject(DatabaseService);
  private modal = inject(NgbActiveModal);
  private translate = inject(TranslateService);

  cwd = '';
  provider = '';
  /** Stable session identity (stored id, fallback name) for per-session active connection. */
  sessionKey = '';
  tableSearch = '';
  nlQuestion = '';
  showFilters = false;
  showManualForm = false;
  manualConnecting = false;
  manualError = '';
  draftRestored = false;
  editingId: string | null = null;
  manualConfig: {
    name: string; type: string; host: string; port: number | null; database: string;
    username: string; password: string; uri: string; path: string;
  } = {
    name: '', type: 'mysql', host: '127.0.0.1', port: 3306, database: '',
    username: '', password: '', uri: '', path: '',
  };

  protected Math = Math;

  ngOnInit(): void {
    SessionDatabaseExplorerComponent.scrubStoredDraft();
    // NgbModal sets componentInstance properties synchronously before ngOnInit,
    // but use a microtask to be safe in case of timing issues
    Promise.resolve().then(() => {
      if (this.cwd) {
        this.db.detectAndConnect(this.cwd, this.provider, false, this.sessionKey);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.cwd) {
      this.db.disconnect(this.cwd, this.sessionKey);
    }
  }

  filteredTables(): string[] {
    const search = this.tableSearch.toLowerCase().trim();
    if (!search) return this.db.tables();
    return this.db.tables().filter(t => t.toLowerCase().includes(search));
  }

  selectTable(table: string): void {
    if (this.cwd) {
      this.db.selectTable(this.cwd, table, this.sessionKey);
    }
  }

  reload(): void {
    if (this.cwd) {
      this.db.loadTables(this.cwd, this.sessionKey);
    }
  }

  retry(): void {
    if (this.cwd) {
      this.db.detectAndConnect(this.cwd, this.provider, false, this.sessionKey);
    }
  }

  rescan(): void {
    if (this.cwd) {
      this.db.disconnect(this.cwd, this.sessionKey);
      this.db.detectAndConnect(this.cwd, this.provider, true, this.sessionKey);
    }
  }

  refreshData(): void {
    if (this.cwd) {
      this.db.fetchRows(this.cwd, this.sessionKey);
    }
  }

  sortBy(column: string): void {
    if (this.cwd) {
      this.db.toggleSort(this.cwd, column, this.sessionKey);
    }
  }

  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  activeFilterCount(): number {
    return this.db.filters().filter(f => f.value.trim() !== '').length;
  }

  applyFilters(): void {
    if (this.cwd) {
      this.db.applyFilters(this.cwd, this.sessionKey);
    }
  }

  nextPage(): void {
    if (this.cwd) this.db.nextPage(this.cwd, this.sessionKey);
  }

  prevPage(): void {
    if (this.cwd) this.db.prevPage(this.cwd, this.sessionKey);
  }

  cellValue(val: unknown): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  cellDisplay(val: unknown): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'object') {
      const str = JSON.stringify(val);
      return str.length > 100 ? str.substring(0, 100) + '...' : str;
    }
    const str = String(val);
    return str.length > 100 ? str.substring(0, 100) + '...' : str;
  }

  runNlQuery(): void {
    if (this.cwd && this.nlQuestion.trim() && !this.db.nlLoading()) {
      this.db.runNlQuery(this.cwd, this.nlQuestion, this.provider, this.sessionKey);
    }
  }

  clearNl(): void {
    this.nlQuestion = '';
    this.db.clearNlQuery();
  }

  onSwitch(id: string): void {
    if (this.cwd && id) {
      this.db.switchConnection(this.cwd, id, this.sessionKey);
    }
  }

  /** Re-attach a saved connection from the error state. */
  connectSaved(id: string): void {
    if (this.cwd && id) {
      this.db.switchConnection(this.cwd, id, this.sessionKey);
    }
  }

  openAddConnection(): void {
    this.editingId = null;
    this.manualError = '';
    this.manualConfig = {
      name: '', type: 'mysql', host: '127.0.0.1', port: 3306, database: '',
      username: '', password: '', uri: '', path: '',
    };
    this.draftRestored = this.restoreManualDraft();
    this.showManualForm = true;
  }

  deleteActive(): void {
    const id = this.db.activeId();
    if (this.cwd && id) {
      this.db.deleteConnection(this.cwd, id, this.sessionKey);
    }
  }

  saveManualDraft(): void {
    SessionDatabaseExplorerComponent.memoryDraft = { ...this.manualConfig };
    try {
      localStorage.setItem(
        SessionDatabaseExplorerComponent.DRAFT_KEY,
        JSON.stringify(persistableDraft(this.manualConfig)),
      );
    } catch { /* private mode / quota — draft is best-effort */ }
  }

  /** Returns true when a meaningful draft was applied to the form. */
  private restoreManualDraft(): boolean {
    if (this.editingId) return false;
    try {
      const raw = localStorage.getItem(SessionDatabaseExplorerComponent.DRAFT_KEY);
      let draft = SessionDatabaseExplorerComponent.memoryDraft;
      if (!draft) {
        if (!raw) return false;
        draft = JSON.parse(raw);
        if (!draft || typeof draft !== 'object') return false;
        draft = persistableDraft({ ...draft!, password: draft!.password ?? '', uri: draft!.uri ?? '' });
      }
      if (!draft.name && !draft.database && !draft.username && !draft.password && !draft.uri && !draft.path) {
        return false;
      }
      this.manualConfig = { ...this.manualConfig, ...draft };
      return true;
    } catch {
      return false;
    }
  }

  /** Drafts written by older versions held the password in localStorage: scrub them. */
  static scrubStoredDraft(): void {
    try {
      const raw = localStorage.getItem(SessionDatabaseExplorerComponent.DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') return;
      const clean = persistableDraft({ password: '', uri: '', ...draft });
      if (clean.password !== (draft.password ?? '') || clean.uri !== (draft.uri ?? '')) {
        localStorage.setItem(SessionDatabaseExplorerComponent.DRAFT_KEY, JSON.stringify(clean));
      }
    } catch { /* best effort */ }
  }

  private clearManualDraft(): void {
    SessionDatabaseExplorerComponent.memoryDraft = null;
    try {
      localStorage.removeItem(SessionDatabaseExplorerComponent.DRAFT_KEY);
    } catch { /* ignore */ }
  }

  /** "Clear" on the restore banner: back to a pristine form, draft dropped. */
  discardManualDraft(): void {
    this.clearManualDraft();
    this.draftRestored = false;
    this.manualConfig = {
      name: '', type: 'mysql', host: '127.0.0.1', port: 3306, database: '',
      username: '', password: '', uri: '', path: '',
    };
  }

  onDbTypeChange(): void {
    if (this.manualConfig.type === 'mysql') {
      this.manualConfig.port = 3306;
    } else if (this.manualConfig.type === 'pgsql') {
      this.manualConfig.port = 5432;
    }
  }

  async submitManualConnect(): Promise<void> {
    if (!this.cwd || this.manualConnecting) return;

    this.manualConnecting = true;
    this.manualError = '';

    const config: Record<string, unknown> = { type: this.manualConfig.type };

    if (this.manualConfig.type === 'mongodb') {
      if (!this.manualConfig.uri) {
        this.manualError = this.translate.instant('DB_EXPLORER.URI required');
        this.manualConnecting = false;
        return;
      }
      config['uri'] = this.manualConfig.uri;
    } else if (this.manualConfig.type === 'sqlite') {
      if (!this.manualConfig.path) {
        this.manualError = this.translate.instant('DB_EXPLORER.Path required');
        this.manualConnecting = false;
        return;
      }
      config['path'] = this.manualConfig.path;
      config['database'] = this.manualConfig.path;
    } else {
      config['host'] = this.manualConfig.host || '127.0.0.1';
      config['port'] = this.manualConfig.port || (this.manualConfig.type === 'pgsql' ? 5432 : 3306);
      config['database'] = this.manualConfig.database;
      config['username'] = this.manualConfig.username;
      config['password'] = this.manualConfig.password;
    }

    try {
      const name = this.manualConfig.name.trim() || undefined;
      await this.db.manualConnect(this.cwd, config as any, name, this.editingId || undefined, this.sessionKey);

      if (this.db.status() === 'connected') {
        this.clearManualDraft();
        this.draftRestored = false;
        this.showManualForm = false;
        this.editingId = null;
      } else {
        this.manualError = this.db.error() || this.translate.instant('DB_EXPLORER.Connection failed');
      }
    } catch (err) {
      this.manualError = (err as Error).message;
    } finally {
      this.manualConnecting = false;
    }
  }

  close(): void {
    this.modal.dismiss();
  }
}
