import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { GitService } from '../services/git.service';
import { GitSetupService } from '../services/git-setup.service';
import { GitSetupModalComponent } from '../git-setup-modal/git-setup-modal.component';
import { GitSettingsModalComponent } from '../git-settings-modal/git-settings-modal.component';
import { GitSettingsService } from '../services/git-settings.service';
import { getActiveSession } from '../../../../../store/sessions/session.selectors';
import { TooltipDirective } from '../../../../common/tooltip.directive';
import { EscCloseDirective } from '../../../../common/esc-close.directive';

@Component({
  selector: 'app-session-git-panel',
  standalone: true,
  imports: [FormsModule, TranslateModule, TooltipDirective, GitSetupModalComponent, GitSettingsModalComponent, EscCloseDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="git-accordion" [class.expanded]="expanded()">
      <!-- Header -->
      <div class="git-accordion-header" (click)="expanded.set(!expanded())">
        <span class="git-accordion-title">
          <iconify-icon icon="mdi:git" width="15"></iconify-icon>
          Git
          @if (git.totalChanges() > 0) {
            <span class="badge bg-info ms-1">{{ git.totalChanges() }}</span>
          }
          <!-- Branch selector -->
          <span class="branch-badge" (click)="toggleBranches($event)" [appTooltip]="'SESSIONS.TOOLTIPS.Switch branch' | translate">
            <iconify-icon icon="mdi:source-branch" width="12"></iconify-icon>
            {{ git.branch() || '...' }}
            <iconify-icon icon="solar:alt-arrow-down-linear" width="10"></iconify-icon>
          </span>
        </span>
        <div class="git-header-actions">
          <button class="btn-git-icon" (click)="doPull($event)" [disabled]="git.pulling()" [appTooltip]="'SESSIONS.TOOLTIPS.Pull' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.Pull' | translate">
            <iconify-icon icon="mdi:arrow-down-bold" width="14" [class.spinning]="git.pulling()"></iconify-icon>
          </button>
          <button class="btn-git-icon" (click)="doPush($event)" [disabled]="git.pushing()" [appTooltip]="'SESSIONS.TOOLTIPS.Push' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.Push' | translate">
            <iconify-icon icon="mdi:arrow-up-bold" width="14" [class.spinning]="git.pushing()"></iconify-icon>
          </button>
          <button class="btn-git-icon" (click)="openGitSetup($event)" [appTooltip]="'SESSIONS.GIT_PANEL.Fix setup' | translate" [attr.aria-label]="'SESSIONS.GIT_PANEL.Fix setup' | translate">
            <iconify-icon icon="mdi:wrench" width="14"></iconify-icon>
          </button>
          <button class="btn-git-icon" (click)="onRefresh($event)" [appTooltip]="'SESSIONS.TOOLTIPS.Refresh' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.Refresh' | translate">
            <iconify-icon icon="mdi:refresh" width="14" [class.spinning]="git.loading()"></iconify-icon>
          </button>
          <iconify-icon
            [icon]="expanded() ? 'solar:alt-arrow-down-bold' : 'solar:alt-arrow-up-bold'"
            width="14"
            class="accordion-chevron"
          ></iconify-icon>
        </div>
      </div>

      <!-- Body -->
      @if (expanded()) {
        <div class="git-body">
          <!-- Branch dropdown -->
          @if (git.showBranchDropdown()) {
            <div class="branch-dropdown">
              <div class="branch-create">
                <input
                  class="branch-input"
                  [placeholder]="'SESSIONS.GIT_PANEL.New branch placeholder' | translate"
                  [attr.aria-label]="'SESSIONS.GIT_PANEL.New branch placeholder' | translate"
                  [ngModel]="git.newBranchName()"
                  (ngModelChange)="git.newBranchName.set($event)"
                  (keydown.enter)="createBranch()"
                />
                <button class="btn-git-icon btn-ai-branch" (click)="generateBranchName()" [disabled]="git.generatingBranchName()" [appTooltip]="'SESSIONS.TOOLTIPS.AI branch name' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.AI branch name' | translate">
                  <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="14" [class.spinning]="git.generatingBranchName()"></iconify-icon>
                </button>
                <button class="btn-git-action btn-stage" (click)="createBranch()" [disabled]="!git.newBranchName()" [appTooltip]="'SESSIONS.TOOLTIPS.Create checkout' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.Create checkout' | translate">
                  <iconify-icon icon="mdi:plus" width="13"></iconify-icon>
                </button>
              </div>
              <div class="branch-list">
                @if (git.branchLoading()) {
                  <div class="branch-item disabled">{{ 'SUBAGENTS.Loading' | translate }}</div>
                } @else {
                  @for (b of git.branches(); track b.name) {
                    <div class="branch-item" [class.active]="b.current" [class.remote]="b.remote" (click)="checkoutBranch(b.name)">
                      <iconify-icon [icon]="b.current ? 'mdi:check-circle' : (b.remote ? 'mdi:cloud-outline' : 'mdi:source-branch')" width="13"></iconify-icon>
                      <span class="branch-item-name">{{ b.name }}</span>
                    </div>
                  }
                }
              </div>
            </div>
          }

          <!-- Sync feedback -->
          @if (git.syncError()) {
            <div class="git-feedback error">
              <span class="git-feedback-text">{{ git.syncError() }}</span>
              <button class="btn-ai-resolver" (click)="aiResolveSync()" [disabled]="git.aiResolving()" [appTooltip]="'SESSIONS.GIT_PANEL.AI resolver hint' | translate">
                <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="12" [class.spinning]="git.aiResolving()"></iconify-icon>
                {{ (git.aiResolving() ? 'SESSIONS.GIT_PANEL.Resolving' : 'SESSIONS.GIT_PANEL.AI resolver') | translate }}
              </button>
              @if (isSetupError(git.syncError())) {
                <button class="btn-open-mini-term" (click)="openGitSetup($event)">
                  <iconify-icon icon="mdi:wrench" width="12"></iconify-icon> {{ 'SESSIONS.GIT_PANEL.Fix setup' | translate }}
                </button>
              }
              @if (!git.miniTerminalOpen()) {
                <button class="btn-open-mini-term" (click)="git.openMiniTerminal()">
                  <iconify-icon icon="mdi:console" width="12"></iconify-icon> {{ 'TERMINAL_PAGE.Terminal' | translate }}
                </button>
              }
              <button class="btn-dismiss-mini" (click)="git.syncError.set(null); git.closeMiniTerminal()" [appTooltip]="'SESSIONS.GIT_PANEL.Dismiss' | translate" [attr.aria-label]="'SESSIONS.GIT_PANEL.Dismiss' | translate">
                <iconify-icon icon="mdi:close" width="11"></iconify-icon>
              </button>
            </div>
            @if (git.aiResolveSteps().length > 0) {
              <div class="ai-resolver-log">
                @for (s of git.aiResolveSteps(); track $index) {
                  <div class="ai-resolver-step">
                    <iconify-icon icon="mdi:chevron-right" width="11"></iconify-icon>
                    <span>{{ s }}</span>
                  </div>
                }
              </div>
            }
            @if (git.miniTerminalOpen()) {
              <div class="mini-terminal-panel">
                <div class="mini-term-output">
                  @for (line of git.miniTerminalOutput(); track $index) {
                    <div class="mini-term-line" [class.cmd]="line.startsWith('$ ')">{{ line }}</div>
                  }
                </div>
                <div class="mini-term-input-row">
                  <span class="mini-term-ps1">$</span>
                  <input class="mini-term-input" placeholder="git ..." [attr.aria-label]="'SESSIONS.GIT_PANEL.Git command' | translate" [(ngModel)]="miniTermCmd" (keydown.enter)="execPanelTerminal()" [disabled]="git.miniTerminalRunning()" />
                </div>
              </div>
            }
          }
          @if (git.syncSuccess()) {
            <div class="git-feedback success">{{ git.syncSuccess() }}</div>
          }

          <!-- Merge conflict banner -->
          @if (git.hasConflicts()) {
            <div class="conflict-banner">
              <div class="conflict-title">
                <iconify-icon icon="mdi:alert-circle" width="14"></iconify-icon>
                {{ 'SESSIONS.GIT_PANEL.Conflicts' | translate: { count: git.conflictFiles().length } }}
              </div>
              <div class="conflict-files">
                @for (f of git.conflictFiles(); track f) {
                  <div class="conflict-row">
                    <span class="conflict-file">{{ f }}</span>
                    <button class="btn-git-action btn-resolve" (click)="resolveConflict(f)" [disabled]="git.resolvingFile() === f">
                      <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="12"></iconify-icon>
                      {{ (git.resolvingFile() === f ? 'SESSIONS.GIT_PANEL.Resolving' : 'SESSIONS.GIT_PANEL.AI resolve') | translate }}
                    </button>
                  </div>
                }
              </div>
              <button class="btn-git-action btn-resolve-all" (click)="resolveAllConflicts()" [disabled]="git.resolvingFile()">
                <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="13"></iconify-icon>
                {{ 'SESSIONS.GIT_PANEL.AI resolve all' | translate }}
              </button>
            </div>
          }

          @if (git.loading()) {
            <div class="git-loading">
              <iconify-icon icon="mdi:refresh" width="16" class="spinning"></iconify-icon>
              {{ 'SUBAGENTS.Loading' | translate }}
            </div>
          } @else if (git.files().length === 0) {
            <div class="git-empty-section">
              <div class="git-empty">
                <iconify-icon icon="mdi:check-circle" width="20" style="color: var(--po-success);"></iconify-icon>
                <span>{{ 'SESSIONS.GIT_PANEL.Working tree clean' | translate }}</span>
              </div>
              <div class="git-empty-actions">
                <button class="btn-git-action btn-push-big" (click)="doPushDirect()" [disabled]="git.pushing()">
                  <iconify-icon icon="mdi:arrow-up-bold" width="14" [class.spinning]="git.pushing()"></iconify-icon>
                  {{ (git.pushing() ? 'SESSIONS.GIT_PANEL.Pushing' : 'SESSIONS.TOOLTIPS.Push') | translate }}
                </button>
                <button class="btn-git-action btn-pull-big" (click)="doPullDirect()" [disabled]="git.pulling()">
                  <iconify-icon icon="mdi:arrow-down-bold" width="14" [class.spinning]="git.pulling()"></iconify-icon>
                  {{ (git.pulling() ? 'SESSIONS.GIT_PANEL.Pulling' : 'SESSIONS.TOOLTIPS.Pull') | translate }}
                </button>
                <button class="btn-git-action btn-history" (click)="toggleCommitLog()">
                  <iconify-icon icon="mdi:history" width="14"></iconify-icon>
                  {{ 'SESSIONS.History label' | translate }}
                </button>
              </div>
              <!-- Commit log inline -->
              @if (git.showCommitLog()) {
                <div class="commit-log">
                  @if (git.commitLogLoading()) {
                    <div class="git-loading"><iconify-icon icon="mdi:refresh" width="14" class="spinning"></iconify-icon> {{ 'SUBAGENTS.Loading' | translate }}</div>
                  } @else {
                    @for (c of git.commits(); track c.hash) {
                      <div class="commit-row" (click)="viewCommit(c.hash)">
                        <span class="commit-hash">{{ c.shortHash }}</span>
                        <span class="commit-msg">{{ c.message }}</span>
                        <span class="commit-meta">{{ c.author }} · {{ c.relativeDate }}</span>
                      </div>
                    }
                  }
                </div>
              }
            </div>
          } @else {
            <!-- Compact git summary -->
            <div class="git-compact">
              <div class="git-compact-info">
                <span class="git-file-count">
                  <iconify-icon icon="mdi:file-document-multiple-outline" width="14"></iconify-icon>
                  {{ (git.files().length === 1 ? 'SESSIONS.GIT_PANEL.File count one' : 'SESSIONS.GIT_PANEL.File count many') | translate: { count: git.files().length } }}
                </span>
                @if (git.stagedFiles().length > 0) {
                  <span class="git-staged-count">{{ 'SESSIONS.GIT_PANEL.Staged count' | translate: { count: git.stagedFiles().length } }}</span>
                }
              </div>
              <div class="git-compact-actions">
                <button class="btn-git-action btn-stage-all" (click)="stageAll()" [disabled]="git.files().length === 0 || allStaged()">
                  <iconify-icon icon="mdi:plus-circle-outline" width="13"></iconify-icon> {{ 'SESSIONS.TOOLTIPS.Stage all' | translate }}
                </button>
              </div>
            </div>

            <!-- Commit section -->
            <div class="git-commit-section">
              <textarea class="commit-input" [placeholder]="'SESSIONS.GIT_PANEL.Commit placeholder' | translate" [attr.aria-label]="'SESSIONS.GIT_PANEL.Commit placeholder' | translate" rows="2"
                [ngModel]="git.commitMessage()"
                (ngModelChange)="git.commitMessage.set($event)"
                (keydown.control.enter)="doCommit()"
              ></textarea>
              <div class="commit-actions">
                <button class="btn-git-action btn-git-settings" (click)="gitSettings.open()" [appTooltip]="'SESSIONS.GIT_SETTINGS.Title' | translate" [attr.aria-label]="'SESSIONS.GIT_SETTINGS.Title' | translate">
                  <iconify-icon icon="mdi:cog-outline" width="13"></iconify-icon>
                </button>
                <button class="btn-git-action btn-generate" (click)="generateMessage()"
                  [disabled]="git.generatingMessage() || !activeSession()"
                  [appTooltip]="'SESSIONS.TOOLTIPS.AI commit message' | translate">
                  @if (git.generatingMessage()) {
                    <iconify-icon icon="mdi:refresh" width="13" class="spinning"></iconify-icon>
                  } @else {
                    <iconify-icon icon="solar:magic-stick-3-bold-duotone" width="13"></iconify-icon>
                  }
                  {{ 'SESSIONS.GIT_PANEL.AI message' | translate }}
                </button>
                <button class="btn-git-action btn-commit" (click)="doCommit()"
                  [disabled]="!git.commitMessage() || git.committing()"
                  [appTooltip]="'SESSIONS.TOOLTIPS.Stage commit' | translate">
                  @if (git.committing()) {
                    <iconify-icon icon="mdi:refresh" width="13" class="spinning"></iconify-icon>
                  } @else {
                    <iconify-icon icon="mdi:check-circle" width="13"></iconify-icon>
                  }
                  {{ 'SESSIONS.GIT_PANEL.Commit' | translate }}
                </button>
              </div>
              @if (git.commitError()) {
                <div class="git-feedback error">{{ git.commitError() }}</div>
              }
              @if (git.generateError()) {
                <div class="git-feedback error">{{ git.generateError() }}</div>
              }
            </div>
          }
        </div>
      }
    </div>

    <!-- Diff Viewer Overlay -->
    @if (git.diffViewFile()) {
      <div class="diff-overlay" (click)="git.closeDiffView()">
        <div class="diff-panel" role="dialog" aria-modal="true" [attr.aria-label]="git.diffViewFile()" (click)="$event.stopPropagation()" appEscClose (escClose)="git.closeDiffView()">
          <div class="diff-header">
            <div class="diff-title">
              <iconify-icon icon="mdi:file-document-outline" width="16"></iconify-icon>
              <span>{{ git.diffViewFile() }}</span>
            </div>
            <button class="btn-git-icon" (click)="git.closeDiffView()" [appTooltip]="'SESSIONS.TOOLTIPS.Close' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.Close' | translate">
              <iconify-icon icon="mdi:close" width="16"></iconify-icon>
            </button>
          </div>
          <div class="diff-content">
            @if (git.diffViewLoading()) {
              <div class="git-loading">
                <iconify-icon icon="mdi:refresh" width="16" class="spinning"></iconify-icon>
                {{ 'SESSIONS.GIT_PANEL.Loading diff' | translate }}
              </div>
            } @else if (!git.diffViewContent()) {
              <div class="git-empty">{{ 'SESSIONS.TOOLTIPS.No changes' | translate }}</div>
            } @else {
              <pre class="diff-pre">@for (line of diffLines(); track $index) {<span [class]="diffLineClass(line)">{{ line }}
</span>}</pre>
            }
          </div>
        </div>
      </div>
    }

    <!-- Commit View Overlay -->
    @if (git.commitViewHash()) {
      <div class="diff-overlay" (click)="git.closeCommitView()">
        <div class="diff-panel" role="dialog" aria-modal="true" [attr.aria-label]="git.commitViewHash()" (click)="$event.stopPropagation()" appEscClose (escClose)="git.closeCommitView()">
          <div class="diff-header">
            <div class="diff-title">
              <iconify-icon icon="mdi:source-commit" width="16"></iconify-icon>
              <span>{{ git.commitViewHash()?.substring(0, 8) }}</span>
            </div>
            <button class="btn-git-icon" (click)="git.closeCommitView()" [appTooltip]="'SESSIONS.TOOLTIPS.Close' | translate" [attr.aria-label]="'SESSIONS.TOOLTIPS.Close' | translate">
              <iconify-icon icon="mdi:close" width="16"></iconify-icon>
            </button>
          </div>
          <div class="diff-content">
            @if (git.commitViewLoading()) {
              <div class="git-loading"><iconify-icon icon="mdi:refresh" width="16" class="spinning"></iconify-icon> {{ 'SUBAGENTS.Loading' | translate }}</div>
            } @else {
              <pre class="diff-pre">@for (line of commitDiffLines(); track $index) {<span [class]="diffLineClass(line)">{{ line }}
</span>}</pre>
            }
          </div>
        </div>
      </div>
    }
    <app-git-setup-modal />
    <app-git-settings-modal />
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .git-accordion {
      border-top: 2px solid var(--po-info);
      display: flex; flex-direction: column; min-height: 0;
      position: relative;
    }
    .git-accordion.expanded { flex: 1; min-height: 120px; max-height: 300px; }

    .git-accordion-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.3rem 0.75rem;
      background: rgba(57, 197, 207, 0.06); cursor: pointer; user-select: none; flex-shrink: 0;
    }
    .git-accordion-header:hover { background: rgba(57, 197, 207, 0.12); }

    .git-accordion-title {
      display: flex; align-items: center; gap: 0.375rem;
      font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--po-info);
    }

    .branch-badge {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 0.62rem; font-weight: 500; padding: 1px 6px; border-radius: 3px;
      background: rgba(57, 197, 207, 0.15); color: var(--po-info);
      text-transform: none; letter-spacing: normal; cursor: pointer;
      transition: background var(--po-duration-fast);
    }
    .branch-badge:hover { background: rgba(57, 197, 207, 0.3); }

    .git-header-actions { display: flex; align-items: center; gap: 0.25rem; }

    .btn-git-icon {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border: none; border-radius: 4px;
      background: transparent; color: var(--po-text-secondary); cursor: pointer;
    }
    .btn-git-icon:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: var(--po-text-primary); }
    .btn-git-icon:disabled { opacity: 0.4; cursor: not-allowed; }

    .accordion-chevron { color: var(--po-text-secondary); }

    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* ── Branch dropdown ── */
    .branch-dropdown {
      background: var(--po-bg-2);
      border-bottom: 1px solid var(--po-border-subtle);
      max-height: 180px; display: flex; flex-direction: column;
      flex-shrink: 0;
    }
    .branch-create {
      display: flex; gap: 0.25rem; padding: 0.375rem; border-bottom: 1px solid var(--po-border-subtle);
    }
    .branch-input {
      flex: 1; background: var(--po-bg-0);
      border: 1px solid var(--po-border-subtle); border-radius: 4px;
      color: var(--po-text-primary); font-size: 0.72rem; padding: 0.2rem 0.4rem;
    }
    .branch-input::placeholder { color: var(--po-text-secondary); }
    .branch-input:focus { outline: none; border-color: rgba(57,197,207,0.5); }

    .btn-ai-branch { color: #bc8cff !important; }
    .btn-ai-branch:hover:not(:disabled) { background: rgba(188,140,255,0.15) !important; }

    .branch-list { overflow-y: auto; flex: 1; }
    .branch-item {
      display: flex; align-items: center; gap: 0.375rem;
      padding: 0.25rem 0.5rem; font-size: 0.72rem; cursor: pointer; transition: background var(--po-duration-instant);
      color: var(--po-text-primary);
    }
    .branch-item:hover { background: rgba(255,255,255,0.06); }
    .branch-item.active { color: var(--po-success); font-weight: 600; }
    .branch-item.remote { color: var(--po-text-secondary); }
    .branch-item.disabled { color: var(--po-text-secondary); cursor: default; }
    .branch-item-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ── Body ── */
    .git-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

    .git-loading, .git-empty {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      padding: 1rem; font-size: 0.78rem; color: var(--po-text-secondary);
    }

    .git-empty-section { display: flex; flex-direction: column; align-items: center; padding: 0.75rem; gap: 0.5rem; }
    .git-empty-actions { display: flex; gap: 0.4rem; }
    .btn-push-big { border-color: rgba(88,166,255,0.3); background: rgba(88,166,255,0.1); color: var(--po-info); }
    .btn-push-big:hover:not(:disabled) { background: rgba(88,166,255,0.2); }
    .btn-pull-big { border-color: rgba(57,197,207,0.3); background: rgba(57,197,207,0.1); color: var(--po-info); }
    .btn-pull-big:hover:not(:disabled) { background: rgba(57,197,207,0.2); }
    .btn-history { border-color: rgba(188,140,255,0.3); background: rgba(188,140,255,0.1); color: #bc8cff; }
    .btn-history:hover:not(:disabled) { background: rgba(188,140,255,0.2); }

    /* ── Conflict banner ── */
    .conflict-banner {
      background: rgba(248,81,73,0.06); border-bottom: 1px solid rgba(248,81,73,0.2);
      padding: 0.4rem 0.5rem; flex-shrink: 0;
    }
    .conflict-title {
      display: flex; align-items: center; gap: 0.3rem;
      font-size: 0.72rem; font-weight: 600; color: var(--po-error); margin-bottom: 0.3rem;
    }
    .conflict-files { display: flex; flex-direction: column; gap: 0.2rem; }
    .conflict-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.15rem 0; font-size: 0.7rem;
    }
    .conflict-file {
      font-family: monospace; font-size: 0.68rem; color: var(--po-text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
    }
    .btn-resolve { border-color: rgba(188,140,255,0.3); background: rgba(188,140,255,0.1); color: #bc8cff; font-size: 0.6rem; padding: 1px 6px; }
    .btn-resolve:hover:not(:disabled) { background: rgba(188,140,255,0.2); }
    .btn-resolve-all {
      margin-top: 0.3rem; width: 100%;
      border-color: rgba(188,140,255,0.3); background: rgba(188,140,255,0.1); color: #bc8cff;
      justify-content: center;
    }
    .btn-resolve-all:hover:not(:disabled) { background: rgba(188,140,255,0.2); }

    /* ── Commit log ── */
    .commit-log {
      max-height: 160px; overflow-y: auto; border-top: 1px solid var(--po-border-subtle);
    }
    .commit-row {
      display: flex; align-items: baseline; gap: 0.375rem;
      padding: 0.2rem 0.5rem; font-size: 0.68rem; cursor: pointer; transition: background var(--po-duration-instant);
    }
    .commit-row:hover { background: rgba(255,255,255,0.04); }
    .commit-hash {
      font-family: monospace; color: var(--po-info); font-weight: 600; flex-shrink: 0;
    }
    .commit-msg {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--po-text-primary);
    }
    .commit-meta {
      font-size: 0.6rem; color: var(--po-text-secondary); white-space: nowrap; flex-shrink: 0;
    }

    .git-feedback { font-size: 0.65rem; padding: 0.25rem 0.5rem; flex-shrink: 0; display: flex; align-items: center; gap: 0.3rem; }
    .git-feedback.error { color: var(--po-error); background: var(--po-error-bg); }
    .git-feedback.success { color: var(--po-success); background: var(--po-success-bg); }
    .git-feedback-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-open-mini-term {
      display: flex; align-items: center; gap: 0.2rem;
      background: rgba(248,81,73,0.12); border: 1px solid rgba(248,81,73,0.25);
      color: var(--po-error); border-radius: 3px; padding: 0.1rem 0.4rem;
      font-size: 0.6rem; cursor: pointer; white-space: nowrap; flex-shrink: 0;
    }
    .btn-open-mini-term:hover { background: rgba(248,81,73,0.2); }
    .btn-dismiss-mini { background: none; border: none; color: var(--po-error); cursor: pointer; padding: 0.1rem; opacity: 0.6; flex-shrink: 0; }
    .btn-dismiss-mini:hover { opacity: 1; }
    .btn-ai-resolver {
      display: flex; align-items: center; gap: 0.25rem;
      background: linear-gradient(90deg, rgba(110,86,207,0.18), rgba(166,114,255,0.18));
      border: 1px solid rgba(166,114,255,0.45);
      color: #c9b6ff; border-radius: 3px; padding: 0.1rem 0.45rem;
      font-size: 0.6rem; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0;
    }
    .btn-ai-resolver:hover:not(:disabled) { background: linear-gradient(90deg, rgba(110,86,207,0.32), rgba(166,114,255,0.32)); }
    .btn-ai-resolver:disabled { opacity: 0.6; cursor: not-allowed; }
    .ai-resolver-log {
      background: rgba(110,86,207,0.06); border-left: 2px solid rgba(166,114,255,0.5);
      padding: 0.3rem 0.5rem; font-size: 0.6rem; max-height: 110px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 0.15rem; flex-shrink: 0;
    }
    .ai-resolver-step { display: flex; align-items: center; gap: 0.25rem; color: var(--po-text-secondary); }
    .ai-resolver-step iconify-icon { color: #a672ff; flex-shrink: 0; }

    .mini-terminal-panel {
      background: var(--po-bg-0); display: flex; flex-direction: column; max-height: 140px; flex-shrink: 0;
    }
    .mini-term-output {
      flex: 1; overflow-y: auto; padding: 0.3rem 0.5rem; font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.6rem; line-height: 1.5; min-height: 0;
    }
    .mini-term-line { color: var(--po-text-secondary); white-space: pre-wrap; word-break: break-all; }
    .mini-term-line.cmd { color: var(--po-info); }
    .mini-term-input-row {
      display: flex; align-items: center; gap: 0.25rem;
      padding: 0.25rem 0.5rem; border-top: 1px solid rgba(139,148,158,0.15);
    }
    .mini-term-ps1 { color: var(--po-success); font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.6rem; }
    .mini-term-input {
      flex: 1; background: none; border: none; outline: none; color: var(--po-text-primary);
      font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.6rem;
    }
    .mini-term-input::placeholder { color: rgba(139,148,158,0.4); }


    .btn-git-action {
      display: flex; align-items: center; gap: 0.2rem;
      font-size: 0.68rem; font-weight: 600; padding: 3px 8px;
      border: 1px solid; border-radius: 4px; cursor: pointer; transition: all var(--po-duration-fast);
    }
    .btn-git-action:disabled { opacity: 0.4; cursor: not-allowed; }

    .btn-stage { border-color: rgba(63,185,80,0.3); background: rgba(63,185,80,0.1); color: var(--po-success); }
    .btn-stage:hover:not(:disabled) { background: rgba(63,185,80,0.2); }
    .btn-unstage { border-color: rgba(210,153,34,0.3); background: rgba(210,153,34,0.1); color: var(--po-warning); }
    .btn-unstage:hover:not(:disabled) { background: rgba(210,153,34,0.2); }

    /* ── Compact summary ── */
    .git-compact {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--po-border-subtle);
      flex-shrink: 0;
    }
    .git-compact-info { display: flex; align-items: center; gap: 0.5rem; }
    .git-file-count {
      display: flex; align-items: center; gap: 0.25rem;
      font-size: 0.75rem; font-weight: 600; color: var(--po-text-primary);
    }
    .git-staged-count {
      font-size: 0.62rem; font-weight: 600; padding: 1px 6px; border-radius: 3px;
      background: var(--po-success-bg); color: var(--po-success);
    }
    .git-compact-actions { display: flex; gap: 0.25rem; }
    .btn-stage-all { border-color: rgba(63,185,80,0.3); background: rgba(63,185,80,0.1); color: var(--po-success); }
    .btn-stage-all:hover:not(:disabled) { background: rgba(63,185,80,0.2); }

    .git-commit-section { border-top: 1px solid var(--po-border-subtle); padding: 0.4rem 0.5rem; flex-shrink: 0; }

    .commit-input {
      width: 100%; background: var(--po-bg-0);
      border: 1px solid var(--po-border-subtle); border-radius: 4px;
      color: var(--po-text-primary); font-size: 0.75rem;
      padding: 0.3rem 0.4rem; resize: none; font-family: inherit;
    }
    .commit-input::placeholder { color: var(--po-text-secondary); }
    .commit-input:focus { outline: none; border-color: rgba(57,197,207,0.5); }

    .commit-actions { display: flex; gap: 0.3rem; margin-top: 0.3rem; align-items: stretch; }
    .btn-git-settings { color: var(--po-text-muted); flex: 0 0 auto; padding: 4px 7px; }
    .btn-git-settings:hover { color: var(--po-text-primary); }

    .btn-generate { border-color: rgba(188,140,255,0.3); background: rgba(188,140,255,0.1); color: #bc8cff; }
    .btn-generate:hover:not(:disabled) { background: rgba(188,140,255,0.2); }

    .btn-commit { border-color: rgba(63,185,80,0.3); background: rgba(63,185,80,0.1); color: var(--po-success); flex: 1; }
    .btn-commit:hover:not(:disabled) { background: rgba(63,185,80,0.2); }

    /* ── Eye button ── */
    .btn-diff-view {
      display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border: none; border-radius: 3px;
      background: transparent; color: var(--po-text-secondary);
      cursor: pointer; flex-shrink: 0; opacity: 0.5; transition: all var(--po-duration-fast);
    }
    .git-file-row:hover .btn-diff-view { opacity: 1; }
    .btn-diff-view:hover { background: rgba(88,166,255,0.15); color: var(--po-info); opacity: 1; }

    /* ── Diff overlay ── */
    .diff-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
    }
    .diff-panel {
      width: 80vw; max-width: 900px; max-height: 80vh;
      background: var(--po-bg-0);
      border: 1px solid var(--po-border-subtle); border-radius: 8px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .diff-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--po-border-subtle);
      flex-shrink: 0;
    }
    .diff-title {
      display: flex; align-items: center; gap: 0.375rem;
      font-size: 0.8rem; font-weight: 600; color: var(--po-text-primary);
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .diff-content { flex: 1; overflow: auto; min-height: 0; }
    .diff-pre {
      margin: 0; padding: 0.5rem; font-size: 0.72rem; line-height: 1.5;
      font-family: 'SF Mono', 'Fira Code', monospace; white-space: pre;
    }
    .diff-pre span { display: block; padding: 0 0.5rem; }
    .diff-line-add { background: var(--po-success-bg); color: var(--po-success); }
    .diff-line-del { background: var(--po-error-bg); color: var(--po-error); }
    .diff-line-hunk { color: #bc8cff; font-weight: 600; background: rgba(188,140,255,0.06); }
    .diff-line-meta { color: var(--po-text-secondary); }
    .diff-line-ctx { color: var(--po-text-primary); }
  `,
})
export class SessionGitPanelComponent implements OnInit, OnDestroy {
  protected git = inject(GitService);
  protected setup = inject(GitSetupService);
  protected gitSettings = inject(GitSettingsService);
  private store = inject(Store);

  activeSession = toSignal(this.store.select(getActiveSession), { initialValue: null });
  expanded = signal(false);

  // Derived path: decouples refresh triggering from unrelated session updates
  // (e.g. status changes, interaction counters) which would otherwise cause
  // git.reset() + git.refresh() to fire and flash the accordion.
  private workspacePathSig = computed(() => this.activeSession()?.workspace?.path ?? null);

  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  /** Tauri: native watcher instead of polling. */
  private unsubGitChanged: (() => void) | null = null;
  private watchedCwd: string | null = null;

  private get isTauri(): boolean {
    return !!(window as any).__TAURI__;
  }

  private get nativeApi(): any {
    return (window as any).promptops;
  }

  constructor() {
    effect(() => {
      const path = this.workspacePathSig();
      this.git.reset();
      // Multi-repo workspaces resolve to the last repo picked in the Git
      // Explorer or the quick-commit bar (shared GitService context).
      if (path) void this.git.scopeToWorkspace(path);
    });

    // Native watcher attached to the repo in scope (effect in the constructor:
    // outside the injection context Angular would reject it).
    if (this.isTauri) {
      effect(() => {
        const cwd = this.git.effectiveCwd() ?? this.workspacePathSig();
        this.syncWatcher(cwd ?? null);
      });
    }
  }

  ngOnInit(): void {
    // [Tauri] Native watcher: `git status` runs only when something actually
    // changes, instead of every 15s while the panel is open. If the watcher does not start
    // (folder is not a repo, permissions) we stay on the usual poll.
    if (this.isTauri && typeof this.nativeApi?.onGitChanged === 'function') {
      this.unsubGitChanged = this.nativeApi.onGitChanged((payload: { cwd: string }) => {
        if (!this.expanded()) return;
        const cwd = this.cwd;
        if (cwd && payload?.cwd === cwd) this.git.refresh(cwd);
      });
      return;
    }

    this.refreshInterval = setInterval(() => {
      // Windows "Safe terminal": pause the git-status poll (main-thread blocking
      // git status is the prime Windows-lag suspect). Only ever true on Windows.
      if ((window as any).__PO_SAFE_TERMINAL__) return;
      if (this.expanded()) {
        const cwd = this.cwd;
        if (cwd) this.git.refresh(cwd);
      }
    }, 15000);
  }

  /** One watcher at a time, on the repo currently in scope. */
  private syncWatcher(cwd: string | null): void {
    if (this.watchedCwd === cwd) return;
    if (this.watchedCwd) this.stopWatch(this.watchedCwd);
    this.watchedCwd = cwd;
    if (!cwd) return;
    this.nativeApi?.gitWatchStart?.(cwd).catch(() => {
      // Not a repo (or not watchable): no events, and the panel
      // can still be refreshed manually with the refresh button.
      this.watchedCwd = null;
    });
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.unsubGitChanged?.();
    if (this.watchedCwd) this.stopWatch(this.watchedCwd);
    this.watchedCwd = null;
  }

  /** git_watch_stop is an IPC promise: a refusal must not become an unhandled rejection. */
  private stopWatch(cwd: string): void {
    try {
      const res = this.nativeApi?.gitWatchStop?.(cwd);
      if (res && typeof res.catch === 'function') res.catch(() => undefined);
    } catch {
      /* bridge missing or threw synchronously: nothing to stop */
    }
  }

  private get cwd(): string | undefined {
    return this.git.effectiveCwd() ?? this.activeSession()?.workspace?.path;
  }

  onRefresh(e: Event): void { e.stopPropagation(); if (this.cwd) this.git.refresh(this.cwd); }
  stageAll(): void { if (this.cwd) this.git.stageAll(this.cwd); }
  stageSelected(): void { if (this.cwd) this.git.stage(this.cwd); }
  unstageSelected(): void { if (this.cwd) this.git.unstage(this.cwd); }
  allStaged(): boolean { return this.git.files().length > 0 && this.git.files().every(f => f.staged); }
  doCommit(): void { if (this.cwd) this.git.commit(this.cwd); }
  doPull(e: Event): void { e.stopPropagation(); if (this.cwd) this.git.pull(this.cwd); }
  doPush(e: Event): void { e.stopPropagation(); if (this.cwd) this.git.push(this.cwd); }
  doPullDirect(): void { if (this.cwd) this.git.pull(this.cwd); }
  doPushDirect(): void { if (this.cwd) this.git.push(this.cwd); }

  openGitSetup(e?: Event): void {
    e?.stopPropagation();
    if (this.cwd) this.setup.open(this.cwd, this.git.syncError() || undefined, this.activeSession()?.provider);
  }

  /** Heuristic: does the sync error look like a setup / auth problem? */
  isSetupError(msg: string | null): boolean {
    if (!msg) return false;
    const m = msg.toLowerCase();
    return (
      m.includes('permission denied') ||
      m.includes('publickey') ||
      m.includes('authentication failed') ||
      m.includes('could not read username') ||
      m.includes('host key verification') ||
      m.includes('please tell me who you are') ||
      m.includes('no configured push destination') ||
      m.includes('no such remote')
    );
  }

  miniTermCmd = '';
  execPanelTerminal(): void {
    const cmd = this.miniTermCmd.trim();
    if (!cmd || !this.cwd) return;
    this.miniTermCmd = '';
    this.git.exec(this.cwd, cmd);
  }

  toggleBranches(e: Event): void {
    e.stopPropagation();
    const wasOpen = this.git.showBranchDropdown();
    this.git.showBranchDropdown.set(!wasOpen);
    if (!wasOpen) {
      this.expanded.set(true); // ensure panel is open to show dropdown
      if (this.cwd) this.git.loadBranches(this.cwd);
    }
  }

  checkoutBranch(name: string): void {
    if (this.cwd) this.git.checkout(this.cwd, name);
  }

  createBranch(): void {
    if (this.cwd) this.git.createBranch(this.cwd);
  }

  viewDiff(e: Event, filePath: string): void {
    e.stopPropagation();
    if (this.cwd) this.git.viewFileDiff(this.cwd, filePath);
  }

  /** Memoized: a large diff is split once per content change, not on every change-detection pass. */
  readonly diffLines = computed(() => this.git.diffViewContent().split('\n'));

  diffLineClass(line: string): string {
    if (line.startsWith('+++') || line.startsWith('---')) return 'diff-line-meta';
    if (line.startsWith('@@')) return 'diff-line-hunk';
    if (line.startsWith('+')) return 'diff-line-add';
    if (line.startsWith('-')) return 'diff-line-del';
    return 'diff-line-ctx';
  }

  toggleCommitLog(): void {
    const wasOpen = this.git.showCommitLog();
    this.git.showCommitLog.set(!wasOpen);
    if (!wasOpen && this.cwd) this.git.loadCommitLog(this.cwd);
  }

  viewCommit(hash: string): void {
    if (this.cwd) this.git.viewCommit(this.cwd, hash);
  }

  readonly commitDiffLines = computed(() => this.git.commitViewDiff().split('\n'));

  aiResolveSync(): void {
    const session = this.activeSession();
    if (!session?.workspace?.path) return;
    const op: 'pull' | 'push' | 'auto' =
      this.git.pulling() ? 'pull'
      : this.git.pushing() ? 'push'
      : 'auto';
    this.git.aiResolveSync(session.workspace.path, op, session.provider, this.git.syncError() || undefined);
  }

  resolveConflict(filePath: string): void {
    const session = this.activeSession();
    if (session?.workspace?.path) {
      this.git.resolveConflict(session.workspace.path, filePath, session.provider);
    }
  }

  resolveAllConflicts(): void {
    const session = this.activeSession();
    if (session?.workspace?.path) {
      this.git.resolveAllConflicts(session.workspace.path, session.provider);
    }
  }

  generateBranchName(): void {
    const session = this.activeSession();
    if (session?.workspace?.path) {
      this.git.generateBranchName(session.workspace.path, session.provider);
    }
  }

  generateMessage(): void {
    const session = this.activeSession();
    if (session?.workspace?.path) {
      this.git.generateCommitMessage(session.workspace.path, session.provider);
    }
  }

  commitLabel(): string {
    if (this.git.stagedFiles().length > 0 && this.git.selectedPaths().size === 0) return 'Commit';
    if (this.git.selectedPaths().size > 0) return 'Stage & Commit';
    return 'Stage All & Commit';
  }

  statusLabel(file: { status: string }): string {
    switch (file.status) {
      case 'modified': return 'M';
      case 'added': return 'A';
      case 'deleted': return 'D';
      case 'renamed': return 'R';
      case 'untracked': return 'U';
      case 'conflict': return 'C';
      default: return '?';
    }
  }

  fileName(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.substring(idx + 1) : path;
  }
}
