import { PromptProviderBadgesComponent } from '../prompt-provider-badges/prompt-provider-badges.component';
import { PromptAuthorFollowComponent } from '../prompt-author-follow/prompt-author-follow.component';
import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from "@angular/core";
import { RouterModule } from "@angular/router";
import { TranslateModule } from "@ngx-translate/core";
import { Prompt } from "@core/models/prompt";
import { CategoryNamePipe } from "@core/category-name.pipe";
import { initialsAvatar } from "@core/helper/initials-avatar";
import { formatRelativeTime } from "@core/helper/ui-locale";

/** Visibility and status values with a label in PROMPTS.*. */
const LABEL_KEYS: Record<string, string> = {
  public: "PROMPTS.Public",
  private: "PROMPTS.Private",
  draft: "PROMPTS.Draft",
  published: "PROMPTS.Published",
  archived: "PROMPTS.Archived",
};

@Component({
  selector: "app-prompt-card",
  standalone: true,
  imports: [PromptProviderBadgesComponent, PromptAuthorFollowComponent, RouterModule, TranslateModule, CategoryNamePipe],
  template: `
    <div class="prompt-card" [class.is-owner]="isOwner" role="button" tabindex="0" [attr.aria-label]="prompt.title" (click)="cardClicked.emit(prompt)" (keydown.enter)="$event.target === $event.currentTarget && cardClicked.emit(prompt)">
      <!-- Accent bar -->
      <div class="accent-bar" [style.background]="getCategoryGradient()"></div>

      <!-- Card content -->
      <div class="card-content">
        <!-- Header row -->
        <div class="card-header">
          <div class="header-left">
            @if (prompt.category) {
            <span class="category-label" [style.color]="prompt.category.color || '#6366f1'">
              {{ prompt.category | categoryName }}
            </span>
            }
            @if (prompt.is_workflow) {
            <span class="workflow-pill">
              <i class="ti ti-robot"></i>
              {{ prompt.sub_agents_count }}
            </span>
            }
          </div>
          <div class="header-right" (click)="$event.stopPropagation()">
            @if (showFollowAuthor) { <app-prompt-author-follow [prompt]="prompt" /> }
            <button
              class="star-action"
              [class.starred]="prompt.is_starred"
              [attr.aria-pressed]="!!prompt.is_starred"
              [attr.aria-label]="(prompt.is_starred ? 'PROMPTS.Unstar' : 'PROMPTS.Star') | translate"
              (click)="onStarClick($event)"
            >
              <i class="ti" [class.ti-star-filled]="prompt.is_starred" [class.ti-star]="!prompt.is_starred"></i>
            </button>
          </div>
        </div>

        <!-- Title -->
        <h3 class="card-title">
          @if (prompt.is_fork) {
          <i class="ti ti-git-fork fork-icon"></i>
          }
          {{ prompt.title }}
        </h3>

        <app-prompt-provider-badges [ids]="prompt.provider_ids" />
        <!-- Body preview -->
        <p class="card-body">{{ getBodyPreview() }}</p>

        <!-- Tags -->
        @if (prompt.tags && prompt.tags.length > 0) {
        <div class="card-tags">
          @for (tag of prompt.tags!.slice(0, 3); track tag.id) {
          <span class="tag">{{ tag.name }}</span>
          } @if (prompt.tags!.length > 3) {
          <span class="tag tag-more">+{{ prompt.tags!.length - 3 }}</span>
          }
        </div>
        }

        <!-- Footer -->
        <div class="card-footer">
          <div class="footer-left">
            @if (showAuthor && prompt.user) {
            <div class="author" (click)="onAuthorClick($event)">
              <img
                class="avatar"
                [src]="prompt.user.avatar_url || getDefaultAvatar()"
                [alt]="prompt.user.first_name"
              />
              <span class="author-name">{{ prompt.user.first_name }}</span>
            </div>
            }
            <span class="meta-sep">·</span>
            <span class="meta">v{{ prompt.current_version || 1 }}</span>
            <span class="meta-sep">·</span>
            <span class="meta">{{ getTimeAgo() }}</span>
          </div>
          <div class="footer-stats">
            <span class="mini-stat"><i class="ti ti-star"></i>{{ prompt.stars_count || 0 }}</span>
            <span class="mini-stat"><i class="ti ti-git-fork"></i>{{ prompt.forks_count || 0 }}</span>
          </div>
        </div>
      </div>

      <!-- Hover overlay actions -->
      <div class="card-actions" (click)="$event.stopPropagation()">
        <button class="action-primary" (click)="injectClicked.emit(prompt)">
          <i class="ti ti-player-play"></i>
          {{ 'PROMPTS.Send to Session' | translate }}
        </button>
        @if (isOwner) {
        <div class="owner-row">
          <button class="action-icon" (click)="shareClicked.emit(prompt)" [title]="'SHARING.Share' | translate" [attr.aria-label]="'SHARING.Share' | translate">
            <i class="ti ti-share"></i>
          </button>
          <span class="vis-pill" [class.public]="prompt.visibility === 'public'">
            <i class="ti" [class.ti-world]="prompt.visibility === 'public'" [class.ti-lock]="prompt.visibility !== 'public'"></i>
            {{ labelOf(prompt.visibility) | translate }}
          </span>
          <span class="status-pill" [class]="'st-' + prompt.status">
            {{ labelOf(prompt.status) | translate }}
          </span>
          <button class="action-icon danger" (click)="deleteClicked.emit(prompt)" [title]="'PROMPTS.Delete' | translate" [attr.aria-label]="'PROMPTS.Delete' | translate">
            <i class="ti ti-trash"></i>
          </button>
        </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    /* ─── Card shell ─── */
    .prompt-card {
      position: relative;
      background: var(--bs-secondary-bg);
      border: 1px solid var(--bs-border-color-translucent, rgba(0, 0, 0, 0.1));
      border-radius: 16px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 200px;
      overflow: hidden;
    }
    .prompt-card:hover {
      border-color: rgba(var(--bs-primary-rgb), 0.2);
      box-shadow:
        0 4px 24px rgba(0, 0, 0, 0.06),
        0 1px 4px rgba(var(--bs-primary-rgb), 0.08);
      transform: translateY(-3px);
    }
    .prompt-card:hover .card-actions,
    .prompt-card:focus-within .card-actions {
      opacity: 1;
      transform: translateY(0);
    }

    /* ─── Top accent ─── */
    .accent-bar {
      height: 3px;
      width: 100%;
      opacity: 0.85;
      flex-shrink: 0;
    }

    /* ─── Content area ─── */
    .card-content {
      padding: 1rem 1.15rem;
      padding-bottom: 3.2rem;
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .is-owner .card-content {
      padding-bottom: 5rem;
    }

    /* ─── Header ─── */
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }
    .category-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .workflow-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      font-size: 0.62rem;
      font-weight: 700;
      padding: 0.1rem 0.4rem;
      border-radius: 10px;
      background: oklch(from var(--po-accent) l c h / 10%);
      color: #7c3aed;
    }
    .workflow-pill .ti { font-size: 0.72rem; }

    .header-right { display: flex; align-items: center; gap: .6rem; flex-shrink: 0; }

    /* ─── Star ─── */
    .star-action {
      background: none;
      border: none;
      padding: 0.15rem;
      cursor: pointer;
      color: var(--bs-secondary-color);
      opacity: 0.4;
      font-size: 0.95rem;
      transition: all 0.2s;
      line-height: 1;
    }
    .star-action:hover {
      opacity: 1;
      color: #eab308;
      transform: scale(1.15);
    }
    .star-action.starred {
      opacity: 1;
      color: #eab308;
    }

    /* ─── Title ─── */
    .card-title {
      font-size: 0.95rem;
      font-weight: 700;
      margin: 0 0 0.4rem 0;
      line-height: 1.35;
      color: inherit;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .fork-icon {
      color: var(--po-accent);
      font-size: 0.82rem;
      margin-inline-end: 0.15rem;
    }

    /* ─── Body ─── */
    .card-body {
      font-size: 0.78rem;
      color: var(--bs-secondary-color);
      line-height: 1.55;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin: 0 0 auto 0;
      opacity: 0.75;
    }

    /* ─── Tags ─── */
    .card-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-top: 0.65rem;
    }
    .tag {
      font-size: 0.62rem;
      font-weight: 600;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      background: rgba(var(--bs-primary-rgb), 0.06);
      color: var(--bs-secondary-color);
      letter-spacing: 0.01em;
    }
    .tag-more {
      opacity: 0.6;
    }

    /* ─── Footer ─── */
    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.75rem;
      padding-top: 0.6rem;
      border-top: 1px solid var(--bs-border-color-translucent, rgba(0,0,0,0.06));
    }
    .footer-left {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .author {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      cursor: pointer;
    }
    .author:hover .author-name {
      color: var(--bs-primary);
    }
    .avatar {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      object-fit: cover;
    }
    .author-name {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--bs-secondary-color);
      transition: color 0.2s;
    }
    .meta {
      font-size: 0.65rem;
      color: var(--bs-secondary-color);
      opacity: 0.55;
      font-weight: 500;
    }
    .meta-sep {
      color: var(--bs-secondary-color);
      opacity: 0.25;
      font-size: 0.6rem;
    }
    .footer-stats {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .mini-stat {
      font-size: 0.65rem;
      font-weight: 600;
      color: var(--bs-secondary-color);
      opacity: 0.5;
      display: flex;
      align-items: center;
      gap: 0.15rem;
    }
    .mini-stat .ti {
      font-size: 0.72rem;
    }

    /* ─── Actions overlay ─── */
    .card-actions {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 0.6rem 1rem 0.85rem;
      background: var(--bs-secondary-bg);
      border-top: 1px solid var(--bs-border-color-translucent, rgba(0,0,0,0.06));
      opacity: 0;
      transform: translateY(6px);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }

    .action-primary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      width: 100%;
      padding: 0.4rem 0.6rem;
      font-size: 0.72rem;
      font-weight: 700;
      border-radius: 10px;
      border: none;
      background: var(--bs-primary, var(--po-accent));
      color: #fff;
      cursor: pointer;
      transition: all 0.2s;
    }
    .action-primary:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .action-primary .ti { font-size: 0.85rem; }

    /* ─── Owner row ─── */
    .owner-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .action-icon {
      background: rgba(var(--bs-secondary-rgb), 0.06);
      border: none;
      color: var(--bs-secondary-color);
      cursor: pointer;
      padding: 0.25rem;
      font-size: 0.82rem;
      border-radius: 6px;
      transition: all 0.2s;
      line-height: 1;
    }
    .action-icon:hover {
      background: rgba(var(--bs-primary-rgb), 0.1);
      color: var(--bs-primary);
    }
    .action-icon.danger { margin-inline-start: auto; }
    .action-icon.danger:hover {
      background: rgba(220, 38, 38, 0.1);
      color: #dc2626;
    }

    .vis-pill {
      font-size: 0.6rem;
      font-weight: 700;
      padding: 0.08rem 0.35rem;
      border-radius: 4px;
      background: rgba(var(--bs-secondary-rgb), 0.08);
      color: var(--bs-secondary-color);
      display: flex;
      align-items: center;
      gap: 0.15rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .vis-pill.public {
      background: oklch(from var(--po-accent) l c h / 8%);
      color: var(--po-accent);
    }
    .vis-pill .ti { font-size: 0.65rem; }

    .status-pill {
      font-size: 0.6rem;
      font-weight: 700;
      padding: 0.08rem 0.35rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .st-draft {
      background: rgba(234, 179, 8, 0.1);
      color: #b45309;
    }
    .st-published {
      background: rgba(34, 197, 94, 0.1);
      color: #15803d;
    }
    .st-archived {
      background: rgba(var(--bs-secondary-rgb), 0.1);
      color: var(--bs-secondary-color);
    }
  `,
})
export class PromptCardComponent {
  @Input() prompt!: Prompt;
  @Input() showFollowAuthor = false;
  @Input() showAuthor = true;
  @Input() isOwner = false;

