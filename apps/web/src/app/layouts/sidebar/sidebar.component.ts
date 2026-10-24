import { Component, DestroyRef, effect, inject, untracked, type OnInit, ChangeDetectionStrategy } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { distinctUntilChanged, filter, map } from "rxjs";
import { SimplebarAngularModule } from "simplebar-angular";
import { LogoBoxComponent } from "@components/logo-box.component";
import {
  MENU_ITEMS,
  MENU_ITEMS_MINIMAL,
  MENU_ITEMS_THEME,
  type MenuItemType,
} from "@common/menu-meta";
import { basePath } from "@common/constants";
import { NavigationEnd, Router, RouterModule } from "@angular/router";
import { Store } from "@ngrx/store";
import { findAllParent, findMenuItem } from "@core/helper/utils";
import {
  NgbCollapseModule,
  NgbModal,
  type NgbCollapse,
} from "@ng-bootstrap/ng-bootstrap";
import { CommonModule } from "@angular/common";
import { changesidebarsize } from "@/store/layout/layout-action";
import { getUser } from "@/store/authentication/authentication.selector";
import { environment } from "@environment/environment";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { QuickAccessComponent } from "./quick-access/quick-access.component";
import { FeatureFlagService } from "@core/services/feature-flag.service";
import { getWaitingInputSessionsCount } from "@/store/sessions/session.selectors";
import { UiPreferencesService } from "@core/services/ui-preferences.service";
import { AuthenticationService } from "@core/services/auth.service";
import { CloudFeatureModalComponent, type CloudFeature } from "@components/cloud-feature-modal/cloud-feature-modal.component";
import { TooltipDirective } from "@common/tooltip.directive";
import { UserMenuComponent } from "@/app/components/user-menu/user-menu.component";
import { UiStyleService } from "@core/services/ui-style.service";
import { PluginRuntimeService, type PluginMenuPage } from "@/app/views/admin-core/plugins/plugin-runtime.service";

