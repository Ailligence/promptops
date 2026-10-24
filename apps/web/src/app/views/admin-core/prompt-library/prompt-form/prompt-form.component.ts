import { SPAWN_PROVIDERS, PROVIDER_LOGOS } from '../../sessions/services/spawn-providers.const';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
  ChangeDetectionStrategy
} from "@angular/core";
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import type {
  PromptInterface,
  PromptCategoryInterface,
  PromptTagInterface,
  PromptSubAgentInterface,
} from "@core/interfaces/prompt.interface";
import { TranslateModule, TranslateService } from "@ngx-translate/core";
import { Prompt } from "@core/models/prompt";
import { PromptQueryService } from "../services/prompt-query.service";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { SwalService } from "@core/services/swal.service";
import { QuickAccessService } from "@/app/layouts/sidebar/quick-access/quick-access.service";
import { ENTITY } from "@core/constants";
import { CategoryNamePipe } from "@core/category-name.pipe";
import { Subscription } from "rxjs";
import { Store } from "@ngrx/store";
import { GenerateAiModalComponent } from './generate-ai-modal/generate-ai-modal.component';
import { getActiveSession } from "@/store/sessions/session.selectors";
import { LOCAL_MODE } from "@core/local-mode";

@Component({
  selector: "app-prompt-form",
  standalone: true,
  imports: [TranslateModule, ReactiveFormsModule, FormsModule, RouterModule, CategoryNamePipe, GenerateAiModalComponent],
  templateUrl: "./prompt-form.component.html",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './prompt-form.component.scss',
})
export class PromptFormComponent implements OnInit, OnDestroy {
  protected form: FormGroup<PromptInterface> | null = null;
  protected categories = signal<PromptCategoryInterface[]>([]);
  protected allTags = signal<PromptTagInterface[]>([]);
  protected extractedVariables = signal<string[]>([]);
  protected selectedTags = signal<PromptTagInterface[]>([]);
  protected newTagInput = "";
  protected subAgents = signal<PromptSubAgentInterface[]>([]);
  protected expandedSubAgent = signal<number | null>(null);
  protected providerOptions = SPAWN_PROVIDERS;
  protected providerLogos = PROVIDER_LOGOS;
  protected saving = signal(false);
  protected loadError = signal(false);
  protected forcePublic = signal<boolean>(false);
  /** Explore, where public prompts are published, needs PromptOps Desktop. */
  protected readonly showPublicationHint = !LOCAL_MODE;

  @ViewChild('generateAiModal') generateAiModal!: GenerateAiModalComponent;

  protected statusOptions = [
    { value: "draft", label: "Draft" },
    { value: "published", label: "Published" },
    { value: "archived", label: "Archived" },
  ];

  private readonly queryService = inject(PromptQueryService);
  private readonly translateService = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly swalService = inject(SwalService);
  private readonly quickAccessService = inject(QuickAccessService);
  private readonly store = inject(Store);
  protected activeSessionProvider: string | null = null;
  private readonly entity_plural = ENTITY.PROMPT_plural;
  private readonly entity_singular_camelCase = ENTITY.PROMPT_camelCase;
  private bodySubscription: Subscription | null = null;
  private sessionSubscription: Subscription | null = null;

  get isEditMode(): boolean {
    return !!this.queryService.promptSelected;
  }

  get forkedFrom(): Prompt | null {
    return this.queryService.promptSelected?.forked_from || null;
  }

  ngOnInit(): void {
    void this.loadData().catch(() => this.loadError.set(true));
    this.sessionSubscription = this.store.select(getActiveSession).subscribe((session) => {
      this.activeSessionProvider = session?.provider ?? null;
    });
  }

  ngOnDestroy(): void {
    if (this.bodySubscription) {
      this.bodySubscription.unsubscribe();
    }
    if (this.sessionSubscription) {
      this.sessionSubscription.unsubscribe();
    }
  }

  protected openGenerateAiModal(): void {
    this.generateAiModal.open(
      this.form?.controls.title?.value || '',
      this.form?.controls.body?.value || ''
    );
  }

