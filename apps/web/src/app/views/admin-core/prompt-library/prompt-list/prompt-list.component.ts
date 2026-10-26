import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy
} from "@angular/core";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { SwalService } from "@core/services/swal.service";
import { LOCAL_MODE } from "@core/local-mode";
import { PromptQueryService } from "../services/prompt-query.service";
import { Prompt } from "@core/models/prompt";
import { PromptCardComponent } from "@components/prompt-card/prompt-card.component";
import { CategoryNamePipe } from "@core/category-name.pipe";
import { PromptInjectSessionModalComponent, PromptInjectTarget } from "@components/prompt-inject-session-modal/prompt-inject-session-modal.component";
import {
  PromptCategoryInterface,
} from "@core/interfaces/prompt.interface";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";
import { PromptInjectionService } from "../../sessions/services/prompt-injection.service";
import { Store } from "@ngrx/store";
import { createSession } from "../../../../../store/sessions/session.actions";

type TabType = "all" | "public" | "private" | "starred" | "shared";

@Component({
  selector: "app-prompt-list",
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    TranslateModule,
    PromptCardComponent,
    CategoryNamePipe,
  ],
  templateUrl: "./prompt-list.component.html",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .my-prompts-container {
      padding: 1.5rem;
    }

    /* ─── Header ─── */
    .my-prompts-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .my-prompts-title {
      font-size: 1.35rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0;
    }
    .my-prompts-title .ti { font-size: 1.3rem; color: #6366f1; }
    .header-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

    /* ─── Tabs ─── */
    .tabs-bar {
      display: flex;
      gap: 0;
      border-bottom: 2px solid var(--bs-border-color);
      margin-bottom: 1.25rem;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .tab-btn {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.65rem 1rem;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--bs-secondary-color);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .tab-btn:hover { color: #4f46e5; }
    .tab-btn.active {
      color: var(--po-accent);
      border-bottom-color: var(--po-accent);
    }
    .tab-count {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.05rem 0.4rem;
      border-radius: 10px;
      background: oklch(from var(--po-accent) l c h / 8%);
      color: var(--po-accent);
    }
    .tab-btn.active .tab-count {
      background: oklch(from var(--po-accent) l c h / 15%);
    }

    /* ─── Filters inline ─── */
    .filters-row {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .search-wrapper {
      position: relative;
      flex: 1;
      min-width: 200px;
      max-width: 360px;
    }
    .search-icon {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--bs-secondary-color);
      font-size: 0.9rem;
    }
    .search-input {
      width: 100%;
      padding: 0.5rem 0.75rem 0.5rem 2.2rem;
      border: 1px solid var(--bs-border-color);
      border-radius: 10px;
      font-size: 0.82rem;
      background: var(--bs-secondary-bg);
      backdrop-filter: blur(6px);
      color: var(--bs-body-color);
      transition: all 0.2s;
    }
    .search-input:focus {
      outline: none;
      border-color: rgba(var(--bs-primary-rgb), 0.4);
      box-shadow: 0 0 0 3px rgba(var(--bs-primary-rgb), 0.08);
    }

    .filter-select {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--bs-border-color);
      border-radius: 10px;
      font-size: 0.82rem;
      background: var(--bs-secondary-bg);
      backdrop-filter: blur(6px);
      color: var(--bs-body-color);
      cursor: pointer;
    }
    .filter-select:focus {
      outline: none;
      border-color: rgba(var(--bs-primary-rgb), 0.4);
    }

    /* ─── Results count ─── */
    .results-count {
      font-size: 0.78rem;
      color: var(--bs-secondary-color);
      margin-bottom: 0.75rem;
      font-weight: 500;
    }

    /* ─── Card wrapper ─── */
    .prompt-grid-card {
      background: var(--bs-secondary-bg);
      border: 1px solid var(--bs-border-color);
      border-radius: 16px;
      padding: 1.25rem;
    }

    /* ─── Card Grid ─── */
    .prompt-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1rem;
    }

    /* ─── Pagination ─── */
    .pagination-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 1.5rem 0 0.5rem;
    }
    .page-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid var(--bs-border-color);
      background: var(--bs-secondary-bg);
      color: var(--bs-secondary-color);
      cursor: pointer;
      transition: all 0.2s;
    }
    .page-btn:hover:not(:disabled) {
      border-color: oklch(from var(--po-accent) l c h / 30%);
      color: var(--po-accent);
    }
    .page-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    .page-info {
      font-size: 0.78rem;
      color: var(--bs-secondary-color);
      font-weight: 500;
    }

    /* ─── Loading & Empty ─── */
    .list-loading {
      display: flex;
      justify-content: center;
      padding: 4rem 0;
    }
    .list-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 4rem;
      color: var(--bs-secondary-color);
    }
    .list-empty .ti { font-size: 2.5rem; }
    .list-empty p { font-size: 0.9rem; margin: 0; }
  `,
})
export class PromptListComponent implements OnInit {
  protected activeTab = signal<TabType>("all");
  /** Nobody can share prompts with you in local mode, so that tab is hidden. */
  protected readonly showSharedTab = !LOCAL_MODE;
  protected prompts = signal<Prompt[]>([]);
  protected categories = signal<PromptCategoryInterface[]>([]);
  protected loading = signal<boolean>(true);
  protected pagination: any = null;

  protected searchQuery = "";
  protected selectedCategoryId: number | null = null;
  protected selectedStatus: string | null = null;
  protected sortBy = "newest";

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly queryService = inject(PromptQueryService);
  private readonly swalService = inject(SwalService);
  private readonly translateService = inject(TranslateService);
  private readonly modalService = inject(NgbModal);
  private readonly promptInjection = inject(PromptInjectionService);
  private readonly store = inject(Store);

  ngOnInit(): void {
    this.loadCategories();
    this.loadData();
  }

  // ── Tab switching ──

  protected setTab(tab: TabType): void {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    this.pagination = null;
    this.loadData(1);
  }

  // ── Filters ──

  protected onSearch(): void {
    this.loadData(1);
  }

  protected onCategoryChange(): void {
    this.loadData(1);
  }

  protected onStatusChange(): void {
    this.loadData(1);
  }

  protected onSortChange(): void {
    this.loadData(1);
  }

  // ── Data Loading ──

  protected async loadData(page: number = 1): Promise<void> {
    this.loading.set(true);
    try {
      const tab = this.activeTab();

      if (tab === "starred") {
        await this.loadStarred();
      } else if (tab === "shared") {
        await this.loadShared(page);
      } else {
        await this.loadOwn(tab, page);
      }
    } catch (err: any) {
      this.swalService.error(
        err?.message ||
          this.translateService.instant("MESSAGE.Generic error")
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async loadOwn(tab: TabType, page: number): Promise<void> {
    const filter: any = {
      searchQuery: this.searchQuery || null,
      page,
      perPage: 18,
      fieldSort: null,
      fieldDir: null,
      suggest: null,
    };

    if (this.selectedCategoryId) filter.category_id = this.selectedCategoryId;
    if (this.selectedStatus) filter.status = this.selectedStatus;

    // Tab-specific visibility filter
    if (tab === "public") filter.visibility = "public";
    else if (tab === "private") filter.visibility = "private";

    // Sort
    if (this.sortBy === "newest") {
      filter.fieldSort = "created_at";
      filter.fieldDir = "desc";
    } else if (this.sortBy === "updated") {
      filter.fieldSort = "updated_at";
      filter.fieldDir = "desc";
    } else if (this.sortBy === "stars") {
      filter.fieldSort = "stars_count";
      filter.fieldDir = "desc";
    } else if (this.sortBy === "title") {
      filter.fieldSort = "title";
      filter.fieldDir = "asc";
    }

    const result = await this.queryService.getList(filter);
    this.prompts.set(result.prompts());
    this.pagination = result.pagination;
  }

  private async loadStarred(): Promise<void> {
    const result = await this.queryService.getStarredPrompts();
    let prompts = result.prompts || [];

    // Apply local search filter
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      prompts = prompts.filter(
        (p) =>
          p.title?.toLowerCase().includes(q) ||
          p.body?.toLowerCase().includes(q)
      );
    }

    this.prompts.set(prompts);
    this.pagination = null;
  }

  private async loadShared(page: number): Promise<void> {
    const result = await this.queryService.getSharedWithMe({
      page,
      perPage: 18,
    });
    this.prompts.set(result.prompts || []);
    this.pagination = result.pagination;
  }

  private async loadCategories(): Promise<void> {
    await this.queryService.loadCategories();
    this.categories.set(this.queryService.categories());
  }

  // ── Actions ──

  protected openPrompt(prompt: Prompt): void {
    this.router.navigate([prompt.id], { relativeTo: this.route });
  }

  protected editPrompt(prompt: Prompt): void {
    this.router.navigate([prompt.id, "edit"], { relativeTo: this.route });
  }

  protected async toggleStar(prompt: Prompt): Promise<void> {
    try {
      const result = await this.queryService.toggleStar(prompt.id!);
      const updated = this.prompts()
        .map((p) =>
          p.id === prompt.id
            ? ({
                ...p,
                is_starred: result.starred,
                stars_count: result.stars_count,
              } as Prompt)
            : p
        )
        // An unstarred prompt leaves the Starred tab right away.
        .filter((p) => this.activeTab() !== "starred" || p.is_starred);
      this.prompts.set(updated);
    } catch (err: any) {
      this.swalService.error(
        err?.message ||
          this.translateService.instant("MESSAGE.Generic error")
      );
    }
  }

  protected openProfile(user: any): void {
    if (user?.username) {
      this.router.navigate(["/admin/profile", user.username]);
    }
  }

  protected handleAddEntity(): void {
    this.queryService.clearEntitySelected();
    this.router.navigate(["new"], { relativeTo: this.route });
  }

  protected handleExplore(): void {
    this.router.navigate(["explore"], { relativeTo: this.route });
  }

  protected goToPage(page: number): void {
    if (page < 1 || (this.pagination && page > this.pagination.last_page))
      return;
    this.loadData(page);
  }

  protected injectToSession(prompt: Prompt): void {
    try {
      const ref = this.modalService.open(PromptInjectSessionModalComponent, {
        centered: true,
        size: 'md',
      });
      ref.componentInstance.promptTitle = prompt.title || '';
      ref.componentInstance.promptBody = prompt.body || '';

      ref.result.then(
        async (target: PromptInjectTarget) => {
          const text = prompt.body || '';
          if (target.type === 'session') {
            try {
              // Wakes a parked session first, then writes the prompt.
              const sent = await this.promptInjection.injectIntoSession(target.session, text);
              if (!sent) throw new Error('not sent');
              this.swalService.success(this.translateService.instant('PROMPTS.Prompt sent to session'));
            } catch {
              this.swalService.error(this.translateService.instant('MESSAGE.Generic error'));
            }
          } else if (target.type === 'new') {
            this.store.dispatch(createSession({
              ...target.createResult,
              initialPrompt: text,
            }));
            this.swalService.success(this.translateService.instant('PROMPTS.Prompt sent to new session'));
          }
        },
        () => {},
      );
    } catch (err) {
      this.swalService.error(this.translateService.instant('MESSAGE.Generic error'));
    }
  }

  protected deletePrompt(prompt: Prompt): void {
    this.swalService.confirm(
      this.translateService.instant("MESSAGE.Delete prompt", {
        prompt: prompt.title,
      }),
      this.translateService.instant(
        "MESSAGE.Are you sure you want to proceed? This action cannot be undone"
      ),
      () => {
        this.queryService
          .deleteEntity(prompt.id!)
          .then(() => {
            this.swalService.success(
              this.translateService.instant(
                "MESSAGE.prompt successfully deleted"
              )
            );
            this.loadData();
          })
          .catch((err: any) => {
            this.swalService.error(
              err?.message ||
                this.translateService.instant("MESSAGE.Generic error")
            );
          });
      }
    );
  }
}
