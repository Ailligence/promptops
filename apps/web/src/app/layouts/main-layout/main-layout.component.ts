import { Component, DestroyRef, HostListener, inject, OnDestroy, Renderer2, signal, type OnInit, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TopbarComponent } from "../topbar/topbar.component";
import { SidebarComponent } from "../sidebar/sidebar.component";
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Store } from '@ngrx/store';
import { filter } from 'rxjs/operators';
import { getSidebarsize } from '@/store/layout/layout-selector';
import { changesidebarsize } from '@/store/layout/layout-action';
import type { LayoutState } from '@/store/layout/layout-reducers';
import { InteractionService } from '@/app/views/admin-core/sessions/services/interaction.service';
import { SessionService } from '@/app/views/admin-core/sessions/services/session.service';
import { sessionStatusChanged, sessionStandbyChanged } from '@/store/sessions/session.actions';
import { TutorialOverlayComponent } from '@/app/components/tutorial/tutorial-overlay.component';
import { BottomBarComponent } from '../bottom-bar/bottom-bar.component';
import { UiPreferencesService } from '@core/services/ui-preferences.service';
import { OfflineService } from '@core/services/offline.service';
import { usesSharedPageStyle } from './page-style-scope';
import { TranslateModule } from '@ngx-translate/core';
import { PluginRuntimeOverlayComponent } from '@views/admin-core/plugins/plugin-runtime-overlay.component';

