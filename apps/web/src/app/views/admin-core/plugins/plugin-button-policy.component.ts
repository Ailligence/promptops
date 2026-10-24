import { Component, computed, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { PluginRuntimeService, PluginSessionButton, SessionButtonConfirmPolicy } from './plugin-runtime.service';
import { TranslateModule } from '@ngx-translate/core';

/**
 * "Controlled by PromptOps" section in a plugin's settings page: when to ask for confirmation
 * before one of its session buttons sends a prompt to an agent. It is chosen by whoever uses
 * the plugin; the plugin's code neither reads nor changes these choices.
 */
@Component({
  selector: 'app-plugin-button-policy',
  standalone: true,
  imports: [TranslateModule],
  template: `
    @if (buttons().length) {
      <div class="pbp">
        <div class="pbp-cap">{{ 'PLUGIN_RUNTIME.Policy.Cap' | translate }}</div>
        <div class="pbp-title">{{ 'PLUGIN_RUNTIME.Policy.Title' | translate }}</div>
        @for (b of buttons(); track b.button.id) {
          <label class="pbp-row">
            <span class="pbp-name"><i class="ti {{ b.button.icon }}" aria-hidden="true"></i> {{ b.button.title }}</span>
            <select class="form-select form-select-sm" (change)="set(b, $any($event.target).value)" [attr.aria-label]="'PLUGIN_RUNTIME.Policy.Ask for' | translate: { title: b.button.title }">
              <option value="always" [selected]="policy(b) === 'always'">{{ 'PLUGIN_RUNTIME.Policy.Always' | translate }}</option>
              <option value="session" [selected]="policy(b) === 'session'">{{ 'PLUGIN_RUNTIME.Policy.Session' | translate }}</option>
              <option value="never" [selected]="policy(b) === 'never'">{{ 'PLUGIN_RUNTIME.Policy.Never' | translate }}</option>
            </select>
          </label>
        }
        <p class="pbp-note">{{ 'PLUGIN_RUNTIME.Policy.Note' | translate }}</p>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    .pbp { border: 1px solid var(--po-page-border, var(--promptops-border-color)); border-radius: var(--po-radius-md, 6px); padding: 12px; margin: 0 0 12px; }
    .pbp-cap { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--po-page-muted, var(--po-text-secondary)); margin-bottom: 6px; }
    .pbp-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .pbp-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; margin: 8px 0; }
    .pbp-name { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .pbp-row select { width: auto; min-width: 180px; flex: none; }
    .pbp-note { font-size: 12px; color: var(--po-page-muted, var(--po-text-secondary)); margin: 8px 0 0; }
    @media (max-width: 480px) { .pbp-row { flex-direction: column; align-items: stretch; gap: 4px; } .pbp-row select { width: 100%; } }
  `],
})
export class PluginButtonPolicyComponent {
  private runtime = inject(PluginRuntimeService);
  readonly pluginId = input.required<string>();
  readonly buttons = computed<PluginSessionButton[]>(() => this.runtime.sessionButtons().filter((b) => b.pluginId === this.pluginId()));

  policy(b: PluginSessionButton): SessionButtonConfirmPolicy {
    return this.runtime.confirmPolicy(b);
  }

  set(b: PluginSessionButton, value: string): void {
    this.runtime.setConfirmPolicy(b, value === 'session' || value === 'never' ? value : 'always');
  }
}
