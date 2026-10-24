import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { AuthenticationService } from '@core/services/auth.service';
import { FirstSessionPromptService } from '@core/services/first-session-prompt.service';
import { getUser } from '@/store/authentication/authentication.selector';
import { setCurrentUser } from '@/store/authentication/authentication.actions';
import { User } from '@core/models/user';

type OnboardingInterest = 'sessions' | 'prompts' | 'teams' | 'explore';

interface OnboardingCard {
  id: OnboardingInterest;
  icon: string;
  titleKey: string;
  descKey: string;
  route: string;
  accent: 'indigo' | 'purple' | 'fuchsia' | 'violet';
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="onboarding-wrap">
      <div class="onboarding-card-outer">
        <header class="onboarding-header">
          <div class="wave-emoji" aria-hidden="true">👋</div>
          <h1 class="onboarding-title">
            {{ 'ONBOARDING.Greeting' | translate: { name: firstName() } }}
          </h1>
          <p class="onboarding-subtitle">
            {{ 'ONBOARDING.Subtitle' | translate }}
          </p>
        </header>

        <!-- Hero card: Sessions (primary entry point) -->
        <button
          type="button"
          class="hero-card"
          [class.is-loading]="loadingId() === heroCard.id"
          [class.is-disabled]="loadingId() !== null && loadingId() !== heroCard.id"
          [disabled]="loadingId() !== null"
          (click)="choose(heroCard)"
        >
          <div class="hero-icon">
            <i class="ti" [ngClass]="heroCard.icon"></i>
          </div>
          <div class="hero-body">
            <span class="hero-badge">{{ 'ONBOARDING.Hero_Badge' | translate }}</span>
            <h2 class="hero-title">{{ heroCard.titleKey | translate }}</h2>
            <p class="hero-desc">{{ heroCard.descKey | translate }}</p>
          </div>
          <div class="hero-cta" aria-hidden="true">
            <span class="hero-cta-label">{{ 'ONBOARDING.Hero_CTA' | translate }}</span>
            <span class="hero-arrow"><i class="ti ti-arrow-right"></i></span>
          </div>
        </button>

        <!-- Secondary discovery: other features -->
        <div class="secondary-block">
          <div class="secondary-label">{{ 'ONBOARDING.Secondary_Label' | translate }}</div>
          <div class="secondary-grid">
            @for (card of secondaryCards; track card.id) {
              <button
                type="button"
                class="secondary-card"
                [class.is-loading]="loadingId() === card.id"
                [class.is-disabled]="loadingId() !== null && loadingId() !== card.id"
                [attr.data-accent]="card.accent"
                [disabled]="loadingId() !== null"
                (click)="choose(card)"
              >
                <div class="sec-icon">
                  <i class="ti" [ngClass]="card.icon"></i>
                </div>
                <div class="sec-body">
                  <h3 class="sec-title">{{ card.titleKey | translate }}</h3>
                  <p class="sec-desc">{{ card.descKey | translate }}</p>
                </div>
                <span class="sec-arrow" aria-hidden="true">
                  <i class="ti ti-arrow-right"></i>
                </span>
              </button>
            }
          </div>
        </div>

