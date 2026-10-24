import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { FolderAccessService } from '@core/services/folder-access.service';

/**
 * Global banner shown when macOS TCC denies access to a session folder
 * (Documents/Desktop/Downloads). The affected sessions are parked in standby
 * by the main process; this banner guides the user to System Settings and
 * offers a Retry that re-probes and wakes them — no app restart needed.
 * Styled on the force-update-modal error banner.
 */
@Component({
  selector: 'app-folder-access-modal',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (svc.info().denied && !svc.info().dismissed) {
      <div class="update-banner folder-access-banner" role="alert">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <iconify-icon icon="solar:folder-error-bold-duotone" width="20" style="color: #dc2626;" aria-hidden="true"></iconify-icon>
          <span>
            <strong>{{ 'FOLDER_ACCESS.Title' | translate }}</strong>
            — {{ 'FOLDER_ACCESS.Blocking' | translate }}
            @for (root of svc.info().deniedRoots; track root) {
              <code class="folder-access-root">{{ root }}</code>
            }
          </span>
          <button class="btn btn-sm btn-primary ms-2" (click)="svc.openSettings(); $event.stopPropagation()">
            <iconify-icon icon="solar:settings-bold" width="16"></iconify-icon>
            {{ 'FOLDER_ACCESS.Open settings' | translate }}
          </button>
          <button class="btn btn-sm btn-outline-danger" [disabled]="svc.info().retrying" (click)="svc.retry(); $event.stopPropagation()">
            @if (svc.info().retrying) {
              <span class="spinner-border spinner-border-sm me-1" role="status"></span>
            }
            {{ 'FOLDER_ACCESS.Retry' | translate }}
          </button>
          <button class="btn btn-sm btn-link text-muted ms-auto" (click)="svc.dismiss(); $event.stopPropagation()"
                  [attr.aria-label]="'BUTTONS.Close' | translate" [title]="'BUTTONS.Close' | translate">
            <iconify-icon icon="solar:close-circle-linear" width="18"></iconify-icon>
          </button>
          <div class="w-100 mt-1 folder-access-hint">
            @if (svc.info().parkedSessionIds.length === 1) {
              {{ 'FOLDER_ACCESS.Parked one' | translate }}
            } @else if (svc.info().parkedSessionIds.length > 1) {
              {{ 'FOLDER_ACCESS.Parked many' | translate: { count: svc.info().parkedSessionIds.length } }}
            }
            {{ 'FOLDER_ACCESS.Steps' | translate }}
          </div>
          @if (svc.info().translocated) {
            <div class="w-100 folder-access-hint folder-access-warn">
              {{ 'FOLDER_ACCESS.Translocated' | translate }}
            </div>
          }
          @if (svc.hasPosixDenial) {
            <div class="w-100 folder-access-hint folder-access-warn">
              {{ 'FOLDER_ACCESS.Posix' | translate }}
              <code>ls -led &lt;folder&gt;</code>
            </div>
          }
          <div class="w-100 folder-access-hint d-flex align-items-center gap-2 flex-wrap">
            <span>{{ 'FOLDER_ACCESS.Granted but blocked' | translate }}</span>
            @if (svc.canRelaunch) {
              <button class="btn btn-sm btn-outline-secondary folder-access-hint-btn" (click)="svc.relaunch(); $event.stopPropagation()">
                {{ 'FOLDER_ACCESS.Restart' | translate }}
              </button>
            }
            @if (svc.canResetPermissions) {
              <button class="btn btn-sm btn-outline-secondary folder-access-hint-btn" [disabled]="svc.info().retrying" (click)="svc.resetPermissions(); $event.stopPropagation()">
                {{ 'FOLDER_ACCESS.Reset permissions' | translate }}
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .update-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      padding: 10px 20px;
      font-size: 0.88rem;
      /* Fixed light background; force dark text so it stays readable under
         the minimal dark skin (which makes body text light). */
      color: #1e293b;
    }

    .update-banner strong { color: #111827; }
    .update-banner .text-muted { color: #6b7280 !important; }

    .folder-access-banner {
      background: #fef2f2;
      border-bottom: 1px solid #fca5a5;
      cursor: default;
    }

    .folder-access-root {
      font-size: 0.78rem;
      background: #f3f4f6;
      color: #b91c1c;
      padding: 2px 6px;
      border-radius: 4px;
      margin-inline-start: 4px;
      word-break: break-all;
    }

    .folder-access-hint {
      font-size: 0.78rem;
      color: #6b7280;
    }

    .folder-access-hint-btn {
      font-size: 0.75rem;
      padding: 1px 8px;
    }

    .folder-access-warn {
      color: #b45309;
    }

    .folder-access-warn code {
      font-size: 0.75rem;
      color: #92400e;
    }
  `],
})
export class FolderAccessModalComponent implements OnInit {
  svc = inject(FolderAccessService);

  ngOnInit(): void {
    this.svc.init();
  }
}
