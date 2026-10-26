import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, inject, signal, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

const ONBOARDED_KEY = 'voice_onboarded';

/**
 * First-run wizard for the global voice shortcut, ⌥+M (Alt+M on Windows and
 * Linux), held for 2 seconds. The desktop registers it as a system hotkey
 * (tauri-plugin-global-shortcut), which needs no Accessibility permission, so
 * the wizard covers:
 *   1. what the shortcut does and where the audio goes;
 *   2. an end-to-end shortcut test.
 *
 * The modal listens for `onVoiceHotkeyToggle`; once it fires while on
 * step 2 we know the OS-level wiring is fully working.
 */
@Component({
  selector: 'app-voice-onboarding-modal',
  standalone: true,
  imports: [TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="modal-header">
      <h4 class="modal-title">
        <iconify-icon icon="solar:microphone-bold-duotone" width="22"></iconify-icon>
        {{ 'voice.onboarding.title' | translate }}
      </h4>
      <button type="button" class="btn-close" [attr.aria-label]="'COMMON.Close' | translate" (click)="skip()"></button>
    </div>

    <div class="modal-body">
      <div class="steps-indicator">
        @for (s of [1, 2]; track s) {
          <span class="step-dot" [class.active]="step() === s" [class.done]="step() > s">{{ s }}</span>
        }
      </div>

      @if (step() === 1) {
        <div class="step">
          <h5>{{ 'voice.onboarding.step1.title' | translate }}</h5>
          <p>{{ 'voice.onboarding.step1.body' | translate }}</p>
          <!-- Where the audio goes, before the shortcut is turned on. -->
          <div class="voice-privacy-note">
            <iconify-icon icon="solar:info-circle-bold" width="15"></iconify-icon>
            <span>{{ 'voice.onboarding.privacy' | translate }}</span>
          </div>
          <div class="actions">
            <button class="btn btn-primary" (click)="enableAndAdvance()">
              {{ 'voice.onboarding.next' | translate }}
            </button>
          </div>
        </div>
      } @else if (step() === 2) {
        <div class="step center">
          <h5>{{ 'voice.onboarding.step2.title' | translate }}</h5>
          <p>{{ 'voice.onboarding.step2.body' | translate }}</p>

          @if (!success()) {
            <div class="kbd-hint">
              <kbd>{{ altKey }}</kbd> + <kbd>M</kbd>
              <span class="hint">{{ 'voice.onboarding.step2.hold_hint' | translate }}</span>
            </div>
            <div class="waiting"><span></span><span></span><span></span></div>
          } @else {
            <div class="success-box">
              <iconify-icon icon="solar:check-circle-bold" width="42"></iconify-icon>
              <p>{{ 'voice.onboarding.step2.success' | translate }}</p>
            </div>
          }

          <div class="actions">
            <button class="btn btn-secondary" (click)="skip()">
              {{ 'voice.onboarding.skip' | translate }}
            </button>
            @if (success()) {
              <button class="btn btn-primary" (click)="finish()">
                {{ 'voice.onboarding.finish' | translate }}
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host { display: block; }
    .modal-title { display: flex; align-items: center; gap: 0.5rem; }
    .voice-privacy-note {
      display: flex; align-items: flex-start; gap: 0.5rem;
      margin: 0.75rem 0 0.25rem;
      padding: 0.6rem 0.75rem;
      border: 1px solid oklch(from var(--po-accent) l c h / 25%);
      background: oklch(from var(--po-accent) l c h / 8%);
      border-radius: 8px;
      font-size: 0.78rem; line-height: 1.4; color: #a5b4fc;
    }
    .voice-privacy-note iconify-icon { flex: 0 0 auto; margin-top: 1px; }
    .steps-indicator {
      display: flex; justify-content: center; gap: 0.5rem;
      margin-bottom: 1.5rem;
    }
    .step-dot {
      width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: rgba(99,102,241,0.12); color: #6366f1;
      font-size: 0.78rem; font-weight: 700;
      border: 2px solid transparent;
    }
    .step-dot.active { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; }
    .step-dot.done { background: rgba(34,197,94,0.18); color: #22c55e; }
    .step h5 { font-size: 1rem; font-weight: 700; margin-bottom: 0.5rem; }
    .step p { font-size: 0.88rem; color: var(--bs-secondary-color, #8b949e); }
    .step ol { padding-left: 1.2rem; font-size: 0.85rem; line-height: 1.7; }
    .actions {
      display: flex; gap: 0.5rem; justify-content: flex-end;
      margin-top: 1.2rem;
    }
    .btn-primary { background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none; }
    .center { text-align: center; }
    .kbd-hint {
      display: inline-flex; align-items: center; gap: 0.4rem;
      margin: 1rem 0 0.5rem;
      font-size: 1.05rem; font-weight: 600;
    }
    .kbd-hint kbd {
      padding: 4px 10px; background: rgba(99,102,241,0.12);
      border: 1px solid rgba(99,102,241,0.3); border-radius: 6px;
      color: var(--po-accent);
    }
    .kbd-hint .hint { font-size: 0.78rem; font-weight: 400; color: var(--bs-secondary-color, #8b949e); }
    .waiting {
      display: flex; gap: 5px; justify-content: center;
      margin: 1rem 0;
    }
    .waiting span {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--po-accent);
      animation: pulse 1.2s ease-in-out infinite;
    }
    .waiting span:nth-child(2) { animation-delay: 0.2s; }
    .waiting span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }
    .success-box {
      padding: 1.5rem; border-radius: 12px;
      background: rgba(34,197,94,0.1); color: #22c55e;
      margin: 1rem 0;
    }
    .success-box p { color: #22c55e; margin: 0.5rem 0 0; font-weight: 600; }
  `,
})
export class VoiceOnboardingModalComponent implements OnDestroy {
  activeModal = inject(NgbActiveModal);

  step = signal<1 | 2>(1);
  success = signal(false);

  private hotkeyUnsubscribe: (() => void) | null = null;

  constructor() {
    // Listen for the global hotkey trigger; if it fires while we're on step 2,
    // we know everything is wired correctly end-to-end.
    const api = (window as any).promptops;
    if (api?.onVoiceHotkeyToggle) {
      this.hotkeyUnsubscribe = api.onVoiceHotkeyToggle(() => {
        if (this.step() === 2 && !this.success()) {
          this.success.set(true);
        }
      });
    }
  }

  /** The Option key on a Mac, Alt elsewhere. */
  readonly altKey = navigator.userAgent.includes('Macintosh') ? '⌥' : 'Alt';

  /**
   * On the way to "test the shortcut", turn the shortcut on so the desktop
   * registers the system hotkey. Without this, the test step would hang
   * forever.
   */
  async enableAndAdvance(): Promise<void> {
    const api = (window as any).promptops;
    if (api?.setVoiceShortcutConfig) {
      try { await api.setVoiceShortcutConfig({ enabled: true }); } catch { /* ignore */ }
    }
    this.step.set(2);
  }

  finish(): void {
    localStorage.setItem(ONBOARDED_KEY, '1');
    this.activeModal.close('done');
  }

  skip(): void {
    // User opted out — leave the shortcut disabled and remember so we don't
    // re-prompt automatically. They can still enable it later from Settings
    // or via the "?" → "Configura" banner.
    localStorage.setItem(ONBOARDED_KEY, '1');
    this.activeModal.dismiss('skipped');
  }

  @HostListener('keydown.escape')
  onEsc(): void { this.skip(); }

  ngOnDestroy(): void {
    this.hotkeyUnsubscribe?.();
  }
}

export const VOICE_ONBOARDED_KEY = ONBOARDED_KEY;
