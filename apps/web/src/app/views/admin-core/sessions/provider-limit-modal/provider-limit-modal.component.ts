import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { ProviderType } from '../../../../../store/sessions/session.state';
import { ProviderLimitContext, ProviderLimitDecision } from '../services/provider-limit.service';

/**
 * Wide "provider hit its limit" modal.
 *  - left (2/3): icon selector over installed / previously-used providers +
 *    scope flag (restart running sub-agents with shared context vs. only new
 *    spawns from the composer on).
 *  - right (1/3, compact): free / no-subscription alternatives with a short
 *    description, one recommended with a "why" line and an "open now" CTA.
 */
@Component({
  selector: 'app-provider-limit-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <div class="head">
        <span class="head-icon" [class.manual]="!!ctx.manual">
          <iconify-icon [icon]="ctx.manual ? 'solar:refresh-circle-bold-duotone' : 'solar:danger-triangle-bold-duotone'" width="22"></iconify-icon>
        </span>
        <div>
          @if (ctx.manual; as manual) {
            <h5 class="modal-title">{{ 'SUBAGENTS.LIMIT.Manual title' | translate: { target: manual.targetLabel } }}</h5>
            <p class="subtitle">{{ 'SUBAGENTS.LIMIT.Manual subtitle' | translate: { provider: ctx.exhaustedLabel } }}</p>
          } @else {
            <h5 class="modal-title">{{ 'SUBAGENTS.LIMIT.Title' | translate: { provider: ctx.exhaustedLabel } }}</h5>
            <p class="subtitle">
              @if (ctx.resetsLabel) {
                {{ 'SUBAGENTS.LIMIT.Subtitle' | translate: { resets: ctx.resetsLabel } }}
              } @else {
                {{ 'SUBAGENTS.LIMIT.Subtitle no reset' | translate }}
              }
            </p>
          }
        </div>
      </div>
      <button type="button" class="btn-close" (click)="activeModal.dismiss()" [attr.aria-label]="'COMMON.Close' | translate"></button>
    </div>

    <div class="modal-body">
      <div class="cols">
        <!-- ── Left: provider picker + scope ── -->
        <section class="main">
          <h6 class="sec-title">{{ 'SUBAGENTS.LIMIT.Pick provider' | translate }}</h6>
          <p class="sec-hint">{{ 'SUBAGENTS.LIMIT.Pick hint' | translate }}</p>

          <div class="grid">
            @for (c of ctx.candidates; track c.id) {
              <button
                type="button"
                class="tile"
                [class.selected]="selected() === c.id"
                [class.limited]="c.limited"
                [class.missing]="!c.installed"
                [disabled]="c.limited"
                (click)="select(c.id)"
                [title]="c.label"
              >
                <img class="p-logo" width="34" height="34" [src]="c.logo" [alt]="c.label" />
                <span class="tile-label">{{ c.label }}</span>
                <span class="tags">
                  @if (c.limited) {
                    <span class="tag warn">{{ 'SUBAGENTS.LIMIT.Limited' | translate }}</span>
                  } @else if (c.installed) {
                    <span class="tag ok">{{ 'SUBAGENTS.LIMIT.Installed' | translate }}</span>
                  } @else {
                    <span class="tag dim">{{ 'SUBAGENTS.LIMIT.Not installed' | translate }}</span>
                  }
                  @if (c.usedBefore && !c.limited) {
                    <span class="tag dim">{{ 'SUBAGENTS.LIMIT.Used before' | translate }}</span>
                  }
                </span>
                @if (selected() === c.id) {
                  <iconify-icon class="check" icon="solar:check-circle-bold" width="16"></iconify-icon>
                }
              </button>
            }
          </div>

          @if (ctx.manual) {
            <div class="manual-note">
              <iconify-icon icon="solar:refresh-circle-bold-duotone" width="14"></iconify-icon>
              <span>{{ 'SUBAGENTS.LIMIT.Manual note' | translate: { target: ctx.manual.targetLabel, provider: selectedLabel() } }}</span>
            </div>
          } @else {
          <h6 class="sec-title mt">{{ 'SUBAGENTS.LIMIT.Scope' | translate }}</h6>
          <div class="scope">
            <label class="opt" [class.active]="scope() === 'restart'" [class.disabled]="affectedCount() === 0">
              <input type="radio" name="scope" value="restart" [checked]="scope() === 'restart'"
                     [disabled]="affectedCount() === 0" (change)="scope.set('restart')" />
              <span class="opt-body">
                <span class="opt-title">
                  @if (affectedCount() > 0) {
                    {{ 'SUBAGENTS.LIMIT.Restart all' | translate: { count: affectedCount(), provider: selectedLabel() } }}
                  } @else {
                    {{ 'SUBAGENTS.LIMIT.Restart none' | translate: { provider: ctx.exhaustedLabel } }}
                  }
                </span>
                <span class="opt-hint">{{ 'SUBAGENTS.LIMIT.Restart all hint' | translate }}</span>
                @if (affectedCount() > 0) {
                  <span class="affected">
                    @if (ctx.affectedMain) {
                      <span class="chip main"><iconify-icon icon="solar:star-bold" width="12"></iconify-icon>{{ ctx.affectedMain.name }} · {{ 'SUBAGENTS.LIMIT.Main' | translate }}</span>
                    }
                    @for (a of ctx.affected; track a.id) {
                      <span class="chip"><iconify-icon [icon]="a.icon" width="12"></iconify-icon>{{ a.title }}</span>
                    }
                  </span>
                }
              </span>
            </label>
            <label class="opt" [class.active]="scope() === 'new'">
              <input type="radio" name="scope" value="new" [checked]="scope() === 'new'" (change)="scope.set('new')" />
              <span class="opt-body">
                <span class="opt-title">{{ 'SUBAGENTS.LIMIT.New only' | translate }}</span>
                <span class="opt-hint">{{ 'SUBAGENTS.LIMIT.New only hint' | translate: { provider: selectedLabel() } }}</span>
              </span>
            </label>
          </div>
          }

          @if (ctx.handoffDraft !== undefined && (ctx.manual || scope() === 'restart')) {
            <details class="handoff">
              <summary>
                <iconify-icon icon="solar:document-text-bold-duotone" width="14"></iconify-icon>
                {{ 'SUBAGENTS.LIMIT.Handoff title' | translate }}
                <span class="handoff-hint">{{ 'SUBAGENTS.LIMIT.Handoff hint' | translate: { provider: selectedLabel() } }}</span>
              </summary>
              <textarea class="form-control handoff-text" rows="9" spellcheck="false"
                        [attr.aria-label]="'SUBAGENTS.LIMIT.Handoff title' | translate"
                        [value]="handoff()" (input)="handoff.set($any($event.target).value)"></textarea>
            </details>
          }
        </section>

        <!-- ── Right: free alternatives (compact) ── -->
        <aside class="free">
          <h6 class="sec-title small">
            <iconify-icon icon="solar:gift-bold-duotone" width="14"></iconify-icon>
            {{ 'SUBAGENTS.LIMIT.Free title' | translate }}
          </h6>
          <p class="sec-hint small">{{ 'SUBAGENTS.LIMIT.Free hint' | translate }}</p>

          @for (f of ctx.free; track f.id) {
            <div class="free-row" [class.rec]="f.recommended" [class.limited]="f.limited" (click)="!f.limited && select(f.id)">
              <img class="p-logo sm" width="22" height="22" [src]="f.logo" [alt]="f.label" />
              <div class="free-body">
                <div class="free-head">
                  <span class="free-name">{{ f.label }}</span>
                  @if (f.recommended) {
                    <span class="tag rec">{{ 'SUBAGENTS.LIMIT.Recommended' | translate }}</span>
                  } @else if (f.installed) {
                    <span class="tag ok">{{ 'SUBAGENTS.LIMIT.Installed' | translate }}</span>
                  }
                </div>
                <p class="free-desc">{{ f.descKey | translate }}</p>
                @if (f.recommended) {
                  <p class="free-why"><b>{{ 'SUBAGENTS.LIMIT.Why' | translate }}:</b> {{ f.whyKey | translate }}</p>
                  <button type="button" class="btn btn-sm btn-primary open-now" (click)="openNow(f.id); $event.stopPropagation()">
                    <iconify-icon icon="solar:play-bold" width="12"></iconify-icon>
                    {{ 'SUBAGENTS.LIMIT.Open now' | translate: { provider: f.label } }}
                  </button>
                }
              </div>
            </div>
          }
        </aside>
      </div>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn btn-ghost" (click)="activeModal.dismiss()">
        {{ 'SUBAGENTS.LIMIT.Cancel' | translate }}
      </button>
      <button type="button" class="btn btn-primary" [disabled]="!selected()" (click)="confirm()">
        @if ((scope() === 'restart' && affectedCount() > 0) || ctx.manual) {
          {{ 'SUBAGENTS.LIMIT.Confirm restart' | translate: { provider: selectedLabel() } }}
        } @else {
          {{ 'SUBAGENTS.LIMIT.Confirm' | translate: { provider: selectedLabel() } }}
        }
      </button>
    </div>
  `,
  styles: `
    :host { display: block; color: var(--po-text-primary); }
    .modal-header { align-items: flex-start; border-bottom: 1px solid var(--po-border-subtle); }
    .head { display: flex; gap: 12px; align-items: flex-start; }
    .head-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      background: var(--po-error-bg); color: var(--po-error);
    }
    .head-icon.manual { background: var(--po-primary-bg, rgba(99, 102, 241, .14)); color: var(--po-primary, #6366f1); }
    .manual-note {
      display: flex; align-items: center; gap: 8px; margin-top: 18px; padding: 10px 12px;
      border-radius: 10px; font-size: 0.78rem; color: var(--po-text-secondary);
      background: var(--po-bg-2); border: 1px solid var(--po-border-subtle);
    }
    .manual-note iconify-icon { color: var(--po-primary, #6366f1); flex-shrink: 0; }
    .handoff { margin-top: 14px; border: 1px solid var(--po-border-subtle); border-radius: 10px; background: var(--po-bg-2); }
    .handoff summary {
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 10px 12px; cursor: pointer;
      font-size: 0.8rem; font-weight: 600; color: var(--po-text-primary);
    }
    .handoff summary iconify-icon { color: var(--po-primary, #6366f1); }
    .handoff-hint { font-weight: 400; color: var(--po-text-secondary); }
    .handoff-text {
      display: block; width: calc(100% - 24px); margin: 0 12px 12px; resize: vertical;
      font-family: var(--po-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 0.74rem; line-height: 1.45;
    }
    .modal-title { font-size: 1.05rem; font-weight: 600; margin: 0; }
    .subtitle { margin: 2px 0 0; font-size: 0.82rem; color: var(--po-text-secondary); }

    .cols { display: grid; grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr); gap: 20px; }
    @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }

    .sec-title {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.86rem; font-weight: 600; margin: 0 0 2px; color: var(--po-text-primary);
    }
    .sec-title.mt { margin-top: 18px; }
    .sec-title.small { font-size: 0.78rem; }
    .sec-hint { font-size: 0.76rem; color: var(--po-text-tertiary); margin: 0 0 10px; }
    .sec-hint.small { font-size: 0.7rem; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
    .tile {
      position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 10px 8px 8px; border-radius: 10px; cursor: pointer; text-align: center;
      background: var(--po-bg-2); border: 1px solid var(--po-border-subtle); color: var(--po-text-primary);
      transition: border-color .12s, background .12s, transform .12s;
    }
    .tile:hover:not(:disabled) { border-color: var(--po-border-strong); transform: translateY(-1px); }
    .tile.selected { border-color: var(--po-primary, #6366f1); background: var(--po-primary-bg, rgba(99, 102, 241, .12)); }
    .tile.missing { opacity: .7; }
    .tile.limited { opacity: .45; cursor: not-allowed; }
    .tile .check { position: absolute; top: 6px; right: 6px; color: var(--po-primary, #6366f1); }
    .p-logo { width: 34px; height: 34px; display: block; object-fit: contain; }
    .p-logo.sm { width: 22px; height: 22px; margin-top: 2px; }
    .tile-label { font-size: 0.78rem; font-weight: 600; line-height: 1.1; }
    .tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 3px; }
    .tag {
      font-size: 0.6rem; line-height: 1; padding: 3px 6px; border-radius: 999px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .02em;
      background: var(--po-bg-0); color: var(--po-text-secondary); border: 1px solid var(--po-border-subtle);
    }
    .tag.ok { background: var(--po-success-bg); color: var(--po-success); border-color: transparent; }
    .tag.warn { background: var(--po-error-bg); color: var(--po-error); border-color: transparent; }
    .tag.dim { color: var(--po-text-tertiary); }
    .tag.rec { background: var(--po-primary-bg, rgba(99, 102, 241, .14)); color: var(--po-primary, #6366f1); border-color: transparent; }

    .scope { display: grid; gap: 8px; }
    .opt {
      display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; cursor: pointer;
      background: var(--po-bg-2); border: 1px solid var(--po-border-subtle); margin: 0;
    }
    .opt.active { border-color: var(--po-primary, #6366f1); }
    .opt.disabled { opacity: .55; cursor: not-allowed; }
    .opt input { margin-top: 3px; accent-color: var(--po-primary, #6366f1); }
    .opt-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .opt-title { font-size: 0.82rem; font-weight: 600; }
    .opt-hint { font-size: 0.72rem; color: var(--po-text-secondary); }
    .affected { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .chip.main { border-color: var(--po-primary, #6366f1); color: var(--po-text-primary); }
    .chip {
      display: inline-flex; align-items: center; gap: 4px; font-size: 0.68rem; padding: 2px 7px;
      border-radius: 999px; background: var(--po-bg-0); border: 1px solid var(--po-border-subtle);
      color: var(--po-text-secondary); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .free {
      border-left: 1px solid var(--po-border-subtle); padding-left: 16px;
      display: flex; flex-direction: column; gap: 6px;
    }
    @media (max-width: 860px) { .free { border-left: 0; padding-left: 0; border-top: 1px solid var(--po-border-subtle); padding-top: 12px; } }
    .free-row {
      display: flex; gap: 8px; padding: 7px 8px; border-radius: 8px; cursor: pointer;
      border: 1px solid transparent; transition: background .12s, border-color .12s;
    }
    .free-row:hover { background: var(--po-bg-2); }
    .free-row.rec { background: var(--po-bg-2); border-color: var(--po-primary, #6366f1); }
    .free-row.limited { opacity: .45; cursor: not-allowed; }
    .free-body { min-width: 0; flex: 1; }
    .free-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .free-name { font-size: 0.76rem; font-weight: 600; }
    .free-desc { margin: 1px 0 0; font-size: 0.68rem; line-height: 1.3; color: var(--po-text-secondary); }
    .free-why { margin: 4px 0 0; font-size: 0.68rem; line-height: 1.3; color: var(--po-text-primary); }
    .open-now { margin-top: 6px; display: inline-flex; align-items: center; gap: 5px; font-size: 0.7rem; padding: 3px 9px; }

    .modal-footer { border-top: 1px solid var(--po-border-subtle); gap: 8px; }
    .btn-ghost { background: transparent; color: var(--po-text-secondary); border: 1px solid var(--po-border-subtle); }
    .btn-ghost:hover { color: var(--po-text-primary); border-color: var(--po-border-strong); }
  `,
})
export class ProviderLimitModalComponent {
  readonly activeModal = inject(NgbActiveModal);

  /** Set by ProviderLimitService right after open(). */
  ctx!: ProviderLimitContext;

  readonly selected = signal<ProviderType | null>(null);
  readonly scope = signal<'restart' | 'new'>('new');
  /** Editable handoff for the main session (seeded from ctx.handoffDraft). */
  readonly handoff = signal('');

  /** Sub-agents + the main session when it runs on the exhausted provider. */
  affectedCount(): number {
    return this.ctx.affected.length + (this.ctx.affectedMain ? 1 : 0);
  }

  readonly selectedLabel = computed(() => {
    const id = this.selected();
    return this.ctx.candidates.find((c) => c.id === id)?.label
      ?? this.ctx.free.find((f) => f.id === id)?.label
      ?? '…';
  });

  ngOnInit(): void {
    // Default pick: first non-limited installed candidate (already ranked),
    // else the recommended free one. Default scope: restart when something
    // is actually running on the exhausted provider.
    const first = this.ctx.candidates.find((c) => c.installed && !c.limited)
      ?? this.ctx.candidates.find((c) => !c.limited);
    const rec = this.ctx.free.find((f) => f.recommended);
    this.selected.set(first?.id ?? rec?.id ?? null);
    this.scope.set(this.affectedCount() > 0 ? 'restart' : 'new');
    this.handoff.set(this.ctx.handoffDraft ?? '');
  }

  select(id: ProviderType): void {
    this.selected.set(id);
  }

  confirm(): void {
    const provider = this.selected();
    if (!provider) return;
    const scope = this.affectedCount() > 0 ? this.scope() : 'new';
    const decision: ProviderLimitDecision = { provider, scope };
    if (this.ctx.handoffDraft !== undefined) decision.handoff = this.handoff();
    this.activeModal.close(decision);
  }

  /** Free block CTA: switch AND open one right away (when nothing restarts). */
  openNow(id: ProviderType): void {
    const scope = this.affectedCount() > 0 ? this.scope() : 'new';
    const decision: ProviderLimitDecision = { provider: id, scope, openNow: true };
    this.activeModal.close(decision);
  }
}
