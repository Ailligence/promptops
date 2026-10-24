import { changetheme } from "@/store/layout/layout-action";
import type { LayoutState } from "@/store/layout/layout-reducers";
import { getLayoutColor } from "@/store/layout/layout-selector";
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  HostListener,
  inject,
  Output,
  signal,
  type OnDestroy,
  type OnInit,
  type TemplateRef,
  ChangeDetectionStrategy
} from "@angular/core";
import { Router, RouterModule } from "@angular/router";
import {
  NgbDropdownModule,
  NgbModal,
  NgbModalModule,
  NgbOffcanvasModule,
  NgbTooltipModule,
} from "@ng-bootstrap/ng-bootstrap";
import { Store } from "@ngrx/store";
import { appData, languages } from "./data";
import { SimplebarAngularModule } from "simplebar-angular";
import { splitArray } from "@core/helper/utils";
import { User } from "@core/models/user";
import { TranslateModule } from "@ngx-translate/core";
import { DataBackend } from "@core/data/data-backend";
import { APP_VERSION } from "@environment/version";
import { TutorialService } from "@/app/components/tutorial/tutorial.service";
import { FeatureFlagService } from "@core/services/feature-flag.service";
import { VoiceAgentComponent } from "@/app/components/voice-agent/voice-agent.component";
import { UserMenuComponent } from "@/app/components/user-menu/user-menu.component";
import { WorkspaceApiService } from '@/app/views/admin-core/sessions/services/workspace-api.service';
import { DesktopSessionApiService } from '@/app/views/admin-core/sessions/services/desktop-session-api.service';
import { UiStyleService, UiStyle } from '@core/services/ui-style.service';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { CloudFeatureModalComponent, type CloudFeature } from "@components/cloud-feature-modal/cloud-feature-modal.component";
import { initialsAvatar } from "@core/helper/initials-avatar";
import { NotificationCenterComponent } from "@/app/components/notification-center/notification-center.component";
import { openSessionTarget } from "../open-session-target";

interface TopbarSearchResult {
  type: 'workspace' | 'session' | 'prompt';
  id: string;
  name: string;
  subtitle?: string;
  icon: string;
}

interface TopbarSearchGroup {
  type: string;
  label: string;
  items: TopbarSearchResult[];
}

