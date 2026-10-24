import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  OnInit,
  ChangeDetectionStrategy
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { DockerService, DockerContainer } from '../services/docker.service';
import { TooltipDirective } from '../../../../common/tooltip.directive';

@Component({
  selector: 'app-session-docker-panel',
  standalone: true,
  imports: [TranslateModule, TooltipDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="docker-panel">
      <!-- Top bar -->
      <div class="docker-topbar">
        <div class="docker-topbar-left">
          <iconify-icon icon="mdi:docker" width="20" class="docker-icon"></iconify-icon>
          <span class="docker-title">{{ 'SESSIONS.TOOLTIPS.Docker containers' | translate }}</span>

          <span class="docker-status" [class]="'status-' + docker.status()">
            @switch (docker.status()) {
              @case ('idle') { <iconify-icon icon="mdi:circle-outline" width="10"></iconify-icon> {{ 'SESSIONS.Status idle' | translate }} }
              @case ('loading') { <iconify-icon icon="mdi:refresh" width="10" class="spinning"></iconify-icon> {{ 'SUBAGENTS.Loading' | translate }} }
              @case ('loaded') {
                <iconify-icon icon="mdi:check-circle" width="10"></iconify-icon>
                {{ (docker.containers().length === 1 ? 'SESSIONS.DOCKER.One container' : 'SESSIONS.DOCKER.N containers') | translate: { count: docker.containers().length } }}
              }
              @case ('error') { <iconify-icon icon="mdi:alert-circle" width="10"></iconify-icon> {{ 'SESSIONS.Status error' | translate }} }
            }
          </span>

          @if (docker.projectName()) {
            <span class="project-badge">{{ docker.projectName() }}</span>
          }
        </div>
        <div class="docker-topbar-right">
          <button class="btn-docker-icon" (click)="refresh()" [appTooltip]="'SESSIONS.TOOLTIPS.Refresh' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.Refresh' | translate">
            <iconify-icon icon="mdi:refresh" width="16" [class.spinning]="docker.status() === 'loading'"></iconify-icon>
          </button>
          @if (showAll) {
            <button class="btn-docker-action" (click)="showAll = false" [appTooltip]="'SESSIONS.TOOLTIPS.Show project only' | translate">
              <iconify-icon icon="solar:filter-bold" width="13"></iconify-icon> {{ 'SESSIONS.DOCKER.Project only' | translate }}
            </button>
          } @else {
            <button class="btn-docker-action" (click)="showAll = true" [appTooltip]="'SESSIONS.TOOLTIPS.Show all containers' | translate">
              <iconify-icon icon="solar:list-bold" width="13"></iconify-icon> {{ 'COMMON.All' | translate }}
            </button>
          }
          <button class="btn-docker-close" (click)="close()" [appTooltip]="'SESSIONS.TOOLTIPS.Close' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.Close' | translate">
            <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
          </button>
        </div>
      </div>

      <!-- Error banner -->
      @if (docker.error()) {
        <div class="docker-error-banner">
          <iconify-icon icon="mdi:alert-circle" width="16"></iconify-icon>
          <span>{{ docker.error() }}</span>
        </div>
      }

      <!-- Containers list -->
      @if (docker.status() === 'loaded') {
        <div class="docker-content">
          @if (visibleContainers.length === 0) {
            <div class="docker-empty">
              <iconify-icon icon="mdi:docker" width="48" class="text-muted"></iconify-icon>
              <p class="text-muted mt-2 mb-0">
                @if (showAll) {
                  {{ 'SESSIONS.DOCKER.No containers found' | translate }}
                } @else {
                  {{ 'SESSIONS.DOCKER.No project containers' | translate }}
                }
              </p>
              @if (!showAll && docker.allContainers().length > 0) {
                <button class="btn btn-sm btn-outline-secondary mt-2" (click)="showAll = true">
                  {{ 'SESSIONS.DOCKER.Show all count' | translate: { count: docker.allContainers().length } }}
                </button>
              }
            </div>
          } @else {
            <div class="docker-table-wrap">
              <table class="docker-table">
                <thead>
                  <tr>
                    <th class="col-state"></th>
                    <th>{{ 'PROMPTS.Name' | translate }}</th>
                    <th>{{ 'SESSIONS.DOCKER.Image' | translate }}</th>
                    <th>{{ 'PROMPTS.Status' | translate }}</th>
                    <th>{{ 'SESSIONS.DOCKER.Ports' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of visibleContainers; track c.id) {
                    <tr [class]="'row-state-' + c.state">
                      <td class="col-state">
                        <span class="state-dot" [class]="'dot-' + c.state" [appTooltip]="c.state"></span>
                      </td>
                      <td class="col-name">{{ c.name }}</td>
                      <td class="col-image">{{ c.image }}</td>
                      <td class="col-status">{{ c.status }}</td>
                      <td class="col-ports">{{ c.ports || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @if (!showAll && docker.allContainers().length > docker.containers().length) {
            <div class="docker-footer">
              <span class="text-muted">
                {{ 'SESSIONS.DOCKER.Other containers' | translate: { count: docker.allContainers().length - docker.containers().length } }}
              </span>
              <button class="btn btn-sm btn-link" (click)="showAll = true">{{ 'SESSIONS.DOCKER.Show all' | translate }}</button>
            </div>
          }
        </div>
      }

      <!-- Loading state -->
      @if (docker.status() === 'loading') {
        <div class="docker-empty">
          <iconify-icon icon="mdi:refresh" width="32" class="spinning text-muted"></iconify-icon>
          <p class="text-muted mt-2 mb-0">{{ 'SESSIONS.DOCKER.Searching' | translate }}</p>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .docker-panel {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--po-bg-0);
      color: var(--po-text-primary);
    }

    /* ── Topbar ── */
    .docker-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: var(--po-bg-2);
      border-bottom: 1px solid var(--po-border-subtle);
      flex-shrink: 0;
    }
    .docker-topbar-left, .docker-topbar-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .docker-icon { color: #2496ed; }
    .docker-title { font-weight: 700; font-size: 0.95rem; }

    .docker-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .status-idle { color: var(--bs-secondary-color); }
    .status-loading { color: var(--po-warning); }
    .status-loaded { color: var(--po-success); background: var(--po-success-bg); }
    .status-error { color: var(--po-error); background: var(--po-error-bg); }

    .project-badge {
      font-size: 0.68rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(36, 150, 237, 0.12);
      color: #2496ed;
    }

    .btn-docker-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      background: transparent;
      color: var(--po-text-secondary);
      border-radius: 6px;
      cursor: pointer;
    }
    .btn-docker-icon:hover { background: rgba(255,255,255,0.08); color: var(--bs-body-color); }

    .btn-docker-action {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--bs-border-color);
      border-radius: 6px;
      background: transparent;
      color: var(--bs-secondary-color);
      font-size: 0.7rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-docker-action:hover { background: rgba(255,255,255,0.06); color: var(--bs-body-color); }

    .btn-docker-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      background: transparent;
      color: var(--po-text-secondary);
      border-radius: 6px;
      cursor: pointer;
    }
    .btn-docker-close:hover { background: rgba(248, 81, 73, 0.12); color: var(--po-error); }

    /* ── Error ── */
    .docker-error-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--po-error-bg);
      color: var(--po-error);
      font-size: 0.8rem;
      border-bottom: 1px solid rgba(248, 81, 73, 0.2);
    }

    /* ── Content ── */
    .docker-content {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .docker-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem;
    }

    /* ── Table ── */
    .docker-table-wrap {
      flex: 1;
      overflow: auto;
    }

    .docker-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }

    .docker-table thead th {
      position: sticky;
      top: 0;
      background: var(--po-bg-2);
      padding: 0.5rem 0.75rem;
      text-align: start;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--bs-secondary-color);
      border-bottom: 1px solid var(--bs-border-color);
    }

    .docker-table tbody tr {
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .docker-table tbody tr:hover {
      background: rgba(255,255,255,0.03);
    }

    .docker-table td {
      padding: 0.5rem 0.75rem;
      vertical-align: middle;
    }

    .col-state { width: 28px; text-align: center; }
    .col-name { font-weight: 600; white-space: nowrap; }
    .col-image { color: var(--bs-secondary-color); white-space: nowrap; }
    .col-status { white-space: nowrap; }
    .col-ports {
      font-family: monospace;
      font-size: 0.72rem;
      color: var(--bs-secondary-color);
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .state-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .dot-running { background: var(--po-success); box-shadow: 0 0 6px rgba(63, 185, 80, 0.5); }
    .dot-exited { background: var(--po-text-secondary); }
    .dot-paused { background: var(--po-warning); }
    .dot-restarting { background: var(--po-warning); box-shadow: 0 0 6px rgba(210, 153, 34, 0.5); }
    .dot-created { background: var(--po-info); }
    .dot-dead { background: var(--po-error); }

    .row-state-running .col-name { color: var(--po-success); }
    .row-state-exited .col-name { color: var(--bs-secondary-color); }

    /* ── Footer ── */
    .docker-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.5rem;
      border-top: 1px solid var(--bs-border-color);
      font-size: 0.72rem;
    }

    /* ── Animations ── */
    .spinning {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `,
})
export class SessionDockerPanelComponent implements OnInit {
  protected docker = inject(DockerService);
  private modal = inject(NgbActiveModal);

  cwd = '';
  showAll = false;

  get visibleContainers(): DockerContainer[] {
    return this.showAll ? this.docker.allContainers() : this.docker.containers();
  }

  ngOnInit(): void {
    this.docker.reset();
    this.docker.loadContainers(this.cwd);
  }

  refresh(): void {
    this.docker.loadContainers(this.cwd);
  }

  close(): void {
    this.docker.reset();
    this.modal.dismiss();
  }
}
