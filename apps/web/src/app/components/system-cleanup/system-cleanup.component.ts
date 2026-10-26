import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, inject, OnInit, signal, ChangeDetectionStrategy } from "@angular/core";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { SwalService } from "@core/services/swal.service";
import { DesktopBridgeService } from "@/app/views/admin-core/terminal/services/desktop-bridge.service";
import { Store } from "@ngrx/store";
import { firstValueFrom } from "rxjs";
import { getSessions } from "@/store/sessions/session.selectors";
import { getWorkspaces } from "@/store/workspaces/workspace.selectors";
import { RemoteBridgeService } from "@/app/views/admin-core/sessions/services/remote-bridge.service";

/** Storage areas the native audit reports (system_info.rs `entry.area`), translated by id. */
export const AREA_IDS = [
  "semantic-index", "context-snapshots", "webview-cache", "usage-exports", "usage-history",
  "terminal-history", "local-data", "pre-import-copies", "config-backups", "plugin-audit-log",
  "voice-models", "diagnostic-reports", "webview-data",
] as const;

/**
 * What the cleanup may delete: caches and usage exports only, never sessions,
 * settings or history. Used when the audit did not say (older desktop build).
 */
export const DEFAULT_CLEANUP_AREAS = ["semantic-index", "context-snapshots", "webview-cache", "usage-exports"];

export interface StorageAuditEntry {
  area?: string;
  label: string;
  sizeBytes: number;
  overThreshold?: boolean;
  cleanable?: boolean;
}

/** Areas to clean: the ones the audit marks cleanable, else the known safe set. */
export function cleanupAreas(entries: StorageAuditEntry[] | null | undefined): string[] {
  const ids = (entries ?? []).filter((e) => e.cleanable && e.area).map((e) => e.area as string);
  return ids.length ? ids : DEFAULT_CLEANUP_AREAS;
}

/**
 * Disk usage of the app's caches and a one-click cleanup. Sessions and session
 * memory are never touched. Desktop only: everything happens on this device.
 */