        <footer class="onboarding-footer">
          <button
            type="button"
            class="skip-link"
            [disabled]="loadingId() !== null"
            (click)="skip()"
          >
            {{ 'ONBOARDING.Skip' | translate }}
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100%;
    }

    .onboarding-wrap {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 48px 24px;
      min-height: calc(100vh - 80px);
      background:
        radial-gradient(ellipse at top left, rgba(99, 102, 241, 0.08), transparent 60%),
        radial-gradient(ellipse at bottom right, rgba(168, 85, 247, 0.08), transparent 60%);
    }

    .onboarding-card-outer {
      width: 100%;
      max-width: 1040px;
      background: var(--bs-body-bg, #fff);
      border-radius: 20px;
      padding: 48px 40px 32px;
      box-shadow: 0 10px 40px -12px rgba(79, 70, 229, 0.18);
      border: 1px solid rgba(99, 102, 241, 0.12);
    }

    .onboarding-header {
      text-align: center;
      margin-bottom: 40px;
    }

    .wave-emoji {
      font-size: 44px;
      margin-bottom: 12px;
      display: inline-block;
      animation: wave 1.8s ease-in-out;
      transform-origin: 70% 70%;
    }

    @keyframes wave {
      0%, 60%, 100% { transform: rotate(0); }
      10%, 30% { transform: rotate(14deg); }
      20% { transform: rotate(-8deg); }
      40% { transform: rotate(14deg); }
      50% { transform: rotate(-4deg); }
    }

    .onboarding-title {
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 8px;
      background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }

    .onboarding-subtitle {
      font-size: 16px;
      color: var(--bs-secondary-color, #6c757d);
      margin: 0;
      max-width: 540px;
      margin-left: auto;
      margin-right: auto;
      line-height: 1.5;
    }

    .onboarding-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }

    /* ═══ HERO CARD (primary entry point) ═══ */

    .hero-card {
      position: relative;
      display: flex;
      align-items: center;
      gap: 22px;
      width: 100%;
      text-align: left;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%);
      border: 1.5px solid rgba(99, 102, 241, 0.25);
      border-radius: 18px;
      padding: 24px 28px;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      font: inherit;
      color: inherit;
      overflow: hidden;
      margin-bottom: 28px;
    }

    .hero-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 18px;
      pointer-events: none;
      opacity: 0;
      transition: opacity .18s ease;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.10), rgba(168, 85, 247, 0.10));
    }

    .hero-card:hover:not(.is-disabled):not(.is-loading) {
      transform: translateY(-3px);
      box-shadow: 0 16px 36px -14px rgba(99, 102, 241, 0.45);
      border-color: rgba(99, 102, 241, 0.55);
    }

    .hero-card:hover:not(.is-disabled):not(.is-loading)::before {
      opacity: 1;
    }

    .hero-card.is-disabled { opacity: .45; cursor: not-allowed; }
    .hero-card.is-loading { cursor: progress; border-color: rgba(99, 102, 241, 0.6); }

    .hero-icon {
      flex: 0 0 auto;
      width: 64px;
      height: 64px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 32px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      box-shadow: 0 10px 24px -8px rgba(99, 102, 241, 0.6);
    }

    .hero-body {
      flex: 1 1 auto;
      min-width: 0;
    }

    .hero-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.15);
      color: #4f46e5;
      margin-bottom: 8px;
    }

    .hero-title {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 6px;
      color: var(--bs-body-color, #1f2937);
    }

    .hero-desc {
      font-size: 14.5px;
      color: var(--bs-secondary-color, #6c757d);
      margin: 0;
      line-height: 1.5;
    }

    .hero-cta {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 8px 20px -8px rgba(99, 102, 241, 0.55);
      transition: transform .18s ease, box-shadow .18s ease;
    }

    .hero-card:hover:not(.is-disabled):not(.is-loading) .hero-cta {
      transform: translateX(2px);
      box-shadow: 0 10px 24px -8px rgba(168, 85, 247, 0.6);
    }

    .hero-arrow { display: inline-flex; }

    @media (max-width: 640px) {
      .hero-card { flex-direction: column; align-items: flex-start; padding: 22px 20px; }
      .hero-cta { align-self: stretch; justify-content: center; }
      .hero-cta-label { font-size: 13.5px; }
    }

    /* ═══ SECONDARY BLOCK (other features) ═══ */

    .secondary-block {
      margin-bottom: 24px;
    }

    .secondary-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .05em;
      text-transform: uppercase;
      color: var(--bs-secondary-color, #8a94a6);
      margin-bottom: 12px;
      padding-left: 4px;
    }

    .secondary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }

    .secondary-card {
      position: relative;
      display: flex;
      align-items: center;
      gap: 14px;
      text-align: left;
      background: var(--bs-tertiary-bg, #f8f9fa);
      border: 1.5px solid transparent;
      border-radius: 12px;
      padding: 14px 44px 14px 14px;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      font: inherit;
      color: inherit;
    }

    .secondary-card:hover:not(.is-disabled):not(.is-loading) {
      transform: translateY(-2px);
      box-shadow: 0 8px 18px -8px rgba(99, 102, 241, 0.28);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .secondary-card.is-disabled { opacity: .45; cursor: not-allowed; }
    .secondary-card.is-loading { cursor: progress; border-color: rgba(99, 102, 241, 0.55); }

    .secondary-card[data-accent="purple"] .sec-icon { background: linear-gradient(135deg, #a855f7, #c084fc); }
    .secondary-card[data-accent="fuchsia"] .sec-icon { background: linear-gradient(135deg, #d946ef, #e879f9); }
    .secondary-card[data-accent="violet"] .sec-icon { background: linear-gradient(135deg, #7c3aed, #a78bfa); }

    .sec-icon {
      flex: 0 0 auto;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 18px;
      box-shadow: 0 5px 12px -5px rgba(99, 102, 241, 0.5);
    }

    .sec-body { flex: 1 1 auto; min-width: 0; }

    .sec-title {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 2px;
      color: var(--bs-body-color, #1f2937);
    }

    .sec-desc {
      font-size: 12.5px;
      color: var(--bs-secondary-color, #6c757d);
      margin: 0;
      line-height: 1.4;
    }

    .sec-arrow {
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: rgba(99, 102, 241, 0.1);
      color: #6366f1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      transition: transform .18s ease, background .18s ease;
    }

    .secondary-card:hover:not(.is-disabled):not(.is-loading) .sec-arrow {
      transform: translateY(-50%) translateX(3px);
      background: #6366f1;
      color: #fff;
    }

    .onboarding-card {
      position: relative;
      text-align: left;
      background: var(--bs-tertiary-bg, #f8f9fa);
      border: 1.5px solid transparent;
      border-radius: 16px;
      padding: 24px 20px 52px;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease;
      min-height: 210px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font: inherit;
      color: inherit;
    }

    .onboarding-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 16px;
      pointer-events: none;
      opacity: 0;
      transition: opacity .18s ease;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.08));
    }

    .onboarding-card:hover:not(.is-disabled):not(.is-loading) {
      transform: translateY(-3px);
      box-shadow: 0 12px 28px -10px rgba(99, 102, 241, 0.35);
      border-color: rgba(99, 102, 241, 0.35);
    }

    .onboarding-card:hover:not(.is-disabled):not(.is-loading)::before {
      opacity: 1;
    }

    .onboarding-card.is-disabled {
      opacity: .45;
      cursor: not-allowed;
    }

    .onboarding-card.is-loading {
      cursor: progress;
      border-color: rgba(99, 102, 241, 0.55);
    }

    .onboarding-card[data-accent="indigo"] .card-icon { background: linear-gradient(135deg, #6366f1, #818cf8); }
    .onboarding-card[data-accent="purple"] .card-icon { background: linear-gradient(135deg, #a855f7, #c084fc); }
    .onboarding-card[data-accent="fuchsia"] .card-icon { background: linear-gradient(135deg, #d946ef, #e879f9); }
    .onboarding-card[data-accent="violet"] .card-icon { background: linear-gradient(135deg, #7c3aed, #a78bfa); }

    .card-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 24px;
      margin-bottom: 16px;
      box-shadow: 0 6px 16px -6px rgba(99, 102, 241, 0.6);
    }

    .card-title {
      font-size: 17px;
      font-weight: 600;
      margin: 0 0 6px;
      color: var(--bs-body-color, #1f2937);
    }

    .card-desc {
      font-size: 14px;
      color: var(--bs-secondary-color, #6c757d);
      margin: 0;
      line-height: 1.5;
    }

    .card-arrow {
      position: absolute;
      right: 20px;
      bottom: 18px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(99, 102, 241, 0.12);
      color: #6366f1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: transform .18s ease, background .18s ease;
    }

    .onboarding-card:hover:not(.is-disabled):not(.is-loading) .card-arrow {
      transform: translateX(4px);
      background: #6366f1;
      color: #fff;
    }

    .onboarding-footer {
      display: flex;
      justify-content: center;
      padding-top: 8px;
    }

    .skip-link {
      background: none;
      border: none;
      color: var(--bs-secondary-color, #6c757d);
      font-size: 14px;
      cursor: pointer;
      padding: 8px 14px;
      border-radius: 8px;
      transition: color .18s ease, background .18s ease;
    }

    .skip-link:hover:not(:disabled) {
      color: #6366f1;
      background: rgba(99, 102, 241, 0.08);
    }

    .skip-link:disabled {
      opacity: .5;
      cursor: not-allowed;
    }

    @media (max-width: 640px) {
      .onboarding-card-outer { padding: 32px 20px 24px; }
      .onboarding-title { font-size: 24px; }
      .onboarding-grid { gap: 14px; }
    }
  `],
})
export class OnboardingComponent {
  private readonly auth = inject(AuthenticationService);
  private readonly router = inject(Router);
  private readonly store = inject(Store);
  private readonly firstSessionPrompt = inject(FirstSessionPromptService);

  readonly loadingId = signal<OnboardingInterest | 'skip' | null>(null);
  readonly firstName = signal<string>('');

  readonly heroCard: OnboardingCard = {
    id: 'sessions',
    icon: 'ti-robot',
    titleKey: 'ONBOARDING.Card_Sessions_Title',
    descKey: 'ONBOARDING.Card_Sessions_Desc',
    route: '/admin/sessions',
    accent: 'indigo',
  };

  readonly secondaryCards: OnboardingCard[] = [
    {
      id: 'prompts',
      icon: 'ti-book',
      titleKey: 'ONBOARDING.Card_Prompts_Title',
      descKey: 'ONBOARDING.Card_Prompts_Desc',
      route: '/admin/prompt-library',
      accent: 'purple',
    },
    {
      id: 'teams',
      icon: 'ti-users-group',
      titleKey: 'ONBOARDING.Card_Teams_Title',
      descKey: 'ONBOARDING.Card_Teams_Desc',
      route: '/admin/teams',
      accent: 'violet',
    },
    {
      id: 'explore',
      icon: 'ti-compass',
      titleKey: 'ONBOARDING.Card_Explore_Title',
      descKey: 'ONBOARDING.Card_Explore_Desc',
      route: '/admin/prompt-library/explore',
      accent: 'fuchsia',
    },
  ];

  constructor() {
    this.store.select(getUser).subscribe((user) => {
      this.firstName.set(user?.first_name?.trim() || user?.username || '');
    });
  }

  async choose(card: OnboardingCard): Promise<void> {
    if (this.loadingId() !== null) return;
    this.loadingId.set(card.id);
    await this.finalize(card.id, card.route);
  }

  async skip(): Promise<void> {
    if (this.loadingId() !== null) return;
    this.loadingId.set('skip');
    await this.finalize(null, '/admin/sessions');
  }

  private async finalize(
    interest: OnboardingInterest | null,
    navigateTo: string,
  ): Promise<void> {
    let freshUser: User | null = null;
    try {
      await firstValueFrom(this.auth.completeOnboarding(interest));
      freshUser = (await firstValueFrom(this.auth.me())) as User | null;
      if (freshUser) {
        this.store.dispatch(setCurrentUser({ user: freshUser }));
      }
    } catch {
      // Saving may fail. Do not trap
      // the user on the onboarding screen: navigate anyway.
    } finally {
      this.loadingId.set(null);
      await this.router.navigateByUrl(navigateTo);
      // Prompt for the first provider choice — non-blocking, opens after navigation.
      void this.firstSessionPrompt.openIfEligible(freshUser);
    }
  }
}
