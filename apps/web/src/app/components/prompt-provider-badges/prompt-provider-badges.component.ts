import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { SPAWN_PROVIDERS, PROVIDER_LOGOS } from '../../views/admin-core/sessions/services/spawn-providers.const';

@Component({
  selector: 'app-prompt-provider-badges',
  standalone: true,
  imports: [TranslateModule],
  template: `@for (provider of providers; track provider.value) {
    @if (ids?.includes(provider.value)) {
      <span class="provider-badge" [title]="provider.labelKey | translate">
        <img [src]="logos[provider.value]" alt="" />
        <span>{{ provider.labelKey | translate }}</span>
      </span>
    }
  }`,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host { display: inline-flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
    .provider-badge { display: inline-flex; align-items: center; gap: .3rem; padding: .2rem .45rem; border: 1px solid var(--bs-border-color); border-radius: 6px; background: var(--bs-tertiary-bg); color: var(--bs-body-color); font-size: .7rem; font-weight: 500; line-height: 1.2; }
    img { width: 16px; height: 16px; object-fit: contain; }
  `,
})
export class PromptProviderBadgesComponent {
  @Input() ids: string[] | null | undefined;
  protected providers = SPAWN_PROVIDERS;
  protected logos = PROVIDER_LOGOS;
}
