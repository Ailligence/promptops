import { Component, inject, ViewChild, type OnInit, type OnDestroy, ChangeDetectionStrategy } from "@angular/core";
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
  type Event,
} from "@angular/router";
import { Store } from "@ngrx/store";
import { DetachedBridgeService } from "./detached/detached-bridge.service";
import { TitleService } from "@core/services/title.service";
import { AuthenticationService } from "@core/services/auth.service";
import { TranslateService } from "@ngx-translate/core";
import {
  NgProgressComponent,
  NgProgressModule,
  type NgProgressRef,
} from "ngx-progressbar";
import { ClaudeHookModalComponent } from "./components/claude-hook-modal/claude-hook-modal.component";
import { ClaudeHookService } from "./views/admin-core/sessions/services/claude-hook.service";
import { FeatureFlagService } from "@core/services/feature-flag.service";
import { ContextTransferService } from "@core/services/context-transfer.service";
import { ProviderLimitService } from "./views/admin-core/sessions/services/provider-limit.service";
import { FolderAccessModalComponent } from "./components/folder-access-modal/folder-access-modal.component";
import { StoreHealthBannerComponent } from "@core/data/store-health-banner.component";
import { setCurrentUser } from "@/store/authentication/authentication.actions";
import { FocusSyncService } from "@core/services/focus-sync.service";
import { NativeMenuService } from "@core/services/native-menu.service";
import { NotificationCenterService } from "@core/services/notification-center.service";
import { AgentMoveService } from "./views/admin-core/sessions/services/agent-move.service";
import { LinuxPerformanceService } from "@core/services/linux-performance.service";
import { openExternal } from "@core/local-mode";

const RELEASES_URL = "https://github.com/shellonback/promptops/releases";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet, NgProgressModule, ClaudeHookModalComponent, FolderAccessModalComponent, StoreHealthBannerComponent],
  templateUrl: "./app.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./app.component.scss",
})
export class AppComponent implements OnInit, OnDestroy {
  private titleService = inject(TitleService);
  private claudeHookService = inject(ClaudeHookService);
  private authService = inject(AuthenticationService);
  protected featureFlags = inject(FeatureFlagService);
  private contextTransfer = inject(ContextTransferService);
  private providerLimit = inject(ProviderLimitService);
  private store = inject(Store);
  private router = inject(Router);
  private focusSync = inject(FocusSyncService);
  private nativeMenu = inject(NativeMenuService);
  private notificationCenter = inject(NotificationCenterService);
  private agentMove = inject(AgentMoveService);
  private linuxPerf = inject(LinuxPerformanceService);
  private detachedBridge = inject(DetachedBridgeService);
  progressRef!: NgProgressRef;
  @ViewChild(NgProgressComponent) progressBar!: NgProgressComponent;

  constructor(private translate: TranslateService) {
    this.router.events.subscribe((event: Event) => {
      this.checkRouteChange(event);
    });

    const savedLang = localStorage.getItem('promptops_lang') || 'en';
    this.translate.setDefaultLang("en");
    this.translate.use(savedLang);
  }

  ngOnInit(): void {
    this.restoreLastRoute();
    this.titleService.init();
    this.claudeHookService.init();
    this.featureFlags.refreshProStatus();
    this.featureFlags.loadFlags();
    this.contextTransfer.start();
    this.providerLimit.start();
    this.focusSync.init();
    // MCP "move me to a new session" (desktop only).
    this.agentMove.init();
    // Detached windows (Floor plan): their links to other pages open here.
    void this.detachedBridge.init();
    this.linuxPerf.init();
    this.nativeMenu.init();
    // Agent outcomes in the notification center (local, in memory).
    this.notificationCenter.start();
    // Release notes and new versions are published on GitHub.
    this.nativeMenu.releaseNotes$.subscribe(() => openExternal(RELEASES_URL));
    this.nativeMenu.checkUpdates$.subscribe(() => openExternal(RELEASES_URL));
    // Load the local profile (name, UI preferences, onboarding state).
    this.authService.me().subscribe({
      next: (res: any) => {
        const user = res?.data?.user ?? res;
        if (user?.id) {
          this.store.dispatch(setCurrentUser({ user }));
          this.featureFlags.refreshProStatus();
        }
      },
      error: () => {},
    });
  }

  /**
   * Navigate to the last visited route (survives app close/reopen).
   * Falls back to the local desktop state if localStorage is empty.
   * Only restores on non-public pages to avoid overriding public navigation.
   */
  private async restoreLastRoute(): Promise<void> {
    // Don't restore if the user is navigating to a public page
    const currentUrl = window.location.pathname;
    const publicPrefixes = ['/download', '/explore', '/auth'];
    if (publicPrefixes.some(p => currentUrl.startsWith(p))) return;

    let route = localStorage.getItem('promptops_last_route');

    // Fallback: try the local desktop state (survives build-hash changes)
    if (!route) {
      const api = (window as any).promptops;
      if (api?.getDesktopState) {
        try {
          const state = await api.getDesktopState();
          if (state?.lastRoute) {
            route = state.lastRoute;
          }
        } catch { /* ignore */ }
      }
    }

    if (route && route !== this.router.url) {
      this.router.navigateByUrl(route);
    }
  }

  ngOnDestroy(): void {
    this.claudeHookService.ngOnDestroy();
    this.contextTransfer.stop();
  }

  checkRouteChange(routerEvent: Event) {
    if (routerEvent instanceof NavigationStart) {
      this.progressBar?.start();
    }
    if (
      routerEvent instanceof NavigationEnd ||
      routerEvent instanceof NavigationCancel ||
      routerEvent instanceof NavigationError
    ) {
      setTimeout(() => {
        this.progressBar?.complete();
      }, 200);
    }

    // Persist the current route for restore on next launch
    if (routerEvent instanceof NavigationEnd && routerEvent.urlAfterRedirects) {
      const url = routerEvent.urlAfterRedirects;
      if (url.startsWith('/admin')) {
        localStorage.setItem('promptops_last_route', url);
      }
    }
  }
}
