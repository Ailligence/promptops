import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, inject, signal, computed, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import {
  VOICE_COMMANDS,
  VOICE_COMMAND_CATEGORIES,
  VoiceCommand,
  VoiceCommandCategory,
  SupportedLang,
} from './voice-commands-data';
import { VoiceOnboardingModalComponent } from './voice-onboarding-modal.component';

const SUPPORTED_PATTERN_LANGS: SupportedLang[] = ['it', 'en'];

/**
 * Voice commands cheat-sheet shown when the user clicks the "?" button next
 * to the floating microphone. Modal text comes from `@ngx-translate` so it
 * always renders in the active UI language.
 *
 * The example string under each command shows the spoken phrase in the same
 * language as the UI — that is the language the user is most likely to speak.
 */
@Component({
  selector: 'app-voice-commands-guide-modal',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <h4 class="modal-title">
        <iconify-icon icon="solar:microphone-bold-duotone" width="22"></iconify-icon>
        {{ 'voice.guide.title' | translate }}
      </h4>
      <button type="button" class="btn-close" [attr.aria-label]="'COMMON.Close' | translate" (click)="activeModal.dismiss()"></button>
    </div>

    <div class="modal-body">
      @if (shortcutChecked() && !shortcutEnabled()) {
        <div class="shortcut-banner">
          <div class="shortcut-banner-content">
            <iconify-icon icon="solar:command-bold-duotone" width="22"></iconify-icon>
            <div>
              <strong>{{ 'voice.guide.banner_title' | translate }}</strong>
              <p>{{ 'voice.guide.banner_body' | translate }}</p>
            </div>
          </div>
          <button class="btn btn-sm btn-primary" (click)="openShortcutWizard()">
            {{ 'voice.guide.banner_cta' | translate }}
          </button>
        </div>
      } @else if (shortcutEnabled()) {
        <p class="hint">
          <iconify-icon icon="solar:command-bold" width="14"></iconify-icon>
          {{ 'voice.guide.shortcut_hint' | translate }}
        </p>
      } @else {
        <p class="hint">
          <iconify-icon icon="solar:mouse-bold" width="14"></iconify-icon>
          {{ 'voice.guide.click_hint' | translate }}
        </p>
      }

      <input
        type="text"
        class="form-control mb-2 search-input"
        [ngModel]="search()"
        (ngModelChange)="search.set($event)"
        [placeholder]="'voice.guide.search_placeholder' | translate"
        autofocus
      />

      <!-- Category chips: jump straight to one command family -->
      <div class="cat-chips">
        <button class="cat-chip" [class.active]="activeCat() === null" (click)="activeCat.set(null)">
          {{ 'voice.guide.all_categories' | translate }}
        </button>
        @for (cat of categories; track cat) {
          <button class="cat-chip" [class.active]="activeCat() === cat" (click)="toggleCat(cat)">
            {{ ('voice.guide.categories.' + cat) | translate }}
          </button>
        }
      </div>

      @for (cat of categories; track cat) {
        @if (filteredByCategory()[cat].length > 0) {
          <details open class="cat-block">
            <summary>
              <span class="cat-title">{{ ('voice.guide.categories.' + cat) | translate }}</span>
              <span class="cat-count">{{ filteredByCategory()[cat].length }}</span>
            </summary>
            <div class="cmd-list">
              @for (cmd of filteredByCategory()[cat]; track cmd.id) {
                <div class="cmd-row" [class.expanded]="expandedId() === cmd.id">
                  <code class="cmd-example" (click)="copyExample(cmd)" [title]="'voice.guide.click_to_copy' | translate">
                    "{{ exampleFor(cmd) }}"
                  </code>
                  <span class="cmd-desc">{{ (cmd.i18nKey + '.description') | translate }}</span>
                  <span class="cmd-actions">
                    @if (cmd.requiresConfirmation) {
                      <span class="badge-confirm" [title]="'voice.guide.requires_confirmation' | translate">
                        <iconify-icon icon="solar:shield-warning-bold" width="12"></iconify-icon>
                      </span>
                    }
                    <button class="cmd-expand" (click)="toggleExpand(cmd.id)" [title]="'voice.guide.all_phrases' | translate">
                      <iconify-icon [icon]="expandedId() === cmd.id ? 'solar:alt-arrow-up-bold' : 'solar:alt-arrow-down-bold'" width="13"></iconify-icon>
                    </button>
                  </span>
                </div>
                @if (expandedId() === cmd.id) {
                  <div class="cmd-variants">
                    @for (p of allPhrasesFor(cmd); track p) {
                      <code class="cmd-variant" (click)="copyText(p)">"{{ p }}"</code>
                    }
                  </div>
                }
              }
            </div>
          </details>
        }
      }

      @if (totalVisible() === 0) {
        <p class="empty">{{ 'voice.guide.no_results' | translate }}</p>
      }
    </div>

    <div class="modal-footer">
      <button type="button" class="btn btn-primary" (click)="activeModal.close()" #okBtn>
        {{ 'voice.guide.ok_button' | translate }}
        <kbd>&#9166;</kbd>
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host { display: block; }
    .modal-title { display: flex; align-items: center; gap: 0.5rem; }
    .hint {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.82rem; color: var(--bs-secondary-color, #8b949e);
      margin-bottom: 0.8rem;
    }
    .search-input { font-size: 0.9rem; }
    .cat-chips {
      display: flex; flex-wrap: wrap; gap: 0.35rem;
      margin-bottom: 0.8rem;
    }
    .cat-chip {
      border: 1px solid rgba(99,102,241,0.28); border-radius: 999px;
      background: transparent; color: var(--bs-secondary-color, #8b949e);
      font-size: 0.74rem; font-weight: 600;
      padding: 2px 10px; cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      text-transform: capitalize;
    }
    .cat-chip:hover { color: #8b9cf6; border-color: rgba(99,102,241,0.5); }
    .cat-chip.active {
      background: rgba(99,102,241,0.18); color: #8b9cf6;
      border-color: rgba(99,102,241,0.6);
    }
    .cmd-actions { display: inline-flex; align-items: center; gap: 0.3rem; justify-content: flex-end; }
    .cmd-expand {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 6px;
      border: none; background: transparent; color: var(--bs-secondary-color, #8b949e);
      cursor: pointer; padding: 0; transition: background 0.15s, color 0.15s;
    }
    .cmd-expand:hover { background: rgba(99,102,241,0.15); color: #8b9cf6; }
    .cmd-variants {
      display: flex; flex-wrap: wrap; gap: 0.3rem;
      padding: 0.3rem 0.3rem 0.55rem;
      border-bottom: 1px dashed rgba(99,102,241,0.1);
    }
    .cmd-variant {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.7rem; padding: 1px 6px; border-radius: 5px;
      background: rgba(139,92,246,0.07); color: rgba(139,92,246,0.85);
      cursor: pointer; transition: background 0.15s;
    }
    .cmd-variant:hover { background: rgba(139,92,246,0.2); }
    .cat-block { margin-bottom: 0.5rem; border: 1px solid var(--bs-border-color, #30363d); border-radius: 8px; overflow: hidden; }
    .cat-block summary {
      cursor: pointer; user-select: none;
      padding: 0.55rem 0.85rem;
      background: rgba(99,102,241,0.08);
      display: flex; align-items: center; justify-content: space-between;
      font-weight: 600; font-size: 0.88rem;
    }
    .cat-title { color: #6366f1; text-transform: capitalize; }
    .cat-count {
      font-size: 0.72rem; padding: 1px 7px; border-radius: 8px;
      background: rgba(99,102,241,0.18); color: #6366f1; font-weight: 700;
    }
    .cmd-list { padding: 0.4rem 0.6rem 0.6rem; }
    .cmd-row {
      display: grid; grid-template-columns: minmax(180px, 1fr) 2fr auto;
      align-items: center; gap: 0.6rem;
      padding: 0.4rem 0.3rem;
      border-bottom: 1px dashed rgba(99,102,241,0.1);
    }
    .cmd-row:last-child { border-bottom: none; }
    .cmd-example {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.78rem;
      padding: 2px 6px; border-radius: 5px;
      background: rgba(139,92,246,0.1); color: #8b5cf6;
      cursor: pointer; transition: background 0.15s;
    }
    .cmd-example:hover { background: rgba(139,92,246,0.2); }
    .cmd-desc { font-size: 0.83rem; color: var(--bs-body-color, #e6edf3); }
    .badge-confirm {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 50%;
      background: rgba(245,158,11,0.15); color: #f59e0b;
    }
    .empty {
      text-align: center; padding: 1.5rem; color: var(--bs-secondary-color, #8b949e);
      font-size: 0.85rem;
    }
    kbd {
      display: inline-block; padding: 1px 6px; margin-left: 0.3rem;
      font-size: 0.78rem; font-family: inherit;
      border: 1px solid currentColor; border-radius: 4px; opacity: 0.85;
    }
    .modal-footer .btn-primary {
      background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none;
    }
    .shortcut-banner {
      display: flex; align-items: center; justify-content: space-between;
      gap: 0.75rem; padding: 0.75rem 1rem;
      background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.12));
      border: 1px solid rgba(99,102,241,0.25);
      border-radius: 10px;
      margin-bottom: 1rem;
    }
    .shortcut-banner-content { display: flex; align-items: center; gap: 0.6rem; }
    .shortcut-banner-content iconify-icon { color: #6366f1; flex-shrink: 0; }
    .shortcut-banner strong { display: block; font-size: 0.88rem; }
    .shortcut-banner p { margin: 0.15rem 0 0; font-size: 0.78rem; color: var(--bs-secondary-color, #8b949e); }
    .shortcut-banner .btn-primary {
      background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none;
      flex-shrink: 0;
    }
  `,
})
export class VoiceCommandsGuideModalComponent implements OnInit {
  activeModal = inject(NgbActiveModal);
  private translate = inject(TranslateService);
  private modalService = inject(NgbModal);

  categories = VOICE_COMMAND_CATEGORIES;
  search = signal('');
  activeCat = signal<VoiceCommandCategory | null>(null);
  expandedId = signal<string | null>(null);
  shortcutEnabled = signal(false);
  shortcutChecked = signal(false);

  ngOnInit(): void {
    const api = (window as any).promptops;
    if (api?.getVoiceShortcutConfig) {
      api.getVoiceShortcutConfig().then((res: any) => {
        if (res?.ok && res.config) this.shortcutEnabled.set(!!res.config.enabled);
      }).catch(() => undefined).finally(() => this.shortcutChecked.set(true));
    } else {
      this.shortcutChecked.set(true);
    }
  }

  openShortcutWizard(): void {
    this.activeModal.close('opened-wizard');
    this.modalService.open(VoiceOnboardingModalComponent, {
      size: 'md',
      centered: true,
      backdrop: 'static',
    });
  }

  /** Determines which language's example to show under each command. */
  private uiLang = computed<SupportedLang>(() => {
    const lang = (localStorage.getItem('promptops_lang') ?? this.translate.currentLang ?? 'en').toLowerCase();
    if ((SUPPORTED_PATTERN_LANGS as string[]).includes(lang)) return lang as SupportedLang;
    return 'en';
  });

  filteredByCategory = computed<Record<VoiceCommandCategory, VoiceCommand[]>>(() => {
    const term = this.search().trim().toLowerCase();
    const cat = this.activeCat();
    const grouped = {} as Record<VoiceCommandCategory, VoiceCommand[]>;
    for (const c of this.categories) grouped[c] = [];
    for (const cmd of VOICE_COMMANDS) {
      if (cat && cmd.category !== cat) continue;
      if (term && !this.commandMatches(cmd, term)) continue;
      grouped[cmd.category].push(cmd);
    }
    return grouped;
  });

  toggleCat(cat: VoiceCommandCategory): void {
    this.activeCat.update((c) => (c === cat ? null : cat));
  }

  toggleExpand(id: string): void {
    this.expandedId.update((c) => (c === id ? null : id));
  }

  /** Every phrase variant for the command in the UI language (en fallback). */
  allPhrasesFor(cmd: VoiceCommand): string[] {
    const lang = this.uiLang();
    return cmd.patterns[lang] ?? cmd.patterns.en ?? [];
  }

  copyText(text: string): void {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => undefined);
    }
  }

  totalVisible = computed(() => {
    const grouped = this.filteredByCategory();
    return this.categories.reduce((sum, c) => sum + grouped[c].length, 0);
  });

  exampleFor(cmd: VoiceCommand): string {
    const lang = this.uiLang();
    const patterns = cmd.patterns[lang] ?? cmd.patterns.en ?? [];
    return patterns[0] ?? '';
  }

  copyExample(cmd: VoiceCommand): void {
    const text = this.exampleFor(cmd);
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => undefined);
    }
  }

  private commandMatches(cmd: VoiceCommand, term: string): boolean {
    if (cmd.id.toLowerCase().includes(term)) return true;
    const example = this.exampleFor(cmd).toLowerCase();
    if (example.includes(term)) return true;
    const desc = this.translate.instant(cmd.i18nKey + '.description')?.toLowerCase?.() ?? '';
    if (desc.includes(term)) return true;
    return false;
  }

  @HostListener('keydown.enter')
  onEnter(): void {
    this.activeModal.close();
  }
}
