import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ModePreset, SubAgentMode } from '../services/sub-agent.service';
import { AgentInjectService, CatalogItem, ExtensionSelectionPayload } from '../services/agent-inject.service';
import { InjectAgentModalComponent } from '../inject-agent-modal/inject-agent-modal.component';
import {
  MAX_SOFT_SKILL_INSTRUCTIONS,
  MAX_SOFT_SKILL_NAME,
  SOFT_SKILL_BASE_MODES,
  SoftSkill,
  SoftSkillService,
} from '../services/soft-skill.service';

/** Mode row as the composer renders it (preset + iconify icon, color and hint). */
export type SoftSkillModeOption = ModePreset & { iconify: string; color: string; hint: string };

/**
 * What the modal hands back on Apply. `skill` = the soft skill to select
 * (saved on the way out); `clearSkill` = back to a plain mode;
 * `extensionSelection` = the Plugins · Skills · MCP the next spawn carries.
 * Cancel discards everything.
 */
export interface SoftSkillModalResult {
  skill?: SoftSkill;
  clearSkill?: boolean;
  extensionSelection: ExtensionSelectionPayload;
}

/**
 * Soft skill editor (pen icon next to the composer chip) — same compact
 * language as the Quick Actions / Quick commit panels: 9px uppercase section
 * heads, 26px rows, ghost 24px icon buttons, flat --po-bg-1 boxes. Two
 * sections only: the soft skill (pick one to edit or write a new one) and the
 * Plugins · Skills · MCP the next sub-agent spawns with (+ opens the picker).
 */
