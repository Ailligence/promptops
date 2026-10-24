import { Component, OnInit, Renderer2, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import type { LayoutState } from '@/store/layout/layout-reducers';
import { setCurrentUser } from '@/store/authentication/authentication.actions';
import { AuthenticationService } from '@core/services/auth.service';

/**
 * Root of a detached window. Takes ONLY language, theme and current user from AppComponent and
 * LayoutComponent: the global services (agent ctl, presence, updates, native menu) run only once,
 * in the main window.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`:host { display: block; height: 100vh; overflow: auto; background: var(--promptops-body-bg); }`],
})
export class DetachedShellComponent implements OnInit {
  private store = inject(Store);
  private render = inject(Renderer2);
  private auth = inject(AuthenticationService);
  private translate = inject(TranslateService);
  private readonly isDesktop = !!(window as any).promptops;

  constructor() {
    this.translate.setDefaultLang('en');
    this.translate.use(localStorage.getItem('promptops_lang') || 'en');
  }

  ngOnInit(): void {
    // Same theme as the main window (LayoutComponent).
    this.store.select('layout').subscribe((data: LayoutState) => {
      const theme = this.isDesktop ? 'dark' : data.LAYOUT_THEME;
      this.render.setAttribute(document.documentElement, 'data-bs-theme', theme);
      this.render.setAttribute(document.documentElement, 'data-layout-mode', data.LAYOUT_MODE);
      this.render.setAttribute(document.documentElement, 'data-menu-color', theme === 'dark' ? 'dark' : 'light');
    });
    if (localStorage.getItem('token')) {
      this.auth.me().subscribe({
        next: (res: any) => {
          const user = res?.data?.user ?? res;
          if (user?.id) this.store.dispatch(setCurrentUser({ user }));
        },
        error: () => undefined,
      });
    }
  }
}
