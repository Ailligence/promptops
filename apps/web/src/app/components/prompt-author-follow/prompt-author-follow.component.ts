import { Component, Injectable, Input, inject, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { getUser } from '../../../store/authentication/authentication.selector';
import { Prompt } from '@core/models/prompt';
import { SwalService } from '@core/services/swal.service';
import { PromptQueryService } from '../../views/admin-core/prompt-library/services/prompt-query.service';

@Injectable({ providedIn: 'root' })
class AuthorFollowState {
  values = signal<Record<number, boolean>>({});
  busy = signal<Record<number, boolean>>({});
  private user = inject(Store).selectSignal(getUser);

  constructor() {
    effect(() => {
      this.user()?.id;
      this.values.set({});
      this.busy.set({});
    });
  }
}

@Component({
  selector: 'app-prompt-author-follow',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `@if (prompt.can_follow_author && prompt.user_id) {
    <button type="button" class="btn btn-sm btn-outline-primary"
      [disabled]="state.busy()[prompt.user_id]" [attr.aria-pressed]="following()"
      [title]="'PROMPTS.Follow notifications' | translate" (click)="toggle($event)">
      <i class="ti me-1" [class.ti-bell-check]="following()" [class.ti-bell-plus]="!following()"></i>
      {{ (following() ? 'PROMPTS.Following author' : 'PROMPTS.Follow author') | translate }}
    </button>
  }`,
})
export class PromptAuthorFollowComponent {
  @Input({ required: true }) prompt!: Prompt;
  protected state = inject(AuthorFollowState);
  private query = inject(PromptQueryService);
  private swal = inject(SwalService);
  private translate = inject(TranslateService);

  protected following(): boolean {
    return this.state.values()[this.prompt.user_id!] ?? this.prompt.is_following_author ?? false;
  }

  protected async toggle(event: Event): Promise<void> {
    event.stopPropagation();
    const id = this.prompt.user_id;
    if (!id || this.state.busy()[id]) return;
    this.state.busy.update(v => ({ ...v, [id]: true }));
    try {
      const following = await this.query.followAuthor(id, !this.following());
      this.state.values.update(v => ({ ...v, [id]: following }));
    } catch {
      this.swal.error(this.translate.instant('MESSAGE.Generic error'));
    } finally {
      this.state.busy.update(v => ({ ...v, [id]: false }));
    }
  }
}
