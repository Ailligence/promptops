import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  signal,
  computed,
  effect,
  OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SwalService } from '@core/services/swal.service';
import { Store } from '@ngrx/store';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { toSignal } from '@angular/core/rxjs-interop';
import { SshService, SshConnectionPublic, SshConnectionInput } from '../services/ssh.service';
import { getActiveSession } from '../../../../../store/sessions/session.selectors';
import { TooltipDirective } from '../../../../common/tooltip.directive';
import { SshTerminalComponent } from '../ssh-terminal/ssh-terminal.component';

type EditorModel = {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  secret: string;
  passphrase: string;
  cwd: string;
};

@Component({
  selector: 'app-session-ssh-panel',
  standalone: true,
  imports: [FormsModule, TranslateModule, TooltipDirective, SshTerminalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="ssh-explorer">
      <!-- Top bar -->
      <div class="ssh-topbar">
        <div class="ssh-topbar-left">
          <iconify-icon icon="solar:server-square-bold-duotone" width="18" class="ssh-icon"></iconify-icon>
          <span class="ssh-title">{{ 'SSH.Title' | translate }}</span>
          @if (connections().length > 0) {
            <span class="ssh-count-badge">{{ connections().length }}</span>
          }
        </div>
        <div class="ssh-topbar-right">
          <button class="btn-ssh-action btn-add" (click)="startAdd()" [appTooltip]="'SSH.Add connection' | translate">
            <iconify-icon icon="mdi:plus" width="14"></iconify-icon> {{ 'SSH.New' | translate }}
          </button>
          <button class="btn-ssh-icon" (click)="onRefresh()" [appTooltip]="'SSH.Refresh' | translate" [attr.aria-label]="'SSH.Refresh' | translate">
            <iconify-icon icon="mdi:refresh" width="16" [class.spinning]="ssh.loading()"></iconify-icon>
          </button>
          <button class="btn-ssh-close" (click)="close()" [appTooltip]="'BUTTONS.Close' | translate" [attr.aria-label]="'BUTTONS.Close' | translate">
            <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
          </button>
        </div>
      </div>

      <!-- Security note -->
      <div class="ssh-note">
        <iconify-icon icon="solar:lock-keyhole-bold-duotone" width="14"></iconify-icon>
        <span>{{ 'SSH.Security note' | translate }}</span>
      </div>

      <!-- Error banner -->
      @if (ssh.error()) {
        <div class="ssh-error-banner">
          <iconify-icon icon="mdi:alert-circle" width="16"></iconify-icon>
          <span>{{ ssh.error() }}</span>
          <button class="btn-ssh-icon" (click)="ssh.error.set(null)" [attr.aria-label]="'SSH.Dismiss' | translate"><iconify-icon icon="mdi:close" width="14"></iconify-icon></button>
        </div>
      }

      <div class="ssh-content">
        <!-- Left: connection list -->
        <aside class="ssh-sidebar">
          <div class="ssh-sidebar-head">
            <h6 class="ssh-sidebar-title">{{ 'SSH.Connections' | translate }}</h6>
          </div>
          @if (connections().length === 0 && !ssh.loading()) {
            <div class="ssh-empty">
              <iconify-icon icon="solar:server-square-line-duotone" width="36"></iconify-icon>
              <div>{{ 'SSH.Empty' | translate }}</div>
              <button class="btn-ssh-action btn-add" (click)="startAdd()">
                <iconify-icon icon="mdi:plus" width="13"></iconify-icon> {{ 'SSH.Create first' | translate }}
              </button>
            </div>
          }
          @for (c of connections(); track c.id) {
            <div class="ssh-item" [class.active]="selectedId() === c.id" (click)="select(c)">
              <iconify-icon class="ssh-item-icon" [icon]="c.authType === 'key' ? 'solar:key-bold' : 'solar:password-bold'" width="14"></iconify-icon>
              <div class="ssh-item-main">
                <div class="ssh-item-name">{{ c.name }}</div>
                <div class="ssh-item-sub">{{ c.username }}&#64;{{ c.host }}:{{ c.port }}</div>
              </div>
            </div>
          }
        </aside>

        <!-- Right: details / editor / terminals -->
        <section class="ssh-main">
          @if (editing()) {
            <div class="ssh-editor">
              <div class="ssh-editor-head">
                <h5>{{ (model.id ? 'SSH.Edit connection' : 'SSH.New connection') | translate }}</h5>
              </div>
              <div class="ssh-form">
                <div class="ssh-row">
                  <label>{{ 'SSH.Name' | translate }}</label>
                  <input type="text" [(ngModel)]="model.name" placeholder="prod-db" />
                </div>
                <div class="ssh-row-inline">
                  <div class="ssh-row grow">
                    <label>{{ 'SSH.Host' | translate }}</label>
                    <input type="text" [(ngModel)]="model.host" placeholder="example.com" />
                  </div>
                  <div class="ssh-row port">
                    <label>{{ 'SSH.Port' | translate }}</label>
                    <input type="number" [(ngModel)]="model.port" min="1" max="65535" />
                  </div>
                </div>
                <div class="ssh-row">
                  <label>{{ 'SSH.Username' | translate }}</label>
                  <input type="text" [(ngModel)]="model.username" placeholder="deploy" />
                </div>
                <div class="ssh-row">
                  <label>{{ 'SSH.Auth type' | translate }}</label>
                  <div class="ssh-auth-toggle">
                    <button [class.active]="model.authType === 'password'" (click)="model.authType = 'password'">{{ 'SSH.Password' | translate }}</button>
                    <button [class.active]="model.authType === 'key'" (click)="model.authType = 'key'">{{ 'SSH.Private key' | translate }}</button>
                  </div>
                </div>
                @if (model.authType === 'password') {
                  <div class="ssh-row">
                    <label>{{ 'SSH.Password' | translate }}</label>
                    <input type="password" [(ngModel)]="model.secret" autocomplete="new-password" />
                  </div>
                } @else {
                  <div class="ssh-row">
                    <label>{{ 'SSH.Private key pem' | translate }}</label>
                    <textarea [(ngModel)]="model.secret" rows="8" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..." spellcheck="false"></textarea>
                  </div>
                  <div class="ssh-row">
                    <label>{{ 'SSH.Passphrase' | translate }}</label>
                    <input type="password" [(ngModel)]="model.passphrase" autocomplete="new-password" />
                  </div>
                }
                <div class="ssh-row">
                  <label>{{ 'SSH.Default dir' | translate }}</label>
                  <input type="text" [(ngModel)]="model.cwd" placeholder="/var/www" />
                </div>
                <div class="ssh-editor-actions">
                  <button class="btn-ssh-cancel" (click)="cancelEdit()">{{ 'BUTTONS.Cancel' | translate }}</button>
                  <button class="btn-ssh-save" (click)="saveEdit()" [disabled]="saving()">
                    {{ (saving() ? 'SSH.Saving' : 'BUTTONS.Save') | translate }}
                  </button>
                </div>
              </div>
            </div>
          } @else if (selected()) {
            @let c = selected()!;
            <div class="ssh-detail">
              <div class="ssh-detail-head">
                <div>
                  <h5>{{ c.name }}</h5>
                  <div class="ssh-detail-sub">{{ c.username }}&#64;{{ c.host }}:{{ c.port }} · {{ (c.authType === 'key' ? 'SSH.Private key' : 'SSH.Password') | translate }}</div>
                </div>
                <div class="ssh-detail-actions">
                  <button class="btn-ssh-action btn-primary" (click)="openTerminal(c)">
                    <iconify-icon icon="solar:monitor-bold" width="13"></iconify-icon> {{ 'SSH.Open terminal' | translate }}
                  </button>
                  <button class="btn-ssh-action" (click)="testConn(c)" [disabled]="testing() === c.id">
                    <iconify-icon [icon]="testing() === c.id ? 'solar:refresh-bold' : 'solar:play-bold'" [class.spinning]="testing() === c.id" width="13"></iconify-icon>
                    {{ 'SSH.Test' | translate }}
                  </button>
                  <button class="btn-ssh-action" (click)="startEdit(c)">
                    <iconify-icon icon="solar:pen-bold" width="13"></iconify-icon> {{ 'SSH.Edit' | translate }}
                  </button>
                  <button class="btn-ssh-action btn-danger" (click)="confirmDelete(c)">
                    <iconify-icon icon="solar:trash-bin-minimalistic-bold" width="13"></iconify-icon> {{ 'BUTTONS.Delete' | translate }}
                  </button>
                </div>
              </div>

              @if (terminalsFor(c.id).length > 0) {
                <div class="ssh-terminals">
                  <h6 class="ssh-subtitle">{{ 'SSH.Active terminals' | translate: { count: terminalsFor(c.id).length } }}</h6>
                  @for (t of terminalsFor(c.id); track t.uid) {
                    <app-ssh-terminal
                      [connection]="t.connection"
                      [uid]="t.uid"
                      (closed)="removeTerminal(t.uid)"
                    ></app-ssh-terminal>
                  }
                </div>
              } @else {
                <div class="ssh-placeholder">
                  <iconify-icon icon="solar:monitor-smartphone-bold-duotone" width="46"></iconify-icon>
                  <p [innerHTML]="'SSH.Open hint' | translate"></p>
                </div>
              }
            </div>
          } @else {
            <div class="ssh-placeholder">
              <iconify-icon icon="solar:server-square-line-duotone" width="64"></iconify-icon>
              <p>{{ 'SSH.Select hint' | translate }}</p>
            </div>
          }
        </section>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: block; height: 100%; }
    .ssh-explorer {
      display: flex; flex-direction: column;
      height: 100%; background: var(--bs-body-bg);
      color: var(--bs-body-color);
    }
    .ssh-topbar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 16px; border-bottom: 1px solid var(--bs-border-color);
      background: var(--bs-tertiary-bg);
    }
    .ssh-topbar-left { display: inline-flex; align-items: center; gap: 10px; }
    .ssh-topbar-right { display: inline-flex; align-items: center; gap: 6px; }
    .ssh-icon { color: #818cf8; }
    .ssh-title { font-size: 15px; font-weight: 700; }
    .ssh-count-badge {
      background: rgba(99,102,241,0.15); color: #6366f1;
      padding: 2px 7px; border-radius: 10px;
      font-size: 11px; font-weight: 600;
    }
    .btn-ssh-icon {
      border: 0; background: transparent; padding: 4px 6px; border-radius: 5px;
      color: var(--bs-body-color); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .btn-ssh-icon:hover { background: var(--bs-body-bg); }
    .btn-ssh-close {
      border: 0; background: transparent; padding: 4px; border-radius: 5px;
      color: var(--bs-body-color); cursor: pointer; opacity: 0.7;
    }
    .btn-ssh-close:hover { opacity: 1; color: var(--bs-danger); }
    .btn-ssh-action {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 10px; font-size: 12px; font-weight: 600;
      border-radius: 5px; border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg); color: var(--bs-body-color);
      cursor: pointer;
    }
    .btn-ssh-action:hover { background: var(--bs-tertiary-bg); }
    .btn-ssh-action:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-ssh-action.btn-add, .btn-ssh-action.btn-primary {
      background: #6366f1; color: white; border-color: #6366f1;
    }
    .btn-ssh-action.btn-add:hover, .btn-ssh-action.btn-primary:hover {
      background: #4f46e5; border-color: #4f46e5;
    }
    .btn-ssh-action.btn-danger { color: var(--bs-danger); }
    .btn-ssh-action.btn-danger:hover { background: rgba(239,68,68,0.1); }
    .spinning { animation: ssh-spin 1s linear infinite; }
    @keyframes ssh-spin { to { transform: rotate(360deg); } }
    .ssh-note {
      display: flex; gap: 8px; align-items: flex-start;
      font-size: 11.5px; line-height: 1.4;
      padding: 8px 14px; margin: 10px 16px 0;
      background: rgba(99,102,241,0.08);
      border: 1px solid rgba(99,102,241,0.25);
      border-radius: 6px;
    }
    .ssh-error-banner {
      display: flex; gap: 8px; align-items: center;
      font-size: 12px; color: var(--bs-danger);
      padding: 8px 14px; margin: 10px 16px 0;
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.3);
      border-radius: 6px;
    }
    .ssh-error-banner span { flex: 1; }
    .ssh-content {
      display: grid; grid-template-columns: 260px 1fr;
      flex: 1; min-height: 0; margin-top: 12px;
    }
    .ssh-sidebar {
      border-right: 1px solid var(--bs-border-color);
      overflow-y: auto; padding: 6px;
    }
    .ssh-sidebar-head { padding: 4px 8px; }
    .ssh-sidebar-title {
      font-size: 10.5px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; opacity: 0.65; margin: 0;
    }
    .ssh-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 6px;
      cursor: pointer; margin-bottom: 2px;
    }
    .ssh-item:hover { background: var(--bs-tertiary-bg); }
    .ssh-item.active { background: rgba(99,102,241,0.12); }
    .ssh-item-icon { flex-shrink: 0; color: #818cf8; }
    .ssh-item-main { min-width: 0; flex: 1; }
    .ssh-item-name {
      font-size: 12.5px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ssh-item-sub {
      font-size: 10.5px; opacity: 0.65;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ssh-empty {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 28px 12px; opacity: 0.7; text-align: center;
      font-size: 12px;
    }
    .ssh-main {
      overflow-y: auto; padding: 14px 18px;
      display: flex; flex-direction: column; gap: 14px;
    }
    .ssh-detail-head {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 12px; flex-wrap: wrap;
    }
    .ssh-detail-head h5 { margin: 0; font-size: 15px; font-weight: 700; }
    .ssh-detail-sub { font-size: 11.5px; opacity: 0.7; margin-top: 2px; }
    .ssh-detail-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .ssh-placeholder {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; flex: 1; opacity: 0.55; padding: 40px 20px; text-align: center;
    }
    .ssh-editor { display: flex; flex-direction: column; gap: 10px; }
    .ssh-editor-head h5 { margin: 0; font-size: 14px; font-weight: 700; }
    .ssh-form {
      display: flex; flex-direction: column; gap: 10px;
      max-width: 560px;
    }
    .ssh-row { display: flex; flex-direction: column; gap: 4px; }
    .ssh-row label {
      font-size: 11px; font-weight: 600; opacity: 0.75;
    }
    .ssh-row input, .ssh-row textarea {
      font-size: 12.5px; padding: 7px 9px; border-radius: 5px;
      border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg); color: var(--bs-body-color);
      font-family: inherit;
    }
    .ssh-row input:focus, .ssh-row textarea:focus {
      outline: none; border-color: #6366f1;
      box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
    }
    .ssh-row textarea {
      font-family: ui-monospace, Menlo, monospace; font-size: 11.5px;
      resize: vertical;
    }
    .ssh-row-inline { display: flex; gap: 8px; }
    .ssh-row.grow { flex: 1; }
    .ssh-row.port { width: 100px; }
    .ssh-auth-toggle { display: inline-flex; }
    .ssh-auth-toggle button {
      flex: 1; padding: 6px 12px; font-size: 12px;
      border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg); cursor: pointer;
      color: var(--bs-body-color);
    }
    .ssh-auth-toggle button:first-child { border-radius: 5px 0 0 5px; }
    .ssh-auth-toggle button:last-child { border-radius: 0 5px 5px 0; border-left: 0; }
    .ssh-auth-toggle button.active {
      background: #6366f1; color: white; border-color: #6366f1;
    }
    .ssh-editor-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
    .btn-ssh-cancel, .btn-ssh-save {
      padding: 7px 16px; font-size: 12px; font-weight: 600;
      border-radius: 5px; border: 1px solid var(--bs-border-color);
      cursor: pointer;
    }
    .btn-ssh-cancel { background: var(--bs-body-bg); color: var(--bs-body-color); }
    .btn-ssh-save { background: #6366f1; color: white; border-color: #6366f1; }
    .btn-ssh-save:hover:not(:disabled) { background: #4f46e5; }
    .btn-ssh-save:disabled { opacity: 0.6; cursor: not-allowed; }
    .ssh-subtitle {
      font-size: 11px; font-weight: 700; opacity: 0.65;
      text-transform: uppercase; letter-spacing: 0.5px;
      margin: 4px 0 6px;
    }
    .ssh-terminals { display: flex; flex-direction: column; gap: 10px; }
  `],
})
export class SessionSshPanelComponent implements OnDestroy {
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly testing = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);

  readonly ssh = inject(SshService);
  private store = inject(Store);
  private activeModal = inject(NgbActiveModal);
  private swal = inject(SwalService);
  private translate = inject(TranslateService);
  readonly activeSession = toSignal(this.store.select(getActiveSession));

  readonly connections = computed(() => this.ssh.connections());
  readonly selected = computed(() => {
    const id = this.selectedId();
    if (!id) return null;
    return this.connections().find((c) => c.id === id) ?? null;
  });

  readonly openTerminals = signal<Array<{ uid: string; connection: SshConnectionPublic }>>([]);

  model: EditorModel = this.emptyModel();

  constructor() {
    effect(() => {
      const sess = this.activeSession();
      if (sess && this.ssh.isDesktop) {
        this.ssh.refresh(sess.id);
      }
    });
  }

  private emptyModel(): EditorModel {
    return {
      name: '', host: '', port: 22, username: '',
      authType: 'key', secret: '', passphrase: '', cwd: '',
    };
  }

  close(): void {
    this.activeModal.dismiss();
  }

  onRefresh(): void {
    this.ssh.refresh(this.activeSession()?.id ?? null);
  }

  select(c: SshConnectionPublic): void {
    this.editing.set(false);
    this.selectedId.set(c.id);
  }

  startAdd(): void {
    this.model = this.emptyModel();
    this.selectedId.set(null);
    this.editing.set(true);
  }

  startEdit(c: SshConnectionPublic): void {
    this.model = {
      id: c.id,
      name: c.name,
      host: c.host,
      port: c.port,
      username: c.username,
      authType: c.authType,
      secret: '',
      passphrase: '',
      cwd: c.cwd ?? '',
    };
    this.selectedId.set(c.id);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.model = this.emptyModel();
  }

  async saveEdit(): Promise<void> {
    const sess = this.activeSession();
    if (!sess) return;
    if (!this.model.name || !this.model.host || !this.model.username || !this.model.secret) {
      this.ssh.error.set('name, host, username and secret are required');
      return;
    }
    this.saving.set(true);
    try {
      const input: SshConnectionInput = {
        id: this.model.id,
        sessionId: sess.id,
        name: this.model.name,
        host: this.model.host,
        port: this.model.port || 22,
        username: this.model.username,
        authType: this.model.authType,
        secret: this.model.secret,
        passphrase: this.model.passphrase || undefined,
        cwd: this.model.cwd || undefined,
      };
      const saved = await this.ssh.save(input);
      if (saved) {
        this.editing.set(false);
        this.selectedId.set(saved.id);
        this.model = this.emptyModel();
      }
    } finally {
      this.saving.set(false);
    }
  }

  confirmDelete(c: SshConnectionPublic): void {
    // window.confirm() returns false at once in the macOS webview (no JS
    // dialog delegate): use the app's confirmation, which calls back only on confirm.
    this.swal.confirmDanger(
      this.translate.instant('SSH.Delete title'),
      this.translate.instant('SSH.Confirm delete', { name: c.name }),
      () => void this.deleteConnection(c),
    );
  }

  private async deleteConnection(c: SshConnectionPublic): Promise<void> {
    // close any open terminals for this conn
    this.openTerminals.update((list) => list.filter((t) => t.connection.id !== c.id));
    const ok = await this.ssh.delete(c.id, this.activeSession()?.id ?? null);
    if (ok && this.selectedId() === c.id) this.selectedId.set(null);
  }

  async testConn(c: SshConnectionPublic): Promise<void> {
    this.testing.set(c.id);
    try {
      const res = await this.ssh.test(c.id);
      if (!res.ok) this.ssh.error.set(this.translate.instant('SSH.Test failed', { error: res.error ?? this.translate.instant('SSH.Unknown error') }));
      else this.ssh.error.set(null);
    } finally {
      this.testing.set(null);
    }
  }

  openTerminal(c: SshConnectionPublic): void {
    const uid = `${c.id}:${Date.now()}`;
    this.openTerminals.update((list) => [...list, { uid, connection: c }]);
    this.selectedId.set(c.id);
  }

  terminalsFor(connId: string): Array<{ uid: string; connection: SshConnectionPublic }> {
    return this.openTerminals().filter((t) => t.connection.id === connId);
  }

  removeTerminal(uid: string): void {
    this.openTerminals.update((list) => list.filter((t) => t.uid !== uid));
  }

  ngOnDestroy(): void {
    this.openTerminals.set([]);
  }
}
