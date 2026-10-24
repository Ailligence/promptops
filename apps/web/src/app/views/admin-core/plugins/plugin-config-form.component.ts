import { Component, OnChanges, inject, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PluginConfig, PluginRuntimeService } from './plugin-runtime.service';

/**
 * A plugin's settings form, generated from the manifest's `config.fields`.
 * ONE single component, used both in the Plugins page and in the section modals:
 * this way credentials are edited the same way everywhere.
 * Secrets never come back from the runtime: you only see whether they are set.
 */
@Component({
  selector: 'app-plugin-config-form',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    @if (error()) { <div class="pcf-error">{{ error() }}</div> }
    @if (config(); as cfg) {
      @if (cfg.secretStorage?.lost) {
        <div class="pcf-error">{{ 'PLUGIN_RUNTIME.Config.Lost' | translate }}</div>
      }
      @if (!cfg.fields?.length) {
        <div class="pcf-muted">{{ 'PLUGIN_RUNTIME.Config.No settings' | translate }}</div>
      } @else {
        <div class="pcf-fields">
          @for (f of cfg.fields; track f.key) {
            <label class="pcf-field">
              @if (f.type !== 'boolean') { <span class="pcf-label">{{ f.label || f.key }}</span> }
              @if (f.type === 'secret') {
                <input class="form-control" type="password" autocomplete="off" [(ngModel)]="secrets[f.key]"
                       [placeholder]="(cfg.secretsSet.includes(f.key) ? 'PLUGIN_RUNTIME.Config.Saved placeholder' : 'PLUGIN_RUNTIME.Config.Not set') | translate">
                <span class="pcf-help">{{ secretHelp(cfg) }}</span>
              } @else if (f.type === 'boolean') {
                <span class="pcf-check"><input class="form-check-input" type="checkbox" [(ngModel)]="values[f.key]"> {{ f.label || f.key }}</span>
              } @else if (f.type === 'select') {
                <select class="form-select" [(ngModel)]="values[f.key]">
                  @for (o of f.options || []; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                </select>
              } @else {
                <input class="form-control" [type]="f.type === 'number' ? 'number' : 'text'" [(ngModel)]="values[f.key]">
              }
            </label>
          }
        </div>
        <div class="pcf-actions">
          <button class="btn btn-primary btn-sm" [disabled]="saving()" (click)="save()">{{ saveLabel() || ('PLUGIN_RUNTIME.Config.Save' | translate) }}</button>
        </div>
      }
    } @else if (!error()) {
      <div class="pcf-muted">{{ 'PLUGIN_RUNTIME.Config.Loading' | translate }}</div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [`
    :host { display: block; }
    .pcf-fields { display: flex; flex-direction: column; gap: 18px; max-width: 520px; }
    .pcf-field { display: flex; flex-direction: column; gap: 6px; margin: 0; }
    .pcf-label { font-size: .85rem; font-weight: 600; }
    .pcf-help, .pcf-muted { font-size: .8rem; color: var(--po-text-secondary, #697089); }
    .pcf-check { display: flex; align-items: center; gap: 8px; font-size: .88rem; }
    .pcf-actions { margin-top: 18px; }
    .pcf-error { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; font-size: .85rem; color: var(--po-error, #d1345b); background: var(--po-error-bg, rgba(209, 52, 91, .1)); }
  `],
})
export class PluginConfigFormComponent implements OnChanges {
  private runtime = inject(PluginRuntimeService);
  private translate = inject(TranslateService);

  /** Where a credential ends up. Without a keychain we say so, instead of promising encryption that is not there. */
  secretHelp(cfg: PluginConfig): string {
    const base = this.translate.instant('PLUGIN_RUNTIME.Config.Secret base');
    if (cfg.secretStorage?.storage === 'file') return this.translate.instant('PLUGIN_RUNTIME.Config.Secret file', { base });
    if (cfg.secretStorage?.storage === 'vault') return this.translate.instant('PLUGIN_RUNTIME.Config.Secret vault', { base });
    return this.translate.instant('PLUGIN_RUNTIME.Config.Secret keychain', { base });
  }

  pluginId = input.required<string>();
  /** Empty = the translated default "Save". */
  saveLabel = input<string>('');
  saved = output<void>();

  config = signal<PluginConfig | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);
  values: Record<string, any> = {};
  secrets: Record<string, string> = {};

  async ngOnChanges(): Promise<void> {
    this.config.set(null);
    this.error.set(null);
    try {
      const cfg = await this.runtime.getConfig(this.pluginId());
      this.values = {};
      this.secrets = {};
      for (const f of cfg.fields || []) {
        if (f.type !== 'secret') this.values[f.key] = cfg.values[f.key] ?? f.default ?? (f.type === 'boolean' ? false : '');
      }
      this.config.set(cfg);
    } catch (e: any) {
      this.error.set(typeof e === 'string' ? e : e?.message || this.translate.instant('PLUGIN_RUNTIME.Config.Load failed'));
    }
  }

  /** true if every required field has a value (for secrets: already saved or just typed). */
  isComplete(): boolean {
    const cfg = this.config();
    if (!cfg) return false;
    return (cfg.fields || []).every((f) => !f.required
      || (f.type === 'secret' ? cfg.secretsSet.includes(f.key) || !!this.secrets[f.key] : this.values[f.key] !== '' && this.values[f.key] != null));
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      // Only typed secrets: a field left empty does not touch the saved one.
      const secrets = Object.fromEntries(Object.entries(this.secrets).filter(([, v]) => !!v));
      await this.runtime.setConfig(this.pluginId(), this.values, secrets);
      await this.ngOnChanges();
      this.saved.emit();
    } catch (e: any) {
      this.error.set(typeof e === 'string' ? e : e?.message || this.translate.instant('PLUGIN_RUNTIME.Config.Save failed'));
    } finally {
      this.saving.set(false);
    }
  }
}