  protected onAiPromptGenerated(prompt: string): void {
    this.form?.get('body')?.setValue(prompt);
    this.form?.get('body')?.markAsTouched();
  }

  // ===== TAG HANDLERS =====

  protected onTagSelect(event: Event): void {
    const selectEl = event.target as HTMLSelectElement;
    const tagId = +selectEl.value;
    if (!tagId) return;

    const tag = this.allTags().find((t) => t.id === tagId);
    if (tag && !this.selectedTags().find((t) => t.id === tag.id)) {
      this.selectedTags.set([...this.selectedTags(), tag]);
      this.syncTagsToForm();
    }
    selectEl.value = "";
  }

  protected removeTag(tagId: number): void {
    this.selectedTags.set(this.selectedTags().filter((t) => t.id !== tagId));
    this.syncTagsToForm();
  }

  protected async handleCreateTag(): Promise<void> {
    const name = this.newTagInput.trim();
    if (!name) return;

    try {
      const tag = await this.queryService.createTag(name);
      this.allTags.set(this.queryService.tags());
      this.selectedTags.set([...this.selectedTags(), tag]);
      this.syncTagsToForm();
      this.newTagInput = "";
    } catch (err: any) {
      this.swalService.error(
        err?.message ||
          this.translateService.instant("MESSAGE.Generic error")
      );
    }
  }

  // ===== SUB-AGENT HANDLERS =====

  protected addSubAgent(): void {
    const agents = this.subAgents();
    this.subAgents.set([
      ...agents,
      {
        name: '',
        role: '',
        icon: '',
        system_prompt: '',
        execution_order: agents.length,
        auto_run: false,
        enabled: true,
      },
    ]);
    this.expandedSubAgent.set(agents.length);
  }

  protected removeSubAgent(index: number): void {
    const agents = [...this.subAgents()];
    agents.splice(index, 1);
    agents.forEach((a, i) => (a.execution_order = i));
    this.subAgents.set(agents);
    if (this.expandedSubAgent() === index) {
      this.expandedSubAgent.set(null);
    }
  }