/** Sessions and Teams (Discord-style shell) fill the whole area, without page padding. */
function isFullscreenUrl(url: string): boolean {
  return url.includes('/sessions') || (url.includes('/admin/teams') && !url.includes('/admin/teams/invite'));
}

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [TopbarComponent, SidebarComponent, BottomBarComponent, RouterModule, TutorialOverlayComponent, TranslateModule, PluginRuntimeOverlayComponent],
  templateUrl: './main-layout.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    /* Fullscreen route (sessions). Sizes use the --po-topbar-h and
       --po-bottombar-h tokens defined in _tokens.scss, so no need to hardcode them. */
    :host ::ng-deep .po-main-fullscreen {
      padding: 0 !important;
      min-height: unset !important;
      height: calc(100vh - var(--po-topbar-h) - var(--po-bottombar-h));
      overflow: hidden;
    }
    :host ::ng-deep .po-page-fullscreen {
      padding: 0 !important;
      max-width: 100% !important;
      height: 100%;
      overflow: hidden;
    }
    .offline-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1080;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 12px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #fff;
      background: #b45309;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    }
    .offline-banner i {
      font-size: 1rem;
    }
  `
})
export class MainLayoutComponent implements OnInit, OnDestroy {

  private store = inject(Store);
  private renderer = inject(Renderer2);
  private router = inject(Router);
  private interactionService = inject(InteractionService);
  private sessionService = inject(SessionService);
  private uiPrefs = inject(UiPreferencesService);
  protected offline = inject(OfflineService);
  private destroyRef = inject(DestroyRef);
  private unsubStatus: (() => void) | null = null;
  private unsubStandby: (() => void) | null = null;

  isFullscreenView = signal(false);
  sharedPageStyle = signal(false);

  onToggleMobileMenu() {
    const w = document.documentElement.clientWidth;

    if (w <= 768) {
      // Real mobile: overlay with backdrop
      const willOpen = !document.documentElement.classList.contains('sidebar-enable');
      document.documentElement.classList.toggle('sidebar-enable');
      if (willOpen) {
        this.showBackdrop();
      } else {
        this.removeBackdrop();
      }
      return;
    }

    // Tablet / desktop ridotto: toggle condensed/default (push, comportamento attuale)
    const current = document.documentElement.getAttribute('data-sidenav-size');
    const next = current === 'condensed' ? 'default' : 'condensed';
    this.store.dispatch(changesidebarsize({ size: next }));
    void this.uiPrefs.save({ sidebar_size: next });
  }

  showBackdrop() {
    this.removeBackdrop();
    const backdrop = this.renderer.createElement('div');
    this.renderer.addClass(backdrop, 'offcanvas-backdrop');
    this.renderer.addClass(backdrop, 'fade');
    this.renderer.addClass(backdrop, 'show');
    this.renderer.appendChild(document.body, backdrop);
    this.renderer.setStyle(document.body, 'overflow', 'hidden');

    if (window.innerWidth > 1040) {
      this.renderer.setStyle(document.body, 'paddingRight', '15px');
    }

    this.renderer.listen(backdrop, 'click', () => {
      document.documentElement.classList.remove('sidebar-enable');
      this.removeBackdrop();
    });
  }

  removeBackdrop() {
    const backdrop = document.querySelector('.offcanvas-backdrop');
    if (backdrop && backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
    this.renderer.setStyle(document.body, 'overflow', null);
    this.renderer.setStyle(document.body, 'paddingRight', null);
  }
  /**
   * The session screen is a canvas: no navigation rail, the dock in the bottom
   * bar and ⌘K replace it (see _signal-box.scss, html[data-po-canvas]).
   */
  private applyCanvas(url: string): void {
    const on = url.includes('/admin/sessions');
    if (on) document.documentElement.setAttribute('data-po-canvas', '');
    else document.documentElement.removeAttribute('data-po-canvas');
  }

  ngOnInit(): void {
    // Track fullscreen routes (no footer, no padding)
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((e) => {
      this.isFullscreenView.set(isFullscreenUrl(e.urlAfterRedirects));
      this.sharedPageStyle.set(usesSharedPageStyle(e.urlAfterRedirects));
      this.applyCanvas(e.urlAfterRedirects);
    });
    this.isFullscreenView.set(isFullscreenUrl(this.router.url));
    this.sharedPageStyle.set(usesSharedPageStyle(this.router.url));
    this.applyCanvas(this.router.url);

    // Global session interaction listener
    this.interactionService.init();
    // Note: loadSessions() is dispatched by SessionViewComponent — no need to duplicate here

    if (this.sessionService.isDesktop) {
      this.unsubStatus = this.sessionService.onSessionStatus((data) => {
        this.store.dispatch(sessionStatusChanged({
          sessionId: data.sessionId,
          status: data.status as any,
        }));
      });
      // Reflect park/wake initiated anywhere (including main process) in the store.
      this.unsubStandby = this.sessionService.onSessionStandbyChanged((data) => {
        this.store.dispatch(sessionStandbyChanged({
          sessionId: data.sessionId,
          standbyAt: data.standbyAt,
        }));
      });
    }

    this.store.select('layout').pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data:LayoutState) => {
      document.documentElement.setAttribute('data-bs-theme', data.LAYOUT_THEME);

      // Menu color follows the theme: light theme → light menu, dark theme → dark menu
      const menuColor = data.LAYOUT_THEME === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-menu-color', menuColor);
      document.documentElement.setAttribute(
        'data-topbar-color',
        data.TOPBAR_COLOR,
      );
      document.documentElement.setAttribute('data-sidenav-size', data.MENU_SIZE);
    });

    // Keep the data-sidenav-size attribute in sync with the store
    this.store.select(getSidebarsize).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((size: string) => {
      this.renderer.setAttribute(document.documentElement, 'data-sidenav-size', size);
    });

    this.onResize();
  }

  @HostListener('window:resize')
  onResize() {
    const w = document.documentElement.clientWidth;
    const current = document.documentElement.getAttribute('data-sidenav-size');
    // "Closed" variants the user may have chosen — never override these.
    const userClosed = current === 'condensed' || current === 'sm-hover';

    if (w <= 768) {
      // Mobile: drawer mode is the only fit. Force only if not already.
      if (current !== 'full') {
        this.store.dispatch(changesidebarsize({ size: 'full' }));
      }
    } else if (w <= 1140) {
      // Tablet: 'default'/'full' don't fit, collapse to 'condensed'.
      // Respect 'sm-hover' / 'sm-hover-active' if the user picked them.
      if (current === 'default' || current === 'full' || !current) {
        this.store.dispatch(changesidebarsize({ size: 'condensed' }));
      }
      document.documentElement.classList.remove('sidebar-enable');
      this.removeBackdrop();
    } else {
      // Wide viewport: respect persisted preference. Only normalize away the
      // mobile-only 'full' value, and only if the user hasn't explicitly closed.
      if (current === 'full' && !userClosed) {
        this.store.dispatch(changesidebarsize({ size: 'default' }));
      }
      document.documentElement.classList.remove('sidebar-enable');
      this.removeBackdrop();
    }
  }

  ngOnDestroy(): void {
    this.interactionService.destroy();
    this.unsubStatus?.();
    this.unsubStandby?.();
  }
}
