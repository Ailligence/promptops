import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  HostListener,
  inject,
  Input,
  signal,
  ViewChild,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Store } from '@ngrx/store';

import { TooltipDirective } from '../../common/tooltip.directive';

import { SessionSummary } from '@/store/sessions/session.state';
import { getActiveSession } from '@/store/sessions/session.selectors';
import { setActiveSession } from '@/store/sessions/session.actions';
import { SwalService } from '@core/services/swal.service';

import { CloudFeatureModalComponent } from '@components/cloud-feature-modal/cloud-feature-modal.component';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TodoStoreService, TodoItem } from '../../views/admin-core/sessions/services/todo-store.service';
import { PromptInjectionService } from '../../views/admin-core/sessions/services/prompt-injection.service';
import { SubAgentService } from '../../views/admin-core/sessions/services/sub-agent.service';

/**
 * Quick TODO list for a session — a lightweight checklist where each item is a
 * thought or a prompt to run later. Each item can be INJECTED into the active
 * session's terminal or SPAWNED as a sub-agent. Team boards are part of
 * PromptOps Desktop: the Board tab shows them locked.
 *
 * Storage is LOCAL only (localStorage via {@link TodoStoreService}) because an
 * item's text may be a full prompt — those are never stored outside localStorage.
 *
 * Modeled on AddNoteModalComponent (imperative open()/close(), @ViewChild from
 * the session view). Trigger lives in the session header (minimal UI only).
 */
