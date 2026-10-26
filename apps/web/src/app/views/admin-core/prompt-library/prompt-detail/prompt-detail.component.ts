import { formatUiDate } from "@core/helper/ui-locale";
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  inject,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { CommonModule } from "@angular/common";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";
import { SwalService } from "@core/services/swal.service";
import { CategoryNamePipe } from "@core/category-name.pipe";
import { PromptQueryService } from "../services/prompt-query.service";
import { Prompt } from "@core/models/prompt";
import { PromptVersionInterface } from "@core/interfaces/prompt.interface";
import { CloudFeatureModalComponent } from "@components/cloud-feature-modal/cloud-feature-modal.component";
import { PromptInjectSessionModalComponent, PromptInjectTarget } from "@components/prompt-inject-session-modal/prompt-inject-session-modal.component";
import { PromptInjectionService } from "../../sessions/services/prompt-injection.service";
import { Store } from "@ngrx/store";
import { createSession } from "../../../../../store/sessions/session.actions";

@Component({
  selector: "app-prompt-detail",
  standalone: true,
  imports: [TranslateModule, RouterModule, CommonModule, CategoryNamePipe],
  templateUrl: "./prompt-detail.component.html",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    /* ─── Layout ─── */
    .detail-container {
      max-width: 100%;
      margin: 0 auto;
      padding: 1.5rem;
    }

    /* ─── Top Bar ─── */
    .detail-top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.85rem;
      font-weight: 500;
      color: oklch(from var(--po-accent) l c h / 70%);
      text-decoration: none;
      transition: color 0.2s;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
    }
    .back-link:hover {
      color: oklch(from var(--po-accent) l c h / 100%);
    }

    .detail-actions {
      display: flex;
      gap: 0.5rem;
    }

    .btn-detail {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 1rem;
      border-radius: 10px;
      font-size: 0.82rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      text-decoration: none;
    }
    .btn-detail:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }
    .btn-detail-primary {
      background: oklch(from var(--po-accent) l c h / 12%);
      color: var(--po-accent);
    }
    .btn-detail-primary:hover {
      background: oklch(from var(--po-accent) l c h / 22%);
      color: var(--po-accent);
    }
    .btn-detail-secondary {
      background: rgba(var(--bs-secondary-rgb), 0.1);
      color: var(--bs-secondary-color);
    }
    .btn-detail-secondary:hover {
      background: rgba(var(--bs-secondary-rgb), 0.18);
      color: var(--bs-body-color);
    }
    .btn-detail-danger {
      background: rgba(220, 38, 38, 0.1);
      color: #dc2626;
    }
    .btn-detail-danger:hover {
      background: rgba(220, 38, 38, 0.2);
      color: #dc2626;
    }

    /* ─── Card ─── */
    .detail-card {
      background: var(--bs-secondary-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--bs-border-color);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      transition: box-shadow 0.2s;
    }
    .detail-card:hover {
      box-shadow: 0 4px 20px rgba(var(--bs-primary-rgb), 0.06);
    }

    .detail-card-title {
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--bs-secondary-color);
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    /* ─── Header Section ─── */
    .prompt-title {
      font-size: 1.35rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      color: inherit;
    }

    .prompt-meta-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 1rem;
    }

    .meta-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 600;
    }

    .badge-status-draft {
      background: rgba(234, 179, 8, 0.12);
      color: #b45309;
    }
    .badge-status-published {
      background: rgba(34, 197, 94, 0.12);
      color: #15803d;
    }
    .badge-status-archived {
      background: rgba(var(--bs-secondary-rgb), 0.12);
      color: var(--bs-secondary-color);
    }
    .badge-visibility {
      background: oklch(from var(--po-accent) l c h / 10%);
      color: var(--po-accent);
    }
    .badge-fork {
      background: oklch(from var(--po-accent) l c h / 10%);
      color: #7c3aed;
    }
    .badge-version {
      background: oklch(from var(--po-accent) l c h / 8%);
      color: var(--po-accent);
    }

    /* ─── Body ─── */
    .prompt-body-editable {
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.82rem;
      line-height: 1.7;
      background: var(--bs-tertiary-bg);
      color: var(--bs-body-color);
      border-radius: 12px;
      padding: 1.25rem;
      white-space: pre-wrap;
      word-wrap: break-word;
      flex: 1;
      overflow-y: auto;
      width: 100%;
      border: 2px solid var(--bs-border-color);
      outline: none;
      resize: none;
      transition: border-color 0.2s;
    }
    .prompt-body-editable:focus {
      border-color: oklch(from var(--po-accent) l c h / 40%);
    }

    /* ─── Variables Chips ─── */
    .variable-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.75rem;
    }

    .variable-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 500;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: oklch(from var(--po-accent) l c h / 10%);
      color: var(--po-accent);
      border: 1px solid oklch(from var(--po-accent) l c h / 15%);
    }

    /* ─── Category & Tags ─── */
    .category-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.7rem;
      border-radius: 8px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #fff;
    }

    .tag-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.5rem;
    }

    .tag-chip {
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 500;
      background: rgba(var(--bs-secondary-rgb), 0.1);
      color: var(--bs-secondary-color);
    }

    /* ─── Notes ─── */
    .notes-block {
      font-size: 0.85rem;
      line-height: 1.6;
      color: var(--bs-body-color);
      background: var(--bs-tertiary-bg);
      border-radius: 10px;
      padding: 1rem;
      border-left: 3px solid var(--bs-border-color);
    }

    /* ─── Prompt Generator ─── */
    .generator-card {
      border: 1px solid oklch(from var(--po-accent) l c h / 15%);
      background: oklch(from var(--po-accent) l c h / 2%);
    }

    .generator-subtitle {
      font-size: 0.82rem;
      color: var(--bs-secondary-color);
      margin: -0.5rem 0 1rem;
    }

    .generator-grid-3col {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.25rem;
    }
    @media (min-width: 992px) {
      .generator-grid-3col {
        grid-template-columns: 3fr 4fr 5fr;
      }
    }
    @media (min-width: 768px) and (max-width: 991px) {
      .generator-grid-3col {
        grid-template-columns: 1fr 1fr;
      }
    }

    .generator-grid-nocols {
      display: block;
    }

    .generator-col-vars {
      display: flex;
      flex-direction: column;
    }

    .generator-col-body {
      display: flex;
      flex-direction: column;
    }

    .generator-col-output {
      display: flex;
      flex-direction: column;
    }

    .generator-fields {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .generator-field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }

    .generator-label {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--po-accent);
      font-family: 'JetBrains Mono', monospace;
    }

    .generator-input {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--bs-border-color);
      border-radius: 10px;
      font-size: 0.85rem;
      background: var(--bs-tertiary-bg);
      color: var(--bs-body-color);
      outline: none;
      resize: vertical;
      min-height: 40px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .generator-input:focus {
      border-color: rgba(var(--bs-primary-rgb), 0.5);
      box-shadow: 0 0 0 3px rgba(var(--bs-primary-rgb), 0.1);
    }

    .generator-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 1rem;
    }

    .btn-generate {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.55rem 1.25rem;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      background: var(--po-accent);
      color: #fff;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-generate:hover:not(:disabled) {
      background: #4338ca;
      transform: translateY(-1px);
      box-shadow: 0 4px 14px oklch(from var(--po-accent) l c h / 30%);
    }
    .btn-generate:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .generated-prompt-block {
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 0.82rem;
      line-height: 1.7;
      background: #059669;
      color: #ecfdf5;
      border-radius: 12px;
      padding: 1.25rem;
      white-space: pre-wrap;
      word-wrap: break-word;
      flex: 1;
      overflow-y: auto;
    }

    .generated-prompt-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      flex: 1;
      min-height: 120px;
      border: 2px dashed rgba(var(--bs-primary-rgb), 0.15);
      border-radius: 12px;
      color: var(--bs-secondary-color);
      font-size: 0.85rem;
      font-weight: 500;
    }

    .generator-output-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .btn-copy-sm {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.3rem 0.7rem;
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 600;
      border: 1px solid oklch(from var(--po-accent) l c h / 20%);
      cursor: pointer;
      background: oklch(from var(--po-accent) l c h / 8%);
      color: var(--po-accent);
      transition: all 0.2s;
    }
    .btn-copy-sm:hover {
      background: oklch(from var(--po-accent) l c h / 18%);
      border-color: oklch(from var(--po-accent) l c h / 35%);
    }

    .btn-inject-sm {
      background: rgba(34, 197, 94, 0.08);
      color: #15803d;
      border-color: rgba(34, 197, 94, 0.2);
    }
    .btn-inject-sm:hover {
      background: rgba(34, 197, 94, 0.18);
      border-color: rgba(34, 197, 94, 0.35);
      color: #15803d;
    }

    .btn-inject {
      background: rgba(34, 197, 94, 0.12);
      color: #15803d;
    }
    .btn-inject:hover {
      background: rgba(34, 197, 94, 0.22);
      color: #15803d;
    }

    /* ─── Version Timeline ─── */
    .version-timeline {
      padding-left: 0.5rem;
    }

    .version-item {
      position: relative;
      padding-left: 1.75rem;
      padding-bottom: 1.25rem;
      border-left: 2px solid oklch(from var(--po-accent) l c h / 15%);
    }
    .version-item:last-child {
      border-left-color: transparent;
      padding-bottom: 0;
    }

    .version-dot {
      position: absolute;
      left: -0.45rem;
      top: 0.15rem;
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      background: var(--po-accent);
      border: 2px solid #fff;
      box-shadow: 0 0 0 2px oklch(from var(--po-accent) l c h / 30%);
    }
    .version-dot.latest {
      background: #16a34a;
      box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.3);
    }

    .version-number {
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--po-accent);
    }

    .version-date {
      font-size: 0.72rem;
      color: var(--bs-secondary-color);
      margin-left: 0.5rem;
    }

    .version-summary {
      font-size: 0.78rem;
      color: var(--bs-body-color);
      margin-top: 0.15rem;
    }

    .version-author {
      font-size: 0.7rem;
      color: var(--bs-secondary-color);
    }

    .view-all-link {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      margin-top: 0.75rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--po-accent);
      text-decoration: none;
      transition: color 0.2s;
    }
    .view-all-link:hover {
      color: #4338ca;
    }

    /* ─── Author Info ─── */
    .author-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
      margin-top: 0.5rem;
    }

    .date-info {
      font-size: 0.75rem;
      color: var(--bs-secondary-color);
    }

    /* ─── Loading / Empty ─── */
    .detail-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4rem 0;
    }

    .detail-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 3rem;
      color: var(--bs-secondary-color);
    }

    /* ─── Sub-Agents Workflow ─── */
    .workflow-tree {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding-left: 0.5rem;
    }

    .workflow-main {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 0;
      font-weight: 700;
      font-size: 0.9rem;
      color: inherit;
    }

    .workflow-main-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: oklch(from var(--po-accent) l c h / 12%);
      color: var(--po-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
    }

    .workflow-agent {
      position: relative;
      padding-left: 2.5rem;
      padding-top: 0.5rem;
      padding-bottom: 0.5rem;
      border-left: 2px solid oklch(from var(--po-accent) l c h / 20%);
      margin-left: 0.95rem;
    }
    .workflow-agent:last-child {
      border-left-color: transparent;
    }

    .workflow-agent-connector {
      position: absolute;
      left: -2px;
      top: 0;
      width: 2rem;
      height: 1.25rem;
      border-bottom: 2px solid oklch(from var(--po-accent) l c h / 20%);
      border-left: 2px solid oklch(from var(--po-accent) l c h / 20%);
      border-bottom-left-radius: 8px;
    }

    .workflow-agent-card {
      background: oklch(from var(--po-accent) l c h / 4%);
      border: 1px solid oklch(from var(--po-accent) l c h / 12%);
      border-radius: 10px;
      padding: 0.75rem 1rem;
      transition: all 0.2s;
    }
    .workflow-agent-card:hover {
      border-color: oklch(from var(--po-accent) l c h / 25%);
      background: oklch(from var(--po-accent) l c h / 6%);
    }
    .workflow-agent-card.disabled {
      opacity: 0.5;
    }

    .workflow-agent-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }

    .workflow-agent-icon {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      background: oklch(from var(--po-accent) l c h / 12%);
      color: #7c3aed;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .workflow-agent-name {
      font-weight: 600;
      font-size: 0.85rem;
    }

    .workflow-agent-role {
      font-size: 0.68rem;
      font-weight: 600;
      padding: 0.08rem 0.4rem;
      border-radius: 4px;
      background: oklch(from var(--po-accent) l c h / 8%);
      color: var(--po-accent);
    }

    .workflow-agent-auto {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0.08rem 0.35rem;
      border-radius: 4px;
      background: rgba(34, 197, 94, 0.1);
      color: #15803d;
    }

    .workflow-agent-prompt {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.75rem;
      line-height: 1.5;
      color: var(--bs-body-color);
      background: var(--bs-tertiary-bg);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 120px;
      overflow-y: auto;
    }

    .workflow-badge-detail {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: oklch(from var(--po-accent) l c h / 10%);
      color: #7c3aed;
    }
  `,
})
export class PromptDetailComponent implements OnInit {
  protected prompt = signal<Prompt | null>(null);
  protected versions = signal<PromptVersionInterface[]>([]);
  protected loading = signal<boolean>(true);
  protected promptId: number | null = null;
  protected variableValues = signal<Record<string, string>>({});
  protected copied = signal<boolean>(false);
  protected generated = signal<boolean>(false);
  protected editableBody = signal<string>('');
  protected currentUserId = signal<number>(0);
  protected isOwner = computed(() => {
    const p = this.prompt();
    return !!p && !!p.user_id && p.user_id === this.currentUserId();
  });

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryService = inject(PromptQueryService);
  private readonly swalService = inject(SwalService);
  private readonly translateService = inject(TranslateService);
  private readonly modalService = inject(NgbModal);
  private readonly destroyRef = inject(DestroyRef);
  private readonly promptInjection = inject(PromptInjectionService);
  private readonly store = inject(Store);

  ngOnInit(): void {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        if (user?.id) this.currentUserId.set(user.id);
      } catch {}
    }
    this.store.select((state: any) => state.authentication?.user?.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((id: number) => { if (id) this.currentUserId.set(id); });

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const id = params.get("id");
        if (id) {
          this.promptId = +id;
          this.variableValues.set({});
          this.generated.set(false);
          this.loadData(this.promptId);
        }
      });
  }

  private async loadData(id: number): Promise<void> {
    this.loading.set(true);
    try {
      await this.queryService.retriveEntitySelected(id);
      this.prompt.set(this.queryService.promptSelected);
      this.editableBody.set(this.queryService.promptSelected?.body || '');

      // Load last 5 versions
      try {
        const allVersions = await this.queryService.getVersionHistory(id);
        this.versions.set(allVersions.slice(0, 5));
      } catch {
        // Versions not critical, ignore errors
        this.versions.set([]);
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

  protected goBack(): void {
    this.router.navigate(["/admin/prompt-library"]);
  }

  protected goEdit(): void {
    if (this.promptId) {
      this.router.navigate(["/admin/prompt-library", this.promptId, "edit"]);
    }
  }

  protected goVersions(): void {
    if (this.promptId) {
      this.router.navigate([
        "/admin/prompt-library",
        this.promptId,
        "versions",
      ]);
    }
  }

  /** Forks need other people: this edition shows the PromptOps Desktop lock and stays on the prompt. */
  protected goForkMap(): void {
    CloudFeatureModalComponent.open(this.modalService, "explore");
  }

  protected getStatusClass(status: string | undefined): string {
    if (!status) return "badge-status-draft";
    const classes: Record<string, string> = {
      draft: "badge-status-draft",
      published: "badge-status-published",
      archived: "badge-status-archived",
    };
    return classes[status] || "badge-status-draft";
  }

  protected getVisibilityIcon(visibility: string | undefined): string {
    return visibility === "public" ? "ti-world" : "ti-lock";
  }

  protected generatedPrompt = computed(() => {
    // A replacer function keeps "$&" and similar in values literal; empty values leave the placeholder.
    const values = this.variableValues();
    return this.editableBody().replace(/\{\{(\w+)\}\}/g, (token, key: string) => values[key]?.trim() ? values[key] : token);
  });

  protected onVariableInput(varName: string, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.variableValues.update(current => ({ ...current, [varName]: value }));
  }

  protected generate(): void {
    this.generated.set(true);
  }

  protected async copyGeneratedPrompt(): Promise<void> {
    try {
      const text = this.generatedPrompt();
      const api = (window as any).promptops;
      if (api?.clipboardWrite) {
        await api.clipboardWrite(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch { /* fallback silently */ }
  }

  protected onBodyEdit(event: Event): void {
    this.editableBody.set((event.target as HTMLTextAreaElement).value);
  }

  protected async copyRawPrompt(): Promise<void> {
    try {
      const text = this.editableBody();
      const api = (window as any).promptops;
      if (api?.clipboardWrite) {
        await api.clipboardWrite(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch { /* fallback silently */ }
  }

  protected formatDate(dateStr: string): string {
    return formatUiDate(dateStr, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  protected formatDateShort(dateStr: string): string {
    return formatUiDate(dateStr, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  protected injectToSession(): void {
    this.openInjectModal(this.editableBody());
  }

  protected injectGeneratedToSession(): void {
    this.openInjectModal(this.generatedPrompt());
  }

  private openInjectModal(text: string): void {
    try {
      const ref = this.modalService.open(PromptInjectSessionModalComponent, {
        centered: true,
        size: 'md',
      });
      ref.componentInstance.promptTitle = this.prompt()?.title || '';
      ref.componentInstance.promptBody = text;

      ref.result.then(
        async (target: PromptInjectTarget) => {
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

  protected deletePrompt(): void {
    if (!this.promptId) return;
    const p = this.prompt();
    this.swalService.confirm(
      this.translateService.instant('MESSAGE.Delete prompt', { prompt: p?.title }),
      this.translateService.instant('MESSAGE.Are you sure you want to proceed? This action cannot be undone'),
      () => {
        this.queryService.deleteEntity(this.promptId!)
          .then(() => {
            this.swalService.success(
              this.translateService.instant('MESSAGE.prompt successfully deleted')
            );
            this.goBack();
          })
          .catch((err: any) => {
            this.swalService.error(
              err?.message || this.translateService.instant('MESSAGE.Generic error')
            );
          });
      }
    );
  }

  /** Sharing needs other people: this edition shows the PromptOps Desktop lock. */
  protected openShareModal(): void {
    CloudFeatureModalComponent.open(this.modalService, "explore");
  }
}
