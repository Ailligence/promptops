import { Injectable, inject } from "@angular/core";
import { NgbModal, NgbModalRef } from "@ng-bootstrap/ng-bootstrap";
import {
  ContextTransferModalComponent,
  ContextTransferModalResult,
} from "@components/context-transfer-modal/context-transfer-modal.component";

interface PromptOpsIpc {
  requestSpawnSubAgent: (request: unknown) => Promise<{
    ok: boolean;
    subAgent?: unknown;
    pendingSpawnId?: string;
    error?: string;
  }>;
  decideContextTransfer: (
    pendingSpawnId: string,
    decision: "transfer" | "skip" | "cancel",
    rememberChoice?: "always" | "never",
  ) => Promise<{ ok: boolean; subAgent?: unknown; canceled?: boolean; error?: string }>;
  listPendingSpawns: () => Promise<{
    ok: boolean;
    pending: Array<{
      id: string;
      fromProvider: string;
      toProvider: string;
      workspacePath: string;
      promptPreview: string;
    }>;
  }>;
  onContextTransferRequired: (
    cb: (
      event: unknown,
      data: {
        pendingSpawnId: string;
        fromProvider: string;
        toProvider: string;
        workspacePath: string;
        promptPreview: string;
      },
    ) => void,
  ) => () => void;
  onContextTransferDone: (
    cb: (
      event: unknown,
      data: { pendingSpawnId: string; success: boolean; skipped: boolean },
    ) => void,
  ) => () => void;
}

function getIpc(): PromptOpsIpc | null {
  const api = (window as unknown as { promptops?: PromptOpsIpc }).promptops;
  return api ?? null;
}

/**
 * Listens for the main-process push event
 * `subagent:context-transfer-required` and opens the context-transfer modal.
 *
 * The user's prompt is always safe in main-process memory (SubAgentSpawnQueue),
 * so if the window is closed or refreshed, we recover via `listPendingSpawns()`
 * and re-open the modal.
 */
@Injectable({ providedIn: "root" })
export class ContextTransferService {
  private modalService = inject(NgbModal);
  private unsubRequired: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;
  private openModals = new Map<string, NgbModalRef>();

  /** Called once from AppComponent on init (after desktop detection). */
  start(): void {
    const api = getIpc();
    if (!api) return;

    this.unsubRequired = api.onContextTransferRequired((_ev, data) => {
      this.openModalFor(data);
    });

    this.unsubDone = api.onContextTransferDone((_ev, data) => {
      // If a modal is still open for that pending id (e.g. external completion),
      // dismiss it so we don't linger.
      const ref = this.openModals.get(data.pendingSpawnId);
      if (ref) {
        try {
          ref.dismiss();
        } catch {
          /* already closed */
        }
        this.openModals.delete(data.pendingSpawnId);
      }
    });

    // Recovery after refresh: replay any pending that arrived while the
    // renderer was reloading.
    void api.listPendingSpawns().then((resp) => {
      if (!resp?.ok) return;
      for (const p of resp.pending) {
        if (!this.openModals.has(p.id)) {
          this.openModalFor({
            pendingSpawnId: p.id,
            fromProvider: p.fromProvider,
            toProvider: p.toProvider,
            workspacePath: p.workspacePath,
            promptPreview: p.promptPreview,
          });
        }
      }
    }).catch(() => { /* nothing to replay */ });
  }

  stop(): void {
    this.unsubRequired?.();
    this.unsubDone?.();
    this.unsubRequired = null;
    this.unsubDone = null;
    for (const [, ref] of this.openModals) {
      try {
        ref.dismiss();
      } catch {
        /* noop */
      }
    }
    this.openModals.clear();
  }

  // ── Private ──────────────────────────────────────────────────────

  private openModalFor(data: {
    pendingSpawnId: string;
    fromProvider: string;
    toProvider: string;
    workspacePath: string;
    promptPreview: string;
  }): void {
    const ref = this.modalService.open(ContextTransferModalComponent, {
      centered: true,
      backdrop: "static",
      keyboard: false,
      windowClass: "ctx-transfer-modal-window",
    });
    const instance = ref.componentInstance as ContextTransferModalComponent;
    instance.fromProvider = data.fromProvider;
    instance.toProvider = data.toProvider;
    instance.workspacePath = data.workspacePath;
    instance.promptPreview = data.promptPreview;

    this.openModals.set(data.pendingSpawnId, ref);

    ref.result
      .then((result: ContextTransferModalResult | undefined) => {
        this.openModals.delete(data.pendingSpawnId);
        if (!result) return;
        void this.forwardDecision(data.pendingSpawnId, result);
      })
      .catch(() => {
        // Dismissed — treat as cancel (no spawn)
        this.openModals.delete(data.pendingSpawnId);
        void this.forwardDecision(data.pendingSpawnId, { decision: "cancel" });
      });
  }

  private async forwardDecision(
    pendingSpawnId: string,
    result: ContextTransferModalResult,
  ): Promise<void> {
    const api = getIpc();
    if (!api) return;
    try {
      await api.decideContextTransfer(pendingSpawnId, result.decision, result.rememberChoice);
    } catch (err) {
      console.error("[ContextTransferService] Failed to forward decision:", err);
    }
  }
}