@Component({
  selector: "app-topbar",
  standalone: true,
  imports: [
    NgbOffcanvasModule,
    NgbDropdownModule,
    SimplebarAngularModule,
    NgbModalModule,
    NgbTooltipModule,
    TranslateModule,
    RouterModule,
    FormsModule,
    VoiceAgentComponent,
    NotificationCenterComponent,
    UserMenuComponent,
  ],
  templateUrl: "./topbar.component.html",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    /* ── Mobile (remote access) button ── */
    .topbar-mobile-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: 1px solid rgba(168, 123, 255, 0.35);
      background: transparent;
      color: #c4a8ff;
      border-radius: 999px;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .topbar-mobile-btn:hover {
      background: rgba(124, 92, 255, 0.12);
      color: #d4bcff;
    }
    .topbar-mobile-btn .mobile-dot {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      box-shadow: 0 0 0 2px var(--po-bg, #0b0b14);
    }
    .topbar-mobile-btn .mobile-dot.live { background: #56d364; }
    .topbar-mobile-btn .mobile-dot.idle { background: #ffb454; }

    /* ══════════════ TOPBAR — tokenized ══════════════ */
    .tutorial-start-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-1);
      font-size: var(--po-text-sm);
      font-weight: var(--po-weight-semibold);
      opacity: 1;
      transition: opacity var(--po-duration-fast) var(--po-ease-out);
    }
    .tutorial-label { font-size: var(--po-text-sm); }

    /* ── Pro trial badge (semantic: warning) ── */
    .pro-days-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-1);
      background: var(--po-warning-bg);
      color: var(--po-warning);
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-bold);
      padding: 2px var(--po-space-3);
      border-radius: var(--po-radius-pill);
      border: 1px solid transparent;
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out);
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    .pro-days-badge:hover {
      background: var(--po-warning-bg);
      border-color: var(--po-warning);
    }
    .pro-days-badge i { font-size: 0.85rem; }


    /* ── Pro request + refresh system (brand accent) ── */
    .pro-request-btn,
    .refresh-system-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-1);
      background: var(--po-accent);
      color: var(--po-accent-on);
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-bold);
      padding: 3px var(--po-space-3);
      border-radius: var(--po-radius-pill);
      border: 1px solid transparent;
      cursor: pointer;
      transition: background var(--po-duration-fast) var(--po-ease-out);
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    .pro-request-btn:hover,
    .refresh-system-btn:hover { background: var(--po-accent-hover); }
    .pro-request-btn:active,
    .refresh-system-btn:active { background: var(--po-accent-active); }
    .pro-request-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .pro-request-btn i,
    .refresh-system-btn i { font-size: 0.85rem; }

    /* Refresh is icon-only: tighten to a square icon button */
    .refresh-system-btn {
      padding: 0;
      width: 28px;
      height: 28px;
      justify-content: center;
    }
    .refresh-system-btn i { font-size: 0.95rem; }
    .refresh-system-btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      background: var(--po-bg-2);
      color: var(--po-text-secondary);
    }
    .refresh-system-btn:disabled:hover { background: var(--po-bg-2); }
    .refresh-countdown {
      font-size: 0.75rem;
      font-weight: var(--po-weight-bold);
      font-variant-numeric: tabular-nums;
      line-height: 1;
      min-width: 10px;
      text-align: center;
    }

    .pro-request-pending {
      background: var(--po-bg-2);
      color: var(--po-text-secondary);
    }

    /* ── Ranking CTA (subtle — dashed accent, hover fills) ── */
    .ranking-cta {
      display: inline-flex;
      align-items: center;
      gap: var(--po-space-1);
      padding: 3px var(--po-space-3);
      border-radius: var(--po-radius-pill);
      background: var(--po-accent-muted-bg, rgba(99, 102, 241, 0.10));
      color: var(--po-accent);
      border: 1px dashed var(--po-accent);
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-semibold);
      letter-spacing: 0.02em;
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      transition:
        background var(--po-duration-fast) var(--po-ease-out),
        color var(--po-duration-fast) var(--po-ease-out),
        border-color var(--po-duration-fast) var(--po-ease-out);
    }
    .ranking-cta:hover {
      background: var(--po-accent);
      color: var(--po-accent-on);
      border-color: var(--po-accent);
    }
    .ranking-cta i { font-size: 0.85rem; }

    /* ── Global Search ── */
    .topbar-search-wrapper { position: relative; }

    .topbar-search-input {
      display: flex;
      align-items: center;
      gap: var(--po-space-2);
      background: var(--po-bg-2);
      border: 1px solid var(--po-border-subtle);
      border-radius: var(--po-radius-md);
      padding: 5px var(--po-space-3);
      width: 280px;
      transition:
        border-color var(--po-duration-fast) var(--po-ease-out),
        background var(--po-duration-fast) var(--po-ease-out),
        width var(--po-duration-base) var(--po-ease-out);
    }
    .topbar-search-input:focus-within {
      width: 340px;
      border-color: var(--po-accent);
      background: var(--po-bg-3);
    }
    .topbar-search-input input {
      border: none;
      background: transparent;
      outline: none;
      font-size: var(--po-text-sm);
      color: var(--po-text-primary);
      width: 100%;
      padding: 0;
      min-width: 0;
    }
    .topbar-search-input input::placeholder {
      color: var(--po-text-tertiary);
      font-size: var(--po-text-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .topbar-search-input > i {
      color: var(--po-text-tertiary);
      flex-shrink: 0;
    }
    .search-clear-btn {
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      color: var(--po-text-tertiary);
      display: flex;
      align-items: center;
      line-height: 1;
      transition: color var(--po-duration-fast) var(--po-ease-out);
    }
    .search-clear-btn:hover { color: var(--po-error); }

    /* ── Search Dropdown — solid, no glass ── */
    .topbar-search-dropdown {
      position: absolute;
      top: calc(100% + var(--po-space-2));
      left: 0;
      min-width: 340px;
      background: var(--po-bg-3);
      border: 1px solid var(--po-border-strong);
      border-radius: var(--po-radius-xl);
      box-shadow: 0 20px 48px rgb(0 0 0 / 0.4);
      z-index: var(--po-z-dropdown);
      max-height: 400px;
      overflow-y: auto;
      padding: var(--po-space-2) 0;
    }
    .search-group-header {
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-bold);
      text-transform: uppercase;
      color: var(--po-text-tertiary);
      padding: var(--po-space-3) var(--po-space-4) var(--po-space-1);
      letter-spacing: 0.06em;
    }
    .search-result-item {
      display: flex;
      align-items: center;
      gap: var(--po-space-3);
      padding: var(--po-space-2) var(--po-space-4);
      cursor: pointer;
      text-decoration: none;
      color: var(--po-text-primary);
      transition: background var(--po-duration-fast) var(--po-ease-out);
      border-radius: var(--po-radius-md);
      margin: 0 var(--po-space-2);
    }
    .search-result-item:hover {
      background: var(--po-accent-muted-bg);
      color: var(--po-text-primary);
    }
    .search-result-item > i {
      color: var(--po-accent);
      flex-shrink: 0;
    }
    .search-result-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .search-result-name {
      font-size: var(--po-text-base);
      font-weight: var(--po-weight-medium);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .search-result-sub {
      font-size: var(--po-text-xs);
      color: var(--po-text-tertiary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .search-state-msg {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--po-space-2);
      padding: var(--po-space-5) var(--po-space-4);
      color: var(--po-text-tertiary);
      font-size: var(--po-text-sm);
    }

    @keyframes topbar-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    .topbar-spin { animation: topbar-spin 0.8s linear infinite; }

    /* ── UI style switcher (Classic / Minimal) ── */
    .ui-style-toggle { position: relative; }
    .ui-style-new {
      position: absolute;
      top: 4px;
      right: -2px;
      font-size: 8px;
      font-weight: var(--po-weight-bold);
      line-height: 1.3;
      letter-spacing: 0.06em;
      padding: 0 4px;
      border-radius: var(--po-radius-pill);
      background: var(--po-accent);
      color: var(--po-accent-on);
      pointer-events: none;
    }
    .ui-style-menu {
      min-width: 180px;
      padding: var(--po-space-1);
    }
    .ui-style-head {
      padding: var(--po-space-1) var(--po-space-2);
      font-size: var(--po-text-xs);
      font-weight: var(--po-weight-semibold);
      color: var(--po-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .ui-style-item {
      display: flex;
      align-items: center;
      gap: var(--po-space-2);
      border-radius: var(--po-radius-md);
      font-size: var(--po-text-base);
    }
    .ui-style-item i { font-size: 1rem; color: var(--po-text-secondary); }
    .ui-style-label { flex: 1; }
    .ui-style-pill {
      font-size: 9px;
      font-weight: var(--po-weight-bold);
      letter-spacing: 0.06em;
      padding: 0 5px;
      border-radius: var(--po-radius-pill);
      background: var(--po-accent-muted-bg);
      color: var(--po-accent);
      line-height: 1.6;
    }
    .ui-style-check { color: var(--po-accent); }
  `,
})
export class TopbarComponent implements OnInit, OnDestroy {
  languageList = languages;
  appsChunks = splitArray(appData, 3);

  /** UI style: minimal is the default, the switcher overrides it
   *  (saved in the local profile as ui_preferences.ui_style). */
  private uiStyleService = inject(UiStyleService);
  uiStyle = this.uiStyleService.style;

  setUiStyle(style: UiStyle): void {
    this.uiStyleService.set(style);
  }

  @Output() mobileMenuButtonClicked = new EventEmitter();

  private modalService = inject(NgbModal);

  router = inject(Router);
  store = inject(Store);

  color!: string;

  private localData = inject(DataBackend);
  private tutorialService = inject(TutorialService);
  ff = inject(FeatureFlagService);
  private workspaceApi = inject(WorkspaceApiService);
  private desktopSessionApi = inject(DesktopSessionApiService);

  user = signal<User | null>(null);
  appVersion = APP_VERSION;
  // Desktop app is dark-only; hide the theme toggle there.
  readonly isDesktop = !!(window as any).promptops;


  // ── Global Search ────────────────────────────────
  searchQuery = '';
  searchResults: TopbarSearchResult[] = [];
  showSearchDropdown = false;
  searchLoading = false;
  private searchTimeout: any = null;

  // ── Refresh cooldown (survives the reload) ───────
  private readonly REFRESH_COOLDOWN_MS = 5000;
  private readonly REFRESH_COOLDOWN_KEY = 'topbar_refresh_cooldown_until';
  refreshCountdown = signal<number>(0);
  private countdownInterval: any = null;

  get fullname(): string {
    return `${this.user()?.first_name} ${this.user()?.last_name}`;
  }

  get avatarUrl(): string {
    const u = this.user();
    if (u?.avatar_url) return u.avatar_url;
    return initialsAvatar(u ? `${u.first_name ?? ""} ${u.last_name ?? ""}` : "");
  }

  constructor() {
    this.user.set(JSON.parse(localStorage.getItem("user")!));
  }

  open(content: TemplateRef<any>) {
    this.modalService.open(content, { size: "lg" });
  }

  ngOnInit(): void {
    this.store.select("layout").subscribe((data: LayoutState) => {
      this.color = data.LAYOUT_THEME;
    });

    this.resumeRefreshCooldown();
  }

  ngOnDestroy(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  toggleMobileMenu() {
    this.mobileMenuButtonClicked.emit();
  }

  changeTheme() {
    const color = document.documentElement.getAttribute("data-bs-theme");
    if (color == "light") {
      this.store.dispatch(changetheme({ color: "dark" }));
    } else {
      this.store.dispatch(changetheme({ color: "light" }));
    }
    this.store.select(getLayoutColor).subscribe((color) => {
      document.documentElement.setAttribute("data-bs-theme", color);
    });
  }


  startTutorial(): void {
    this.tutorialService.start();
  }

  refreshSystem(): void {
    if (this.refreshCountdown() > 0) return;
    try {
      localStorage.setItem(
        this.REFRESH_COOLDOWN_KEY,
        String(Date.now() + this.REFRESH_COOLDOWN_MS),
      );
    } catch { /* storage unavailable — still allow the reload */ }
    window.location.reload();
  }

  private resumeRefreshCooldown(): void {
    let until = 0;
    try {
      until = Number(localStorage.getItem(this.REFRESH_COOLDOWN_KEY) || 0);
    } catch { return; }
    const remaining = until - Date.now();
    if (remaining <= 0) {
      try { localStorage.removeItem(this.REFRESH_COOLDOWN_KEY); } catch { /* noop */ }
      return;
    }
    this.refreshCountdown.set(Math.ceil(remaining / 1000));
    this.countdownInterval = setInterval(() => {
      const left = until - Date.now();
      if (left <= 0) {
        this.refreshCountdown.set(0);
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        try { localStorage.removeItem(this.REFRESH_COOLDOWN_KEY); } catch { /* noop */ }
      } else {
        this.refreshCountdown.set(Math.ceil(left / 1000));
      }
    }, 200);
  }

  // ── Global Search ────────────────────────────────

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('.topbar-search-wrapper')) {
      this.showSearchDropdown = false;
    }
  }

  get searchGroups(): TopbarSearchGroup[] {
    const groups: TopbarSearchGroup[] = [];
    const workspaces = this.searchResults.filter(r => r.type === 'workspace');
    const sessions = this.searchResults.filter(r => r.type === 'session');
    const prompts = this.searchResults.filter(r => r.type === 'prompt');
    if (workspaces.length) groups.push({ type: 'workspace', label: 'TOPBAR.SearchWorkspaces', items: workspaces });
    if (sessions.length) groups.push({ type: 'session', label: 'TOPBAR.SearchSessions', items: sessions });
    if (prompts.length) groups.push({ type: 'prompt', label: 'TOPBAR.SearchPrompts', items: prompts });
    return groups;
  }

  onSearchInput(): void {
    clearTimeout(this.searchTimeout);
    if (this.searchQuery.length < 2) {
      this.searchResults = [];
      this.searchLoading = false;
      return;
    }
    this.searchLoading = true;
    this.showSearchDropdown = true;
    this.searchTimeout = setTimeout(() => this.performSearch(this.searchQuery), 300);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.showSearchDropdown = false;
    clearTimeout(this.searchTimeout);
  }

  navigateToResult(result: TopbarSearchResult): void {
    this.showSearchDropdown = false;
    this.searchQuery = '';
    this.searchResults = [];

    switch (result.type) {
      case 'workspace':
      case 'session':
        void openSessionTarget(this.router, this.store, result.type, result.id);
        break;
      case 'prompt':
        this.router.navigate(['/admin/prompt-library', result.id]);
        break;
    }
  }

  private async performSearch(query: string): Promise<void> {
    const q = query.toLowerCase();
    const results: TopbarSearchResult[] = [];

    try {
      const [workspacesRes, sessionsRes, promptsRes] = await Promise.allSettled([
        firstValueFrom(this.workspaceApi.list()),
        firstValueFrom(this.desktopSessionApi.list()),
        this.localData.call<{ prompts: any[] }>('prompts.list', { search: query, per_page: 5, page: 1 }),
      ]);

      // Workspaces
      if (workspacesRes.status === 'fulfilled') {
        const filtered = workspacesRes.value
          .filter(w => (w.name ?? '').toLowerCase().includes(q) || w.projectPath?.toLowerCase().includes(q))
          .slice(0, 3);
        for (const w of filtered) {
          results.push({ type: 'workspace', id: w.id, name: w.name, subtitle: w.projectPath, icon: 'ti ti-folder' });
        }
      }

      // Sessions (a name can be missing on records from older versions: never let it throw)
      if (sessionsRes.status === 'fulfilled') {
        const filtered = sessionsRes.value
          .filter(s => (s.name ?? '').toLowerCase().includes(q))
          .slice(0, 3);
        for (const s of filtered) {
          results.push({ type: 'session', id: s.id, name: s.name, subtitle: s.provider, icon: 'ti ti-terminal-2' });
        }
      }

      // Prompts
      if (promptsRes.status === 'fulfilled') {
        const promptList = promptsRes.value?.prompts ?? [];
        for (const p of promptList.slice(0, 3)) {
          results.push({ type: 'prompt', id: String(p.id), name: p.title || 'Untitled', subtitle: p.category?.name, icon: 'ti ti-file-text' });
        }
      }
    } catch (e) {
      // silently fail — results stay empty
    }

    // Only update if the query hasn't changed while we were fetching
    if (this.searchQuery === query) {
      this.searchResults = results;
      this.searchLoading = false;
    }
  }

  /** Opens the "available in PromptOps Desktop" dialog for a locked feature. */
  openCloudFeature(feature: CloudFeature): void {
    CloudFeatureModalComponent.open(this.modalService, feature);
  }

}
