import { Component, CUSTOM_ELEMENTS_SCHEMA, effect, inject, OnDestroy, signal, computed, viewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { NgbModal, NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { CommandActionModalComponent } from '../../views/admin-core/sessions/command-action-modal/command-action-modal.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { VoiceAgentComponent } from '@/app/components/voice-agent/voice-agent.component';
import { VoiceAgentService } from '@/app/components/voice-agent/voice-agent.service';
import { CloudFeatureModalComponent } from '@components/cloud-feature-modal/cloud-feature-modal.component';
import { SessionShortcutsModalComponent } from '../../views/admin-core/sessions/session-shortcuts-modal/session-shortcuts-modal.component';
import { UiStyleService, UiStyle } from '@core/services/ui-style.service';
import { Store } from '@ngrx/store';
import {
  AVAILABLE_LANGUAGES,
  LanguagePickerModalComponent,
} from '@/app/components/language-picker-modal/language-picker-modal.component';
import { distinctUntilChanged, filter, map, switchMap } from 'rxjs/operators';
import { Subscription, of } from 'rxjs';
import { VersionService } from '@core/services/version.service';
import { DesktopUpdateService } from '@core/services/desktop-update.service';
import { SmartActionService } from '../../views/admin-core/sessions/services/smart-action.service';
import { EcoModeService, EcoLevel } from '../../views/admin-core/sessions/services/eco-mode.service';
import { APP_VERSION } from '@environment/version';
import { getActiveSession } from '@/store/sessions/session.selectors';
import { getSessionTokenStats } from '@/store/token-efficiency/token-efficiency.selectors';
import { loadSessionTokenStats } from '@/store/token-efficiency/token-efficiency.actions';
import { SessionTokenStats, OptimizationAnalytics } from '@/store/token-efficiency/token-efficiency.state';
import { KebabMenuComponent, KebabMenuItem } from '@/app/common/kebab-menu/kebab-menu.component';
import { EscCloseDirective } from '@/app/common/esc-close.directive';
import { ClaudeHookService } from '../../views/admin-core/sessions/services/claude-hook.service';
import { GITHUB_ISSUES_URL, openExternal } from '@core/local-mode';

/**
 * Script names, make targets and script files come from the workspace on disk, i.e.
 * from whoever wrote the repository. They are pasted into a shell after one click, so a
 * name such as `lint; curl … | sh` or one carrying a carriage return or an escape
 * sequence (invisible in the preview) would run more than the person read. Real names
 * are plain words: letters, digits and `_ - . : @ / + =`.
 */
export function isSafeCommandWord(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name.length <= 120 && /^[A-Za-z0-9_@][A-Za-z0-9_.:@\/+=-]*$/.test(name);
}

interface OptimizationEntry {
  key: string;
  name: string;
  icon: string;
  description: string;
  analytics: OptimizationAnalytics | null;
}

/** name / description are translation keys (rendered with the translate pipe). */
const OPTIMIZATION_META: Record<string, { name: string; icon: string; description: string }> = {
  used_context_injection: { name: 'BOTTOM_BAR.ENGINES.used_context_injection.Name', icon: 'solar:map-bold', description: 'BOTTOM_BAR.ENGINES.used_context_injection.Desc' },
  used_cache: { name: 'BOTTOM_BAR.ENGINES.used_cache.Name', icon: 'solar:database-bold', description: 'BOTTOM_BAR.ENGINES.used_cache.Desc' },
  used_graph_query: { name: 'BOTTOM_BAR.ENGINES.used_graph_query.Name', icon: 'solar:share-circle-bold', description: 'BOTTOM_BAR.ENGINES.used_graph_query.Desc' },
  used_compaction: { name: 'BOTTOM_BAR.ENGINES.used_compaction.Name', icon: 'solar:minimize-square-bold', description: 'BOTTOM_BAR.ENGINES.used_compaction.Desc' },
  used_tool_filtering: { name: 'BOTTOM_BAR.ENGINES.used_tool_filtering.Name', icon: 'solar:filter-bold', description: 'BOTTOM_BAR.ENGINES.used_tool_filtering.Desc' },
  used_code_execution: { name: 'BOTTOM_BAR.ENGINES.used_code_execution.Name', icon: 'solar:play-bold', description: 'BOTTOM_BAR.ENGINES.used_code_execution.Desc' },
  used_prompt_dedup: { name: 'BOTTOM_BAR.ENGINES.used_prompt_dedup.Name', icon: 'solar:copy-bold', description: 'BOTTOM_BAR.ENGINES.used_prompt_dedup.Desc' },
  used_diff_only: { name: 'BOTTOM_BAR.ENGINES.used_diff_only.Name', icon: 'solar:document-medicine-bold', description: 'BOTTOM_BAR.ENGINES.used_diff_only.Desc' },
  used_batch_reads: { name: 'BOTTOM_BAR.ENGINES.used_batch_reads.Name', icon: 'solar:layers-bold', description: 'BOTTOM_BAR.ENGINES.used_batch_reads.Desc' },
  used_conversation_pruning: { name: 'BOTTOM_BAR.ENGINES.used_conversation_pruning.Name', icon: 'solar:scissors-bold', description: 'BOTTOM_BAR.ENGINES.used_conversation_pruning.Desc' },
  used_subagent_scoping: { name: 'BOTTOM_BAR.ENGINES.used_subagent_scoping.Name', icon: 'solar:target-bold', description: 'BOTTOM_BAR.ENGINES.used_subagent_scoping.Desc' },
};

@Component({
  selector: 'app-bottom-bar',
  standalone: true,
  imports: [TranslateModule, RouterModule, NgbDropdownModule, VoiceAgentComponent, KebabMenuComponent, EscCloseDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="bottom-bar" [class.in-session]="inSession()">
      <!-- Minimal: the mic dock has two states with per-context defaults —
           in session it starts as the liquid orb fixed top-center (can be
           minimized into the bar); everywhere else it starts in the bar at
           far left under the sidebar avatar (can be expanded to the orb). -->
      @if (uiStyle() === 'minimal') {
        @if (voiceDockExpanded()) {
          <app-voice-agent variant="fab" [minimizable]="true" (minimize)="setVoiceDockExpanded(false)"></app-voice-agent>
        } @else {
          <app-voice-agent #voiceLeft class="bb-voice bb-voice-left" [showGuideButton]="true" [bubbleAbove]="true"
                           [expandable]="true" (expand)="setVoiceDockExpanded(true)"></app-voice-agent>
        }
      }

      <!-- Left group: horizontally scrollable on narrow screens (mobile-tabbar style) -->
      <div class="bb-scroll" [style.--bb-voice-reserve]="voiceLeftReserve() + 'px'">

      <!-- Token efficiency section (only in sessions, offset to match content area) -->
      @if (inSession() && stats()) {
        <div class="token-section" (click)="openTokenModal()">
          <span class="tc title">
            {{ 'TOKEN_STATS.Efficiency' | translate }}
          </span>
          <span class="tc">
            <span class="tl" [title]="'BOTTOM_BAR.Used tooltip' | translate">{{ 'BOTTOM_BAR.Used' | translate }}</span>
            <span class="tv">{{ fmtNum(stats()!.tokensUsed) }}</span>
          </span>
          @if (stats()!.savingsAvailable === false) {
            <!-- No measured PromptOps saving: show the provider's prompt cache
                 instead of a SAVED that would always read 0. -->
            @if ((stats()!.cacheHitPercentage ?? 0) > 0) {
              <span class="tc">
                <span class="tl" [title]="cacheTooltip()">{{ 'BOTTOM_BAR.Cache' | translate }}</span>
                <span class="tv" [class.green]="stats()!.cacheHitPercentage! >= 50">{{ fmtPct(stats()!.cacheHitPercentage!) }}%</span>
              </span>
            }
          } @else {
            <span class="tc">
              <span class="tl" [title]="'BOTTOM_BAR.Saved tooltip' | translate">{{ 'BOTTOM_BAR.Saved' | translate }}</span>
              <span class="tv green">{{ fmtNum(stats()!.tokensSaved) }}</span>
            </span>
            <span class="tc">
              <span class="tv" [class.green]="stats()!.efficiencyPercentage > 0">{{ fmtPct(stats()!.efficiencyPercentage) + '%' }}</span>
            </span>
          }
          @if (hasActiveFlags(stats()!)) {
            <span class="tc chips">
              @for (opt of activeOptimizations(); track opt.key) {
                <span class="chip" [title]="chipTooltip(opt)">
                  <iconify-icon [icon]="opt.icon" width="10"></iconify-icon>
                </span>
              }
            </span>
          }
        </div>
      }

      <!-- Provider usage: moved to action-center sidebar accordion -->

      <!-- Knowledge Graph query (moved inside efficiency modal) -->

      <!-- Workspace commands scan -->
      @if (inSession() && activeSessionId() && smartActionService.isDesktop) {
        <button class="cmd-scan-btn"
                [class.scanning]="smartActionService.scanning()"
                (click)="openCommandsModal()">
          <iconify-icon
            [icon]="smartActionService.scanning() ? 'solar:refresh-bold' : 'solar:folder-with-files-bold-duotone'"
            width="12"
            [class.cmd-spin]="smartActionService.scanning()"></iconify-icon>
          {{ 'BOTTOM_BAR.Commands' | translate }}
          @if (smartActionService.folderMap().length > 0) {
            <span class="cmd-count">{{ smartActionService.folderMap().length }}</span>
          }
        </button>
      }

      <!-- Eco Mode (energy saving) -->
      @if (inSession() && activeSessionId()) {
        <button class="eco-btn" [class.active]="ecoMode()" (click)="openEcoModal()">
          <iconify-icon [icon]="ecoMode() ? 'solar:leaf-bold' : 'solar:leaf-bold-duotone'" width="12"></iconify-icon>
          {{ 'BOTTOM_BAR.Eco' | translate }}
          @if (ecoMode()) {
            <span class="eco-badge">{{ 'BOTTOM_BAR.On' | translate }}</span>
          }
        </button>
      }

      </div><!-- /bb-scroll -->

      <!-- Spacer -->
      <div class="spacer"></div>

      <!-- Update chip — web only: on desktop the new version lives on the Updates button (in-app updater, not GitHub). -->
      @if (!desktopUpdate.isDesktop && versionService.state().updateAvailable && !versionService.state().updateRequired) {
        <a class="update-chip" [href]="versionService.state().updateUrl" target="_blank" rel="noopener noreferrer">
          <span class="update-dot"></span>
          v{{ versionService.state().latestVersion }}
        </a>
      }

      <!-- Right cells that collapse into the ⋮ menu on narrow screens -->
      <div class="bb-right">

      <!-- Minimal: mobile relocated here from the hidden header (mic moved to far left). -->
      @if (uiStyle() === 'minimal') {
        @if (isDesktop) {
          <button class="bottom-bar-cell link bb-icon bb-mobile" (click)="openRemoteAccessModal()" [title]="'CLOUD.Locked tooltip' | translate">
            <i class="ti ti-device-mobile"></i>
            <span class="bb-mobile-label">{{ 'BOTTOM_BAR.Mobile' | translate }}</span>
          </button>
        }
        @if (inSession()) {
          <button class="bottom-bar-cell link bb-icon" type="button" (click)="openShortcutsModal()"
                  [title]="'BOTTOM_BAR.Keyboard shortcuts' | translate" [attr.aria-label]="'BOTTOM_BAR.Keyboard shortcuts' | translate">
            <i class="ti ti-keyboard"></i>
          </button>
        }
      }

      <!-- Interface switcher — always here (classic + minimal). -->
      <div ngbDropdown placement="top-end" class="bb-ui-switch">
        <button ngbDropdownToggle class="bottom-bar-cell link bb-icon" type="button" [attr.aria-label]="'BOTTOM_BAR.Interface style' | translate" [title]="'BOTTOM_BAR.Interface' | translate">
          <i class="ti ti-layout-2"></i>
          UI
        </button>
        <div ngbDropdownMenu class="dropdown-menu-end">
          <button ngbDropdownItem type="button" (click)="setUiStyle('classic')">
            <i class="ti ti-layout-navbar me-1"></i> {{ 'BOTTOM_BAR.Classic' | translate }}
            @if (uiStyle() === 'classic') { <i class="ti ti-check ms-1"></i> }
          </button>
          <button ngbDropdownItem type="button" (click)="setUiStyle('minimal')">
            <i class="ti ti-layout-sidebar-right-collapse me-1"></i> {{ 'BOTTOM_BAR.Minimal' | translate }}
            @if (uiStyle() === 'minimal') { <i class="ti ti-check ms-1"></i> }
          </button>
        </div>
      </div>

      <!-- Right cells -->
      <a class="bottom-bar-cell link" (click)="openLanguageModal()">
        <i class="ti ti-world"></i>
        {{ currentLang().toUpperCase() }}
      </a>
      <!-- No feedback page in this edition: Support opens the project's GitHub issues. -->
      <a class="bottom-bar-cell link" (click)="openSupport()">
        <i class="ti ti-lifebuoy"></i>
        {{ 'TOPBAR.Support' | translate }}
      </a>

      <!-- Desktop update button -->
      @if (desktopUpdate.isDesktop) {
        @switch (desktopUpdate.info().state) {
          @case ('available') {
            <a class="bottom-bar-cell link update-available" (click)="downloadUpdate()">
              <i class="ti ti-download"></i>
              {{ 'BOTTOM_BAR.Update version' | translate: { version: desktopUpdate.info().version } }}
            </a>
          }
          @case ('downloading') {
            <span class="bottom-bar-cell update-progress">
              <i class="ti ti-loader spin"></i>
              {{ desktopUpdate.info().progress?.percent?.toFixed(0) || 0 }}%
            </span>
          }
          @case ('downloaded') {
            <a class="bottom-bar-cell link update-ready" (click)="installUpdate()">
              <i class="ti ti-refresh"></i>
              {{ 'BOTTOM_BAR.Restart' | translate }}
            </a>
          }
          @case ('checking') {
            <span class="bottom-bar-cell update-checking">
              <i class="ti ti-loader spin"></i>
              {{ 'BOTTOM_BAR.Checking' | translate }}
            </span>
          }
          @case ('error') {
            <a class="bottom-bar-cell link update-error" (click)="checkForUpdates()">
              <i class="ti ti-alert-triangle"></i>
              {{ 'BOTTOM_BAR.Retry' | translate }}
            </a>
          }
          @default {
            @if (versionService.state().updateAvailable && !versionService.state().updateRequired) {
              <a class="bottom-bar-cell link update-chip" (click)="checkForUpdates()" [title]="'BOTTOM_BAR.Check updates' | translate">
                <span class="update-dot"></span>
                v{{ versionService.state().latestVersion }}
              </a>
            } @else {
              <a class="bottom-bar-cell link" (click)="checkForUpdates()">
                <i class="ti ti-refresh"></i>
                {{ 'BOTTOM_BAR.Updates' | translate }}
              </a>
            }
          }
        }
      }

      </div><!-- /bb-right -->

      <!-- ⋮ menu replacing the right cells on narrow screens -->
      <div class="bb-more">
        <app-kebab-menu
          [items]="moreMenuItems()"
          placement="top-end bottom-end"
          (select)="onMoreSelect($event)"
        ></app-kebab-menu>
      </div>

      <span class="bottom-bar-cell version">v{{ version }}</span>
    </div>

    <!-- ── Token Efficiency Modal (with Knowledge tab) ── -->
    @if (showModal && inSession() && stats()) {
      <div class="modal-backdrop" (click)="showModal = false"></div>
      <div class="modal-panel" appEscClose (escClose)="showModal = false">
        <div class="modal-header">
          <div class="modal-title">
            <iconify-icon icon="solar:chart-square-bold-duotone" width="18"></iconify-icon>
            {{ (modalTab() === 'efficiency' ? 'BOTTOM_BAR.REPORT.Title efficiency' : 'BOTTOM_BAR.REPORT.Title knowledge') | translate }}
          </div>
          <div class="modal-header-right">
            @if (modalTab() === 'efficiency') {
              <span class="modal-prompts">
                {{ 'BOTTOM_BAR.REPORT.Prompts' | translate: { count: stats()!.promptCount || '—' } }}
                @if (promptsPerDay() !== null) {
                  <span class="modal-ppd" [attr.data-tip]="'BOTTOM_BAR.REPORT.Per day tip' | translate">{{ 'BOTTOM_BAR.REPORT.Per day' | translate: { count: promptsPerDay() } }}</span>
                }
              </span>
            }
            <button class="modal-close" (click)="showModal = false" [attr.aria-label]="'BOTTOM_BAR.REPORT.Close' | translate">
              <iconify-icon icon="solar:close-circle-bold" width="16"></iconify-icon>
            </button>
          </div>
        </div>

        <!-- Modal tabs -->
        <div class="modal-tabs">
          <button class="modal-tab" [class.active]="modalTab() === 'efficiency'" (click)="modalTab.set('efficiency')">{{ 'TOKEN_STATS.Efficiency' | translate }}</button>
          <button class="modal-tab" [class.active]="modalTab() === 'knowledge'" (click)="modalTab.set('knowledge')">{{ 'BOTTOM_BAR.REPORT.Tab knowledge' | translate }}</button>
        </div>

        <div class="modal-body">
          @if (modalTab() === 'efficiency') {
            @if (stats()!.savingsAvailable === false) {
              <div class="savings-note" role="note">
                <iconify-icon icon="solar:info-circle-linear" width="14"></iconify-icon>
                <span>{{ 'TOKEN_STATS.Savings unavailable' | translate }}</span>
              </div>
            }

            <!-- Summary -->
            <div class="summary-row">
              <div class="summary-cell">
                <span class="summary-label">{{ 'BOTTOM_BAR.Used' | translate }}</span>
                <span class="summary-val">{{ fmtExact(stats()!.tokensUsed) }}</span>
              </div>
              <div class="summary-sep"><iconify-icon icon="solar:arrow-right-linear" width="14"></iconify-icon></div>
              <div class="summary-cell">
                <span class="summary-label" [title]="'BOTTOM_BAR.REPORT.Reference tip' | translate">{{ 'BOTTOM_BAR.REPORT.Reference' | translate }}</span>
                <span class="summary-val dim">{{ stats()!.savingsAvailable === false ? '—' : fmtExact(stats()!.tokensEstimated) }}</span>
              </div>
              <div class="summary-sep"><span class="summary-eq">=</span></div>
              <div class="summary-cell saved">
                <span class="summary-label">{{ 'BOTTOM_BAR.REPORT.Est saved' | translate }}</span>
                <span class="summary-val green">{{ stats()!.savingsAvailable === false ? '—' : '-' + fmtExact(stats()!.tokensSaved) }}</span>
              </div>
              <div class="summary-cell pct">
                <span class="summary-pct" [class.green]="stats()!.efficiencyPercentage > 0">{{ stats()!.savingsAvailable === false ? '—' : fmtPct(stats()!.efficiencyPercentage) + '%' }}</span>
              </div>
            </div>

            <!-- Baseline breakdown -->
            @if (stats()!.savingsAvailable !== false && stats()!.breakdown) {
              <div class="section">
                <div class="section-head"><span class="section-label">{{ 'BOTTOM_BAR.REPORT.Breakdown title' | translate }}</span></div>
                <table class="data-table">
                  <thead><tr><th>{{ 'BOTTOM_BAR.REPORT.Source' | translate }}</th><th class="r">{{ 'BOTTOM_BAR.REPORT.Tokens' | translate }}</th><th class="r">%</th></tr></thead>
                  <tbody>
                    <tr>
                      <td><iconify-icon icon="solar:file-text-bold" width="12"></iconify-icon> {{ 'BOTTOM_BAR.REPORT.File reads' | translate }}</td>
                      <td class="r mono">{{ fmtExact(stats()!.breakdown!.file_reads_estimated) }}</td>
                      <td class="r mono dim">{{ srcPct(stats()!.breakdown!.file_reads_estimated) }}%</td>
                    </tr>
                    <tr>
                      <td><iconify-icon icon="solar:settings-bold" width="12"></iconify-icon> {{ 'BOTTOM_BAR.REPORT.Tool schemas' | translate }}</td>
                      <td class="r mono">{{ fmtExact(stats()!.breakdown!.tool_schema_estimated) }}</td>
                      <td class="r mono dim">{{ srcPct(stats()!.breakdown!.tool_schema_estimated) }}%</td>
                    </tr>
                    <tr>
                      <td><iconify-icon icon="solar:database-bold" width="12"></iconify-icon> {{ 'BOTTOM_BAR.REPORT.Context' | translate }}</td>
                      <td class="r mono">{{ fmtExact(stats()!.breakdown!.context_estimated) }}</td>
                      <td class="r mono dim">{{ srcPct(stats()!.breakdown!.context_estimated) }}%</td>
                    </tr>
                  </tbody>
                  <tfoot><tr><td>{{ 'BOTTOM_BAR.REPORT.Total baseline' | translate }}</td><td class="r mono">{{ fmtExact(stats()!.tokensEstimated) }}</td><td class="r mono dim">100%</td></tr></tfoot>
                </table>
              </div>
            }

            <!-- Optimization engines -->
            @if (hasActiveFlags(stats()!)) {
              <div class="section">
                <div class="section-head">
                  <span class="section-label">{{ 'BOTTOM_BAR.REPORT.Engines title' | translate }}</span>
                  <span class="section-count">{{ 'BOTTOM_BAR.REPORT.Active count' | translate: { count: activeOptimizations().length } }}</span>
                </div>
                <table class="data-table">
                  <thead><tr><th>{{ 'BOTTOM_BAR.REPORT.Engine' | translate }}</th><th class="r">{{ 'TOKEN_STATS.Saved' | translate }}</th><th class="r">{{ 'BOTTOM_BAR.REPORT.Hits' | translate }}</th><th class="r">{{ 'BOTTOM_BAR.REPORT.Impact' | translate }}</th></tr></thead>
                  <tbody>
                    @for (opt of activeOptimizations(); track opt.key) {
                      <tr>
                        <td><div class="engine-name"><iconify-icon [icon]="opt.icon" width="13"></iconify-icon> {{ opt.name | translate }}</div></td>
                        <td class="r mono green">{{ opt.analytics ? '-' + fmtExact(opt.analytics.tokensSaved) : '—' }}</td>
                        <td class="r mono">{{ opt.analytics?.occurrences ?? '—' }}</td>
                        <td class="r"><div class="impact-bar-wrap"><div class="impact-bar" [style.width.%]="barW(opt.analytics?.tokensSaved ?? 0)"></div></div></td>
                      </tr>
                    }
                  </tbody>
                  @if (totalOptSaved() > 0) {
                    <tfoot><tr><td>{{ 'BOTTOM_BAR.REPORT.Total optimization' | translate }}</td><td class="r mono green">-{{ fmtExact(totalOptSaved()) }}</td><td></td><td></td></tr></tfoot>
                  }
                </table>
              </div>

              <!-- Engine details -->
              <div class="section">
                <div class="section-head"><span class="section-label">{{ 'BOTTOM_BAR.REPORT.Engine details' | translate }}</span></div>
                <div class="engine-details">
                  @for (opt of activeOptimizations(); track opt.key) {
                    <div class="engine-row">
                      <div class="engine-row-head">
                        <iconify-icon [icon]="opt.icon" width="14"></iconify-icon>
                        <span class="engine-row-name">{{ opt.name | translate }}</span>
                        @if (opt.analytics && opt.analytics.tokensSaved > 0) {
                          <span class="engine-row-saved">{{ 'BOTTOM_BAR.REPORT.Tok' | translate: { count: '-' + fmtExact(opt.analytics.tokensSaved) } }}</span>
                        }
                      </div>
                      <p class="engine-row-desc">{{ opt.description | translate }}</p>
                    </div>
                  }
                </div>
              </div>
            }
          }

          @if (modalTab() === 'knowledge') {
            <!-- Knowledge sub-tabs -->
            @if (knIndexing()) {
              <div class="kn-indexing">
                <iconify-icon icon="solar:refresh-bold" width="12" class="cmd-spin"></iconify-icon>
                {{ (knIndexing() === 'semantic' ? 'BOTTOM_BAR.REPORT.Indexing semantic' : 'BOTTOM_BAR.REPORT.Indexing') | translate }}
              </div>
            }
            <div class="kn-tabs">
              <button class="kn-tab" [class.active]="knTab() === 'graph'" (click)="knTab.set('graph')">
                <iconify-icon icon="solar:share-circle-bold" width="12"></iconify-icon> {{ 'BOTTOM_BAR.REPORT.Graph' | translate }}
              </button>
              @if (knSemanticAvailable()) {
                <button class="kn-tab" [class.active]="knTab() === 'semantic'" (click)="knTab.set('semantic')">
                  <iconify-icon icon="solar:magnifer-bold" width="12"></iconify-icon> {{ 'BOTTOM_BAR.REPORT.Semantic' | translate }}
                </button>
              }
              <button class="kn-tab" [class.active]="knTab() === 'impact'" (click)="knTab.set('impact')">
                <iconify-icon icon="solar:danger-triangle-bold" width="12"></iconify-icon> {{ 'BOTTOM_BAR.REPORT.Impact' | translate }}
              </button>
              <button class="kn-tab" [class.active]="knTab() === 'memory'" (click)="knTab.set('memory')">
                <iconify-icon icon="solar:brain-bold" width="12"></iconify-icon> {{ 'BOTTOM_BAR.REPORT.Memory' | translate }}
              </button>
            </div>
            @if (!knSemanticAvailable()) {
              <div class="kn-meta">{{ 'BOTTOM_BAR.REPORT.Semantic unavailable' | translate }}</div>
            }

            @if (knTab() === 'graph') {
              <div class="kn-body">
                <div class="kn-input-row">
                  <input class="kn-input" [placeholder]="'BOTTOM_BAR.REPORT.Graph placeholder' | translate" [value]="knGraphInput()" (input)="knGraphInput.set($any($event.target).value)" (keydown.enter)="execKnGraphQuery()" />
                  <select class="kn-select" [value]="knDepth()" (change)="knDepth.set(+$any($event.target).value)">
                    <option value="1">{{ 'BOTTOM_BAR.REPORT.Depth' | translate: { n: 1 } }}</option><option value="2">{{ 'BOTTOM_BAR.REPORT.Depth' | translate: { n: 2 } }}</option><option value="3">{{ 'BOTTOM_BAR.REPORT.Depth' | translate: { n: 3 } }}</option>
                  </select>
                  <button class="kn-run" (click)="execKnGraphQuery()" [disabled]="!knGraphInput() || knLoading()"><iconify-icon icon="solar:play-bold" width="12"></iconify-icon></button>
                </div>
                @if (knGraphResult()) {
                  <div class="kn-meta">{{ 'BOTTOM_BAR.REPORT.Graph meta' | translate: { nodes: knGraphResult()!.nodes.length, edges: knGraphResult()!.edges.length, tokens: knGraphResult()!.estimatedTokens } }}</div>
                  <pre class="kn-result">{{ knGraphResult()!.summary }}</pre>
                }
              </div>
            }
            @if (knTab() === 'semantic') {
              <div class="kn-body">
                <div class="kn-input-row">
                  <input class="kn-input" [placeholder]="'BOTTOM_BAR.REPORT.Semantic placeholder' | translate" [value]="knSemanticInput()" (input)="knSemanticInput.set($any($event.target).value)" (keydown.enter)="execKnSemanticSearch()" />
                  @if (knBriefSearchAvailable) {
                    <select class="kn-select" [value]="knSemanticSource()" (change)="knSemanticSource.set($any($event.target).value)" [title]="'BOTTOM_BAR.REPORT.Source tip' | translate" [attr.aria-label]="'BOTTOM_BAR.REPORT.Source tip' | translate">
                      <option value="brief">{{ 'BOTTOM_BAR.REPORT.Brief' | translate }}</option>
                      <option value="code">{{ 'BOTTOM_BAR.REPORT.Code' | translate }}</option>
                    </select>
                  }
                  <button class="kn-run" (click)="execKnSemanticSearch()" [disabled]="!knSemanticInput() || knLoading()"><iconify-icon icon="solar:play-bold" width="12"></iconify-icon></button>
                </div>
                @if (knSemanticResult()) {
                  <div class="kn-meta">{{ 'BOTTOM_BAR.REPORT.Chunks meta' | translate: { count: knSemanticResult()!.chunks.length, tokens: knSemanticResult()!.estimatedTokens } }}</div>
                  <pre class="kn-result">{{ knSemanticResult()!.summary }}</pre>
                }
              </div>
            }
            @if (knTab() === 'impact') {
              <div class="kn-body">
                <div class="kn-input-row">
                  <input class="kn-input" [placeholder]="'BOTTOM_BAR.REPORT.Impact placeholder' | translate" [value]="knImpactInput()" (input)="knImpactInput.set($any($event.target).value)" (keydown.enter)="execKnImpact()" />
                  <button class="kn-run" (click)="execKnImpact()" [disabled]="!knImpactInput() || knLoading()"><iconify-icon icon="solar:play-bold" width="12"></iconify-icon></button>
                </div>
                @if (knImpactResult()) {
                  <div class="kn-meta">{{ 'BOTTOM_BAR.REPORT.Impacted files' | translate: { count: knImpactResult()!.nodes.length } }}</div>
                  <pre class="kn-result">{{ knImpactResult()!.summary }}</pre>
                }
              </div>
            }
            @if (knTab() === 'memory') {
              <div class="kn-body">
                <div class="kn-input-row">
                  <input class="kn-input" [placeholder]="'BOTTOM_BAR.REPORT.Memory placeholder' | translate" [value]="knMemoryInput()" (input)="knMemoryInput.set($any($event.target).value)" (keydown.enter)="execKnMemorySearch()" />
                  <button class="kn-run" (click)="execKnMemorySearch()" [disabled]="knLoading()"><iconify-icon icon="solar:play-bold" width="12"></iconify-icon></button>
                </div>
                @if (knMemoryResult()) {
                  @for (entry of knMemoryResult()!.entries; track entry.id) {
                    <div class="kn-mem-row">
                      <span class="kn-mem-cat" [class]="'kmc-' + entry.category">{{ entry.category }}</span>
                      <span class="kn-mem-text">{{ entry.content }}</span>
                    </div>
                  } @empty {
                    <div class="kn-empty">{{ 'BOTTOM_BAR.REPORT.No memories' | translate }}</div>
                  }
                }
              </div>
            }
          }
        </div>
      </div>
    }

    <!-- ── Commands Map Modal ── -->
    @if (showCommandsModal && inSession() && activeSessionId()) {
      <div class="modal-backdrop" (click)="showCommandsModal = false"></div>
      <div class="modal-panel cmd-modal" appEscClose (escClose)="showCommandsModal = false">
        <div class="modal-header">
          <div class="modal-title">
            <iconify-icon icon="solar:folder-with-files-bold-duotone" width="18"></iconify-icon>
            {{ 'QUICK_ACTION_BUILDER.Workspace commands' | translate }}
          </div>
          <div class="modal-header-right">
            <span class="modal-prompts">{{ 'QUICK_ACTION_BUILDER.Folders scanned' | translate: { count: smartActionService.folderMap().length } }}</span>
            <button class="cmd-rescan-btn" [disabled]="smartActionService.scanning()" (click)="rescanFolders()">
              <iconify-icon icon="solar:refresh-bold" width="13" [class.cmd-spin]="smartActionService.scanning()"></iconify-icon>
              {{ 'QUICK_ACTION_BUILDER.Rescan' | translate }}
            </button>
            <button class="modal-close" (click)="showCommandsModal = false">
              <iconify-icon icon="solar:close-circle-bold" width="16"></iconify-icon>
            </button>
          </div>
        </div>

        <div class="modal-body cmd-body">
          @if (smartActionService.scanning()) {
            <div class="cmd-scanning">
              <iconify-icon icon="solar:refresh-bold" width="20" class="cmd-spin"></iconify-icon>
              <span>{{ 'QUICK_ACTION_BUILDER.Scanning' | translate }}</span>
            </div>
          } @else if (smartActionService.folderMap().length === 0) {
            <div class="cmd-empty">
              <iconify-icon icon="solar:folder-error-bold-duotone" width="32"></iconify-icon>
              <span>{{ 'QUICK_ACTION_BUILDER.No commands' | translate }}</span>
            </div>
          } @else {
            <div class="cmd-hint">
              {{ 'QUICK_ACTION_BUILDER.Commands hint' | translate }}
            </div>
            @for (folder of smartActionService.folderMap(); track folder.folderPath) {
              <div class="cmd-folder">
                <div class="cmd-folder-header">
                  <iconify-icon icon="solar:folder-bold" width="14"></iconify-icon>
                  <span class="cmd-folder-name">{{ folder.folderName }}</span>
                  <span class="cmd-folder-path">{{ folder.folderPath }}</span>
                  <span class="cmd-folder-pm">{{ folder.commands.packageManager }}</span>
                </div>
                <!-- npm scripts -->
                @if (safeWords(objectKeys(folder.commands.npmScripts)).length > 0) {
                  <div class="cmd-section">
                    <span class="cmd-section-label">
                      <iconify-icon icon="solar:code-file-bold" width="11"></iconify-icon>
                      package.json scripts
                    </span>
                    <div class="cmd-grid">
                      @for (script of safeWords(objectKeys(folder.commands.npmScripts)); track script) {
                        <button type="button" class="cmd-chip cmd-clickable" (click)="injectCommand((folder.commands.packageManager === 'npm' ? 'npm run' : folder.commands.packageManager) + ' ' + script, folder.folderPath)">
                          <code>{{ folder.commands.packageManager === 'npm' ? 'npm run' : folder.commands.packageManager }} {{ script }}</code>
                        </button>
                      }
                    </div>
                  </div>
                }
                <!-- docker -->
                @if (folder.commands.hasDockerCompose) {
                  <div class="cmd-section">
                    <span class="cmd-section-label">
                      <iconify-icon icon="mdi:docker" width="12"></iconify-icon>
                      Docker Compose
                    </span>
                    <div class="cmd-grid">
                      <button type="button" class="cmd-chip cmd-clickable" (click)="injectCommand('docker compose up', folder.folderPath)"><code>docker compose up</code></button>
                      <button type="button" class="cmd-chip cmd-clickable" (click)="injectCommand('docker compose build', folder.folderPath)"><code>docker compose build</code></button>
                      <button type="button" class="cmd-chip cmd-clickable" (click)="injectCommand('docker compose down', folder.folderPath)"><code>docker compose down</code></button>
                    </div>
                  </div>
                }
                <!-- Makefile -->
                @if (folder.commands.hasMakefile && safeWords(folder.commands.makeTargets).length > 0) {
                  <div class="cmd-section">
                    <span class="cmd-section-label">
                      <iconify-icon icon="solar:settings-bold" width="11"></iconify-icon>
                      {{ 'BOTTOM_BAR.REPORT.Makefile targets' | translate }}
                    </span>
                    <div class="cmd-grid">
                      @for (target of safeWords(folder.commands.makeTargets); track target) {
                        <button type="button" class="cmd-chip cmd-clickable" (click)="injectCommand('make ' + target, folder.folderPath)"><code>make {{ target }}</code></button>
                      }
                    </div>
                  </div>
                }
                <!-- Script files -->
                @if (safeWords(folder.commands.scriptFiles).length > 0) {
                  <div class="cmd-section">
                    <span class="cmd-section-label">
                      <iconify-icon icon="solar:programming-bold" width="11"></iconify-icon>
                      scripts/
                    </span>
                    <div class="cmd-grid">
                      @for (f of safeWords(folder.commands.scriptFiles); track f) {
                        <button type="button" class="cmd-chip cmd-clickable" (click)="injectCommand('./scripts/' + f, folder.folderPath)"><code>./scripts/{{ f }}</code></button>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          }
        </div>

      </div>
    }

    <!-- ── Eco Mode Modal ── -->
    @if (showEcoModal && inSession() && activeSessionId()) {
      <div class="modal-backdrop" (click)="showEcoModal = false"></div>
      <div class="modal-panel eco-modal" appEscClose (escClose)="showEcoModal = false">
        <div class="modal-header">
          <div class="modal-title">
            <iconify-icon icon="solar:leaf-bold" width="18"></iconify-icon>
            {{ 'BOTTOM_BAR.ECO.Title' | translate }}
          </div>
          <div class="modal-header-right">
            <span class="eco-status-label" [class.on]="ecoMode()">{{ (ecoMode() ? 'BOTTOM_BAR.ECO.Active' : 'BOTTOM_BAR.ECO.Inactive') | translate }}</span>
            <button class="modal-close" (click)="showEcoModal = false" [attr.aria-label]="'BOTTOM_BAR.REPORT.Close' | translate">
              <iconify-icon icon="solar:close-circle-bold" width="16"></iconify-icon>
            </button>
          </div>
        </div>

        <div class="modal-body eco-body">
          <!-- Hero section -->
          <div class="eco-hero">
            <div class="eco-hero-icon" [class.active]="ecoMode()">
              <iconify-icon icon="solar:leaf-bold" width="28"></iconify-icon>
            </div>
            <div class="eco-hero-text">
              <span class="eco-hero-title">{{ 'BOTTOM_BAR.ECO.Hero title' | translate }}</span>
              <span class="eco-hero-sub">{{ 'BOTTOM_BAR.ECO.Hero sub' | translate }}</span>
            </div>
          </div>

          <!-- How it works -->
          <div class="eco-section">
            <div class="eco-section-label">{{ 'BOTTOM_BAR.ECO.How title' | translate }}</div>
            <p class="eco-desc">{{ 'BOTTOM_BAR.ECO.How desc' | translate }}</p>
            <p class="eco-desc">
              {{ 'BOTTOM_BAR.ECO.Inspired' | translate }} <a href="https://github.com/JuliusBrussee/caveman" target="_blank" rel="noopener noreferrer" class="eco-link">github.com/JuliusBrussee/caveman</a>
            </p>
          </div>

          <!-- Response pattern -->
          <div class="eco-section">
            <div class="eco-section-label">{{ 'BOTTOM_BAR.ECO.Pattern title' | translate }}</div>
            <div class="eco-example">
              <div class="eco-example-label">{{ 'BOTTOM_BAR.ECO.Normal' | translate }}</div>
              <div class="eco-example-text dim">{{ 'BOTTOM_BAR.ECO.Normal example' | translate }}</div>
            </div>
            <div class="eco-example">
              <div class="eco-example-label green">{{ 'BOTTOM_BAR.ECO.Title' | translate }}</div>
              <div class="eco-example-text">{{ 'BOTTOM_BAR.ECO.Eco example' | translate }}</div>
            </div>
          </div>

          <!-- Stats -->
          <div class="eco-section">
            <div class="eco-section-label">{{ 'BOTTOM_BAR.ECO.Bench title' | translate }}</div>
            <p class="eco-desc">{{ 'BOTTOM_BAR.ECO.Bench note' | translate }}</p>
            <div class="eco-stats">
              <div class="eco-stat">
                <span class="eco-stat-val green">~75%</span>
                <span class="eco-stat-label">{{ 'BOTTOM_BAR.ECO.Stat tokens' | translate }}</span>
              </div>
              <div class="eco-stat">
                <span class="eco-stat-val">100%</span>
                <span class="eco-stat-label">{{ 'BOTTOM_BAR.ECO.Stat accuracy' | translate }}</span>
              </div>
              <div class="eco-stat">
                <span class="eco-stat-val green">+26pp</span>
                <span class="eco-stat-label">{{ 'BOTTOM_BAR.ECO.Stat improvement' | translate }}</span>
              </div>
            </div>
          </div>

          <!-- Intensity selector -->
          <div class="eco-section">
            <div class="eco-section-label">{{ 'BOTTOM_BAR.ECO.Intensity' | translate }}</div>
            <div class="eco-levels">
              @for (level of ecoLevels; track level.id) {
                <button class="eco-level" [class.active]="ecoLevel() === level.id" (click)="ecoService.setLevel(level.id)">
                  <span class="eco-level-name">{{ level.name }}</span>
                  <span class="eco-level-desc">{{ level.desc | translate }}</span>
                </button>
              }
            </div>
          </div>

          <!-- Toggle -->
          <div class="eco-toggle-section">
            <button class="eco-toggle-btn" [class.active]="ecoMode()" (click)="toggleEcoMode()">
              <iconify-icon [icon]="ecoMode() ? 'solar:pause-bold' : 'solar:play-bold'" width="14"></iconify-icon>
              {{ (ecoMode() ? 'BOTTOM_BAR.ECO.Deactivate' : 'BOTTOM_BAR.ECO.Activate') | translate }}
            </button>
            @if (ecoMode()) {
              <span class="eco-toggle-hint">{{ 'BOTTOM_BAR.ECO.Active hint' | translate }}</span>
            }
          </div>
        </div>
      </div>
    }

  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    /* ══════════════ BOTTOM BAR — tokenized ══════════════ */
    .bottom-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: var(--po-bottombar-h);
      display: flex;
      align-items: center;
      padding: 0;
      background: var(--po-bg-1);
      border-top: 1px solid var(--po-border-subtle);
      z-index: 1001;
      font-family: var(--po-font-body);
      font-size: var(--po-text-xs);
      color: var(--po-text-secondary);
    }

    .spacer { flex: 1; }

    /* ── Responsive: left group scrolls, right group collapses into ⋮ ── */
    .bb-scroll {
      display: flex;
      align-items: center;
      align-self: stretch;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .bb-scroll::-webkit-scrollbar { display: none; }

    /* Children participate directly in the bar's flex row; the wrapper only
       exists so a single media-query rule can hide the whole group. */
    .bb-right { display: contents; }

    .bb-more {
      display: none;
      align-items: center;
      height: 100%;
      padding: 0 var(--po-space-2);
      border-left: 1px solid var(--po-border-subtle);
      flex-shrink: 0;
    }

    .bottom-bar-cell, .bb-ui-switch, .update-chip { flex-shrink: 0; }

    /* In-session the left side needs ~920px (rail sidenav) to ~1110px (full
       sidenav) and the right cells ~430-560px, so the bar overflows between
       ~1350px and ~1540px of viewport. Collapse at 1500px to cover both
       sidenav states with margin. */
    @media (max-width: 1499.98px) {
      .bottom-bar.in-session .bb-right { display: none; }
      .bottom-bar.in-session .bb-more { display: inline-flex; }
    }
    /* Outside sessions the bar is nearly empty — collapse only on true
       small screens (same breakpoint the bar already uses for mobile). */
    @media (max-width: 767.98px) {
      .bb-right { display: none; }
      .bb-more { display: inline-flex; }
    }

    /* Outside a session: mic anchored to the bar's left edge, below
       the sidebar rail avatar. Absolute so it does not shift the offset of the
       efficiency section. */
    .bb-voice-left {
      position: absolute;
      left: var(--po-space-2);
      top: 0;
      bottom: 0;
      display: inline-flex;
      align-items: center;
      z-index: 2;
    }

    /* Content-area offset lives on whichever element is first in the scroll
       group: with no open session stats() is null, the token section is gone
       and Commands/Eco would otherwise start at x=0. */
    .bb-scroll {
      --bb-offset: calc(var(--po-sidebar-w, 260px) + var(--session-sidebar-w, 260px));
    }
    /* max(): with the session sidebar collapsed (48px) the content offset is
       narrower than the absolute mic dock, which would sit on "Efficiency". */
    .bb-scroll > :first-child {
      margin-left: max(var(--bb-offset), var(--bb-voice-reserve, 0px));
      transition: margin-left var(--po-duration-base) var(--po-ease-out);
    }

    /* ── Token section ── */
    .token-section {
      display: flex;
      align-items: center;
      height: 100%;
      cursor: pointer;
      transition:
        background var(--po-duration-fast) var(--po-ease-out),
        margin-left var(--po-duration-base) var(--po-ease-out);
    }
    .token-section:hover { background: var(--po-bg-2); }

    .tc {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-1);
      height: 100%;
      padding: 0 var(--po-space-2);
      border-left: 1px solid var(--po-border-subtle);
      white-space: nowrap;
      color: var(--po-text-secondary);
      font-weight: var(--po-weight-medium);
    }
    .tc:first-child { border-left: none; padding-left: var(--po-space-3); }

    .tc.title {
      gap: var(--po-space-1);
      font-weight: var(--po-weight-semibold);
      color: var(--po-text-tertiary);
      font-size: var(--po-text-xs);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .tl {
      color: var(--po-text-tertiary);
      font-size: var(--po-text-xs);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .tv {
      font-weight: var(--po-weight-semibold);
      color: var(--po-text-primary);
      font-family: var(--po-font-mono);
      font-size: var(--po-text-xs);
      font-variant-numeric: tabular-nums;
    }

    .tc.chips { gap: var(--po-space-1); padding: 0 var(--po-space-2); }

    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      background: var(--po-accent-muted-bg);
      border-radius: var(--po-radius-sm);
      color: var(--po-accent);
    }

    /* ── Right cells ── */
    .bottom-bar-cell {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-1);
      height: 100%;
      padding: 0 var(--po-space-3);
      border-left: 1px solid var(--po-border-subtle);
      font-weight: var(--po-weight-medium);
      transition:
        background var(--po-duration-fast) var(--po-ease-out),
        color var(--po-duration-fast) var(--po-ease-out);
    }

    .bottom-bar-cell.link {
      color: var(--po-text-secondary);
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
    }

    .bottom-bar-cell.link:hover {
      color: var(--po-text-primary);
      background: var(--po-bg-2);
    }

    .bottom-bar-cell.link i { font-size: 0.85rem; }

    /* Interface switcher lives here in both classic and minimal — reset the
       native <button> chrome so it reads like the other cells (the minimal
       skin layers its own gray on top). */
    .bb-icon {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      border-left: 1px solid var(--po-border-subtle);
    }
    .bb-ui-switch { display: inline-flex; align-items: center; height: 100%; }

    /* Mobile connect cell shows a short label next to the icon. */
    .bb-mobile { position: relative; }
    .bb-mobile-label {
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-semibold);
      letter-spacing: 0.02em;
    }

    .bottom-bar-cell.version {
      color: var(--po-text-tertiary);
      font-weight: var(--po-weight-semibold);
      font-family: var(--po-font-mono);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
      border-right: 1px solid var(--po-border-subtle);
      white-space: nowrap;
    }

    /* ── Update chip ── */
    .update-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-1);
      background: var(--po-accent-muted-bg);
      color: var(--po-accent);
      font-weight: var(--po-weight-semibold);
      padding: 2px var(--po-space-2);
      border-radius: var(--po-radius-pill);
      text-decoration: none;
      border: 1px solid transparent;
      margin-right: var(--po-space-1);
      font-size: var(--po-text-xs);
      transition: background var(--po-duration-fast) var(--po-ease-out);
    }
    .update-chip:hover { background: var(--po-accent-muted-bg); color: var(--po-accent-hover); }

    .update-dot {
      width: 5px; height: 5px; border-radius: var(--po-radius-pill);
      background: var(--po-accent);
      animation: pulse-dot 2s var(--po-ease-in-out) infinite;
    }
    @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* ── Update states ── */
    .update-available { color: var(--po-success) !important; }
    .update-available:hover { color: var(--po-success) !important; background: var(--po-success-bg); }
    .update-ready { color: var(--po-success) !important; font-weight: var(--po-weight-bold); }
    .update-ready:hover { color: var(--po-success) !important; background: var(--po-success-bg); }
    .update-progress { color: var(--po-warning) !important; }
    .update-checking { color: var(--po-text-tertiary); }
    .update-error { color: var(--po-error) !important; }
    .update-error:hover { color: var(--po-error) !important; background: var(--po-error-bg); }
    .spin { animation: spin 1s linear infinite; display: inline-block; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* ── Semantic color helper ── */
    .green { color: var(--po-success) !important; }
    .red { color: var(--po-danger, #ef4444) !important; }


    /* Sidebar condensed mode */
    :host-context([data-sidenav-size="condensed"]) .bb-scroll {
      --bb-offset: calc(var(--po-sidebar-w-rail, 70px) + var(--session-sidebar-w, 260px));
    }
    /* Rail mode (minimal uses sm-hover): align Efficiency with the content
       column — i.e. under the Assets panel — using the 70px rail, not the
       full 260px sidenav the default assumes. */
    :host-context([data-sidenav-size="sm-hover"]) .bb-scroll,
    :host-context([data-sidenav-size="sm-hover-active"]) .bb-scroll {
      --bb-offset: calc(var(--po-sidebar-w-rail, 70px) + var(--session-sidebar-w, 260px));
    }
    :host-context([data-sidenav-size="full"]) .bb-scroll {
      --bb-offset: var(--session-sidebar-w, 260px);
    }
    @media (max-width: 767.98px) {
      .bb-scroll > :first-child { margin-left: 0; }
    }

    /* ══════════ MODAL — solid surface, tokenized ══════════ */
    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgb(0 0 0 / 0.55);
      z-index: 10000;
    }

    .modal-panel {
      position: fixed; bottom: 54px; left: 50%; transform: translateX(-50%);
      width: 560px; max-width: calc(100vw - 40px); max-height: 75vh;
      overflow-y: auto;
      background: var(--po-bg-3);
      border: 1px solid var(--po-border-strong);
      border-radius: var(--po-radius-xl);
      box-shadow: 0 20px 48px rgb(0 0 0 / 0.4);
      z-index: 10001;
      font-family: var(--po-font-body);
      font-size: var(--po-text-sm);
      color: var(--po-text-primary);
    }

    .modal-panel::-webkit-scrollbar { width: 4px; }
    .modal-panel::-webkit-scrollbar-thumb { background: var(--po-border-subtle); border-radius: 2px; }

    .modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--po-space-3) var(--po-space-4);
      border-bottom: 1px solid var(--po-border-subtle);
      background: var(--po-bg-3);
    }

    .modal-title {
      display: flex; align-items: center; gap: var(--po-space-2);
      font-size: var(--po-text-xs); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary);
      letter-spacing: 0.08em; text-transform: uppercase;
    }

    .modal-header-right { display: flex; align-items: center; gap: var(--po-space-3); }
    .modal-prompts { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; font-size: var(--po-text-xs); color: var(--po-text-tertiary); line-height: 1.2; }
    .modal-ppd { position: relative; font-size: 9px; font-weight: 600; letter-spacing: .03em; color: var(--po-text-secondary); opacity: .75; cursor: help; }
    .modal-ppd::after {
      content: attr(data-tip);
      position: absolute; bottom: calc(100% + 6px); right: 0;
      width: max-content; max-width: 220px; padding: 6px 8px;
      background: var(--po-surface-raised, #1e1e24); color: var(--po-text-primary);
      border: 1px solid var(--po-border, rgba(255,255,255,.1)); border-radius: 6px;
      font-size: 10px; font-weight: 400; letter-spacing: 0; line-height: 1.35; text-align: left;
      white-space: normal; box-shadow: 0 4px 12px rgba(0,0,0,.35);
      opacity: 0; pointer-events: none; transform: translateY(2px); transition: opacity .12s ease, transform .12s ease;
      z-index: 10;
    }
    .modal-ppd:hover::after { opacity: 1; transform: translateY(0); }
    .modal-close {
      background: transparent; border: 1px solid transparent;
      color: var(--po-text-secondary); cursor: pointer;
      padding: var(--po-space-1); border-radius: var(--po-radius-sm);
      transition: background var(--po-duration-fast) var(--po-ease-out);
    }
    .modal-close:hover { background: var(--po-bg-2); color: var(--po-text-primary); }
    .modal-body { padding: 0; }

    /* Modal tabs (Efficiency / Knowledge) */
    .modal-tabs {
      display: flex;
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .modal-tab {
      flex: 1;
      display: flex; align-items: center; justify-content: center;
      padding: var(--po-space-2) 0;
      font-size: var(--po-text-xs); font-weight: var(--po-weight-semibold);
      color: var(--po-text-tertiary);
      background: none; border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      text-transform: uppercase; letter-spacing: 0.06em;
      transition:
        color var(--po-duration-fast) var(--po-ease-out),
        border-color var(--po-duration-fast) var(--po-ease-out);
    }
    .modal-tab:hover { color: var(--po-text-secondary); }
    .modal-tab.active { color: var(--po-accent); border-bottom-color: var(--po-accent); }

    /* Summary */
    .savings-note {
      display: flex;
      align-items: flex-start;
      gap: var(--po-space-2, 8px);
      margin: 0 0 var(--po-space-3, 12px);
      padding: var(--po-space-2, 8px) var(--po-space-3, 12px);
      border: 1px solid var(--po-border-subtle, rgba(127,127,127,.2));
      border-left: 2px solid var(--po-accent, #7c5cff);
      border-radius: var(--po-radius-md, 8px);
      background: var(--po-bg-2, rgba(127,127,127,.06));
      color: var(--po-text-secondary, inherit);
      font-size: var(--po-text-xs, 11px);
      line-height: 1.45;
    }
    .savings-note iconify-icon { flex-shrink: 0; margin-top: 1px; color: var(--po-accent, #7c5cff); }
    .summary-row {
      display: flex; align-items: center;
      padding: var(--po-space-3) var(--po-space-4);
      border-bottom: 1px solid var(--po-border-subtle);
      gap: var(--po-space-2);
    }
    .summary-cell { display: flex; flex-direction: column; gap: 2px; }
    .summary-cell.saved { flex: 1; }
    .summary-cell.pct { margin-left: auto; }
    .summary-label {
      font-size: var(--po-text-xs); color: var(--po-text-tertiary);
      letter-spacing: 0.06em; font-weight: var(--po-weight-semibold);
      text-transform: uppercase;
    }
    .summary-val {
      font-size: var(--po-text-md); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary); font-variant-numeric: tabular-nums;
    }
    .summary-val.dim { color: var(--po-text-tertiary); }
    .summary-pct {
      font-size: var(--po-text-lg); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary); font-variant-numeric: tabular-nums;
    }
    .summary-sep {
      color: var(--po-text-tertiary); padding: 0 var(--po-space-1);
      display: flex; align-items: center;
    }
    .summary-eq { font-size: var(--po-text-md); font-weight: 300; }

    /* Sections & table */
    .section { border-bottom: 1px solid var(--po-border-subtle); }
    .section-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--po-space-2) var(--po-space-4) var(--po-space-1);
    }
    .section-label {
      font-size: var(--po-text-xs); font-weight: var(--po-weight-bold);
      color: var(--po-text-tertiary); letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .section-count { font-size: var(--po-text-xs); color: var(--po-text-tertiary); }

    .data-table { width: 100%; border-collapse: collapse; font-size: var(--po-text-sm); }
    .data-table th {
      padding: var(--po-space-1) var(--po-space-4);
      font-size: var(--po-text-xs); font-weight: var(--po-weight-semibold);
      color: var(--po-text-tertiary); letter-spacing: 0.06em;
      text-transform: uppercase; text-align: left;
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .data-table td {
      padding: var(--po-space-2) var(--po-space-4);
      color: var(--po-text-secondary);
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .data-table td iconify-icon { margin-right: 5px; opacity: 0.5; }
    .data-table tbody tr:hover td { background: var(--po-bg-2); }
    .data-table tfoot td {
      padding-top: var(--po-space-2); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary); border-bottom: none;
      border-top: 1px solid var(--po-border-strong);
    }
    .r { text-align: right; }
    .mono { font-family: var(--po-font-mono); font-variant-numeric: tabular-nums; }
    .dim { color: var(--po-text-tertiary); }

    .engine-name { display: flex; align-items: center; gap: var(--po-space-1); }
    .engine-name iconify-icon { opacity: 0.8 !important; color: var(--po-accent); }
    .impact-bar-wrap {
      width: 60px; height: 4px; background: var(--po-bg-2);
      border-radius: var(--po-radius-pill); overflow: hidden; display: inline-block;
    }
    .impact-bar {
      height: 100%; background: var(--po-success);
      border-radius: var(--po-radius-pill); min-width: 1px;
    }

    .engine-details {
      padding: var(--po-space-1) var(--po-space-4) var(--po-space-3);
      display: flex; flex-direction: column;
    }
    .engine-row {
      padding: var(--po-space-2) 0;
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .engine-row:last-child { border-bottom: none; }
    .engine-row-head {
      display: flex; align-items: center; gap: var(--po-space-2);
      font-size: var(--po-text-sm); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary); margin-bottom: 3px;
    }
    .engine-row-name { text-transform: uppercase; letter-spacing: 0.04em; }
    .engine-row-saved {
      margin-left: auto; font-size: var(--po-text-xs);
      font-weight: var(--po-weight-bold); color: var(--po-success);
      font-variant-numeric: tabular-nums;
    }
    .engine-row-desc {
      margin: 0; font-size: var(--po-text-xs);
      color: var(--po-text-secondary);
      line-height: var(--po-leading-body);
    }

    /* ══════════ COMMANDS SCAN BUTTON ══════════ */
    .cmd-scan-btn {
      display: inline-flex; align-items: center; gap: var(--po-space-1);
      height: 100%; padding: 0 var(--po-space-3);
      border: none; border-left: 1px solid var(--po-border-subtle);
      background: transparent; color: var(--po-warning);
      font-size: var(--po-text-xs); font-weight: var(--po-weight-semibold);
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out);
      white-space: nowrap;
    }
    .cmd-scan-btn:hover { background: var(--po-warning-bg); }
    .cmd-scan-btn.scanning { pointer-events: none; opacity: 0.6; }
    .cmd-spin { animation: cmd-spin 1s linear infinite; display: inline-block; }
    @keyframes cmd-spin { to { transform: rotate(360deg); } }
    .cmd-count {
      font-size: var(--po-text-xs); font-weight: var(--po-weight-bold);
      background: var(--po-warning-bg);
      padding: 0 3px; border-radius: var(--po-radius-xs); line-height: 1.4;
    }

    /* ══════════ COMMANDS MODAL ══════════ */
    .cmd-modal { width: 640px; }
    .cmd-body { padding: 0; }
    .cmd-hint {
      padding: var(--po-space-3) var(--po-space-4);
      font-size: var(--po-text-sm);
      color: var(--po-text-secondary);
      line-height: var(--po-leading-body);
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .cmd-scanning, .cmd-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--po-space-2); padding: var(--po-space-6) var(--po-space-4);
      color: var(--po-text-tertiary); font-size: var(--po-text-sm);
    }
    .cmd-folder { border-bottom: 1px solid var(--po-border-subtle); }
    .cmd-folder:last-child { border-bottom: none; }
    .cmd-folder-header {
      display: flex; align-items: center; gap: var(--po-space-2);
      padding: var(--po-space-2) var(--po-space-4);
      background: var(--po-bg-2);
      font-size: var(--po-text-sm); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary);
    }
    .cmd-folder-name { flex-shrink: 0; }
    .cmd-folder-path {
      flex: 1; font-weight: var(--po-weight-body); font-size: var(--po-text-xs);
      color: var(--po-text-tertiary); overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
      font-family: var(--po-font-mono);
    }
    .cmd-folder-pm {
      font-size: var(--po-text-xs); font-weight: var(--po-weight-semibold);
      text-transform: uppercase;
      padding: 1px 5px; border-radius: var(--po-radius-xs);
      background: var(--po-accent-muted-bg); color: var(--po-accent);
      letter-spacing: 0.04em;
    }
    .cmd-section { padding: var(--po-space-1) var(--po-space-4) var(--po-space-2) var(--po-space-6); }
    .cmd-section-label {
      display: flex; align-items: center; gap: var(--po-space-1);
      font-size: var(--po-text-xs); font-weight: var(--po-weight-semibold);
      color: var(--po-text-tertiary);
      text-transform: uppercase; letter-spacing: 0.04em;
      margin-bottom: var(--po-space-1);
    }
    .cmd-grid { display: flex; flex-wrap: wrap; gap: var(--po-space-1); }
    .cmd-chip {
      display: inline-flex; align-items: center;
      padding: 2px var(--po-space-2); border-radius: var(--po-radius-sm);
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      transition:
        background var(--po-duration-fast) var(--po-ease-out),
        border-color var(--po-duration-fast) var(--po-ease-out);
    }
    .cmd-chip.cmd-clickable { cursor: pointer; }
    .cmd-chip:hover {
      background: var(--po-warning-bg);
      border-color: var(--po-warning);
    }
    .cmd-chip code {
      font-size: var(--po-text-xs); color: var(--po-text-primary);
      font-family: var(--po-font-mono);
    }
    .cmd-rescan-btn {
      display: inline-flex; align-items: center; gap: var(--po-space-1);
      padding: 2px var(--po-space-2); border-radius: var(--po-radius-sm);
      border: 1px solid var(--po-warning);
      background: transparent; color: var(--po-warning);
      font-size: var(--po-text-xs); font-weight: var(--po-weight-semibold);
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out);
    }
    .cmd-rescan-btn:hover { background: var(--po-warning-bg); }
    .cmd-rescan-btn:disabled { opacity: 0.5; pointer-events: none; }

    /* ══════════════ KNOWLEDGE (inside efficiency modal) ══════════════ */
    .kn-indexing {
      display: flex; align-items: center; gap: var(--po-space-2);
      padding: var(--po-space-2) var(--po-space-4);
      font-size: var(--po-text-xs); color: var(--po-accent);
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .kn-tabs { display: flex; border-bottom: 1px solid var(--po-border-subtle); }
    .kn-tab {
      flex: 1; display: flex; align-items: center; justify-content: center;
      gap: var(--po-space-1);
      padding: var(--po-space-2) 0;
      font-size: var(--po-text-xs); font-weight: var(--po-weight-semibold);
      color: var(--po-text-tertiary); background: none; border: none;
      border-bottom: 2px solid transparent; cursor: pointer;
      transition:
        color var(--po-duration-fast) var(--po-ease-out),
        border-color var(--po-duration-fast) var(--po-ease-out);
    }
    .kn-tab:hover { color: var(--po-text-secondary); }
    .kn-tab.active { color: var(--po-accent); border-bottom-color: var(--po-accent); }
    .kn-body { padding: var(--po-space-3) var(--po-space-4); }
    .kn-input-row { display: flex; gap: var(--po-space-1); margin-bottom: var(--po-space-2); }
    .kn-input {
      flex: 1; background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      color: var(--po-text-primary);
      padding: var(--po-space-1) var(--po-space-2);
      border-radius: var(--po-radius-md);
      font-size: var(--po-text-sm);
      font-family: var(--po-font-mono); outline: none;
      transition: border-color var(--po-duration-fast) var(--po-ease-out);
    }
    .kn-input::placeholder { color: var(--po-text-tertiary); }
    .kn-input:focus { border-color: var(--po-accent); }
    .kn-select {
      background: var(--po-bg-2); border: 1px solid var(--po-border-subtle);
      color: var(--po-text-secondary);
      padding: var(--po-space-1) var(--po-space-2);
      border-radius: var(--po-radius-md);
      font-size: var(--po-text-xs);
      font-family: var(--po-font-body); outline: none; cursor: pointer;
    }
    .kn-run {
      background: var(--po-accent); border: 1px solid var(--po-accent);
      color: var(--po-accent-on); border-radius: var(--po-radius-md);
      padding: var(--po-space-1) var(--po-space-3); cursor: pointer;
      display: flex; align-items: center;
      transition: background var(--po-duration-fast) var(--po-ease-out);
    }
    .kn-run:hover { background: var(--po-accent-hover); }
    .kn-run:disabled { opacity: 0.3; cursor: default; }
    .kn-meta {
      font-size: var(--po-text-xs); color: var(--po-text-tertiary);
      margin-bottom: var(--po-space-1);
    }
    .kn-result {
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: var(--po-radius-md);
      padding: var(--po-space-2); margin: 0;
      font-size: var(--po-text-xs); color: var(--po-text-secondary);
      font-family: var(--po-font-mono);
      line-height: var(--po-leading-body);
      max-height: 250px; overflow-y: auto;
      white-space: pre-wrap; word-break: break-word;
    }
    .kn-result::-webkit-scrollbar { width: 3px; }
    .kn-result::-webkit-scrollbar-thumb { background: var(--po-border-subtle); }

    .kn-mem-row {
      display: flex; align-items: baseline; gap: var(--po-space-2);
      padding: var(--po-space-1) 0;
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .kn-mem-row:last-child { border-bottom: none; }
    .kn-mem-cat {
      font-size: var(--po-text-xs); font-weight: var(--po-weight-bold);
      text-transform: uppercase;
      padding: 1px 5px; border-radius: var(--po-radius-xs); flex-shrink: 0;
      background: var(--po-accent-muted-bg); color: var(--po-accent);
    }
    .kmc-bug         { background: var(--po-error-bg);   color: var(--po-error); }
    .kmc-architecture{ background: var(--po-accent-muted-bg); color: var(--po-accent); }
    .kmc-pattern     { background: var(--po-accent-muted-bg); color: var(--po-accent); }
    .kmc-config      { background: var(--po-warning-bg); color: var(--po-warning); }
    .kmc-dependency  { background: var(--po-info-bg);    color: var(--po-info); }
    .kmc-warning     { background: var(--po-warning-bg); color: var(--po-warning); }
    .kmc-decision    { background: var(--po-success-bg); color: var(--po-success); }
    .kn-mem-text {
      flex: 1; font-size: var(--po-text-xs);
      color: var(--po-text-secondary);
    }
    .kn-empty {
      font-size: var(--po-text-xs); color: var(--po-text-tertiary);
      text-align: center; padding: var(--po-space-3) 0;
    }

    /* ══════════════ ECO MODE BUTTON ══════════════ */
    .eco-btn {
      display: inline-flex; align-items: center; gap: var(--po-space-1);
      height: 100%; padding: 0 var(--po-space-3);
      border: none; border-left: 1px solid var(--po-border-subtle);
      background: transparent; color: var(--po-success);
      font-size: var(--po-text-xs); font-weight: var(--po-weight-semibold);
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out);
      white-space: nowrap;
    }
    .eco-btn:hover { background: var(--po-success-bg); }
    .eco-btn.active { background: var(--po-success-bg); color: var(--po-success); }
    .eco-badge {
      font-size: 9px; font-weight: var(--po-weight-bold);
      background: var(--po-success);
      color: #fff;
      padding: 0 4px; border-radius: var(--po-radius-xs); line-height: 1.5;
      letter-spacing: 0.06em;
    }

    /* ══════════════ ECO MODAL ══════════════ */
    .eco-modal { width: 640px; max-height: none; overflow-y: visible; }
    .eco-body { padding: 0; }

    .eco-status-label {
      font-size: var(--po-text-xs); font-weight: var(--po-weight-bold);
      color: var(--po-text-tertiary);
      letter-spacing: 0.06em; text-transform: uppercase;
    }
    .eco-status-label.on { color: var(--po-success); }

    .eco-hero {
      display: flex; align-items: center; gap: var(--po-space-3);
      padding: var(--po-space-3) var(--po-space-4);
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .eco-hero-icon {
      display: flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border-radius: var(--po-radius-lg);
      background: var(--po-bg-2);
      color: var(--po-text-tertiary);
      flex-shrink: 0;
      transition: background var(--po-duration-base) var(--po-ease-out), color var(--po-duration-base) var(--po-ease-out);
    }
    .eco-hero-icon.active {
      background: var(--po-success-bg);
      color: var(--po-success);
    }
    .eco-hero-text { display: flex; flex-direction: column; gap: 2px; }
    .eco-hero-title {
      font-size: var(--po-text-md); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary);
    }
    .eco-hero-sub {
      font-size: var(--po-text-xs);
      color: var(--po-text-secondary);
      line-height: var(--po-leading-body);
    }

    .eco-section {
      padding: var(--po-space-2) var(--po-space-4);
      border-bottom: 1px solid var(--po-border-subtle);
    }
    .eco-section-label {
      font-size: var(--po-text-xs); font-weight: var(--po-weight-bold);
      color: var(--po-text-tertiary); letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: var(--po-space-2);
    }
    .eco-desc {
      font-size: var(--po-text-sm);
      color: var(--po-text-secondary);
      line-height: var(--po-leading-body);
      margin: 0 0 var(--po-space-1) 0;
    }
    .eco-desc:last-child { margin-bottom: 0; }
    .eco-link {
      color: var(--po-accent);
      text-decoration: none;
      font-weight: var(--po-weight-semibold);
    }
    .eco-link:hover { text-decoration: underline; }

    .eco-example {
      padding: var(--po-space-2);
      background: var(--po-bg-2);
      border-radius: var(--po-radius-md);
      border: 1px solid var(--po-border-subtle);
      margin-bottom: var(--po-space-1);
    }
    .eco-example:last-child { margin-bottom: 0; }
    .eco-example-label {
      font-size: 9px; font-weight: var(--po-weight-bold);
      color: var(--po-text-tertiary);
      letter-spacing: 0.08em; text-transform: uppercase;
      margin-bottom: 4px;
    }
    .eco-example-text {
      font-size: var(--po-text-sm);
      color: var(--po-text-primary);
      line-height: var(--po-leading-body);
      font-style: italic;
    }
    .eco-example-text.dim { color: var(--po-text-tertiary); }

    .eco-stats {
      display: flex; gap: var(--po-space-3);
    }
    .eco-stat {
      flex: 1; display: flex; flex-direction: column; align-items: center;
      gap: 2px;
      padding: var(--po-space-2);
      background: var(--po-bg-2);
      border-radius: var(--po-radius-md);
      border: 1px solid var(--po-border-subtle);
    }
    .eco-stat-val {
      font-size: var(--po-text-lg); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary);
      font-variant-numeric: tabular-nums;
    }
    .eco-stat-label {
      font-size: 9px; font-weight: var(--po-weight-semibold);
      color: var(--po-text-tertiary);
      text-align: center; letter-spacing: 0.02em;
    }

    .eco-levels {
      display: flex; flex-direction: column; gap: var(--po-space-1);
    }
    .eco-level {
      display: flex; align-items: center; gap: var(--po-space-3);
      padding: var(--po-space-2) var(--po-space-3);
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: var(--po-radius-md);
      cursor: pointer;
      transition:
        background var(--po-duration-fast) var(--po-ease-out),
        border-color var(--po-duration-fast) var(--po-ease-out);
    }
    .eco-level:hover { background: var(--po-bg-3); border-color: var(--po-border-strong); }
    .eco-level.active {
      background: var(--po-success-bg);
      border-color: var(--po-success);
    }
    .eco-level-name {
      font-size: var(--po-text-sm); font-weight: var(--po-weight-bold);
      color: var(--po-text-primary);
      min-width: 48px;
    }
    .eco-level-desc {
      font-size: var(--po-text-xs);
      color: var(--po-text-secondary);
    }

    .eco-toggle-section {
      padding: var(--po-space-2) var(--po-space-4);
      display: flex; flex-direction: column; align-items: center;
      gap: var(--po-space-2);
    }
    .eco-toggle-btn {
      display: inline-flex; align-items: center; gap: var(--po-space-2);
      padding: var(--po-space-2) var(--po-space-5);
      border-radius: var(--po-radius-md);
      border: 1px solid var(--po-success);
      background: transparent;
      color: var(--po-success);
      font-size: var(--po-text-sm); font-weight: var(--po-weight-bold);
      cursor: pointer;
      transition:
        background var(--po-duration-fast) var(--po-ease-out),
        color var(--po-duration-fast) var(--po-ease-out);
      width: 100%;
      justify-content: center;
    }
    .eco-toggle-btn:hover { background: var(--po-success-bg); }
    .eco-toggle-btn.active {
      background: var(--po-success);
      color: #fff;
      border-color: var(--po-success);
    }
    .eco-toggle-btn.active:hover {
      background: var(--po-error);
      border-color: var(--po-error);
    }
    .eco-toggle-hint {
      font-size: var(--po-text-xs);
      color: var(--po-text-tertiary);
      text-align: center;
    }
  `],
})
export class BottomBarComponent implements OnDestroy {
  versionService = inject(VersionService);
  desktopUpdate = inject(DesktopUpdateService);
  smartActionService = inject(SmartActionService);
  ecoService = inject(EcoModeService);
  // Minimal: header controls relocated into the bottom bar.
  /** True inside the desktop shell: the locked "Connect mobile" entry shows only there. */
  readonly isDesktop = !!(window as { promptops?: unknown }).promptops;
  private uiStyleService = inject(UiStyleService);
  uiStyle = this.uiStyleService.style;
  version = APP_VERSION;
  showModal = false;
  showCommandsModal = false;
  showEcoModal = false;
  modalTab = signal<'efficiency' | 'knowledge'>('efficiency');

  // Eco Mode shortcuts
  ecoMode = this.ecoService.enabled;
  ecoLevel = this.ecoService.level;
  ecoLevels = [
    { id: 'lite' as const, name: 'Lite', desc: 'BOTTOM_BAR.ECO.Lite desc' },
    { id: 'full' as const, name: 'Full', desc: 'BOTTOM_BAR.ECO.Full desc' },
    { id: 'ultra' as const, name: 'Ultra', desc: 'BOTTOM_BAR.ECO.Ultra desc' },
  ];

  // Knowledge query state
  knTab = signal<'graph' | 'semantic' | 'impact' | 'memory'>('graph');
  knGraphInput = signal('');
  knDepth = signal(1);
  knLoading = signal(false);
  knGraphResult = signal<any>(null);
  knSemanticInput = signal('');
  knSemanticResult = signal<any>(null);
  /** Semantic corpus: 'brief' = project brief material (fast, no workspace index), 'code' = full embedding index. */
  knSemanticSource = signal<'brief' | 'code'>('brief');
  knImpactInput = signal('');
  knImpactResult = signal<any>(null);
  knMemoryInput = signal('');
  knMemoryResult = signal<any>(null);
  /** Engines are indexed on-demand (startup indexing is disabled for perf); tracks a pending index build. */
  knIndexing = signal<null | 'graph' | 'semantic'>(null);
  /**
   * False when this build has no embeddings runtime (`semantic_status().available`,
   * or a search answered `unavailable`): the Semantic tab is hidden, keyword
   * graph, impact and memory keep working.
   */
  knSemanticAvailable = signal(true);
  private knSemanticChecked = false;

  private store = inject(Store);
  private router = inject(Router);
  private modalService = inject(NgbModal);
  private translate = inject(TranslateService);
  private voiceUi = inject(VoiceAgentService);
  private subs: Subscription[] = [];

  /** Current locale code shown in the bar (language picker moved here from the topbar). */
  currentLang = signal<string>(
    localStorage.getItem('promptops_lang') || this.translate.currentLang || this.translate.defaultLang || 'en',
  );

  inSession = signal(false);

  /** Voice dock expanded state — per-context default lives in VoiceAgentService. */
  voiceDockExpanded = computed(() =>
    this.inSession() ? this.voiceUi.dockExpandedInSession() : this.voiceUi.dockExpandedElsewhere(),
  );

  setVoiceDockExpanded(expanded: boolean): void {
    if (this.inSession()) this.voiceUi.dockExpandedInSession.set(expanded);
    else this.voiceUi.dockExpandedElsewhere.set(expanded);
  }

  stats = signal<SessionTokenStats | null>(null);
  activeWorkspacePath = signal<string | null>(null);
  activeSessionId = signal<string | null>(null);
  activeSessionCreatedAt = signal<string | null>(null);

  /** Average prompts per day since the session was created (min 1 day). */
  promptsPerDay(): number | null {
    const s = this.stats();
    const created = this.activeSessionCreatedAt();
    if (!s?.promptCount || !created) return null;
    const ms = Date.now() - new Date(created).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const days = Math.max(1, ms / 86400000);
    return Math.round(s.promptCount / days);
  }

  /** Right edge of the absolute mic dock (+ gap): minimum left offset of the scroll group. */
  private voiceLeft = viewChild('voiceLeft', { read: ElementRef });
  voiceLeftReserve = signal(0);

  private hookService = inject(ClaudeHookService);
  /** Cold-resume check: provider cache expired while the session was idle. */
  private checkColdResume = () => { if (this.inSession()) this.hookService.maybeWarnColdResume(this.stats()); };
  private coldResumeTimer = setInterval(this.checkColdResume, 60_000);

  constructor() {
    effect(() => { this.stats(); this.checkColdResume(); });
    window.addEventListener('focus', this.checkColdResume);

    effect((onCleanup) => {
      const el = this.voiceLeft()?.nativeElement as HTMLElement | undefined;
      if (!el) { this.voiceLeftReserve.set(0); return; }
      const ro = new ResizeObserver(() => this.voiceLeftReserve.set(Math.ceil(el.offsetLeft + el.offsetWidth + 12)));
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });

    this.subs.push(this.smartActionService.commandsModalRequested.subscribe(() => this.openCommandsModal()));

    this.inSession.set(this.router.url.includes('/sessions'));
    this.subs.push(
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      ).subscribe((e) => {
        this.inSession.set(e.urlAfterRedirects.includes('/sessions'));
      }),
    );

    this.subs.push(
      this.store.select(getActiveSession).pipe(
        // A retained selection ID can outlive the session after a list refresh.
        map((session) => session?.id ?? null),
        distinctUntilChanged(),
        switchMap((id) => {
          if (!id) return of(null);
          this.store.dispatch(loadSessionTokenStats({ sessionId: id }));
          return this.store.select(getSessionTokenStats(id));
        }),
      ).subscribe((s) => this.stats.set(s)),
    );

    // Track active workspace path reactively
    this.subs.push(
      this.store.select(getActiveSession).subscribe((s) => {
        this.activeSessionId.set(s?.id ?? null);
        if (!s) {
          this.showCommandsModal = false;
          this.showEcoModal = false;
        }
        this.activeWorkspacePath.set(s?.workspace?.path ?? s?.deviceWorkspace?.localPath ?? null);
        this.activeSessionCreatedAt.set(s?.createdAt ?? null);
      }),
    );
  }

  ngOnDestroy(): void {
    clearInterval(this.coldResumeTimer);
    window.removeEventListener('focus', this.checkColdResume);
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ── Provider usage helpers ──────────────────────────────────────

  // ── Token efficiency helpers ──────────────────────────────────

  fmtNum(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  }

  fmtPct(n: number): string { return n.toFixed(1); }

  /** Provider prompt cache: real data from the provider, not a PromptOps saving. */
  cacheTooltip(): string {
    const st = this.stats();
    if (!st) return '';
    const parts = [`Provider prompt cache: ${this.fmtNum(st.cacheReadTokens ?? 0)} input tokens read from cache`];
    if ((st.cacheSavedUsd ?? 0) > 0) parts.push(`~$${st.cacheSavedUsd!.toFixed(2)} discount applied by the provider`);
    if ((st.costUsd ?? 0) > 0) parts.push(`~$${st.costUsd!.toFixed(2)} list-price cost`);
    if ((st.coldResumeCount ?? 0) > 0) parts.push(`${st.coldResumeCount} resume(s) after cache expiry re-wrote ${this.fmtNum(st.coldResumeTokens ?? 0)} tokens`);
    return parts.join(' · ');
  }
  fmtExact(n: number): string { return n.toLocaleString('en-US'); }

  srcPct(val: number): string {
    const total = this.stats()?.tokensEstimated ?? 1;
    return total > 0 ? Math.round((val / total) * 100).toString() : '0';
  }

  hasActiveFlags(s: SessionTokenStats): boolean {
    return !!s.optimizationFlags && Object.values(s.optimizationFlags).some(v => v === true);
  }

  activeOptimizations = computed<OptimizationEntry[]>(() => {
    const s = this.stats();
    if (!s?.optimizationFlags) return [];
    const analytics = s.optimizationAnalytics ?? {};
    return Object.entries(s.optimizationFlags)
      .filter(([, active]) => active)
      .map(([key]) => {
        const meta = OPTIMIZATION_META[key];
        if (!meta) return null;
        return { key, ...meta, analytics: analytics[key] ?? null };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => (b!.analytics?.tokensSaved ?? 0) - (a!.analytics?.tokensSaved ?? 0));
  });

  /** Items for the ⋮ menu that replaces the right cells on narrow screens. */
  moreMenuItems(): KebabMenuItem[] {
    const items: KebabMenuItem[] = [];
    const t = (key: string, params?: Record<string, unknown>): string => this.translate.instant(key, params);
    if (this.uiStyle() === 'minimal' && this.isDesktop) {
      items.push({ id: 'mobile', label: t('BOTTOM_BAR.Connect mobile'), icon: 'solar:smartphone-bold' });
    }
    if (this.uiStyle() === 'minimal' && this.inSession()) {
      items.push({ id: 'shortcuts', label: t('BOTTOM_BAR.Keyboard shortcuts'), icon: 'solar:keyboard-bold' });
    }
    items.push(
      { id: 'ui-classic', label: `${t('BOTTOM_BAR.Classic UI')}${this.uiStyle() === 'classic' ? '  ✓' : ''}`, icon: 'solar:widget-2-bold', divider: items.length > 0 },
      { id: 'ui-minimal', label: `${t('BOTTOM_BAR.Minimal UI')}${this.uiStyle() === 'minimal' ? '  ✓' : ''}`, icon: 'solar:sidebar-minimalistic-bold' },
      { id: 'language', label: t('BOTTOM_BAR.Language code', { code: this.currentLang().toUpperCase() }), icon: 'solar:global-bold', divider: true },
      { id: 'support', label: t('TOPBAR.Support'), icon: 'solar:chat-round-call-bold' },
    );
    if (this.desktopUpdate.isDesktop) {
      const info = this.desktopUpdate.info();
      const upd: KebabMenuItem = { id: 'updates', label: t('BOTTOM_BAR.Check updates'), icon: 'solar:refresh-bold', divider: true };
      switch (info.state) {
        case 'available': upd.label = t('BOTTOM_BAR.Update version', { version: info.version }); upd.icon = 'solar:download-bold'; break;
        case 'downloading': upd.label = t('BOTTOM_BAR.Downloading percent', { percent: info.progress?.percent?.toFixed(0) || 0 }); upd.disabled = true; break;
        case 'downloaded': upd.label = t('BOTTOM_BAR.Restart to update'); break;
        case 'checking': upd.label = t('BOTTOM_BAR.Checking'); upd.disabled = true; break;
        case 'error': upd.label = t('BOTTOM_BAR.Update error retry'); upd.danger = true; break;
      }
      items.push(upd);
    }
    return items;
  }

  /** `/admin/feedback` does not exist here: the wildcard route silently sent people to Sessions. */
  openSupport(): void {
    openExternal(GITHUB_ISSUES_URL);
  }

  onMoreSelect(id: string): void {
    switch (id) {
      case 'mobile': this.openRemoteAccessModal(); break;
      case 'shortcuts': this.openShortcutsModal(); break;
      case 'ui-classic': this.setUiStyle('classic'); break;
      case 'ui-minimal': this.setUiStyle('minimal'); break;
      case 'language': this.openLanguageModal(); break;
      case 'support': this.openSupport(); break;
      case 'updates': {
        const st = this.desktopUpdate.info().state;
        if (st === 'available') this.downloadUpdate();
        else if (st === 'downloaded') this.installUpdate();
        else this.checkForUpdates();
        break;
      }
    }
  }

  /** name and description are translation keys: shown untranslated they read "BOTTOM_BAR.ENGINES…". */
  chipTooltip(opt: OptimizationEntry): string {
    const saved = opt.analytics?.tokensSaved;
    const savedLine = saved ? ` · -${this.fmtNum(saved)} tok` : '';
    return `${this.translate.instant(opt.name)}${savedLine}\n${this.translate.instant(opt.description)}`;
  }

  barW(saved: number): number {
    const total = this.stats()?.tokensSaved ?? 1;
    return total > 0 ? Math.min(100, Math.round((saved / total) * 100)) : 0;
  }

  totalOptSaved = computed(() => {
    return this.activeOptimizations().reduce((sum, o) => sum + (o.analytics?.tokensSaved ?? 0), 0);
  });

  // ── Language picker ─────────────────────────────────────────────

  /** Connecting a phone is a PromptOps Desktop feature: opens its locked dialog. */
  openRemoteAccessModal(): void {
    CloudFeatureModalComponent.open(this.modalService, 'remote');
  }

  openShortcutsModal(): void {
    this.modalService.open(SessionShortcutsModalComponent, { centered: true, backdrop: true, keyboard: true });
  }

  setUiStyle(style: UiStyle): void {
    this.uiStyleService.set(style);
  }

  openLanguageModal(): void {
    const ref = this.modalService.open(LanguagePickerModalComponent, {
      centered: true,
      size: 'lg',
      backdrop: true,
      keyboard: true,
    });
    ref.componentInstance.languages = AVAILABLE_LANGUAGES;
    ref.componentInstance.currentLang = this.currentLang();
    ref.result.then(
      (code: string | undefined) => {
        if (code && code !== this.currentLang()) {
          this.translate.use(code);
          this.currentLang.set(code);
          localStorage.setItem('promptops_lang', code);
        }
      },
      () => { /* dismissed — no-op */ },
    );
  }

  checkForUpdates(): void { this.desktopUpdate.checkForUpdates(); }
  downloadUpdate(): void { this.desktopUpdate.downloadUpdate(); }
  installUpdate(): void { this.desktopUpdate.installUpdate(); }

  openTokenModal(): void {
    this.showCommandsModal = false;
    this.showEcoModal = false;
    this.modalTab.set('efficiency');
    this.showModal = true;
  }

  /** Open the commands map modal. Scan uses 4h cache; manual re-scan available via button. */
  openCommandsModal(): void {
    this.showModal = false;
    this.showEcoModal = false;
    this.showCommandsModal = true;
    this.scanFolders();
  }

  /** Scan workspace folders (uses 4h desktop-side cache). */
  scanFolders(): void {
    const ws = this.resolveWorkspacePath();
    if (ws) {
      this.smartActionService.scanFolders(ws, false);
    }
  }

  /** Force re-scan workspace folders (bypasses cache). */
  rescanFolders(): void {
    const ws = this.resolveWorkspacePath();
    if (ws) {
      this.smartActionService.scanFolders(ws, true);
    }
  }

  /** Use the current workspace before falling back to the last scan. */
  private resolveWorkspacePath(): string | null {
    return this.activeWorkspacePath() ?? this.smartActionService.lastWorkspacePath();
  }

  /** Commands always open a decision modal; selecting one never executes it. */
  injectCommand(command: string, directory: string): void {
    const sessionId = this.activeSessionId();
    if (!sessionId) return;
    this.showCommandsModal = false;
    const ref = this.modalService.open(CommandActionModalComponent, {
      centered: true, size: 'lg', scrollable: true,
      beforeDismiss: () => !(ref.componentInstance as CommandActionModalComponent).busy(),
    });
    const component = ref.componentInstance as CommandActionModalComponent;
    component.command = command;
    component.directory = directory;
    component.sessionId = sessionId;
    component.title = command.slice(0, 100);
    ref.result.then(
      () => { this.showCommandsModal = false; },
      () => { if (this.activeSessionId() === sessionId) this.showCommandsModal = true; },
    );
  }

  objectKeys(obj: Record<string, any>): string[] {
    return Object.keys(obj ?? {});
  }

  /** Only names that are a single plain shell word become one-click commands (see isSafeCommandWord). */
  safeWords(names: string[] | null | undefined): string[] {
    return (names ?? []).filter(isSafeCommandWord);
  }

  // ── Eco Mode ────────────────────────────────

  openEcoModal(): void {
    this.showModal = false;
    this.showCommandsModal = false;
    this.showEcoModal = true;
  }

  /** The sub-agent composer's Eco mode asks for this panel — it lives here. */
  private ecoModalRequestEffect = effect(() => {
    if (this.ecoService.modalOpenRequest() > 0) this.openEcoModal();
  });

  async toggleEcoMode(): Promise<void> {
    await this.ecoService.toggleGlobal(this.activeSessionId() ?? undefined);
  }

  private get knApi(): any {
    return (window as any).promptops;
  }

  /** Asks once, when the Knowledge tab is first opened, whether semantic search can run here. */
  private knSemanticCheckEffect = effect(() => {
    if (this.modalTab() !== 'knowledge' || this.knSemanticChecked) return;
    this.knSemanticChecked = true;
    void this.checkSemanticAvailable();
  });

  async checkSemanticAvailable(): Promise<void> {
    try {
      const status = await this.knApi?.getSemanticStatus?.();
      if (status && status.available === false) this.markSemanticUnavailable();
    } catch { /* unknown: keep the tab */ }
  }

  private markSemanticUnavailable(): void {
    this.knSemanticAvailable.set(false);
    this.knSemanticResult.set(null);
    if (this.knTab() === 'semantic') this.knTab.set('graph');
  }

  /** Code graph startup indexing is disabled (perf) — build it lazily before the first query. */
  private async ensureGraphIndexed(): Promise<void> {
    const ws = this.resolveWorkspacePath();
    if (!ws || !this.knApi?.getKnowledgeStats || !this.knApi?.indexKnowledgeGraph) return;
    try {
      const stats = await this.knApi.getKnowledgeStats();
      if (stats?.nodes > 0 && stats?.workspacePath === ws) return;
      this.knIndexing.set('graph');
      await this.knApi.indexKnowledgeGraph(ws);
    } catch { /* */ }
    this.knIndexing.set(null);
  }

  /** Same lazy strategy for the semantic embeddings index. */
  private async ensureSemanticIndexed(): Promise<void> {
    const ws = this.resolveWorkspacePath();
    if (!ws || !this.knApi?.getSemanticStatus || !this.knApi?.indexSemanticEngine) return;
    try {
      const status = await this.knApi.getSemanticStatus();
      if (status?.isReady && status?.chunkCount > 0) return;
      this.knIndexing.set('semantic');
      await this.knApi.indexSemanticEngine(ws);
    } catch { /* */ }
    this.knIndexing.set(null);
  }

  async execKnGraphQuery(): Promise<void> {
    const q = this.knGraphInput();
    if (!q || !this.knApi?.queryKnowledgeGraph) return;
    this.knLoading.set(true);
    try {
      await this.ensureGraphIndexed();
      this.knGraphResult.set(await this.knApi.queryKnowledgeGraph(q, this.knDepth()));
    } catch { /* */ }
    this.knLoading.set(false);
  }

  /** Feature-detect: brief-based search needs a preload with semanticSearchBrief. */
  get knBriefSearchAvailable(): boolean {
    return typeof this.knApi?.semanticSearchBrief === 'function';
  }

  async execKnSemanticSearch(): Promise<void> {
    const q = this.knSemanticInput();
    if (!q || !this.knApi?.semanticSearch) return;
    this.knLoading.set(true);
    try {
      const ws = this.resolveWorkspacePath();
      if (this.knSemanticSource() === 'brief' && this.knBriefSearchAvailable && ws) {
        const status = await this.knApi.getSemanticStatus?.();
        if (!status?.isReady) this.knIndexing.set('semantic');
        const res = await this.knApi.semanticSearchBrief(ws, q, 5);
        this.knIndexing.set(null);
        // Never show "no runtime" as an empty list of matches.
        if (res?.unavailable) this.markSemanticUnavailable();
        else this.knSemanticResult.set(res);
      } else {
        await this.ensureSemanticIndexed();
        const res = await this.knApi.semanticSearch(q, 5, 2000);
        if (res?.unavailable) this.markSemanticUnavailable();
        else this.knSemanticResult.set(res);
      }
    } catch { /* */ }
    this.knIndexing.set(null);
    this.knLoading.set(false);
  }

  async execKnImpact(): Promise<void> {
    const input = this.knImpactInput();
    if (!input || !this.knApi?.impactAnalysis) return;
    this.knLoading.set(true);
    try {
      await this.ensureGraphIndexed();
      const files = input.split(',').map((f: string) => f.trim()).filter(Boolean);
      this.knImpactResult.set(await this.knApi.impactAnalysis(files));
    } catch { /* */ }
    this.knLoading.set(false);
  }

  async execKnMemorySearch(): Promise<void> {
    if (!this.knApi?.searchMemory) return;
    this.knLoading.set(true);
    try {
      this.knMemoryResult.set(await this.knApi.searchMemory(this.knMemoryInput() || undefined, undefined, 10));
    } catch { /* */ }
    this.knLoading.set(false);
  }
}
