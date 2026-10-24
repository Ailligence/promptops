import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  computed,
  inject,
  Input,
  OnDestroy,
  OnInit,
  signal,
  QueryList,
  ViewChildren,
  ChangeDetectionStrategy
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Subscription } from 'rxjs';
import { TerminalManagerService } from '../services/terminal-manager.service';
import { DesktopBridgeService } from '../services/desktop-bridge.service';
import { TerminalInstanceComponent } from '../terminal-instance/terminal-instance.component';
import { DesktopDownloadCtaComponent } from '@components/desktop-download-cta/desktop-download-cta.component';
import { SwalService } from '@core/services/swal.service';

@Component({
  selector: 'app-terminal-view',
  standalone: true,
  imports: [TerminalInstanceComponent, TranslateModule, DesktopDownloadCtaComponent],
  templateUrl: './terminal-view.component.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .terminal-page {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 70px);
      background: var(--bs-body-bg, #0d1117);
    }

    /* ── Header ── */
    .terminal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem 0.75rem;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .terminal-title {
      font-size: 1.25rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0;
    }
    .header-actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .btn-icon-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid var(--bs-border-color, #30363d);
      color: var(--bs-secondary-color, #8b949e);
      padding: 0.25rem 0.45rem;
      line-height: 1;
      margin-left: 0.25rem;
    }
    .btn-icon-close:hover {
      background: var(--po-error-bg, rgba(248, 81, 73, 0.12));
      color: var(--bs-danger, #f85149);
      border-color: var(--bs-danger, #f85149);
    }

    /* ── Empty state ── */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 24px 16px;
      text-align: center;
    }
    .empty-state-icon { color: var(--po-text-tertiary); }
    .empty-title {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--po-text-secondary);
    }
    .empty-hint {
      font-size: 0.75rem;
      color: var(--po-text-tertiary);
      max-width: 240px;
      line-height: 1.4;
    }

    /* ── Tab bar ── */
    .terminal-tabs {
      display: flex;
      background: var(--bs-tertiary-bg, #161b22);
      border-bottom: 1px solid var(--bs-border-color, #30363d);
      padding: 0 0.75rem;
      overflow-x: auto;
    }
    .terminal-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0.5rem 0.75rem;
      font-size: 0.82rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--bs-secondary-color, #8b949e);
      white-space: nowrap;
      transition: all 0.15s;
    }
    .terminal-tab:hover {
      color: var(--bs-body-color, #c9d1d9);
    }
    .terminal-tab.active {
      color: var(--bs-primary, #58a6ff);
      border-bottom-color: var(--bs-primary, #58a6ff);
    }
    .tab-close {
      background: none;
      border: none;
      padding: 0;
      color: inherit;
      opacity: 0.5;
      cursor: pointer;
      line-height: 1;
    }
    .tab-close:hover {
      opacity: 1;
      color: var(--bs-danger, #f85149);
    }

    /* ── Panels ── */
    .terminal-panels {
      flex: 1;
      position: relative;
      overflow: hidden;
    }
    .terminal-panel {
      position: absolute;
      inset: 0;
      display: none;
    }
    .terminal-panel.active {
      display: flex;
      flex-direction: column;
    }

    /* Split mode */
    .terminal-panels.split {
      display: flex;
      flex-direction: row;
      position: relative;
    }
    .terminal-panels.split .terminal-panel {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--bs-border-color, #30363d);
    }
    .terminal-panels.split .terminal-panel:last-child {
      border-right: none;
    }
    .split-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      background: var(--bs-tertiary-bg, #161b22);
      border-bottom: 1px solid var(--bs-border-color, #30363d);
      font-size: 0.8rem;
      color: var(--bs-secondary-color, #8b949e);
    }
    .split-label { font-weight: 600; }

    app-terminal-instance {
      flex: 1;
      min-height: 0;
    }
  `,
})
export class TerminalViewComponent implements OnInit, OnDestroy {
  protected manager = inject(TerminalManagerService);
  protected bridge = inject(DesktopBridgeService);
  private route = inject(ActivatedRoute);
  private swal = inject(SwalService);
  private translate = inject(TranslateService);
  // Present only when this component is mounted as the content of an NgbModal.
  protected activeModal = inject(NgbActiveModal, { optional: true });

  @ViewChildren(TerminalInstanceComponent) terminalInstances!: QueryList<TerminalInstanceComponent>;

  /**
   * Owning session. Terminals are bucketed by this id in TerminalManagerService
   * so each session has its own independent list of open shells. When mounted
   * via the legacy route (no session context) this falls back to a shared
   * 'default' bucket.
   */
  @Input() sessionId: string = 'default';

  /**
   * Initial working directory. Set by the parent when this component is
   * mounted inside an NgbModal (where no active route is available to read
   * query params from). Also used as the default cwd for terminals spawned
   * later via the "New Terminal" button. Falls back to the `cwd` query param
   * when null and no modal is active.
   */
  @Input() initialCwd: string | null = null;

  /** Tabs and active id for the owning session — reactive via signal. */
  protected tabs = computed(() => this.manager.tabsForSession(this.sessionId));
  protected activeId = computed(() => this.manager.activeIdForSession(this.sessionId));

  splitMode = signal(false);
  private querySub?: Subscription;

  /** True when this component is rendered as a modal (vs standalone page). */
  protected get isModal(): boolean {
    return this.activeModal !== null;
  }

  ngOnInit(): void {
    this.manager.init();

    // Only auto-create the first terminal when the session has none yet:
    // reopening the modal on a session with existing terminals must restore
    // them, not spawn duplicates.
    if (this.tabs().length === 0 && this.initialCwd) {
      this.createTerminalInFolder(this.initialCwd);
      return;
    }

    if (this.tabs().length === 0) {
      this.querySub = this.route.queryParams.subscribe((params) => {
        const cwd = params['cwd'];
        if (cwd) {
          this.createTerminalInFolder(cwd);
        }
      });
    }
  }

  ngOnDestroy(): void {
    // Note: do NOT call manager.destroy() — the manager is a root singleton
    // shared across sessions and must keep its IPC subscription alive so
    // terminals continue receiving output while this modal is closed.
    this.querySub?.unsubscribe();
  }

  private async createTerminalInFolder(cwd: string): Promise<void> {
    await this.openAndFocus({ sessionId: this.sessionId, cwd });
  }

  async newTerminal(): Promise<void> {
    await this.openAndFocus({
      sessionId: this.sessionId,
      ...(this.initialCwd ? { cwd: this.initialCwd } : {}),
    });
  }

  /** Opens a terminal and focuses it; a refused open (remote session, no
   * shell, PTY limit) is shown instead of failing silently. */
  private async openAndFocus(opts: { sessionId: string; cwd?: string }): Promise<void> {
    let id: string;
    try {
      id = await this.manager.create(opts);
    } catch (e) {
      this.swal.error(e instanceof Error ? e.message : String(e));
      return;
    }
    setTimeout(() => {
      const instance = this.terminalInstances?.find((t) => t.terminalId === id);
      instance?.focus();
    }, 50);
  }

  closeModal(): void {
    this.activeModal?.dismiss('user');
  }

  activate(id: string): void {
    this.manager.activate(this.sessionId, id);
    setTimeout(() => {
      const instance = this.terminalInstances?.find((t) => t.terminalId === id);
      instance?.focus();
    }, 50);
  }

  close(id: string, event?: Event): void {
    event?.stopPropagation();
    this.manager.close(this.sessionId, id);
  }

  killAll(): void {
    // Destructive: closing the tabs kills every running PTY (SIGKILL fallback),
    // so any active command or agent is terminated. Confirm before proceeding.
    this.swal.confirmDanger(
      this.translate.instant('TERMINAL_PAGE.Kill all confirm title'),
      this.translate.instant('TERMINAL_PAGE.Kill all confirm message'),
      () => void this.manager.closeAll(this.sessionId),
    );
  }

  toggleSplit(): void {
    this.splitMode.update((v) => !v);
    // Re-fit all visible terminals
    setTimeout(() => {
      this.terminalInstances?.forEach((t) => t.focus());
    }, 50);
  }
}
