import { Component, inject, Renderer2, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { MainLayoutComponent } from "../main-layout/main-layout.component";
import { Store } from '@ngrx/store';
import type { LayoutState } from '@/store/layout/layout-reducers';
import { UiPreferencesService } from '@core/services/ui-preferences.service';

@Component({
  selector: 'layout',
  standalone: true,
  imports: [MainLayoutComponent],
  templateUrl: './layout.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``
})
export class LayoutComponent implements OnInit {

  private store = inject(Store)
  private render = inject(Renderer2)
  private uiPrefs = inject(UiPreferencesService)

  // Desktop app is locked to dark mode; the web app lets the user choose.
  private readonly isDesktop = !!(window as any).promptops;

  ngOnInit(): void {
    this.store.select('layout').subscribe((data: LayoutState) => {
      const theme = this.isDesktop ? 'dark' : data.LAYOUT_THEME
      this.render.setAttribute(document.documentElement, 'data-bs-theme', theme)
      this.render.setAttribute(document.documentElement, 'data-layout-mode', data.LAYOUT_MODE)
      const menuColor = theme === 'dark' ? 'dark' : 'light'
      this.render.setAttribute(document.documentElement, 'data-menu-color', menuColor)
      const topbarColor = this.isDesktop ? 'dark' : data.TOPBAR_COLOR
      this.render.setAttribute(document.documentElement, 'data-topbar-color', topbarColor)
      this.render.setAttribute(document.documentElement, 'data-sidenav-size', data.MENU_SIZE)
    })

    // Apply saved user UI preferences (fonts, terminal, etc.)
    this.uiPrefs.init()
  }
}
