import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ViewChild,
  TemplateRef,
  ApplicationRef,
  EmbeddedViewRef,
  DOCUMENT,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  CdkDragDrop,
  CdkDrag,
  CdkDropList,
  CdkDragHandle,
  CdkDragPlaceholder,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { QuickAccessService } from './quick-access.service';
import { IconPickerComponent } from './icon-picker/icon-picker.component';
import { PromptPickerModalComponent } from './prompt-picker-modal/prompt-picker-modal.component';
import { MenuShortcutInterface } from '@core/interfaces/menu-shortcut.interface';
import { SessionService } from '../../../views/admin-core/sessions/services/session.service';
import { WorkspaceApiService } from '../../../views/admin-core/sessions/services/workspace-api.service';
import { WorkspaceSummary } from '@/store/workspaces/workspace.state';
import { firstValueFrom } from 'rxjs';
import { EscCloseDirective } from '../../../common/esc-close.directive';
import { Store } from '@ngrx/store';
import { openSessionTarget } from '../../open-session-target';

@Component({
  selector: 'app-quick-access',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslateModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
    IconPickerComponent,
    PromptPickerModalComponent,
    EscCloseDirective,
  ],
  templateUrl: './quick-access.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './quick-access.component.scss',
})
export class QuickAccessComponent implements OnInit, OnDestroy {
  private quickAccessService = inject(QuickAccessService);
  protected sessionService = inject(SessionService);
  private workspaceApi = inject(WorkspaceApiService);
  private router = inject(Router);
  private appRef = inject(ApplicationRef);
  private document = inject(DOCUMENT);
  private store = inject(Store);

  @ViewChild('sessionPickerTpl') sessionPickerTpl!: TemplateRef<any>;
  private sessionPickerViewRef: EmbeddedViewRef<any> | null = null;

  editMode = signal(false);
  showPromptPicker = signal(false);
  showSessionPicker = signal(false);
  showIconPicker = signal(false);
  editingShortcutId = signal<number | null>(null);
  liveSessions = signal<any[]>([]);
  liveWorkspaces = signal<WorkspaceSummary[]>([]);

  shortcuts = this.quickAccessService.shortcuts;
  loading = this.quickAccessService.loading;

  excludedPromptIds = computed(() =>
    this.shortcuts().map((s) => s.prompt_id)
  );

  ngOnInit(): void {
    this.quickAccessService.loadShortcuts();
  }

  ngOnDestroy(): void {
    this.destroySessionPicker();
  }

  private showSessionPickerPortal(): void {
    if (this.sessionPickerViewRef) return;
    this.sessionPickerViewRef = this.sessionPickerTpl.createEmbeddedView(null);
    this.appRef.attachView(this.sessionPickerViewRef);
    const domElement = this.sessionPickerViewRef.rootNodes[0] as HTMLElement;
    this.document.body.appendChild(domElement);
  }

  private destroySessionPicker(): void {
    if (this.sessionPickerViewRef) {
      this.appRef.detachView(this.sessionPickerViewRef);
      this.sessionPickerViewRef.destroy();
      this.sessionPickerViewRef = null;
    }
  }

  closeSessionPicker(): void {
    this.showSessionPicker.set(false);
    this.destroySessionPicker();
  }

  toggleEditMode(): void {
    this.editMode.update((v) => !v);
    // Close pickers when exiting edit mode
    if (!this.editMode()) {
      this.showIconPicker.set(false);
      this.editingShortcutId.set(null);
    }
  }

  /** A session or workspace shortcut: opens that session (a workspace opens its oldest session). */
  openTarget(shortcut: MenuShortcutInterface): void {
    if (!shortcut.target_id || (shortcut.type !== 'session' && shortcut.type !== 'workspace')) return;
    void openSessionTarget(this.router, this.store, shortcut.type, shortcut.target_id);
  }

  navigateToPrompt(shortcut: MenuShortcutInterface): void {
    if (!this.editMode()) {
      this.router.navigate(['/admin/prompt-library', shortcut.prompt_id]);
    }
  }

  onDrop(event: CdkDragDrop<MenuShortcutInterface[]>): void {
    const items = [...this.shortcuts()];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    this.quickAccessService.shortcuts.set(items);
    this.quickAccessService.reorder(items.map((s) => s.id));
  }

  removeShortcut(shortcut: MenuShortcutInterface): void {
    if (shortcut.type === 'session' || shortcut.type === 'workspace') {
      this.quickAccessService.removeSessionShortcut(shortcut.id);
    } else {
      this.quickAccessService.removeShortcut(shortcut.id);
    }
  }

  openPromptPicker(): void {
    this.showPromptPicker.set(true);
  }

  async openSessionPicker(): Promise<void> {
    if (!this.sessionService.isDesktop) return;
    try {
      const [sessions, workspaces] = await Promise.all([
        this.sessionService.listSessions(),
        firstValueFrom(this.workspaceApi.list()),
      ]);
      // Only show standalone sessions (not bound to a workspace)
      this.liveSessions.set(sessions.filter((s) => !s.workspaceId));
      this.liveWorkspaces.set(workspaces);
    } catch {
      this.liveSessions.set([]);
      this.liveWorkspaces.set([]);
    }
    this.showSessionPicker.set(true);
    this.showSessionPickerPortal();
  }

  onPromptSelected(event: { promptId: number; label: string }): void {
    this.quickAccessService.addShortcut(event.promptId, event.label);
    this.showPromptPicker.set(false);
  }

  onSessionSelected(session: any): void {
    this.quickAccessService.addSessionShortcut(session.id, session.name || session.id.substring(0, 8));
    this.closeSessionPicker();
  }

  onWorkspaceSelected(workspace: WorkspaceSummary): void {
    this.quickAccessService.addSessionShortcut(workspace.id, workspace.name, 'workspace');
    this.closeSessionPicker();
  }

  openIconPicker(shortcut: MenuShortcutInterface): void {
    this.editingShortcutId.set(shortcut.id);
    this.showIconPicker.set(true);
  }

  onIconSelected(iconName: string): void {
    const id = this.editingShortcutId();
    if (id) {
      this.quickAccessService.updateShortcut(id, { icon: iconName });
    }
    this.showIconPicker.set(false);
    this.editingShortcutId.set(null);
  }

  getEditingShortcutIcon(): string {
    const id = this.editingShortcutId();
    if (!id) return 'ti-bolt';
    const shortcut = this.shortcuts().find((s) => s.id === id);
    return shortcut?.icon ?? 'ti-bolt';
  }
}