import { ABSORBED_BY_BUILTIN, BUILTIN_MENU_KEYS, BUILTIN_PLUGINS, BuiltinPluginsService } from '@/app/views/admin-core/plugins/builtin-plugins.service';
import { NotificationCenterComponent } from "@/app/components/notification-center/notification-center.component";
@Component({
  selector: "app-sidebar",
  standalone: true,
  imports: [
    NotificationCenterComponent,
    SimplebarAngularModule,
    LogoBoxComponent,
    CommonModule,
    NgbCollapseModule,
    RouterModule,
    TranslateModule,
    QuickAccessComponent,
    TooltipDirective,
    UserMenuComponent,
  ],
  templateUrl: "./sidebar.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host ::ng-deep .po-nav-link {
      padding: 7px 12px !important;
      font-size: 0.8125rem !important;
    }
    :host ::ng-deep .po-nav-heading {
      padding: 10px 14px 4px !important;
      font-size: 10px !important;
    }
    :host ::ng-deep .po-nav-icon {
      width: 20px !important;
      height: 20px !important;
      font-size: 15px !important;
      line-height: 20px !important;
    }
    :host ::ng-deep .po-nav-label {
      font-size: 0.8125rem !important;
    }
    :host ::ng-deep .po-nav-item { margin: 0 !important; }

    /* Guest-locked sections: grayed out but still hoverable, so the
       tooltip can explain why and the click can open the upgrade modal. */
    :host ::ng-deep .po-nav-link.disabled {
      opacity: 0.45;
      cursor: not-allowed;
      pointer-events: auto;
    }

    /* Session count badge — light text on red bg */
    :host ::ng-deep .badge.bg-danger {
      color: var(--po-accent-on) !important;
      background: var(--po-error) !important;
    }

    /* "BETA" badge — amber/warning semantic (flat, no glow) */
    :host ::ng-deep .badge.bg-warning {
      background: var(--po-warning-bg) !important;
      color: var(--po-warning) !important;
      font-size: var(--po-text-xs) !important;
      font-weight: var(--po-weight-bold) !important;
      letter-spacing: 0.04em !important;
      text-transform: uppercase !important;
      padding: 2px var(--po-space-1) !important;
      border-radius: var(--po-radius-sm) !important;
      border: 1px solid transparent !important;
      line-height: 1.3 !important;
      margin-left: var(--po-space-2);
    }

    /* Item added by a plugin: small puzzle piece in place of the badge */
    :host ::ng-deep .menu-plugin-mark {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      line-height: 1;
      opacity: 0.55;
      padding-left: var(--po-space-2);
      flex: none;
    }
    :host ::ng-deep .po-nav-link:hover .menu-plugin-mark,
    :host ::ng-deep .po-nav-link.active .menu-plugin-mark { opacity: 0.9; }

    /* Compact menu: the text disappears, so the puzzle piece moves over the real icon,
       small, in the bottom-right corner. With the menu open it goes back to the right of the row. */
    :host ::ng-deep .po-nav-icon.from-plugin { position: relative; }
    :host ::ng-deep .menu-plugin-corner {
      display: none;
      position: absolute;
      right: -5px;
      bottom: -4px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      font-size: 9px !important;
      line-height: 12px !important;
      text-align: center;
      background: var(--po-bg-0, var(--promptops-body-bg, #fff));
      box-shadow: 0 0 0 1px var(--po-bg-0, var(--promptops-body-bg, #fff));
    }
    :host-context(html[data-sidenav-size="condensed"]) ::ng-deep .menu-plugin-corner,
    :host-context(html[data-sidenav-size="sm-hover"]) ::ng-deep .po-sidebar:not(:hover) .menu-plugin-corner { display: block; }
    :host-context(html[data-sidenav-size="condensed"]) ::ng-deep .menu-plugin-mark,
    :host-context(html[data-sidenav-size="sm-hover"]) ::ng-deep .po-sidebar:not(:hover) .menu-plugin-mark { display: none; }

    /* "NEW" badge — green semantic (flat, no glow) */
    :host ::ng-deep .badge.bg-new-summer,
    :host ::ng-deep .badge.bg-beta {
      background: var(--po-success-bg) !important;
      color: var(--po-success) !important;
      font-size: var(--po-text-xs) !important;
      font-weight: var(--po-weight-bold) !important;
      letter-spacing: 0.04em !important;
      text-transform: uppercase !important;
      padding: 2px var(--po-space-1) !important;
      border-radius: var(--po-radius-sm) !important;
      border: 1px solid transparent !important;
      line-height: 1.3 !important;
      margin-left: var(--po-space-2);
    }
    /* "BETA" badge — same shape as NEW, accent color */
    :host ::ng-deep .badge.bg-beta {
      background: var(--po-accent-muted-bg) !important;
      color: var(--po-accent) !important;
    }
  `,
})
export class SidebarComponent implements OnInit {
  menuItems: MenuItemType[] = [];
  /** The native items after the role and flag filters: the base onto which the plugin ones are grafted. */
  private baseItems: MenuItemType[] = [];
  activeMenuItems: string[] = [];

  router = inject(Router);
  trimmedURL = this.router.url?.replaceAll(
    basePath !== "" ? basePath + "/" : "",
    "/"
  );

  store = inject(Store);
  private ff = inject(FeatureFlagService);
  private uiPrefs = inject(UiPreferencesService);
  private modalService = inject(NgbModal);
  private destroyRef = inject(DestroyRef);
  private uiStyleService = inject(UiStyleService);
  private pluginRuntime = inject(PluginRuntimeService);
  private builtins = inject(BuiltinPluginsService);
  private translate = inject(TranslateService);
  uiStyle = this.uiStyleService.style;
  private menuInitialized = false;

  /**
   * Entries that need PromptOps Cloud. They stay visible with a lock and open
   * the download dialog of PromptOps Desktop instead of a page.
   */
  private static readonly CLOUD_LOCKED: Record<string, CloudFeature> = {
    ranking: "ranking",
    "morning-news": "morning",
    teams: "teams",
    explore: "explore",
    profile: "profile",
    organization: "organization",
  };

  constructor() {
    this.router.events.forEach((event) => {
      if (event instanceof NavigationEnd) {
        this.trimmedURL = this.router.url?.replaceAll(
          basePath !== "" ? basePath + "/" : "",
          "/"
        );
        this._activateMenu();
        setTimeout(() => {
          this.scrollToActive();
        }, 200);

        // Mobile only: automatically close the sidebar after navigation.
        // Only when size=full (≤768px) → avoids collapsing the sidebar on desktop.
        const size = document.documentElement.getAttribute('data-sidenav-size');
        if (size === 'full' && document.documentElement.classList.contains('sidebar-enable')) {
          this.closeFullSidebar();
        }
      }
    });

    // Classic and minimal have a different menu order (menu-meta): on style
    // change it is rebuilt. The first pass is done by ngOnInit.
    effect(() => {
      this.uiStyle();
      if (!this.menuInitialized) return;
      untracked(() => this.initMenu());
    });

    // Menu items added by active plugins. Tauri v2 desktop only: elsewhere the list is empty.
    effect(() => {
      this.pluginRuntime.menuPages();
      this.builtins.off();
      this.applyPluginPages();
    });
  }

  /**
   * Grafts the pages of active plugins into the menu.
   *  - The integrated sections (AI Agent Evals, AI Git Writer, Browser) stay the usual NATIVE items, under
   *    "Plugins" after the Catalog, with the same page; turned off from the Plugins page they disappear.
   *  - The pages of registry plugins go as sub-items of "Plugins", after the Catalog, except those
   *    of plugins absorbed by an integrated section (ABSORBED_BY_BUILTIN), which do not enter the menu.
   * The native items stay the same objects, so live badges are not lost.
   */
  private applyPluginPages(): void {
    const pages = this.pluginRuntime.menuPages().filter((p) => !ABSORBED_BY_BUILTIN[p.pluginId]);
    const toItem = (p: PluginMenuPage): MenuItemType => ({
      key: `plugin-page:${p.pluginId}:${p.pageId}`,
      label: p.title,
      icon: p.icon,
      url: `/admin/plugin-page/${p.pluginId}/${p.pageId}`,
      fromPlugin: p.pluginName,
      parentKey: 'plugins',
    });
    // Integrated plugins turned off from the Plugins page: the native item disappears.
    const hidden = (item: MenuItemType): boolean => {
      const key = BUILTIN_MENU_KEYS[item.key];
      return !!key && !this.builtins.isOn(key);
    };
    // Integrated sections: they are PromptOps plugins, so they carry the puzzle piece like plugin items.
    const mark = (native: MenuItemType): MenuItemType => {
      const builtinKey = BUILTIN_MENU_KEYS[native.key];
      // A translation key: the template's translate pipe shows it in the current language.
      const builtinName = builtinKey && BUILTIN_PLUGINS.some((b) => b.key === builtinKey) ? `BUILTIN_PLUGINS.${builtinKey}.Name` : undefined;
      return builtinName ? { ...native, fromPlugin: builtinName } : native;
    };
    const apply = (list: MenuItemType[]): MenuItemType[] =>
      list.filter((item) => !hidden(item)).map((native) => {
        if (!native.children) return mark(native);
        const children = apply(native.children);
        const extra = native.key === 'plugins' ? pages.map(toItem) : [];
        const prev = this.menuItems.find((m) => m.key === native.key);
        // The open/closed state survives the recompute (new plugins, integrated toggles).
        return { ...native, collapsed: prev?.collapsed ?? native.collapsed, children: [...children, ...extra] };
      });
    this.menuItems = SidebarComponent.dropOrphanTitles(apply(this.baseItems));
    // Every menu rebuild (plugins, integrated toggles, style change) recomputes
    // the active item: previously it was lost until navigating again.
    this._activateMenu();
  }

  /** A section title with no items under it (flag off, integrated plugin off) disappears. */
  private static dropOrphanTitles(list: MenuItemType[]): MenuItemType[] {
    return list.filter((item, i) => {
      if (!item.isTitle) return true;
      const next = list[i + 1];
      return !!next && !next.isTitle;
    });
  }

  /** Accessible name of the item: without it, the compact rail shows only the icon glyph. */
  menuLabel(menu: MenuItemType): string {
    return menu.custom ? this.translate.instant('MENU.' + menu.label) : menu.label;
  }

  ngOnInit(): void {
    this.initMenu();

    this.store.select(getWaitingInputSessionsCount).subscribe((count) => {
      const sessionsItem = this.menuItems.find((m) => m.key === 'sessions');
      if (sessionsItem) {
        sessionsItem.badge = count > 0 ? { variant: 'danger', text: String(count) } : undefined;
      }
    });
  }

  initMenu(): void {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const userRole = user?.role?.name || 'user';

    const source = this.uiStyle() === 'minimal' ? MENU_ITEMS_MINIMAL : MENU_ITEMS;
    let items = source.filter(item => {
      if (item.roles && !item.roles.includes(userRole)) return false;
      if (item.featureFlag && !this.ff.canAccess(item.featureFlag)) return false;
      return true;
    });

    if (environment.showTheme)
      items = [...items, ...MENU_ITEMS_THEME];

    const lock = (item: MenuItemType): MenuItemType => {
      const locked = SidebarComponent.CLOUD_LOCKED[item.key] ? { ...item, isDisabled: true } : item;
      return locked.children ? { ...locked, children: locked.children.map(lock) } : locked;
    };
    items = items.map(lock);

    this.baseItems = items;
    this.applyPluginPages();
    // Live badges (Sessions, Feedback) stay: the items are the same objects as menu-meta.
    this.menuInitialized = true;
  }

  openCloudFeature(key: string): void {
    const feature = SidebarComponent.CLOUD_LOCKED[key];
    if (feature) CloudFeatureModalComponent.open(this.modalService, feature);
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this._activateMenu();
    });
    setTimeout(() => {
      this.scrollToActive();
    }, 200);
  }

  hasSubmenu(menu: MenuItemType): boolean {
    return menu.children ? true : false;
  }

  scrollToActive(): void {
    const activatedItem = document.querySelector(".po-nav-item li a.active");
    if (activatedItem) {
      const simplebarContent = document.querySelector(
        ".po-sidebar .simplebar-content-wrapper"
      );
      if (simplebarContent) {
        const activatedItemRect = activatedItem.getBoundingClientRect();
        const simplebarContentRect = simplebarContent.getBoundingClientRect();
        const activatedItemOffsetTop =
          activatedItemRect.top + simplebarContent.scrollTop;
        const centerOffset =
          activatedItemOffsetTop -
          simplebarContentRect.top -
          simplebarContent.clientHeight / 2 +
          activatedItemRect.height / 2;
        this.scrollTo(simplebarContent, centerOffset, 600);
      }
    }
  }

  easeInOutQuad(t: number, b: number, c: number, d: number): number {
    t /= d / 2;
    if (t < 1) return (c / 2) * t * t + b;
    t--;
    return (-c / 2) * (t * (t - 2) - 1) + b;
  }

  scrollTo(element: Element, to: number, duration: number): void {
    const start = element.scrollTop;
    const change = to - start;
    const increment = 20;
    let currentTime = 0;

    const animateScroll = () => {
      currentTime += increment;
      const val = this.easeInOutQuad(currentTime, start, change, duration);
      element.scrollTop = val;
      if (currentTime < duration) {
        setTimeout(animateScroll, increment);
      }
    };
    animateScroll();
  }

  /**
   * Highlights the item of the open page (and its parent groups).
   * Works on the menu data, not the DOM: so it works right after a
   * rebuild too (plugins, style change) and with hash / query / fragment routing.
   * Match: identical url, otherwise the longest prefix on a segment boundary
   * (e.g. /admin/sessions/abc → Sessions, /admin/prompt-library/explore → Explore).
   */
  _activateMenu(): void {
    const current = SidebarComponent.normalizePath(this.router.url ?? this.trimmedURL ?? "");
    let best: MenuItemType | null = null;
    let bestLen = -1;
    const visit = (list: MenuItemType[]) => {
      for (const item of list) {
        if (item.children) visit(item.children);
        if (!item.url || item.isTitle) continue;
        const url = SidebarComponent.normalizePath(item.url);
        const hit = current === url || current.startsWith(url.endsWith("/") ? url : url + "/");
        if (hit && url.length > bestLen) {
          best = item;
          bestLen = url.length;
        }
      }
    };
    visit(this.menuItems);

    if (!best) {
      // Page outside the menu (e.g. /admin/get-pro): no stale highlight left hanging.
      this.activeMenuItems = [];
      return;
    }
    const activeMt: MenuItemType = best;
    const matchingObjs = [activeMt.key, ...findAllParent(this.menuItems, activeMt)];
    this.activeMenuItems = matchingObjs;
    this.menuItems.forEach((menu: MenuItemType) => {
      if (menu.children) menu.collapsed = !matchingObjs.includes(menu.key);
    });
  }

  /** "/#/admin/x?y=1#frag" | "#/admin/x" | "/base/admin/x/" → "/admin/x" */
  private static normalizePath(raw: string): string {
    let p = raw.trim();
    const hashRoute = p.indexOf("#/");
    if (hashRoute >= 0) p = p.slice(hashRoute + 1);
    p = p.split("?")[0].split("#")[0];
    if (basePath && p.startsWith(basePath + "/")) p = p.slice(basePath.length);
    if (!p.startsWith("/")) p = "/" + p;
    if (p.length > 1) p = p.replace(/\/+$/, "");
    return p;
  }

  /**
   * toggles open menu
   * @param menuItem clicked menuitem
   * @param collapse collpase instance
   */
  toggleMenuItem(menuItem: MenuItemType, collapse: NgbCollapse): void {
    collapse.toggle();
    let openMenuItems: string[];
    if (!menuItem.collapsed) {
      openMenuItems = [
        menuItem["key"],
        ...findAllParent(this.menuItems, menuItem),
      ];
      this.menuItems.forEach((menu: MenuItemType) => {
        if (!openMenuItems.includes(menu.key!)) {
          menu.collapsed = true;
        }
      });
    }
  }

  changeSidebarSize() {
    let size = document.documentElement.getAttribute("data-sidenav-size");
    if (size == "sm-hover") {
      size = "sm-hover-active";
    } else {
      size = "sm-hover";
    }
    this.store.dispatch(changesidebarsize({ size }));
    void this.uiPrefs.save({ sidebar_size: size });
    // The attribute follows the store through MainLayoutComponent's single subscription: a new
    // subscription here on every click piled up and was never released.
  }

  closeFullSidebar() {
    document.documentElement.classList.remove('sidebar-enable');

    const backdrop = document.querySelector('.offcanvas-backdrop');
    if (backdrop && backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }

    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }
}