@Component({
  selector: 'app-soft-skill-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <h5 class="modal-title">
        <iconify-icon icon="solar:star-bold-duotone" width="17"></iconify-icon>
        {{ 'SESSIONS.SOFT_SKILL.Title' | translate }}
      </h5>
      <button type="button" class="btn-close" (click)="modal.dismiss()" [attr.aria-label]="'BUTTONS.Cancel' | translate"></button>
    </div>

    <div class="modal-body">
      <!-- ── Soft skill: pick one to edit (or a new one), name · base mode, instructions ── -->
      <section class="qm">
        <div class="qm-head">
          <span>{{ 'SESSIONS.SOFT_SKILL.Section skill' | translate }}</span>
          @if (editingId()) {
            <button type="button" class="qm-btn qm-btn-danger" (click)="removeEditing()" [title]="'SESSIONS.SOFT_SKILL.Delete skill' | translate" [attr.aria-label]="'SESSIONS.SOFT_SKILL.Delete skill' | translate">
              <iconify-icon icon="solar:trash-bin-trash-linear" width="16"></iconify-icon>
            </button>
          }
        </div>
        <div class="qm-row">
          <select class="qm-select" [value]="editingId() ?? ''" (change)="onPickExisting($any($event.target).value)" [attr.aria-label]="'SESSIONS.SOFT_SKILL.Section skill' | translate">
            <option value="">{{ 'SESSIONS.SOFT_SKILL.New skill' | translate }}</option>
            @for (s of skills(); track s.id) {
              <option [value]="s.id">{{ s.name }}</option>
            }
          </select>
        </div>
        <div class="qm-row">
          <input type="text" class="qm-input" [maxlength]="maxName" [ngModel]="draftName()" (ngModelChange)="draftName.set($event)" [placeholder]="'SESSIONS.SOFT_SKILL.Name placeholder' | translate" [attr.aria-label]="'SESSIONS.SOFT_SKILL.Name placeholder' | translate" />
          <select class="qm-select qm-select-mode" [ngModel]="draftBaseMode()" (ngModelChange)="draftBaseMode.set($event)" [title]="'SESSIONS.SOFT_SKILL.Base mode' | translate" [attr.aria-label]="'SESSIONS.SOFT_SKILL.Base mode' | translate">
            @for (m of baseModes(); track m.mode) {
              <option [value]="m.mode">{{ m.label }}</option>
            }
          </select>
        </div>
        <textarea class="qm-textarea" rows="6" [maxlength]="maxInstructions" [ngModel]="draftInstructions()" (ngModelChange)="draftInstructions.set($event)" [placeholder]="'SESSIONS.SOFT_SKILL.Instructions placeholder' | translate" [attr.aria-label]="'SESSIONS.SOFT_SKILL.Instructions placeholder' | translate" (keydown.control.enter)="apply()" (keydown.meta.enter)="apply()"></textarea>
        <div class="qm-foot"><span class="qm-count">{{ draftInstructions().length }} / {{ maxInstructions }}</span></div>
      </section>

      <!-- ── Plugins · Skills · MCP the next spawn carries (+ opens the picker) ── -->
      <section class="qm">
        <div class="qm-head">
          <span>{{ 'SESSIONS.SOFT_SKILL.Section extensions' | translate }}</span>
          @if (extItems().length > 0) { <span class="qm-badge">{{ extItems().length }}</span> }
          <button type="button" class="qm-btn" (click)="openPicker()" [title]="'SESSIONS.SOFT_SKILL.Add extensions' | translate" [attr.aria-label]="'SESSIONS.SOFT_SKILL.Add extensions' | translate">
            <iconify-icon icon="solar:add-circle-linear" width="16"></iconify-icon>
          </button>
        </div>
        @if (extItems().length > 0) {
          <div class="qm-chips">
            @for (item of extItems(); track item.itemId) {
              <span class="qm-chip">
                <iconify-icon [icon]="kindIcon(item)" width="13"></iconify-icon>
                <span class="qm-chip-name">{{ item.name }}</span>
                <button type="button" class="qm-chip-x" (click)="removeExt(item)" [title]="'SESSIONS.SOFT_SKILL.Remove' | translate" [attr.aria-label]="'SESSIONS.SOFT_SKILL.Remove' | translate"><iconify-icon icon="solar:close-circle-linear" width="14"></iconify-icon></button>
              </span>
            }
          </div>
        } @else {
          <div class="qm-empty">{{ 'SESSIONS.SOFT_SKILL.No extensions' | translate }}</div>
        }
      </section>

      @if (error()) {
        <div class="qm-error"><iconify-icon icon="solar:danger-triangle-linear" width="14"></iconify-icon>{{ error() }}</div>
      }
    </div>

    <div class="modal-footer">
      @if (currentSkillId) {
        <button type="button" class="qm-link me-auto" (click)="clearSkill()">{{ 'SESSIONS.SOFT_SKILL.Clear' | translate }}</button>
      }
      <button type="button" class="btn btn-outline-secondary" (click)="modal.dismiss()">{{ 'BUTTONS.Cancel' | translate }}</button>
      <button type="button" class="btn btn-primary" [disabled]="!canApply()" (click)="apply()">
        {{ (draftValid() ? 'SESSIONS.SOFT_SKILL.Save and apply' : 'SESSIONS.SOFT_SKILL.Apply') | translate }}
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .modal-title { display: flex; align-items: center; gap: 8px; font-size: 1rem; }
    .modal-title iconify-icon { color: #a78bfa; }
    .modal-body { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
    .modal-footer { gap: 8px; }

    /* Section box — same language as .quick-actions-mini, one size up */
    .qm {
      display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 10px 12px 12px;
      background: var(--po-bg-1); border: 1px solid var(--po-border-subtle);
      border-radius: var(--po-radius-lg, 10px);
    }
    .qm-head, .qm-row, .qm-foot { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .qm-head { min-height: 28px; }
    .qm-head > span:first-child {
      flex: 1; min-width: 0; padding-left: 2px; font-size: 10.5px; font-weight: 600;
      letter-spacing: .08em; text-transform: uppercase; color: var(--po-text-tertiary);
    }
    .qm-badge {
      min-width: 20px; padding: 1px 7px; border-radius: 10px; font-size: 10.5px; font-weight: 700;
      text-align: center; background: var(--po-bg-3); color: var(--po-text-secondary);
    }
    .qm-btn {
      display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
      min-width: 28px; height: 28px; padding: 0 5px; border: none; border-radius: 6px;
      background: transparent; color: var(--po-text-secondary); cursor: pointer;
    }
    .qm-btn:hover { background: var(--po-bg-3); color: var(--po-text-primary); }
    .qm-btn-danger:hover { color: var(--po-error); }
    .qm-btn:focus-visible, .qm-select:focus-visible, .qm-input:focus-visible, .qm-textarea:focus-visible {
      outline: 2px solid var(--po-text-secondary); outline-offset: 1px;
    }
    .qm-select, .qm-input {
      flex: 1; min-width: 0; width: 0; height: 34px; padding: 0 10px;
      border: 1px solid var(--po-border-subtle); border-radius: 6px;
      background: var(--po-bg-2); color: var(--po-text-primary);
      font-family: inherit; font-size: 13px; text-overflow: ellipsis;
    }
    .qm-select { cursor: pointer; }
    .qm-select-mode { flex: 0 0 auto; width: 150px; }
    .qm-input::placeholder, .qm-textarea::placeholder { color: var(--po-text-tertiary); }
    .qm-textarea {
      width: 100%; min-width: 0; box-sizing: border-box; padding: 9px 10px; resize: vertical;
      border: 1px solid var(--po-border-subtle); border-radius: 6px;
      background: var(--po-bg-2); color: var(--po-text-primary);
      font-family: inherit; font-size: 13px; line-height: 1.5; min-height: 132px; max-height: 320px;
    }
    .qm-foot { justify-content: flex-end; }
    .qm-count { font-size: 10.5px; color: var(--po-text-tertiary); font-variant-numeric: tabular-nums; padding-right: 2px; }

    .qm-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0; }
    .qm-chip {
      display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 30px; padding: 0 4px 0 10px;
      border: 1px solid var(--po-border-subtle); border-radius: 6px; background: var(--po-bg-2);
      font-size: 12.5px; font-weight: 500; color: var(--po-text-primary);
    }
    .qm-chip > iconify-icon { color: var(--po-text-secondary); flex-shrink: 0; }
    .qm-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qm-chip-x {
      display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
      padding: 0; border: none; border-radius: 4px; background: transparent; color: var(--po-text-tertiary); cursor: pointer;
    }
    .qm-chip-x:hover { background: var(--po-bg-3); color: var(--po-error); }
    .qm-empty { padding: 6px 2px 4px; font-size: 12.5px; line-height: 1.5; color: var(--po-text-tertiary); }
    .qm-error { display: flex; align-items: center; gap: 6px; padding: 4px 6px; font-size: 12.5px; color: var(--po-error); }
    .qm-link { background: none; border: none; padding: 0; font-size: 13px; color: var(--po-text-secondary); cursor: pointer; }
    .qm-link:hover { color: var(--po-text-primary); text-decoration: underline; }
  `,
})
export class SoftSkillModalComponent {
  protected modal = inject(NgbActiveModal);
  private modalService = inject(NgbModal);
  private softSkills = inject(SoftSkillService);
  private injectService = inject(AgentInjectService);
  private translate = inject(TranslateService);

  // ── Set by the opener before display ──
  /** Composer mode rows — labels for the base-mode select. */
  modes: SoftSkillModeOption[] = [];
  currentMode: SubAgentMode = 'sprint';
  currentSkillId: string | null = null;
  /** Provider of the agent being spawned — filters the extension catalog. */
  provider = 'claude-code-cli';
  /** Composer's current Plugins · Skills · MCP selection. */
  initialExtensionSelection: ExtensionSelectionPayload | null = null;

  readonly maxName = MAX_SOFT_SKILL_NAME;
  readonly maxInstructions = MAX_SOFT_SKILL_INSTRUCTIONS;

  error = signal('');
  readonly skills = this.softSkills.skills;

  /** Skill loaded in the form (null = writing a new one). */
  editingId = signal<string | null>(null);
  draftName = signal('');
  draftBaseMode = signal<SubAgentMode>('sprint');
  draftInstructions = signal('');
  private deletedCurrent = false;

  extItems = signal<CatalogItem[]>([]);
  private extSecrets = signal<Record<string, string>>({});

  readonly baseModes = computed(() =>
    SOFT_SKILL_BASE_MODES
      .map(mode => this.modes.find(m => m.mode === mode))
      .filter((m): m is SoftSkillModeOption => !!m),
  );

  readonly draftValid = computed(() => !!this.draftName().trim() && !!this.draftInstructions().trim());
  /** Half-filled form: block Apply so a stray name is never silently dropped. */
  readonly draftPartial = computed(() => !!this.draftName().trim() !== !!this.draftInstructions().trim());
  readonly canApply = computed(() => !this.draftPartial());

  /** Called by the opener once inputs are set. */
  init(): void {
    const current = this.softSkills.byId(this.currentSkillId);
    if (current) this.edit(current);
    else this.resetDraft();
    if (this.initialExtensionSelection) {
      this.extItems.set([...this.initialExtensionSelection.items]);
      this.extSecrets.set({ ...this.initialExtensionSelection.secrets });
    }
  }

  onPickExisting(id: string): void {
    const skill = id ? this.softSkills.byId(id) : undefined;
    if (skill) this.edit(skill);
    else this.resetDraft();
  }

  edit(skill: SoftSkill): void {
    this.editingId.set(skill.id);
    this.draftName.set(skill.name);
    this.draftBaseMode.set(skill.baseMode);
    this.draftInstructions.set(skill.instructions);
    this.error.set('');
  }

  resetDraft(): void {
    this.editingId.set(null);
    this.draftName.set('');
    this.draftBaseMode.set(SOFT_SKILL_BASE_MODES.includes(this.currentMode) ? this.currentMode : 'sprint');
    this.draftInstructions.set('');
    this.error.set('');
  }

  removeEditing(): void {
    const id = this.editingId();
    if (!id) return;
    this.softSkills.remove(id);
    if (id === this.currentSkillId) this.deletedCurrent = true;
    this.resetDraft();
  }

  kindIcon(item: CatalogItem): string {
    if (item.kind === 'skill') return 'solar:magic-stick-3-bold-duotone';
    if (item.kind === 'plugin') return 'solar:widget-2-bold-duotone';
    return 'solar:plug-circle-bold-duotone';
  }

  removeExt(item: CatalogItem): void {
    this.extItems.update(list => list.filter(i => i.itemId !== item.itemId));
  }

  /** Same picker as the composer's Plugins & Skills row, stacked on top. */
  async openPicker(): Promise<void> {
    const ref = this.modalService.open(InjectAgentModalComponent, { centered: true, size: 'lg' });
    const picker = ref.componentInstance as InjectAgentModalComponent;
    picker.provider.set(this.provider);
    picker.selectedItems.set([...this.extItems()]);
    picker.secrets.set({ ...this.extSecrets() });
    try {
      const result: ExtensionSelectionPayload | undefined = await ref.result;
      if (result) {
        this.extItems.set(result.items);
        this.extSecrets.set({ ...result.secrets });
      }
    } catch {
      // Picker dismissed — keep what we had.
    }
  }

  /** Persist the form (new or edited). */
  private saveDraft(): SoftSkill | null {
    if (!this.draftValid()) return null;
    const id = this.editingId();
    const existing = id ? this.softSkills.byId(id) : undefined;
    const skill = this.softSkills.save({
      ...(existing ?? {}),
      ...(id ? { id } : {}),
      name: this.draftName(),
      instructions: this.draftInstructions(),
      baseMode: this.draftBaseMode(),
      source: existing?.source ?? 'custom',
    });
    if (!skill) this.error.set(this.translate.instant('MESSAGE.Generic error'));
    return skill;
  }

  clearSkill(): void {
    this.modal.close({ clearSkill: true, extensionSelection: this.extensionSelection() } satisfies SoftSkillModalResult);
  }

  apply(): void {
    if (!this.canApply()) return;
    const saved = this.draftValid() ? this.saveDraft() : null;
    if (this.draftValid() && !saved) return;
    this.modal.close({
      ...(saved ? { skill: saved } : {}),
      ...(!saved && this.deletedCurrent ? { clearSkill: true } : {}),
      extensionSelection: this.extensionSelection(),
    } satisfies SoftSkillModalResult);
  }

  private extensionSelection(): ExtensionSelectionPayload {
    return this.injectService.buildExtensionSelection(this.extItems(), this.extSecrets());
  }
}
