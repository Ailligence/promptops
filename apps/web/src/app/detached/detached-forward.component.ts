import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { focusMainWindow, tauri } from './detached-window';

/**
 * A detached window shows only its own section. A link to another part of the app
 * (sessions, settings…) opens in the main window, and this one goes back.
 */
@Component({
  selector: 'app-detached-forward',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<p style="padding:24px;opacity:.7">{{ 'COMMON.Opening in main window' | translate }}</p>`,
})
export class DetachedForwardComponent implements OnInit {
  private router = inject(Router);

  ngOnInit(): void {
    const url = this.router.url;
    void tauri()?.event.emit('detached:navigate', { url });
    void focusMainWindow();
    setTimeout(() => history.length > 1 ? history.back() : undefined, 50);
  }
}