  protected moveSubAgent(index: number, direction: -1 | 1): void {
    const agents = [...this.subAgents()];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= agents.length) return;
    [agents[index], agents[newIndex]] = [agents[newIndex], agents[index]];
    agents.forEach((a, i) => (a.execution_order = i));
    this.subAgents.set(agents);
    this.expandedSubAgent.set(newIndex);
  }

  protected toggleSubAgent(index: number): void {
    this.expandedSubAgent.set(this.expandedSubAgent() === index ? null : index);
  }

  protected updateSubAgentField(index: number, field: keyof PromptSubAgentInterface, value: any): void {
    const agents = [...this.subAgents()];
    (agents[index] as any)[field] = value;
    this.subAgents.set(agents);
  }

  // ===== SAVE =====

  protected deletePrompt(): void {
    const prompt = this.queryService.promptSelected;
    if (!prompt?.id || this.saving()) return;
    this.swalService.confirm(
      this.translateService.instant('MESSAGE.Delete prompt', { prompt: prompt.title }),
      this.translateService.instant('MESSAGE.Are you sure you want to proceed? This action cannot be undone'),
      async () => {
        if (this.saving()) return;
        this.saving.set(true);
        try {
          await this.queryService.deleteEntity(prompt.id!);
          this.queryService.clearEntitySelected();
          this.quickAccessService.loadShortcuts();
          this.router.navigate(['/admin/prompt-library']);
        } catch (error: any) {
          this.swalService.error(error?.message || this.translateService.instant('MESSAGE.Generic error'));
        } finally {
          this.saving.set(false);
        }
      }
    );
  }

  protected submitPrompt(): void {
    if (this.saving()) return;
    if (this.form?.invalid) { this.form.markAllAsTouched(); return; }
    if (this.form?.controls.visibility?.value === 'public' && this.form?.controls.status?.value !== 'archived') this.form?.controls.status?.setValue('published');
    void this.handleSaveEntity();
  }

  protected saveDraft(): void {
    if (this.saving()) return;
    this.form?.controls.status?.setValue('draft');
    void this.handleSaveEntity();
  }

  async handleSaveEntity(): Promise<void> {
    if (!this.form || this.saving()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    try {
      const body = Prompt.generateModel(
        this.form!,
        this.isEditMode ? this.queryService.promptSelected! : undefined,
        this.subAgents()
      );

      let savedId = this.queryService.promptSelected?.id;
      if (this.isEditMode) {
        await this.queryService.updateEntity(body);
        this.quickAccessService.loadShortcuts();
      } else {
        const created = await this.queryService.addEntity(body);
        savedId = created?.id;
      }

      const message = this.isEditMode
        ? `MESSAGE.${this.entity_singular_camelCase} updated successfully`
        : `MESSAGE.${this.entity_singular_camelCase} added successfully`;

      this.swalService.success(this.translateService.instant(message));

      this.form.markAsPristine();
      if (!LOCAL_MODE && body.visibility === 'public' && body.status === 'published' && savedId) {
        this.router.navigate(['/admin/prompt-library/explore', savedId]);
      } else {
        this.router.navigate(['/admin/prompt-library']);
      }
    } catch (err: any) {
      this.swalService.error(
        err?.message ||
          this.translateService.instant("MESSAGE.Generic error")
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected translateField(field: string): string {
    return this.translateService.instant(`PROMPTS.${field}`);
  }

  // ===== DATA LOADING =====

  private async loadData(): Promise<void> {
    const id = this.route.snapshot.paramMap.get("id");
    const publicParam = this.route.snapshot.queryParamMap.get("public");
    const wantsPublic = publicParam === "1" || publicParam === "true";
    this.forcePublic.set(wantsPublic && !id);

    await Promise.all([
      this.queryService.loadCategories(),
      this.queryService.loadTags(),
    ]);

    this.categories.set(this.queryService.categories());
    this.allTags.set(this.queryService.tags());

    if (id) {
      await this.queryService.retriveEntitySelected(+id);
    } else {
      this.queryService.clearEntitySelected();
    }

    this.form = this.initForm(this.queryService.promptSelected);

    if (this.forcePublic()) {
      this.form.get("visibility")?.setValue("public");
      this.form.get("status")?.setValue("published");
    }

    if (this.queryService.promptSelected?.tags) {
      this.selectedTags.set([...this.queryService.promptSelected.tags]);
    }

    if (this.queryService.promptSelected?.sub_agents) {
      this.subAgents.set([...this.queryService.promptSelected.sub_agents]);
    }

    this.bodySubscription = this.form
      .get("body")!
      .valueChanges.subscribe((value) => {
        this.extractVariables(value || "");
      });

    if (this.queryService.promptSelected?.body) {
      this.extractVariables(this.queryService.promptSelected.body);
    }
  }

  protected toggleProvider(id: string): void {
    const control = this.form?.controls.provider_ids;
    const selected = control?.value ?? [];
    control?.setValue(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
    control?.markAsDirty();
  }

  private initForm(prompt: Prompt | null = null): FormGroup<PromptInterface> {
    return new FormGroup<PromptInterface>({
      title: new FormControl(prompt?.title ?? null, [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(255),
      ]),
      body: new FormControl(prompt?.body ?? null, [Validators.required]),
      category_id: new FormControl(prompt?.category_id ?? null),
      provider_ids: new FormControl<string[] | null>(prompt?.provider_ids ?? []),
      tags: new FormControl(
        prompt?.tags ? prompt.tags.map((t) => t.id) : null
      ),
      notes: new FormControl(prompt?.notes ?? null),
      status: new FormControl(prompt?.status ?? "draft", [
        Validators.required,
      ]),
      visibility: new FormControl(prompt?.visibility ?? "private"),
    });
  }

  private extractVariables(body: string): void {
    const regex = /\{\{(\w+)\}\}/g;
    const matches = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      matches.add(match[1]);
    }
    this.extractedVariables.set(Array.from(matches));
  }

  private syncTagsToForm(): void {
    const tagIds = this.selectedTags().map((t) => t.id);
    this.form?.get("tags")?.setValue(tagIds.length > 0 ? tagIds : null);
  }
}
