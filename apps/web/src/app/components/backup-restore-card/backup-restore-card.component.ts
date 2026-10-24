import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  ViewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { EscCloseDirective } from "@/app/common/esc-close.directive";

/** Shortest passphrase accepted, in characters (same rule as local_backup.rs). */
export const MIN_BACKUP_PASSPHRASE = 12;

interface ExportSummary {
  records: number;
  collections: number;
  skippedUnreadable: number;
  bytes: number;
}

interface ImportSummary {
  records: number;
  restored: number;
  keptLocal: number;
  createdAt: string;
  previousCopy: string | null;
}

interface BackupBridge {
  localBackupPickFile?: (save: boolean) => Promise<string | null>;
  localBackupExport?: (path: string, passphrase: string) => Promise<ExportSummary>;
  localBackupImport?: (path: string, passphrase: string, mode: "replace" | "merge") => Promise<ImportSummary>;
}

/** Error codes from local_backup.rs that have their own message. */
const KNOWN_ERRORS = [
  "passphrase_too_short",
  "not_a_backup",
  "unsupported_version",
  "unsupported_kdf",
  "wrong_passphrase",
  "store_not_ready",
];

type Dialog = "export" | "import" | null;

/**
 * Settings → Backup & restore: an encrypted copy of the local store, under a
 * passphrase, to move to another computer or recover lost data. The files
 * and the passphrase are handled natively (local_backup.rs); this card only
 * collects the choices.
 */
