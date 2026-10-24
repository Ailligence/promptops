import { Injectable, inject } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { User } from '@core/models/user';
import { FirstSessionModalComponent } from '../../views/admin-core/onboarding/first-session-modal/first-session-modal.component';

/**
 * Decides whether the "first session" modal should open and owns the
 * one-shot display logic. Triggers when:
 *   - the user has completed onboarding
 *   - no preferred_provider has been set
 *   - the modal has not already been shown in the current app session
 *
 * The flag is in-memory only: a restart will re-evaluate eligibility.
 * If the user picks "later" we still flip the flag so they aren't
 * interrupted twice in the same session.
 */
@Injectable({ providedIn: 'root' })
export class FirstSessionPromptService {
  private readonly modalService = inject(NgbModal);
  private shown = false;

  shouldShowFor(user: User | null | undefined): boolean {
    if (!user) return false;
    if (this.shown) return false;
    if (!user.onboarding_completed_at) return false;
    if (user.preferred_provider) return false;
    return true;
  }

  async openIfEligible(user: User | null | undefined): Promise<void> {
    if (!this.shouldShowFor(user)) return;
    this.shown = true;
    const ref = this.modalService.open(FirstSessionModalComponent, {
      centered: true,
      backdrop: 'static',
      keyboard: false,
      windowClass: 'first-session-modal-window',
    });
    try {
      await ref.result;
    } catch { /* dismissed — still considered shown for this app session */ }
  }

  /** Useful for tests / explicit re-trigger after logout. */
  reset(): void {
    this.shown = false;
  }
}
