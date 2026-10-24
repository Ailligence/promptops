import { Component, computed, input, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Blue check for publishers verified by an admin.
 * `team` = verified company/team, `user` = verified user.
 * The blue is a status signal, not a brand accent: it stays fixed across themes.
 */
@Component({
  selector: 'app-verified-badge',
  standalone: true,
  imports: [TranslateModule],
  template: `
    @if (verified()) {
      <span class="vb" [attr.title]="label() | translate" [attr.aria-label]="label() | translate" role="img"
            [style.width.px]="size()" [style.height.px]="size()">
        <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" aria-hidden="true">
          <path fill="#1d9bf0" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"/>
          <path fill="#fff" d="M10.54 16.2 6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/>
        </svg>
      </span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .vb { display: inline-flex; flex: none; line-height: 0; cursor: help; }
  `],
})
export class VerifiedBadgeComponent {
  verified = input<boolean>(false);
  kind = input<'user' | 'team'>('user');
  size = input<number>(16);

  /** i18n key, translated in the template so it follows the language. */
  label = computed(() => (this.kind() === 'team' ? 'PLUGIN_RUNTIME.Badge.Company' : 'PLUGIN_RUNTIME.Badge.User'));
}