@Component({
  selector: "app-backup-restore-card",
  standalone: true,
  imports: [FormsModule, TranslateModule, EscCloseDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <p class="br-desc">{{ "BACKUP.Description" | translate }}</p>
    <p class="br-note">
      <iconify-icon icon="solar:lock-keyhole-minimalistic-bold" width="14"></iconify-icon>
      <span>{{ "BACKUP.Included" | translate }}</span>
    </p>
    <div class="br-actions">
      <button type="button" class="btn btn-sm btn-primary" data-qa="backup-export" (click)="openExport()">
        <iconify-icon icon="solar:download-minimalistic-bold-duotone" width="14"></iconify-icon>
        {{ "BACKUP.Export" | translate }}
      </button>
      <button type="button" class="btn btn-sm btn-outline-primary" data-qa="backup-import" (click)="openImport()">
        <iconify-icon icon="solar:upload-minimalistic-bold" width="14"></iconify-icon>
        {{ "BACKUP.Import" | translate }}
      </button>
    </div>
    @if (status(); as s) {
      <div class="br-status" [class.ok]="s.kind === 'ok'" [class.err]="s.kind === 'err'" data-qa="backup-status">
        <iconify-icon [icon]="s.kind === 'ok' ? 'solar:check-circle-bold' : 'solar:close-circle-bold'" width="14"></iconify-icon>
        <span>{{ s.text }}</span>
      </div>
    }

    @if (dialog()) {
      <div #overlay class="br-overlay po-modal-overlay" (click)="close()">
        <form class="br-modal po-modal" role="dialog" aria-modal="true" appEscClose (escClose)="close()" (click)="$event.stopPropagation()" (ngSubmit)="primary()">
          <div class="br-header po-modal-header">
            <span>
              <iconify-icon [icon]="dialog() === 'export' ? 'solar:download-minimalistic-bold-duotone' : 'solar:upload-minimalistic-bold'" width="18"></iconify-icon>
              {{ (dialog() === "export" ? "BACKUP.Export title" : "BACKUP.Import title") | translate }}
            </span>
            <button type="button" class="br-close po-modal-close" [attr.aria-label]="'BUTTONS.Close' | translate" (click)="close()">
              <i class="ti ti-x"></i>
            </button>
          </div>

          <div class="br-body po-modal-body">
            @if (dialog() === "import") {
              @if (imported(); as r) {
                <div class="br-result" data-qa="backup-import-result">
                  <iconify-icon icon="solar:check-circle-bold" width="22"></iconify-icon>
                  <div>
                    <div class="br-result-title">{{ "BACKUP.Restored" | translate: { restored: r.restored, records: r.records } }}</div>
                    @if (r.keptLocal > 0) {
                      <div class="br-hint">{{ "BACKUP.Kept local" | translate: { count: r.keptLocal } }}</div>
                    }
                    @if (r.previousCopy) {
                      <div class="br-hint">{{ "BACKUP.Previous copy" | translate: { path: r.previousCopy } }}</div>
                    }
                    <div class="br-hint">{{ "BACKUP.Reload hint" | translate }}</div>
                  </div>
                </div>
              } @else {
                <div class="br-field">
                  <span class="br-label">{{ "BACKUP.File" | translate }}</span>
                  <div class="br-file">
                    <button type="button" class="btn btn-sm btn-outline-primary" data-qa="backup-choose-file" (click)="chooseFile()" [disabled]="busy()">
                      <iconify-icon icon="solar:folder-open-bold" width="14"></iconify-icon>
                      {{ "BACKUP.Choose file" | translate }}
                    </button>
                    <span class="br-file-name" [title]="importPath">{{ importPath ? fileName(importPath) : ("BACKUP.No file" | translate) }}</span>
                  </div>
                </div>
              }
            }

            @if (!imported()) {
              <label class="br-field">
                <span class="br-label">{{ "BACKUP.Passphrase" | translate }}</span>
                <input
                  type="password"
                  class="form-control form-control-sm"
                  name="passphrase"
                  data-qa="backup-passphrase"
                  autocomplete="new-password"
                  [(ngModel)]="passphrase"
                  [disabled]="busy()"
                />
              </label>
              @if (dialog() === "export") {
                <label class="br-field">
                  <span class="br-label">{{ "BACKUP.Confirm passphrase" | translate }}</span>
                  <input
                    type="password"
                    class="form-control form-control-sm"
                    name="confirm"
                    data-qa="backup-passphrase-confirm"
                    autocomplete="new-password"
                    [(ngModel)]="confirm"
                    [disabled]="busy()"
                  />
                </label>
                <p class="br-hint">{{ "BACKUP.Passphrase hint" | translate: { min: min } }}</p>
              } @else {
                <div class="br-field">
                  <span class="br-label">{{ "BACKUP.Mode" | translate }}</span>
                  <label class="br-choice" [class.active]="mode === 'replace'">
                    <input type="radio" name="mode" value="replace" data-qa="backup-mode-replace" [(ngModel)]="mode" [disabled]="busy()" />
                    <span>
                      <strong>{{ "BACKUP.Mode replace" | translate }}</strong>
                      <span class="br-hint">{{ "BACKUP.Mode replace hint" | translate }}</span>
                    </span>
                  </label>
                  <label class="br-choice" [class.active]="mode === 'merge'">
                    <input type="radio" name="mode" value="merge" data-qa="backup-mode-merge" [(ngModel)]="mode" [disabled]="busy()" />
                    <span>
                      <strong>{{ "BACKUP.Mode merge" | translate }}</strong>
                      <span class="br-hint">{{ "BACKUP.Mode merge hint" | translate }}</span>
                    </span>
                  </label>
                </div>
                <label class="br-confirm">
                  <input type="checkbox" name="understood" data-qa="backup-confirm" [(ngModel)]="understood" [disabled]="busy()" />
                  <span>{{ (mode === "replace" ? "BACKUP.Confirm replace" : "BACKUP.Confirm merge") | translate }}</span>
                </label>
              }
              @if (formError()) {
                <div class="br-status err" data-qa="backup-error">
                  <iconify-icon icon="solar:close-circle-bold" width="14"></iconify-icon>
                  <span>{{ formError() }}</span>
                </div>
              }
            }
          </div>

          <div class="br-footer po-modal-footer">
            @if (imported()) {
              <button type="submit" class="btn btn-sm btn-primary" data-qa="backup-reload">
                <iconify-icon icon="solar:refresh-bold" width="14"></iconify-icon>
                {{ "BACKUP.Reload" | translate }}
              </button>
            } @else {
              <button type="button" class="btn btn-sm btn-outline-secondary" (click)="close()" [disabled]="busy()">
                {{ "BUTTONS.Cancel" | translate }}
              </button>
              <button type="submit" class="btn btn-sm btn-primary" data-qa="backup-submit" [disabled]="busy() || !canSubmit()">
                @if (busy()) {
                  <span class="spinner-border spinner-border-sm" role="status"></span>
                  {{ (dialog() === "export" ? "BACKUP.Exporting" : "BACKUP.Restoring") | translate }}
                } @else {
                  {{ (dialog() === "export" ? "BACKUP.Choose and export" : "BACKUP.Restore") | translate }}
                }
              </button>
            }
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .br-desc {
      font-size: 0.82rem;
      color: var(--promptops-body-color, inherit);
      margin: 0 0 0.5rem;
      line-height: 1.45;
    }
    .br-note {
      display: flex;
      gap: 0.4rem;
      align-items: flex-start;
      font-size: 0.75rem;
      line-height: 1.45;
      color: var(--promptops-secondary-color, #64748b);
      margin: 0 0 0.85rem;
    }
    .br-note iconify-icon { flex-shrink: 0; margin-top: 0.1rem; color: var(--promptops-primary, #6366f1); }
    .br-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .br-actions .btn, .br-file .btn, .br-footer .btn { display: inline-flex; align-items: center; gap: 0.35rem; }
    .br-status {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.75rem;
      padding: 0.3rem 0.55rem;
      border-radius: 8px;
      font-size: 0.76rem;
      font-weight: 500;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .br-status.ok { background: rgba(34, 197, 94, 0.1); color: rgb(21, 128, 61); }
    .br-status.err { background: rgba(239, 68, 68, 0.1); color: rgb(185, 28, 28); }
    :host-context([data-bs-theme="dark"]) .br-status.ok { color: rgb(74, 222, 128); }
    :host-context([data-bs-theme="dark"]) .br-status.err { color: rgb(248, 113, 113); }

    .br-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      z-index: 1060;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .br-modal {
      width: 480px;
      max-width: 100%;
      max-height: calc(100vh - 2rem);
      display: flex;
      flex-direction: column;
      background: var(--promptops-card-bg, #fff);
      color: var(--promptops-body-color, inherit);
      border: 1px solid var(--promptops-border-color, rgba(100, 116, 139, 0.15));
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      overflow: hidden;
    }
    :host-context([data-bs-theme="dark"]) .br-modal { box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45); }
    .br-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--promptops-border-color, rgba(100, 116, 139, 0.1));
      font-size: 0.9rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .br-header > span { display: inline-flex; align-items: center; gap: 0.4rem; }
    .br-header iconify-icon { color: var(--promptops-primary, #6366f1); }
    .br-close {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      color: var(--promptops-secondary-color, #64748b);
      padding: 0.15rem;
    }
    .br-close:hover { color: var(--promptops-danger, #ef4444); }
    .br-body {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      overflow-y: auto;
      min-height: 0;
    }
    .br-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--promptops-border-color, rgba(100, 116, 139, 0.08));
      flex-shrink: 0;
    }
    .br-field { display: flex; flex-direction: column; gap: 0.3rem; margin: 0; }
    .br-label { font-size: 0.78rem; font-weight: 600; }
    .br-hint { display: block; font-size: 0.72rem; line-height: 1.4; color: var(--promptops-secondary-color, #64748b); margin: 0; }
    .br-file { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
    .br-file-name {
      font-size: 0.76rem;
      color: var(--promptops-secondary-color, #64748b);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .br-choice {
      display: flex;
      gap: 0.55rem;
      align-items: flex-start;
      padding: 0.55rem 0.65rem;
      border: 1px solid var(--promptops-border-color, rgba(100, 116, 139, 0.15));
      border-radius: 10px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .br-choice.active {
      border-color: var(--promptops-primary, #6366f1);
      background: rgba(99, 102, 241, 0.06);
    }
    .br-choice input { margin-top: 0.2rem; accent-color: var(--promptops-primary, #6366f1); }
    .br-choice > span { display: flex; flex-direction: column; gap: 0.1rem; }
    .br-confirm { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.76rem; line-height: 1.4; cursor: pointer; }
    .br-confirm input { margin-top: 0.15rem; accent-color: var(--promptops-primary, #6366f1); }
    .br-result { display: flex; gap: 0.6rem; align-items: flex-start; }
    .br-result > iconify-icon { color: rgb(34, 197, 94); flex-shrink: 0; }
    .br-result-title { font-weight: 600; font-size: 0.85rem; margin-bottom: 0.25rem; }
    .br-result .br-hint { overflow-wrap: anywhere; margin-top: 0.15rem; }
  `,
})
export class BackupRestoreCardComponent implements OnDestroy {
  /**
   * The settings cards use backdrop-filter, which makes them the containing
   * block of position: fixed children: the modal would be clipped inside the
   * card. It is moved to <body> while open.
   */
  @ViewChild("overlay") set overlay(ref: ElementRef<HTMLElement> | undefined) {
    this.overlayEl = ref?.nativeElement ?? null;
    if (this.overlayEl) document.body.appendChild(this.overlayEl);
  }
  private overlayEl: HTMLElement | null = null;

  readonly min = MIN_BACKUP_PASSPHRASE;
  readonly dialog = signal<Dialog>(null);
  readonly busy = signal(false);
  readonly formError = signal<string | null>(null);
  readonly status = signal<{ kind: "ok" | "err"; text: string } | null>(null);
  readonly imported = signal<ImportSummary | null>(null);

  passphrase = "";
  confirm = "";
  importPath = "";
  mode: "replace" | "merge" = "replace";
  understood = false;

  private readonly translate = inject(TranslateService);

  private get bridge(): BackupBridge {
    return ((window as { promptops?: BackupBridge }).promptops ?? {}) as BackupBridge;
  }

  openExport(): void {
    this.reset();
    this.dialog.set("export");
  }

  openImport(): void {
    this.reset();
    this.dialog.set("import");
  }

  close(): void {
    if (this.busy() || !this.dialog()) return;
    this.dialog.set(null);
    this.reset();
  }

  canSubmit(): boolean {
    if (this.dialog() === "export") return this.passphrase.length > 0 && this.confirm.length > 0;
    return !!this.importPath && this.passphrase.length > 0 && this.understood;
  }

  fileName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() || path;
  }

  /** Enter (form submit) runs the primary action of the open dialog. */
  async primary(): Promise<void> {
    if (this.imported()) {
      window.location.reload();
      return;
    }
    if (this.busy() || !this.canSubmit()) return;
    if (this.dialog() === "export") await this.runExport();
    else await this.runImport();
  }

  async chooseFile(): Promise<void> {
    const path = await this.bridge.localBackupPickFile?.(false).catch(() => null);
    if (path) this.importPath = path;
  }

  private async runExport(): Promise<void> {
    this.formError.set(null);
    if ([...this.passphrase].length < this.min) {
      this.formError.set(this.t("BACKUP.Too short", { min: this.min }));
      return;
    }
    if (this.passphrase !== this.confirm) {
      this.formError.set(this.t("BACKUP.Mismatch"));
      return;
    }
    const path = await this.bridge.localBackupPickFile?.(true).catch(() => null);
    if (!path) return;
    this.busy.set(true);
    try {
      const s = await this.bridge.localBackupExport!(path, this.passphrase);
      let text = this.t("BACKUP.Exported", { records: s.records, file: this.fileName(path) });
      if (s.skippedUnreadable > 0) text += " " + this.t("BACKUP.Skipped", { count: s.skippedUnreadable });
      this.status.set({ kind: "ok", text });
      this.busy.set(false);
      this.close();
    } catch (e) {
      this.busy.set(false);
      this.formError.set(this.errorText(e));
    }
  }

  private async runImport(): Promise<void> {
    this.formError.set(null);
    this.busy.set(true);
    try {
      const r = await this.bridge.localBackupImport!(this.importPath, this.passphrase, this.mode);
      this.passphrase = "";
      this.imported.set(r);
    } catch (e) {
      this.formError.set(this.errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  private errorText(e: unknown): string {
    const message = String((e as { message?: string })?.message ?? e ?? "");
    const code = message.split(":")[0].trim();
    if (KNOWN_ERRORS.includes(code)) return this.t("BACKUP.Error " + code, { min: this.min });
    return this.t("BACKUP.Error generic", { message });
  }

  ngOnDestroy(): void {
    this.overlayEl?.remove();
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  private reset(): void {
    this.passphrase = "";
    this.confirm = "";
    this.importPath = "";
    this.mode = "replace";
    this.understood = false;
    this.formError.set(null);
    this.imported.set(null);
  }
}