@Component({
  selector: 'app-todo-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule, TooltipDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (visible()) {
      <div class="todo-modal-overlay po-modal-overlay" (click)="close()">
        <div class="todo-modal po-modal" role="dialog" aria-modal="true" [attr.aria-label]="'TODOS.Title' | translate" (click)="$event.stopPropagation()">
          <div class="todo-modal-header po-modal-header">
            <span><i class="ti ti-list-check"></i> {{ 'TODOS.Title' | translate }}</span>
            <button class="close-btn po-modal-close" (click)="close()" [attr.aria-label]="'BUTTONS.Close' | translate"><i class="ti ti-x"></i></button>
          </div>

          <!-- Tabs -->
          <div class="todo-tabs">
            <button class="todo-tab" [class.active]="tab() === 'todo'" (click)="tab.set('todo')">
              <i class="ti ti-checklist"></i> {{ 'TODOS.List' | translate }}
              @if (items().length) { <span class="tab-count">{{ openCount() }}</span> }
            </button>
            <button class="todo-tab" (click)="switchToBoard()" [appTooltip]="'CLOUD.Locked tooltip' | translate">
              <i class="ti ti-layout-kanban"></i> {{ 'TODOS.Board' | translate }}
            </button>
          </div>

          <!-- ── TODO tab ── -->
          @if (tab() === 'todo') {
            <div class="todo-modal-body po-modal-body">
              <div class="todo-add-row">
                <input
                  #newInput
                  class="todo-input"
                  [(ngModel)]="newText"
                  (keydown.enter)="addItem()"
                  [placeholder]="'TODOS.Placeholder' | translate"
                  [attr.aria-label]="'TODOS.Placeholder' | translate"
                />
                <button class="btn-add" (click)="addItem()" [disabled]="!newText.trim()" [appTooltip]="'TODOS.Add' | translate" [attr.aria-label]="'TODOS.Add' | translate">
                  <i class="ti ti-plus"></i>
                </button>
              </div>

              @if (items().length === 0) {
                <div class="todo-empty">
                  <i class="ti ti-clipboard-list"></i>
                  <span>{{ 'TODOS.Empty' | translate }}</span>
                </div>
              } @else {
                <div class="todo-list">
                  @for (item of items(); track item.id) {
                    <div class="todo-item" [class.done]="item.done">
                      <input type="checkbox" class="todo-check" [checked]="item.done" (change)="toggleDone(item)" [attr.aria-label]="item.text" />
                      <span class="todo-text">{{ item.text }}</span>
                      <div class="todo-actions">
                        <button
                          class="act inject"
                          [disabled]="busyId() === item.id"
                          (click)="injectItem(item)"
                          [appTooltip]="'TODOS.Inject' | translate"
                          [attr.aria-label]="'TODOS.Inject' | translate"
                        >
                          <i class="ti ti-arrow-bar-to-right"></i>
                        </button>
                        <button
                          class="act spawn"
                          [disabled]="busyId() === item.id"
                          (click)="spawnItem(item)"
                          [appTooltip]="'TODOS.Spawn' | translate"
                          [attr.aria-label]="'TODOS.Spawn' | translate"
                        >
                          <i class="ti ti-robot"></i>
                        </button>
                        <button class="act del" (click)="removeItem(item)" [appTooltip]="'TODOS.Delete' | translate" [attr.aria-label]="'TODOS.Delete' | translate">
                          <i class="ti ti-trash"></i>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }

        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    /* Frame: colors/padding come from the shared po-modal-* contract (minimal). */
    .todo-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);
      z-index: 1050; display: flex; align-items: center; justify-content: center;
    }
    .todo-modal {
      width: 560px; max-width: 92vw; max-height: 82vh;
      display: flex; flex-direction: column;
      background: var(--po-bg-1); border-radius: var(--po-radius-xl); overflow: hidden;
    }
    .todo-modal-header { display: flex; align-items: center; justify-content: space-between; }
    .todo-modal-header > span { display: inline-flex; align-items: center; gap: 8px; }

    .todo-tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--po-border-subtle); }
    .todo-tab {
      display: flex; align-items: center; gap: 6px;
      background: none; border: none; cursor: pointer;
      padding: 8px 10px; font-size: 13px; font-weight: 600;
      color: var(--po-text-secondary); border-bottom: 2px solid transparent;
    }
    .todo-tab:hover { color: var(--po-text-primary); }
    .todo-tab.active { color: var(--po-accent); border-bottom-color: var(--po-accent); }
    .tab-count {
      min-width: 18px; padding: 1px 6px; border-radius: 10px; text-align: center;
      font-size: 10.5px; font-weight: 700; background: var(--po-bg-3); color: var(--po-text-secondary);
    }

    .todo-modal-body { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }

    .todo-add-row { display: flex; gap: 6px; }
    .todo-input { flex: 1; min-width: 0; }
    .btn-add {
      display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
      width: 34px; height: 34px; border: none; border-radius: var(--po-radius-md);
      background: var(--po-accent); color: var(--po-accent-on, #fff); cursor: pointer; font-size: 1rem;
    }
    .btn-add:hover { background: var(--po-accent-hover); }
    .btn-add:disabled { opacity: 0.5; cursor: not-allowed; }

    .todo-empty {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 24px 16px; color: var(--po-text-tertiary); font-size: 12.5px;
      border: 1px dashed var(--po-border-subtle); border-radius: var(--po-radius-lg);
    }
    .todo-empty i { font-size: 1.5rem; opacity: 0.6; }

    .todo-list { display: flex; flex-direction: column; gap: 6px; }
    .todo-item {
      display: flex; align-items: center; gap: 10px; min-height: 40px;
      padding: 6px 8px 6px 12px; border-radius: var(--po-radius-md);
      border: 1px solid var(--po-border-subtle); background: var(--po-bg-2);
    }
    .todo-item:hover { background: var(--po-bg-3); }
    .todo-check { width: 15px; height: 15px; cursor: pointer; accent-color: var(--po-accent); flex: 0 0 auto; }
    .todo-text { flex: 1; font-size: 13px; line-height: 1.4; word-break: break-word; white-space: pre-wrap; }
    .todo-item.done .todo-text { text-decoration: line-through; opacity: 0.5; }
    .status-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; background: var(--po-text-tertiary); }
    .status-dot[data-status="todo"] { background: var(--po-accent); }
    .status-dot[data-status="in_progress"] { background: var(--po-warning); }
    .status-dot[data-status="in_review"] { background: #8b5cf6; }
    .status-dot[data-status="done"] { background: var(--po-success); }

    .todo-actions { display: flex; gap: 2px; flex: 0 0 auto; }
    .act {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--po-radius-md);
      background: none; cursor: pointer; font-size: 0.9rem; color: var(--po-text-secondary); line-height: 1;
    }
    .act:hover { background: var(--po-bg-4, var(--po-bg-3)); color: var(--po-text-primary); }
    .act.del:hover { color: var(--po-error); }
    .act:disabled { opacity: 0.4; cursor: not-allowed; }
  `,
})
export class TodoModalComponent {
  /** The session this TODO list belongs to (scope key + inject/spawn target). */
  @Input() session?: SessionSummary;

  visible = signal(false);
  tab = signal<'todo'>('todo');
  items = signal<TodoItem[]>([]);
  newText = '';
  busyId = signal<string | null>(null);

  @ViewChild('newInput') newInputRef?: ElementRef<HTMLInputElement>;

  private readonly store = inject(Store);
  private readonly todoStore = inject(TodoStoreService);
  private readonly promptInjection = inject(PromptInjectionService);
  private readonly subAgentService = inject(SubAgentService);
  private readonly swalService = inject(SwalService);
  private readonly modalService = inject(NgbModal);
  private readonly translate = inject(TranslateService);

  openCount(): number {
    return this.items().filter((i) => !i.done).length;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible()) this.close();
  }

  open(): void {
    if (!this.session) return;
    this.tab.set('todo');
    this.newText = '';
    this.items.set(this.todoStore.read(this.session));
    this.visible.set(true);
    // Explicit focus — `autofocus` does not fire reliably for @if-mounted
    // elements in the webview, and keystrokes would leak to the terminal.
    setTimeout(() => this.newInputRef?.nativeElement?.focus(), 0);
  }

  close(): void {
    this.visible.set(false);
  }

  // ── TODO list ──────────────────────────────────────────────────────

  addItem(): void {
    const text = this.newText.trim();
    if (!text) return;
    const item: TodoItem = { id: this.uid(), text, done: false, createdAt: Date.now() };
    this.items.update((list) => [...list, item]);
    this.newText = '';
    this.flush();
    setTimeout(() => this.newInputRef?.nativeElement?.focus(), 0);
  }

  toggleDone(item: TodoItem): void {
    this.items.update((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    this.flush();
  }

  removeItem(item: TodoItem): void {
    this.items.update((list) => list.filter((i) => i.id !== item.id));
    this.flush();
  }

  async injectItem(item: TodoItem): Promise<void> {
    await this.doInject(item.id, item.text);
  }

  async spawnItem(item: TodoItem): Promise<void> {
    await this.doSpawn(item.id, item.text);
  }

  // ── Board ──────────────────────────────────────────────────────────

  /** Team boards are part of PromptOps Desktop. */
  switchToBoard(): void {
    CloudFeatureModalComponent.open(this.modalService, 'teams');
  }

  // ── shared inject/spawn ────────────────────────────────────────────

  private async doInject(busyId: string, text: string): Promise<void> {
    const session = this.targetSession();
    if (!session) {
      this.swalService.error(this.translate.instant('TODOS.No active session'));
      return;
    }
    this.busyId.set(busyId);
    try {
      this.store.dispatch(setActiveSession({ sessionId: session.id }));
      const ok = await this.promptInjection.injectIntoSession(session, text);
      if (ok) this.toast('TODOS.Injected');
      else this.swalService.error(this.translate.instant('TODOS.Inject failed'));
    } catch {
      // A wake or a write that throws: same message as a refused injection,
      // never an unhandled rejection out of the click handler.
      this.swalService.error(this.translate.instant('TODOS.Inject failed'));
    } finally {
      this.busyId.set(null);
    }
  }

  private async doSpawn(busyId: string, text: string, titleOverride?: string): Promise<void> {
    const session = this.targetSession();
    if (!session) {
      this.swalService.error(this.translate.instant('TODOS.No active session'));
      return;
    }
    this.busyId.set(busyId);
    try {
      const title = this.truncate(titleOverride || text, 60);
      const spawned = await this.subAgentService.spawnCustom(session.id, 'todo', title, text);
      // null = a cross-provider context-transfer modal is pending; the agent
      // arrives asynchronously via the SUBAGENT_CREATED push — still a success.
      this.toast('TODOS.Spawned');
      void spawned;
    } catch (err: any) {
      this.swalService.error(err?.message || this.translate.instant('MESSAGE.Generic error'));
    } finally {
      this.busyId.set(null);
    }
  }

  /** Prefer the live active session; fall back to the one this modal opened for. */
  private targetSession(): SessionSummary | null {
    let active: SessionSummary | null = null;
    this.store.select(getActiveSession).subscribe((s) => (active = s)).unsubscribe();
    return active ?? this.session ?? null;
  }

  private flush(): void {
    if (this.session) this.todoStore.save(this.session, this.items());
  }

  private truncate(text: string, max: number): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
  }

  private toast(key: string): void {
    this.swalService.autoClose(this.translate.instant(key), '');
  }

  private uid(): string {
    try {
      return (crypto as any)?.randomUUID?.() ?? 't-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    } catch {
      return 't-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    }
  }
}
