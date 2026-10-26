import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  ViewChild,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { GitService } from '../services/git.service';
import { EscCloseDirective } from '../../../../common/esc-close.directive';

type MergeStrategy = 'default' | 'no-ff' | 'squash' | 'ff-only';

interface MergeRow {
  source: string;
  ok: boolean;
  error?: string;
  conflict?: boolean;
}

@Component({
  selector: 'app-branch-merge-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule, EscCloseDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (open) {
      <div class="bm-backdrop po-modal-overlay" (click)="onBackdrop($event)">
        <div
          class="bm-modal po-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bm-title"
          appEscClose
          (escClose)="onEsc()"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="bm-header po-modal-header">
            <div class="bm-title po-modal-title" id="bm-title">
              <iconify-icon icon="mdi:source-merge" width="18" aria-hidden="true"></iconify-icon>
              {{ 'SESSIONS.BRANCH_MERGE.Title' | translate }}
            </div>
            <button type="button" class="bm-close po-modal-close" (click)="close()" [disabled]="git.merging()" [attr.aria-label]="'BUTTONS.Close' | translate">
              <iconify-icon icon="mdi:close" width="16" aria-hidden="true"></iconify-icon>
            </button>
          </div>

          <!-- Body: 2 columns (Source | Target & options) -->
          <div class="bm-body po-modal-body">
            <!-- ── LEFT: Source picker ───────────────────────────────────────── -->
            <div class="bm-col bm-col-left">
              <div class="bm-section-label" id="bm-sources-label">
                <iconify-icon icon="mdi:source-branch-plus" width="13" aria-hidden="true"></iconify-icon>
                {{ 'SESSIONS.BRANCH_MERGE.Source branches' | translate }}
                <span class="bm-counter">{{ 'SESSIONS.BRANCH_MERGE.Selected count' | translate: { count: selectedSources().size } }}</span>
              </div>

              <input
                #searchInput
                type="text"
                class="bm-search"
                [placeholder]="'SESSIONS.BRANCH_MERGE.Filter placeholder' | translate"
                [attr.aria-label]="'SESSIONS.BRANCH_MERGE.Filter placeholder' | translate"
                [(ngModel)]="filter"
                (ngModelChange)="filterSig.set($event)"
              />

              <div class="bm-branch-list" role="group" aria-labelledby="bm-sources-label">
                <!-- Local -->
                @if (filteredLocal().length > 0) {
                  <div class="bm-group-header">
                    <iconify-icon icon="mdi:laptop" width="11" aria-hidden="true"></iconify-icon>
                    {{ 'SESSIONS.BRANCH_MERGE.Local' | translate }}
                    <span class="bm-group-count">{{ filteredLocal().length }}</span>
                  </div>
                  @for (b of filteredLocal(); track b) {
                    <label
                      class="bm-branch-row"
                      [class.disabled]="b === target()"
                      [title]="b === target() ? ('SESSIONS.BRANCH_MERGE.Cannot merge into itself' | translate) : ''"
                    >
                      <input
                        type="checkbox"
                        [checked]="selectedSources().has(b)"
                        [disabled]="b === target()"
                        (change)="toggleSource(b)"
                      />
                      <iconify-icon
                        [icon]="b === currentBranch ? 'mdi:source-branch-check' : 'mdi:source-branch'"
                        width="12"
                        aria-hidden="true"
                        [style.color]="b === currentBranch ? '#3fb950' : ''"
                      ></iconify-icon>
                      <span class="bm-branch-name">{{ b }}</span>
                      @if (b === currentBranch) { <span class="bm-tag head">HEAD</span> }
                    </label>
                  }
                }

                <!-- Remote -->
                @if (filteredRemote().length > 0) {
                  <div class="bm-group-header">
                    <iconify-icon icon="mdi:cloud-outline" width="11" aria-hidden="true"></iconify-icon>
                    {{ 'SESSIONS.BRANCH_MERGE.Remote' | translate }}
                    <span class="bm-group-count">{{ filteredRemote().length }}</span>
                  </div>
                  @for (b of filteredRemote(); track b) {
                    <label class="bm-branch-row">
                      <input
                        type="checkbox"
                        [checked]="selectedSources().has(b)"
                        (change)="toggleSource(b)"
                      />
                      <iconify-icon icon="mdi:source-branch" width="12" aria-hidden="true" style="color: var(--po-text-secondary)"></iconify-icon>
                      <span class="bm-branch-name remote">{{ b }}</span>
                    </label>
                  }
                }

                @if (filteredLocal().length === 0 && filteredRemote().length === 0) {
                  <div class="bm-empty">{{ 'SESSIONS.BRANCH_MERGE.No match' | translate }}</div>
                }
              </div>
            </div>

            <!-- ── RIGHT: Target + options ─────────────────────────────────── -->
            <div class="bm-col bm-col-right">
              <!-- Target -->
              <div class="bm-section-label" id="bm-target-label">
                <iconify-icon icon="mdi:target" width="13" aria-hidden="true"></iconify-icon>
                {{ 'SESSIONS.BRANCH_MERGE.Target branch' | translate }}
              </div>
              <div class="bm-target-pill">
                <iconify-icon icon="mdi:source-branch-check" width="13" aria-hidden="true" style="color:var(--po-success)"></iconify-icon>
                <select class="bm-target-select" aria-labelledby="bm-target-label" [ngModel]="target()" (ngModelChange)="onTargetChange($event)">
                  @for (b of localBranches; track b) {
                    <option [value]="b">{{ b }}{{ b === currentBranch ? ' (' + ('SESSIONS.BRANCH_MERGE.Current' | translate) + ')' : '' }}</option>
                  }
                </select>
              </div>

              <!-- Strategy -->
              <div class="bm-section-label" id="bm-strategy-label" style="margin-top: 1rem">
                <iconify-icon icon="mdi:source-merge" width="13" aria-hidden="true"></iconify-icon>
                {{ 'SESSIONS.BRANCH_MERGE.Strategy' | translate }}
              </div>
              <div class="bm-strategy-list" role="radiogroup" aria-labelledby="bm-strategy-label">
                <label class="bm-strategy-row" [class.active]="strategy() === 'default'">
                  <input type="radio" name="strat" value="default" [ngModel]="strategy()" (ngModelChange)="strategy.set($event)" />
                  <div>
                    <div class="bm-strat-title">{{ 'SESSIONS.BRANCH_MERGE.Strategy default' | translate }}</div>
                    <div class="bm-strat-hint">{{ 'SESSIONS.BRANCH_MERGE.Strategy default hint' | translate }}</div>
                  </div>
                </label>
                <label class="bm-strategy-row" [class.active]="strategy() === 'no-ff'">
                  <input type="radio" name="strat" value="no-ff" [ngModel]="strategy()" (ngModelChange)="strategy.set($event)" />
                  <div>
                    <div class="bm-strat-title">{{ 'SESSIONS.BRANCH_MERGE.Strategy no-ff' | translate }} <code>--no-ff</code></div>
                    <div class="bm-strat-hint">{{ 'SESSIONS.BRANCH_MERGE.Strategy no-ff hint' | translate }}</div>
                  </div>
                </label>
                <label class="bm-strategy-row" [class.active]="strategy() === 'squash'">
                  <input type="radio" name="strat" value="squash" [ngModel]="strategy()" (ngModelChange)="strategy.set($event)" />
                  <div>
                    <div class="bm-strat-title">{{ 'SESSIONS.BRANCH_MERGE.Strategy squash' | translate }} <code>--squash</code></div>
                    <div class="bm-strat-hint">{{ 'SESSIONS.BRANCH_MERGE.Strategy squash hint' | translate }}</div>
                  </div>
                </label>
                <label class="bm-strategy-row" [class.active]="strategy() === 'ff-only'">
                  <input type="radio" name="strat" value="ff-only" [ngModel]="strategy()" (ngModelChange)="strategy.set($event)" />
                  <div>
                    <div class="bm-strat-title">{{ 'SESSIONS.BRANCH_MERGE.Strategy ff-only' | translate }} <code>--ff-only</code></div>
                    <div class="bm-strat-hint">{{ 'SESSIONS.BRANCH_MERGE.Strategy ff-only hint' | translate }}</div>
                  </div>
                </label>
              </div>

              <!-- Auto-stash -->
              <label class="bm-checkbox-row" style="margin-top: 1rem">
                <input type="checkbox" [(ngModel)]="autoStash" />
                <div>
                  <div class="bm-strat-title">{{ 'SESSIONS.BRANCH_MERGE.Auto-stash' | translate }}</div>
                  <div class="bm-strat-hint">{{ 'SESSIONS.BRANCH_MERGE.Auto-stash hint' | translate }}</div>
                </div>
              </label>

              <!-- Optional commit message (only for merge commit) -->
              @if (strategy() === 'no-ff' || strategy() === 'default') {
                <label class="bm-section-label" for="bm-message" style="margin-top: 1rem">
                  <iconify-icon icon="mdi:message-text-outline" width="13" aria-hidden="true"></iconify-icon>
                  {{ 'SESSIONS.BRANCH_MERGE.Commit message' | translate }} <span class="bm-hint">{{ 'SESSIONS.BRANCH_MERGE.Commit message hint' | translate }}</span>
                </label>
                <input
                  id="bm-message"
                  type="text"
                  class="bm-message-input"
                  [placeholder]="'SESSIONS.BRANCH_MERGE.Commit message placeholder' | translate"
                  [(ngModel)]="message"
                />
              }
            </div>
          </div>

          <!-- Preview -->
          <div class="bm-preview">
            <iconify-icon icon="mdi:console" width="12" aria-hidden="true"></iconify-icon>
            <code>{{ commandPreview() || ('SESSIONS.BRANCH_MERGE.Preview empty' | translate) }}</code>
          </div>

          <!-- Results / errors -->
          @if (git.merging()) {
            <div class="bm-status running" role="status">
              <iconify-icon icon="mdi:refresh" width="14" class="spinning" aria-hidden="true"></iconify-icon>
              {{ 'SESSIONS.BRANCH_MERGE.Merging' | translate }}
            </div>
          }
          @if (mergeError()) {
            <div class="bm-status error" role="alert">
              <iconify-icon icon="mdi:alert" width="14" aria-hidden="true"></iconify-icon>
              {{ mergeError() }}
            </div>
          }
          @if (results().length > 0) {
            <div class="bm-results">
              @for (r of results(); track r.source) {
                <div class="bm-result-row" [class.ok]="r.ok" [class.fail]="!r.ok" [class.conflict]="r.conflict">
                  <iconify-icon
                    [icon]="r.ok ? 'mdi:check-circle' : (r.conflict ? 'mdi:alert-octagon' : 'mdi:close-circle')"
                    width="13"
                    aria-hidden="true"
                  ></iconify-icon>
                  <span class="bm-result-source">{{ r.source }}</span>
                  @if (r.ok) {
                    <span class="bm-result-ok">{{ 'SESSIONS.BRANCH_MERGE.Merged' | translate }}</span>
                  } @else if (r.conflict) {
                    <span class="bm-result-conflict">{{ 'SESSIONS.BRANCH_MERGE.Conflict' | translate }}</span>
                  } @else if (r.error) {
                    <span class="bm-result-err" [title]="r.error">{{ r.error }}</span>
                  }
                </div>
              }
            </div>
          }

          <!-- Footer -->
          <div class="bm-footer po-modal-footer">
            <div class="bm-footer-left">
              @if (hasConflict()) {
                <button type="button" class="bm-btn warning" (click)="abort()" [disabled]="git.merging()">
                  <iconify-icon icon="mdi:undo-variant" width="13" aria-hidden="true"></iconify-icon>
                  {{ 'SESSIONS.BRANCH_MERGE.Abort merge' | translate }}
                </button>
              }
            </div>
            <div class="bm-footer-right">
              <button type="button" class="bm-btn ghost" (click)="close()" [disabled]="git.merging()">{{ 'BUTTONS.Cancel' | translate }}</button>
              <button
                type="button"
                class="bm-btn primary"
                (click)="runMerge()"
                [disabled]="!canMerge() || git.merging()"
              >
                <iconify-icon icon="mdi:source-merge" width="14" aria-hidden="true"></iconify-icon>
                {{ 'SESSIONS.BRANCH_MERGE.Merge into' | translate: { count: selectedSources().size, target: target() || '…' } }}
                <kbd class="bm-kbd" aria-hidden="true">⏎</kbd>
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .bm-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 1080; backdrop-filter: blur(2px);
    }
    .bm-modal {
      background: var(--po-bg-3, #161b22);
      border: 1px solid var(--po-border-subtle, #30363d);
      border-radius: 10px;
      width: min(880px, calc(100vw - 32px)); max-height: 92vh;
      display: flex; flex-direction: column;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    .bm-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--po-border-subtle, #30363d);
      background: linear-gradient(180deg, oklch(from var(--po-accent) l c h / 8%), transparent);
    }
    .bm-title {
      display: flex; align-items: center; gap: 0.45rem;
      font-weight: 600; font-size: 0.875rem;
      color: var(--po-text-primary, #e6edf3);
    }
    .bm-close {
      background: transparent; border: 0; color: var(--po-text-secondary, #8b949e);
      cursor: pointer; padding: 0.25rem; border-radius: 4px;
      display: flex; align-items: center;
    }
    .bm-close:hover { background: rgba(255,255,255,0.06); color: var(--po-text-primary, #e6edf3); }

    .bm-body {
      display: grid; grid-template-columns: 1fr 1fr;
      grid-template-rows: minmax(0, 1fr);
      gap: 0;
      /* Grows up to 360px but shrinks with the viewport: header, preview,
         results and footer stay visible, the columns scroll. */
      flex: 1 1 360px; min-height: 0;
      overflow: hidden;
    }
    .bm-header, .bm-preview, .bm-status, .bm-results, .bm-footer { flex-shrink: 0; }
    @media (max-width: 640px) {
      .bm-body { grid-template-columns: 1fr; grid-template-rows: auto; overflow-y: auto; }
      .bm-col-left { border-inline-end: 0 !important; border-bottom: 1px solid var(--po-border-subtle, #30363d); }
      .bm-branch-list { max-height: 40vh; }
      .bm-footer { flex-wrap: wrap; }
    }
    .bm-col {
      padding: 0.85rem 1rem;
      display: flex; flex-direction: column;
      min-width: 0;
    }
    .bm-col-left { border-inline-end: 1px solid var(--po-border-subtle, #30363d); overflow: hidden; }
    .bm-col-right { overflow-y: auto; }

    .bm-section-label {
      display: flex; align-items: center; gap: 0.35rem;
      font-size: 0.7rem; font-weight: 600;
      color: var(--po-text-secondary, #8b949e);
      text-transform: uppercase; letter-spacing: 0.04em;
      margin-bottom: 0.45rem;
    }
    .bm-counter {
      margin-inline-start: auto; font-weight: 500; font-size: 0.65rem;
      color: rgba(165, 180, 252, 0.9);
      background: oklch(from var(--po-accent) l c h / 12%);
      padding: 0.05rem 0.4rem; border-radius: 10px;
      text-transform: none; letter-spacing: 0;
    }
    .bm-hint {
      text-transform: none; letter-spacing: 0;
      font-weight: 400; color: var(--po-text-secondary, #8b949e);
      margin-inline-start: 0.35rem;
    }

    .bm-search {
      width: 100%; padding: 0.4rem 0.55rem;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--po-border-subtle, #30363d);
      border-radius: 6px; font-size: 0.75rem;
      color: var(--po-text-primary, #e6edf3);
      margin-bottom: 0.45rem;
    }
    .bm-search:focus {
      outline: none;
      border-color: oklch(from var(--po-accent) l c h / 50%);
      box-shadow: 0 0 0 2px oklch(from var(--po-accent) l c h / 15%);
    }

    .bm-branch-list {
      flex: 1; min-height: 0; overflow-y: auto;
      border: 1px solid var(--po-border-subtle, #30363d);
      border-radius: 6px;
      padding: 0.25rem;
      background: rgba(255,255,255,0.015);
    }
    .bm-group-header {
      display: flex; align-items: center; gap: 0.35rem;
      font-size: 0.65rem; font-weight: 600;
      color: var(--po-text-secondary, #8b949e);
      text-transform: uppercase; letter-spacing: 0.04em;
      padding: 0.45rem 0.45rem 0.25rem;
    }
    .bm-group-count {
      margin-inline-start: auto; font-weight: 500;
      background: rgba(255,255,255,0.05);
      padding: 0.02rem 0.35rem; border-radius: 8px;
    }
    .bm-branch-row {
      display: flex; align-items: center; gap: 0.45rem;
      padding: 0.35rem 0.45rem;
      border-radius: 4px; cursor: pointer;
      font-size: 0.78rem;
      color: var(--po-text-primary, #e6edf3);
    }
    .bm-branch-row:hover { background: rgba(99,102,241,0.08); }
    .bm-branch-row.disabled { opacity: 0.4; cursor: not-allowed; }
    .bm-branch-row input[type=checkbox] {
      accent-color: var(--po-accent);
      cursor: pointer;
    }
    .bm-branch-name {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .bm-branch-name.remote { color: var(--po-text-secondary, #8b949e); }
    .bm-tag {
      font-size: 0.55rem; font-weight: 700;
      padding: 0.05rem 0.35rem; border-radius: 3px;
      letter-spacing: 0.05em;
    }
    .bm-tag.head { background: rgba(63, 185, 80, 0.18); color: #3fb950; }
    .bm-empty {
      text-align: center; padding: 1.5rem 0;
      color: var(--po-text-secondary, #8b949e);
      font-size: 0.75rem;
    }

    .bm-target-pill {
      display: flex; align-items: center; gap: 0.4rem;
      padding: 0.4rem 0.55rem;
      background: oklch(from var(--po-accent) l c h / 8%);
      border: 1px solid oklch(from var(--po-accent) l c h / 30%);
      border-radius: 6px;
    }
    .bm-target-select {
      flex: 1;
      background: transparent;
      border: 0; outline: none;
      font-size: 0.8rem; color: var(--po-text-primary, #e6edf3);
      cursor: pointer;
    }

    .bm-strategy-list {
      display: flex; flex-direction: column; gap: 0.35rem;
    }
    .bm-strategy-row, .bm-checkbox-row {
      display: flex; align-items: flex-start; gap: 0.55rem;
      padding: 0.5rem 0.65rem;
      border: 1px solid var(--po-border-subtle, #30363d);
      border-radius: 6px; cursor: pointer;
      transition: border-color 0.12s ease, background 0.12s ease;
    }
    .bm-strategy-row:hover, .bm-checkbox-row:hover {
      background: rgba(255,255,255,0.03);
    }
    .bm-strategy-row.active {
      border-color: oklch(from var(--po-accent) l c h / 50%);
      background: oklch(from var(--po-accent) l c h / 8%);
    }
    .bm-strategy-row input, .bm-checkbox-row input {
      margin-top: 0.18rem;
      accent-color: var(--po-accent);
      cursor: pointer;
    }
    .bm-strat-title {
      font-size: 0.78rem; font-weight: 600;
      color: var(--po-text-primary, #e6edf3);
    }
    .bm-strat-title code {
      font-size: 0.7rem; padding: 0.05rem 0.3rem;
      background: rgba(255,255,255,0.06);
      border-radius: 3px; margin-inline-start: 0.3rem;
      color: rgba(165, 180, 252, 1);
    }
    .bm-strat-hint {
      font-size: 0.7rem; color: var(--po-text-secondary, #8b949e);
      margin-top: 0.15rem;
    }

    .bm-message-input {
      width: 100%; padding: 0.4rem 0.55rem;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--po-border-subtle, #30363d);
      border-radius: 6px; font-size: 0.75rem;
      color: var(--po-text-primary, #e6edf3);
    }
    .bm-message-input:focus {
      outline: none; border-color: rgba(139, 92, 246, 0.5);
      box-shadow: 0 0 0 2px oklch(from var(--po-accent) l c h / 15%);
    }

    .bm-preview {
      display: flex; align-items: center; gap: 0.4rem;
      padding: 0.5rem 1rem;
      background: rgba(0,0,0,0.25);
      border-top: 1px solid var(--po-border-subtle, #30363d);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.72rem;
      color: var(--po-text-secondary, #8b949e);
      overflow-x: auto;
    }
    .bm-preview code { color: rgba(165, 180, 252, 1); white-space: nowrap; }

    .bm-status {
      display: flex; align-items: center; gap: 0.45rem;
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      border-top: 1px solid var(--po-border-subtle, #30363d);
    }
    .bm-status.running { color: rgba(165, 180, 252, 1); background: rgba(99,102,241,0.06); }
    .bm-status.error { color: var(--po-error, #f85149); background: rgba(248, 81, 73, 0.08); }

    .bm-results {
      max-height: 140px; overflow-y: auto;
      border-top: 1px solid var(--po-border-subtle, #30363d);
      background: rgba(0,0,0,0.15);
    }
    .bm-result-row {
      display: flex; align-items: center; gap: 0.45rem;
      padding: 0.35rem 1rem;
      font-size: 0.72rem;
    }
    .bm-result-row.ok { color: #3fb950; }
    .bm-result-row.fail { color: var(--po-error, #f85149); }
    .bm-result-row.conflict { color: #f0883e; }
    .bm-result-source { font-weight: 600; color: var(--po-text-primary, #e6edf3); }
    .bm-result-ok { font-style: italic; opacity: 0.8; }
    .bm-result-conflict { font-weight: 500; }
    .bm-result-err {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.7rem;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .bm-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--po-border-subtle, #30363d);
      background: rgba(0,0,0,0.18);
      gap: 0.5rem;
    }
    .bm-footer-right { display: flex; gap: 0.5rem; align-items: center; }

    .bm-btn {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.45rem 0.85rem;
      border-radius: 6px; border: 1px solid transparent;
      font-size: 0.78rem; font-weight: 500; cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
    }
    .bm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .bm-btn.ghost {
      background: transparent;
      color: var(--po-text-secondary, #8b949e);
      border-color: var(--po-border-subtle, #30363d);
    }
    .bm-btn.ghost:hover:not(:disabled) {
      background: rgba(255,255,255,0.04);
      color: var(--po-text-primary, #e6edf3);
    }
    .bm-btn.warning {
      background: rgba(240, 136, 62, 0.12);
      color: #f0883e; border-color: rgba(240, 136, 62, 0.4);
    }
    .bm-btn.warning:hover:not(:disabled) { background: rgba(240, 136, 62, 0.2); }
    .bm-btn.primary {
      background: linear-gradient(180deg, var(--po-accent), var(--po-accent));
      color: white; border-color: rgba(99, 102, 241, 0.6);
      box-shadow: 0 1px 3px oklch(from var(--po-accent) l c h / 25%);
    }
    .bm-btn.primary:hover:not(:disabled) {
      filter: brightness(1.08);
      box-shadow: 0 2px 6px oklch(from var(--po-accent) l c h / 35%);
    }
    .bm-kbd {
      background: rgba(255,255,255,0.18);
      padding: 0.05rem 0.3rem; border-radius: 3px;
      font-size: 0.7rem; font-family: inherit;
      margin-inline-start: 0.3rem;
    }

    .spinning { animation: bm-spin 1s linear infinite; }
    @keyframes bm-spin { to { transform: rotate(360deg); } }
  `],
})
export class BranchMergeModalComponent implements OnInit, OnChanges, OnDestroy {
  git = inject(GitService);

  @Input() open = false;
  @Input() cwd = '';
  /**
   * Signal-backed: `filteredLocal`/`filteredRemote` are computed() and must
   * recompute when the parent passes a new branch list (a plain field kept
   * the first list forever, so new/deleted branches never showed up).
   */
  private readonly branchesSig = signal<string[]>([]);
  @Input() set branches(value: string[] | null | undefined) { this.branchesSig.set(value ?? []); }
  get branches(): string[] { return this.branchesSig(); }
  @Input() currentBranch = '';
  /** Optional pre-selected source branch (used by right-click "Merge into current"). */
  @Input() initialSource: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() completed = new EventEmitter<void>();

  selectedSources = signal<Set<string>>(new Set());
  target = signal<string>('');
  strategy = signal<MergeStrategy>('default');
  filter = '';
  filterSig = signal('');
  message = '';
  autoStash = false;

  results = computed<MergeRow[]>(() => this.git.mergeResults() as MergeRow[]);
  mergeError = computed(() => this.git.mergeError());
  hasConflict = computed(() => this.results().some(r => r.conflict));

  get localBranches(): string[] {
    return this.branches.filter(b => !b.startsWith('origin/'));
  }
  get remoteBranches(): string[] {
    return this.branches.filter(b => b.startsWith('origin/'));
  }

  filteredLocal = computed(() => {
    const f = this.filterSig().toLowerCase();
    return this.localBranches.filter(b => !f || b.toLowerCase().includes(f));
  });
  filteredRemote = computed(() => {
    const f = this.filterSig().toLowerCase();
    return this.remoteBranches.filter(b => !f || b.toLowerCase().includes(f));
  });

  canMerge = computed(() =>
    this.selectedSources().size > 0 &&
    !!this.target() &&
    !this.selectedSources().has(this.target())
  );

  commandPreview = computed(() => {
    const srcs = Array.from(this.selectedSources());
    // Empty = the template shows the translated placeholder.
    if (srcs.length === 0 || !this.target()) return '';
    const flag =
      this.strategy() === 'no-ff' ? ' --no-ff' :
      this.strategy() === 'squash' ? ' --squash' :
      this.strategy() === 'ff-only' ? ' --ff-only' : '';
    return `git checkout ${this.target()} && git merge${flag} ${srcs.join(' ')}`;
  });

  private autoCloseTimer?: ReturnType<typeof setTimeout>;
  private focusedSearch?: ElementRef<HTMLInputElement>;

  /** Focus the branch filter each time the modal opens. */
  @ViewChild('searchInput') set searchInput(ref: ElementRef<HTMLInputElement> | undefined) {
    if (!ref) { this.focusedSearch = undefined; return; }
    if (ref === this.focusedSearch) return;
    this.focusedSearch = ref;
    queueMicrotask(() => ref.nativeElement.focus());
  }

  ngOnInit(): void {
    this.applyInputs();
  }

  ngOnDestroy(): void {
    clearTimeout(this.autoCloseTimer);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.applyInputs();
    }
  }

  private applyInputs(): void {
    if (!this.target()) this.target.set(this.currentBranch || (this.localBranches[0] ?? ''));
    if (this.initialSource) {
      const next = new Set<string>([this.initialSource]);
      this.selectedSources.set(next);
    }
  }

  toggleSource(branch: string): void {
    this.selectedSources.update(prev => {
      const next = new Set(prev);
      if (next.has(branch)) next.delete(branch);
      else next.add(branch);
      return next;
    });
  }

  onTargetChange(value: string): void {
    this.target.set(value);
    // Drop the target from the selected sources set if present
    this.selectedSources.update(prev => {
      if (!prev.has(value)) return prev;
      const next = new Set(prev);
      next.delete(value);
      return next;
    });
  }

  onBackdrop(_evt: MouseEvent): void {
    if (this.git.merging()) return;
    this.close();
  }

  close(): void {
    clearTimeout(this.autoCloseTimer);
    // Next open re-targets the CURRENT branch (it may have changed meanwhile).
    this.target.set('');
    this.git.mergeError.set(null);
    this.git.mergeResults.set([]);
    this.selectedSources.set(new Set());
    this.message = '';
    this.filter = '';
    this.filterSig.set('');
    this.closed.emit();
  }

  async runMerge(): Promise<void> {
    if (!this.canMerge() || this.git.merging()) return;
    const sources = Array.from(this.selectedSources());
    const result = await this.git.merge(
      this.cwd,
      sources,
      this.target(),
      this.strategy(),
      this.message.trim() || undefined,
      this.autoStash,
    );
    if (result.ok) {
      this.completed.emit();
      // Auto-close on full success
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = setTimeout(() => this.close(), 600);
    }
  }

  async abort(): Promise<void> {
    const res = await this.git.mergeAbort(this.cwd);
    // The abort failure used to be dropped: surface it in the error strip.
    if (!res?.ok) this.git.mergeError.set(res?.error || null);
    this.completed.emit();
  }

  /**
   * Enter = Merge, only when safe: not from a textarea, a button (Enter on
   * Cancel/Abort must do what the button says), a select or a link, not
   * while composing, not when an NgbModal sits on top, and only when the
   * merge is actually possible.
   */
  @HostListener('document:keydown.enter', ['$event'])
  onEnter(evt: KeyboardEvent): void {
    if (!this.open || evt.defaultPrevented || evt.isComposing) return;
    const tag = (evt.target as HTMLElement | null)?.tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'A') return;
    if (typeof document !== 'undefined' && document.querySelector('ngb-modal-window')) return;
    if (this.canMerge() && !this.git.merging()) {
      evt.preventDefault();
      void this.runMerge();
    }
  }

  /** Esc comes from the shared appEscClose stack (topmost overlay only). */
  onEsc(): void {
    if (!this.open || this.git.merging()) return;
    this.close();
  }
}