@Component({
  selector: "app-system-cleanup",
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <p class="cleanup-desc">{{ 'SECURITY.Cleanup Description' | translate }}</p>

    @if (auditLoading()) {
      <div class="cleanup-loading">
        <span class="spinner-border spinner-border-sm text-primary"></span>
      </div>
    } @else if (auditData()) {
      <div class="cleanup-total">
        <iconify-icon icon="solar:server-bold-duotone" width="16"></iconify-icon>
        {{ 'SECURITY.Storage Used' | translate }}:
        <span class="size-value">{{ formatBytes(auditData().totalBytes) }}</span>
      </div>

      <div class="cleanup-areas">
        @for (entry of auditData().entries; track entry.area ?? entry.label) {
          <div class="area-chip" [class.over-threshold]="entry.overThreshold && entry.cleanable !== false"
               [class.measured-only]="entry.cleanable === false"
               [attr.title]="entry.cleanable === false ? ('SECURITY.Area measured only' | translate) : null">
            <span class="area-label">
              @if (entry.cleanable === false) {
                <iconify-icon icon="solar:lock-keyhole-minimalistic-linear" width="11" aria-hidden="true"></iconify-icon>
              }
              {{ areaLabel(entry) }}
            </span>
            <span class="area-size">{{ formatBytes(entry.sizeBytes) }}</span>
            @if (entry.cleanable === false) {
              <span class="visually-hidden">{{ 'SECURITY.Area measured only' | translate }}</span>
            }
          </div>
        }
      </div>
    }

    <button class="btn-cleanup" [disabled]="cleanupRunning() || auditLoading()" (click)="runCleanup()">
      @if (cleanupRunning()) {
        <span class="spinner-border spinner-border-sm"></span>
      } @else {
        <iconify-icon icon="solar:broom-bold" width="16"></iconify-icon>
      }
      {{ 'SECURITY.Run Cleanup' | translate }}
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .cleanup-desc {
      font-size: 0.78rem;
      color: rgba(100, 116, 139, 0.7);
      line-height: 1.45;
      margin-bottom: 0.75rem;
    }
    .cleanup-loading { padding: 1rem 0; text-align: center; }
    .cleanup-total {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--po-text-secondary, #64748b);
      margin-bottom: 0.75rem;
    }
    .cleanup-total .size-value {
      color: var(--po-accent, var(--po-accent));
      font-size: 0.95rem;
    }
    .cleanup-areas {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    @media (max-width: 640px) {
      .cleanup-areas { grid-template-columns: 1fr 1fr; }
    }
    .area-chip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
      padding: 0.45rem 0.7rem;
      background: rgba(100, 116, 139, 0.04);
      border: 1px solid rgba(100, 116, 139, 0.08);
      border-radius: 8px;
      font-size: 0.75rem;
    }
    .area-chip .area-label { color: var(--po-text-secondary, #64748b); font-weight: 500; }
    .area-chip .area-size { color: var(--po-text-tertiary, #94a3b8); font-weight: 600; font-variant-numeric: tabular-nums; }
    .area-chip.over-threshold { background: rgba(251, 146, 60, 0.06); border-color: rgba(251, 146, 60, 0.2); }
    .area-chip.over-threshold .area-size { color: #f97316; }
    .area-chip.measured-only .area-label { display: inline-flex; align-items: center; gap: 0.25rem; }
    .btn-cleanup {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.55rem 1.25rem;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      background: rgba(251, 146, 60, 0.1);
      color: #ea580c;
      border: 1px solid rgba(251, 146, 60, 0.2);
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-cleanup:hover { background: rgba(251, 146, 60, 0.18); border-color: rgba(251, 146, 60, 0.35); }
    .btn-cleanup:disabled { opacity: 0.5; cursor: not-allowed; }
  `,
})
export class SystemCleanupComponent implements OnInit {
  protected auditLoading = signal<boolean>(false);
  protected cleanupRunning = signal<boolean>(false);
  protected auditData = signal<any>(null);


  private readonly swalService = inject(SwalService);
  private readonly translateService = inject(TranslateService);
  private readonly bridge = inject(DesktopBridgeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store);

  ngOnInit(): void {
    this.loadStorageAudit();
  }

  private async loadStorageAudit(): Promise<void> {
    if (!this.bridge.isDesktop) return;
    this.auditLoading.set(true);
    try {
      this.auditData.set(await this.bridge.storageAudit());
    } catch {
      // The card still offers the cleanup without sizes.
    } finally {
      this.auditLoading.set(false);
    }
  }

  protected async runCleanup(): Promise<void> {
    this.swalService.confirm(
      this.translateService.instant("SECURITY.Cleanup Confirm Title"),
      this.translateService.instant("SECURITY.Cleanup Confirm Message"),
      async () => {
        this.cleanupRunning.set(true);
        try {
          // Never sessions, settings or history: only what the audit marks cleanable.
          const report = await this.bridge.storageCleanup(cleanupAreas(this.auditData()?.entries));
          // Also takes PromptOps hooks out of the provider configs it edited (workspace
          // .claude/settings.local.json, Gemini/Antigravity settings), restoring the user's files.
          const restored = await this.uninstallIntegrations();
          this.auditData.set(await this.bridge.storageAudit());
          const freed = this.translateService.instant("SECURITY.Cleanup Success", { freed: this.formatBytes(report.totalFreedBytes) });
          this.swalService.success(
            restored.length ? `${freed} ${this.translateService.instant("SECURITY.Cleanup Integrations Removed", { count: restored.length })}` : freed
          );
        } catch (err: any) {
          this.swalService.error(err?.message || this.translateService.instant("MESSAGE.Generic error"));
        } finally {
          this.cleanupRunning.set(false);
        }
      },
      // Leaving the page closes the confirmation instead of keeping it over the next one.
      this.destroyRef,
    );
  }

  /** Every workspace folder the app knows: the hooks it installed there are removed. */
  private async uninstallIntegrations(): Promise<string[]> {
    const api = (window as any).promptops;
    if (typeof api?.uninstallIntegrations !== "function") return [];
    const [sessions, workspaces] = await Promise.all([
      firstValueFrom(this.store.select(getSessions)),
      firstValueFrom(this.store.select(getWorkspaces)),
    ]);
    const paths = new Set<string>();
    const remote = new Set<string>();
    for (const w of workspaces ?? []) if (w?.projectPath) paths.add(w.projectPath);
    for (const s of sessions ?? []) {
      const path = s?.workspace?.path ?? s?.deviceWorkspace?.localPath;
      if (path) paths.add(path);
    }
    for (const p of [...paths]) {
      if (RemoteBridgeService.isRemote(p)) { paths.delete(p); remote.add(p); }
    }
    const res = await api.uninstallIntegrations([...paths]);
    const changed: string[] = Array.isArray(res?.changed) ? res.changed : [];
    // Remote sessions: take the helper PromptOps installed on the host back out.
    // A host that is offline is skipped (best effort).
    if (remote.size && typeof api?.remoteBridgeRemove === "function") {
      const results = await Promise.allSettled([...remote].map((cwd) => api.remoteBridgeRemove(cwd)));
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value?.removed) changed.push([...remote][i]);
      });
    }
    return changed;
  }

  /** The native audit sends a stable area id: show it translated, the English label otherwise. */
  protected areaLabel(entry: StorageAuditEntry): string {
    if (entry.area && (AREA_IDS as readonly string[]).includes(entry.area)) {
      return this.translateService.instant(`SECURITY.Area ${entry.area}`);
    }
    return entry.label;
  }

  protected formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }
}
