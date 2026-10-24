import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { GitSettingsService, GitSettingsSection } from '../services/git-settings.service';
import { GitService } from '../services/git.service';
import { EscCloseDirective } from '../../../../common/esc-close.directive';

interface SectionDef {
  id: GitSettingsSection;
  labelKey: string;
  icon: string;
}

/**
 * Git Settings modal — a sectioned preferences surface for the Git tooling.
 * Visual language intentionally mirrors the SSH Connections modal (Bootstrap
 * tokens + indigo accent, topbar + left rail). The section list is data-driven
 * so new sections drop in by extending `sections` and adding a body branch.
 */
@Component({
  selector: 'app-git-settings-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule, EscCloseDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (settings.visible()) {
      <div class="gst-backdrop po-modal-overlay" (click)="onBackdrop($event)">
        <div class="gst-modal po-modal" role="dialog" aria-modal="true" [attr.aria-label]="'SESSIONS.GIT_SETTINGS.Title' | translate"
          (click)="$event.stopPropagation()" appEscClose (escClose)="settings.close()">
          <!-- Topbar -->
          <div class="gst-topbar po-modal-header">
            <div class="gst-topbar-left">
              <iconify-icon icon="solar:settings-bold-duotone" width="18" class="gst-icon"></iconify-icon>
              <span class="gst-title po-modal-title">{{ 'SESSIONS.GIT_SETTINGS.Title' | translate }}</span>
            </div>
            <button class="gst-close po-modal-close" (click)="settings.close()" [attr.aria-label]="'COMMON.Close' | translate">
              <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
            </button>
          </div>

          <div class="gst-content">
            <!-- Left rail: sections (extensible) -->
            <aside class="gst-sidebar">
              <div class="gst-sidebar-head"><h6 class="gst-sidebar-title">{{ 'SETTINGS.Title' | translate }}</h6></div>
              @for (s of sections; track s.id) {
                <button class="gst-item" [class.active]="settings.activeSection() === s.id"
                  (click)="settings.activeSection.set(s.id)">
                  <iconify-icon class="gst-item-icon" [icon]="s.icon" width="15"></iconify-icon>
                  <span class="gst-item-name">{{ s.labelKey | translate }}</span>
                </button>
              }
            </aside>

            <!-- Right: section content -->
            <section class="gst-main">
              <!-- ── AI COMMIT ──────────────────────────────────── -->
              @if (settings.activeSection() === 'commit') {
                <div class="gst-section">
                  <h5>{{ 'SESSIONS.GIT_SETTINGS.AI Commit' | translate }}</h5>
                  <div class="gst-note">
                    <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="14"></iconify-icon>
                    <span>{{ 'SESSIONS.GIT_SETTINGS.Commit note' | translate }}</span>
                  </div>

                  <label class="gst-label">{{ 'SESSIONS.GIT_SETTINGS.Message convention' | translate }}</label>
                  <div class="gst-choices">
                    <button type="button" class="gst-choice" [class.selected]="git.commitConvention() === 'conventional'"
                      (click)="git.setCommitConvention('conventional')">
                      <span class="gst-radio" [class.on]="git.commitConvention() === 'conventional'"></span>
                      <span class="gst-choice-body">
                        <span class="gst-choice-title">Conventional Commits</span>
                        <span class="gst-choice-desc"><code>feat:</code> <code>fix:</code> <code>docs:</code> <code>refactor:</code> …</span>
                      </span>
                    </button>
                    <button type="button" class="gst-choice" [class.selected]="git.commitConvention() === 'plain'"
                      (click)="git.setCommitConvention('plain')">
                      <span class="gst-radio" [class.on]="git.commitConvention() === 'plain'"></span>
                      <span class="gst-choice-body">
                        <span class="gst-choice-title">{{ 'SESSIONS.GIT_SETTINGS.Plain' | translate }}</span>
                        <span class="gst-choice-desc">{{ 'SESSIONS.GIT_SETTINGS.Plain desc' | translate }}</span>
                      </span>
                    </button>
                  </div>

                  <label class="gst-label">{{ 'SESSIONS.GIT_SETTINGS.Message language' | translate }}</label>
                  <div class="gst-segmented">
                    @for (l of languages; track l.id) {
                      <button type="button" [class.active]="git.commitLanguage() === l.id" (click)="git.setCommitLanguage(l.id)">{{ l.labelKey ? (l.labelKey | translate) : l.label }}</button>
                    }
                  </div>

                  <label class="gst-label" for="gst-instructions">{{ 'SESSIONS.GIT_SETTINGS.Custom instructions' | translate }}</label>
                  <textarea id="gst-instructions" class="gst-textarea" rows="3" maxlength="500"
                    [placeholder]="'SESSIONS.GIT_SETTINGS.Instructions placeholder' | translate"
                    [ngModel]="git.commitInstructions()" (ngModelChange)="git.setCommitInstructions($event)"></textarea>
                  <span class="gst-counter">{{ git.commitInstructions().length }}/500 · {{ 'SESSIONS.GIT_SETTINGS.Counter note' | translate }}</span>
                </div>
              }

              <!-- ── BRANCH / GITFLOW ───────────────────────────── -->
              @if (settings.activeSection() === 'branch') {
                <div class="gst-section">
                  <h5>{{ 'SESSIONS.GIT_SETTINGS.Branch' | translate }}</h5>
                  <div class="gst-note">
                    <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="14"></iconify-icon>
                    <span>{{ 'SESSIONS.GIT_SETTINGS.Branch note' | translate }}</span>
                  </div>

                  <label class="gst-label">{{ 'SESSIONS.GIT_SETTINGS.Naming style' | translate }}</label>
                  <div class="gst-choices">
                    <button type="button" class="gst-choice" [class.selected]="git.branchStyle() === 'simple'"
                      (click)="git.setBranchStyle('simple')">
                      <span class="gst-radio" [class.on]="git.branchStyle() === 'simple'"></span>
                      <span class="gst-choice-body">
                        <span class="gst-choice-title">{{ 'SESSIONS.GIT_SETTINGS.Simple' | translate }}</span>
                        <span class="gst-choice-desc"><code>feat/add-auth</code> <code>fix/login-bug</code></span>
                      </span>
                    </button>
                    <button type="button" class="gst-choice" [class.selected]="git.branchStyle() === 'gitflow'"
                      (click)="git.setBranchStyle('gitflow')">
                      <span class="gst-radio" [class.on]="git.branchStyle() === 'gitflow'"></span>
                      <span class="gst-choice-body">
                        <span class="gst-choice-title">Gitflow</span>
                        <span class="gst-choice-desc"><code>feature/</code> <code>bugfix/</code> <code>hotfix/</code> <code>release/</code></span>
                      </span>
                    </button>
                  </div>

                  <label class="gst-label" for="gst-base-branch">{{ 'SESSIONS.GIT_SETTINGS.Default base branch' | translate }}</label>
                  <input id="gst-base-branch" class="gst-input" type="text" [placeholder]="'SESSIONS.GIT_SETTINGS.Base branch placeholder' | translate"
                    [ngModel]="git.defaultBaseBranch()" (ngModelChange)="git.setDefaultBaseBranch($event)" />
                </div>
              }

              <!-- ── PUSH / SYNC ────────────────────────────────── -->
              @if (settings.activeSection() === 'push') {
                <div class="gst-section">
                  <h5>{{ 'SESSIONS.GIT_SETTINGS.Push sync' | translate }}</h5>

                  <label class="gst-toggle">
                    <input type="checkbox" [ngModel]="git.confirmBeforePush()" (ngModelChange)="git.setConfirmBeforePush($event)" />
                    <span class="gst-choice-body">
                      <span class="gst-choice-title">{{ 'SESSIONS.GIT_SETTINGS.Confirm before push' | translate }}</span>
                      <span class="gst-choice-desc">{{ 'SESSIONS.GIT_SETTINGS.Confirm before push desc' | translate }}</span>
                    </span>
                  </label>

                  <label class="gst-toggle">
                    <input type="checkbox" [ngModel]="git.autoPullBeforePush()" (ngModelChange)="git.setAutoPullBeforePush($event)" />
                    <span class="gst-choice-body">
                      <span class="gst-choice-title">{{ 'SESSIONS.GIT_SETTINGS.Auto pull' | translate }}</span>
                      <span class="gst-choice-desc">{{ 'SESSIONS.GIT_SETTINGS.Auto pull desc' | translate }}</span>
                    </span>
                  </label>

                  <div class="gst-info-line">
                    <iconify-icon icon="mdi:shield-check-outline" width="14"></iconify-icon>
                    <span>{{ 'SESSIONS.GIT_SETTINGS.Push info' | translate }}</span>
                  </div>
                </div>
              }
            </section>
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .gst-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center; z-index: 10000;
      backdrop-filter: blur(2px);
    }
    .gst-modal {
      width: min(680px, 94vw); max-height: 82vh; display: flex; flex-direction: column;
      background: var(--bs-body-bg); color: var(--bs-body-color);
      border: 1px solid var(--bs-border-color); border-radius: 10px;
      overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.4);
    }

    /* Topbar — mirrors .ssh-topbar */
    .gst-topbar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 16px; border-bottom: 1px solid var(--bs-border-color);
      background: var(--bs-tertiary-bg);
    }
    .gst-topbar-left { display: inline-flex; align-items: center; gap: 10px; }
    .gst-icon { color: #818cf8; }
    .gst-title { font-size: 15px; font-weight: 700; }
    .gst-close {
      border: 0; background: transparent; padding: 4px; border-radius: 5px;
      color: var(--bs-body-color); cursor: pointer; opacity: 0.7; display: inline-flex;
    }
    .gst-close:hover { opacity: 1; color: var(--bs-danger); }

    .gst-content { display: grid; grid-template-columns: 200px 1fr; flex: 1; min-height: 0; }

    /* Left rail — mirrors .ssh-sidebar */
    .gst-sidebar {
      border-inline-end: 1px solid var(--bs-border-color);
      overflow-y: auto; padding: 8px; background: var(--bs-tertiary-bg);
    }
    .gst-sidebar-head { padding: 4px 8px; }
    .gst-sidebar-title {
      font-size: 10.5px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; opacity: 0.65; margin: 0;
    }
    .gst-item {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; border-radius: 6px; cursor: pointer; margin-bottom: 2px;
      border: 0; background: transparent; color: var(--bs-body-color);
      font-size: 12.5px; font-weight: 600; text-align: start;
    }
    .gst-item:hover { background: var(--bs-body-bg); }
    .gst-item.active { background: rgba(99,102,241,0.12); color: #818cf8; }
    .gst-item-icon { flex-shrink: 0; color: #818cf8; }
    .gst-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Right content — mirrors .ssh-main */
    .gst-main { overflow-y: auto; padding: 16px 18px; }
    .gst-section { display: flex; flex-direction: column; }
    .gst-section h5 { margin: 0 0 10px; font-size: 15px; font-weight: 700; }
    .gst-label {
      font-size: 11px; font-weight: 600; opacity: 0.75;
      margin: 14px 0 6px; display: block;
    }
    .gst-section h5 + .gst-note { margin-top: 0; }

    /* Note — mirrors .ssh-note */
    .gst-note {
      display: flex; gap: 8px; align-items: flex-start;
      font-size: 11.5px; line-height: 1.4; padding: 8px 12px;
      background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.25);
      border-radius: 6px;
    }
    .gst-note iconify-icon { color: #818cf8; flex: 0 0 auto; margin-top: 1px; }
    .gst-note strong { color: #818cf8; font-weight: 700; }

    /* Radio-card choices */
    .gst-choices { display: flex; flex-direction: column; gap: 8px; }
    .gst-choice {
      display: flex; align-items: flex-start; gap: 10px; width: 100%;
      padding: 10px 12px; border-radius: 6px; cursor: pointer; text-align: start;
      border: 1px solid var(--bs-border-color); background: var(--bs-body-bg);
    }
    .gst-choice:hover { border-color: #6366f1; }
    .gst-choice.selected { border-color: #6366f1; background: rgba(99,102,241,0.1); }
    .gst-radio {
      flex: 0 0 auto; width: 14px; height: 14px; margin-top: 1px; border-radius: 50%;
      border: 2px solid var(--bs-border-color); position: relative;
    }
    .gst-radio.on { border-color: #6366f1; }
    .gst-radio.on::after { content: ''; position: absolute; inset: 2px; border-radius: 50%; background: #6366f1; }
    .gst-choice-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .gst-choice-title { font-size: 12.5px; font-weight: 600; }
    .gst-choice-desc { font-size: 11px; opacity: 0.7; }
    .gst-choice-desc code {
      font-size: 10.5px; padding: 1px 4px; border-radius: 3px;
      background: rgba(129,140,248,0.14); color: #818cf8; margin-inline-end: 2px;
    }

    /* Segmented control — mirrors .ssh-auth-toggle */
    .gst-segmented { display: inline-flex; }
    .gst-segmented button {
      padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--bs-border-color); background: var(--bs-body-bg); color: var(--bs-body-color);
    }
    .gst-segmented button:first-child { border-start-start-radius: 5px; border-end-start-radius: 5px; }
    .gst-segmented button:last-child { border-start-end-radius: 5px; border-end-end-radius: 5px; }
    .gst-segmented button:not(:first-child) { border-inline-start: 0; }
    .gst-segmented button.active { background: #6366f1; color: #fff; border-color: #6366f1; }

    /* Inputs — mirrors .ssh-row input/textarea */
    .gst-textarea, .gst-input {
      width: 100%; box-sizing: border-box; font-size: 12.5px; padding: 7px 9px;
      border-radius: 5px; border: 1px solid var(--bs-border-color);
      background: var(--bs-body-bg); color: var(--bs-body-color); font-family: inherit;
    }
    .gst-textarea { resize: vertical; }
    .gst-textarea:focus, .gst-input:focus {
      outline: none; border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
    }
    .gst-textarea::placeholder, .gst-input::placeholder { opacity: 0.55; }
    .gst-counter { display: block; margin-top: 5px; font-size: 10.5px; opacity: 0.6; }

    /* Toggle rows */
    .gst-toggle {
      display: flex; align-items: flex-start; gap: 10px; cursor: pointer;
      padding: 10px 12px; margin-bottom: 8px; border-radius: 6px;
      border: 1px solid var(--bs-border-color); background: var(--bs-body-bg);
    }
    .gst-toggle:hover { border-color: #6366f1; }
    .gst-toggle input { margin-top: 1px; width: 15px; height: 15px; accent-color: #6366f1; }

    .gst-info-line {
      display: flex; align-items: flex-start; gap: 8px; margin-top: 12px;
      font-size: 11.5px; opacity: 0.7; line-height: 1.4;
    }
    .gst-info-line iconify-icon { color: var(--bs-success, #22c55e); flex: 0 0 auto; margin-top: 1px; }
  `],
})
export class GitSettingsModalComponent {
  settings = inject(GitSettingsService);
  git = inject(GitService);

  sections: SectionDef[] = [
    { id: 'commit', labelKey: 'SESSIONS.GIT_SETTINGS.AI Commit', icon: 'solar:magic-stick-3-bold-duotone' },
    { id: 'branch', labelKey: 'SESSIONS.GIT_SETTINGS.Branch', icon: 'mdi:source-branch' },
    { id: 'push', labelKey: 'SESSIONS.GIT_SETTINGS.Push sync', icon: 'mdi:cloud-upload-outline' },
  ];

  /** Language names stay in their own language (endonyms); only "Auto" is translated. */
  languages: { id: 'auto' | 'en' | 'it'; label: string; labelKey?: string }[] = [
    { id: 'auto', label: 'Auto', labelKey: 'SESSIONS.GIT_SETTINGS.Auto' },
    { id: 'en', label: 'English' },
    { id: 'it', label: 'Italiano' },
  ];

  onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.settings.close();
  }
}