  @Output() starClicked = new EventEmitter<Prompt>();
  @Output() forkClicked = new EventEmitter<Prompt>();
  @Output() cardClicked = new EventEmitter<Prompt>();
  @Output() shareClicked = new EventEmitter<Prompt>();
  @Output() injectClicked = new EventEmitter<Prompt>();
  @Output() authorClicked = new EventEmitter<any>();
  @Output() deleteClicked = new EventEmitter<Prompt>();

  getCategoryGradient(): string {
    const color = this.prompt.category?.color || '#6366f1';
    return `linear-gradient(90deg, ${color}, ${color}88)`;
  }

  getBodyPreview(): string {
    const body = this.prompt.body || "";
    // Strip variable placeholders for cleaner preview
    const clean = body.replace(/\{\{(\w+)\}\}/g, "$1").replace(/\n/g, " ");
    return clean.length > 140 ? clean.substring(0, 140) + "..." : clean;
  }

  getDefaultAvatar(): string {
    return initialsAvatar(this.prompt.user ? `${this.prompt.user.first_name ?? ""} ${this.prompt.user.last_name ?? ""}` : "");
  }

  getTimeAgo(): string {
    return formatRelativeTime(this.prompt.updated_at || this.prompt.created_at || "", { minUnit: "day" });
  }

  /** Translation key of a visibility/status value; unknown values show as they are. */
  labelOf(value: string | undefined): string {
    return (value && LABEL_KEYS[value]) || value || "";
  }

  onStarClick(event: Event): void {
    event.stopPropagation();
    this.starClicked.emit(this.prompt);
  }

  onAuthorClick(event: Event): void {
    event.stopPropagation();
    if (this.prompt.user) {
      this.authorClicked.emit(this.prompt.user);
    }
  }
}
