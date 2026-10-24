import { inject, Injectable, signal, WritableSignal } from "@angular/core";
import { BaseTableFilter } from "@core/interfaces/base-table.interface";
import {
  PromptCategoryInterface,
  PromptTagInterface,
  PromptVersionInterface,
  PromptChangeRequestInterface,
  ForkChainResponse,
} from "@core/interfaces/prompt.interface";
import { Prompt } from "@core/models/prompt";
import { DataBackend, type DataError } from "@core/data/data-backend";

/** Answer of the features that need other people (community, sharing, forks). */
const NOT_AVAILABLE: DataError = { code: "not_available", message: "This feature is not available in this edition." };

@Injectable({ providedIn: "root" })
export class PromptQueryService {
  prompts = signal<Prompt[]>([]);
  promptSelected: Prompt | null = null;
  categories = signal<PromptCategoryInterface[]>([]);
  tags = signal<PromptTagInterface[]>([]);

  private data = inject(DataBackend);

  // ── Helper: list parameters from a table filter ──

  private listParams(filter: BaseTableFilter): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (filter.searchQuery) params["search"] = filter.searchQuery;
    if (!filter.suggest) {
      if (filter.page) params["page"] = filter.page;
      if (filter.perPage) params["per_page"] = filter.perPage;
    }
    if (filter.fieldSort) params["sort_field"] = filter.fieldSort;
    if (filter.fieldDir) params["sort_dir"] = filter.fieldDir;
    Object.entries(filter).forEach(([key, value]) => {
      if (["searchQuery", "page", "perPage", "fieldSort", "fieldDir", "suggest"].includes(key)) return;
      if (value !== null && value !== undefined) params[key] = value;
    });
    return params;
  }

  // ── CRUD ──

  async getList(
    filter: BaseTableFilter
  ): Promise<{ prompts: WritableSignal<Prompt[]>; pagination: any }> {
    try {
      const response = await this.data.call<{ prompts: Prompt[]; pagination: any }>("prompts.list", this.listParams(filter));
      this.prompts.set(response.prompts);
      return { prompts: this.prompts, pagination: response.pagination };
    } catch (error) {
      return { prompts: this.prompts, pagination: null };
    }
  }

  async fetchEntity(id: number): Promise<Prompt> {
    const prompt = await this.data.call<Prompt>("prompts.get", { id });
    this.promptSelected = prompt;
    return prompt;
  }

  async addEntity(body: any): Promise<any> {
    return this.data.call<Prompt>("prompts.create", body);
  }

  async updateEntity(body: any): Promise<void> {
    await this.data.call("prompts.update", body);
  }

  async deleteEntity(id: number): Promise<void> {
    await this.data.call("prompts.delete", { id });
  }

  async retriveEntitySelected(id: number): Promise<void> {
    // Always fetch by id so that switching prompts (e.g. from Quick Access) loads the correct one.
    // Previously we only fetched when promptSelected was null, so clicking another prompt left the old one visible.
    await this.fetchEntity(id);
  }

  clearEntitySelected(): void {
    this.promptSelected = null;
  }

  // ── Versions ──

  async getVersionHistory(promptId: number): Promise<PromptVersionInterface[]> {
    return this.data.call<PromptVersionInterface[]>("prompts.versions", { id: promptId });
  }

  async restoreVersion(promptId: number, versionId: number): Promise<void> {
    await this.data.call("prompts.restoreVersion", { id: promptId, version_id: versionId });
  }

  // ── Stars ──
  // A star is a personal bookmark kept on the prompt itself.

  async toggleStar(promptId: number): Promise<{ starred: boolean; stars_count: number }> {
    const prompt = await this.data.call<Prompt>("prompts.toggleStar", { id: promptId });
    return { starred: !!prompt.is_starred, stars_count: prompt.stars_count ?? 0 };
  }

  async getStarredPrompts(): Promise<{ prompts: Prompt[]; pagination: any }> {
    const response = await this.data.call<{ prompts: Prompt[]; pagination: any }>("prompts.list", {
      starred: true,
      sort_field: "updated_at",
      sort_dir: "desc",
      per_page: 500,
    });
    return { prompts: response.prompts ?? [], pagination: response.pagination ?? null };
  }

  // ── Community, forks, change requests, sharing ──
  // These need other people, so this edition has none of them: lists are
  // empty and actions reject with code `not_available`.

  async getPublicPrompts(_filter: BaseTableFilter): Promise<{ prompts: Prompt[]; pagination: any }> {
    return { prompts: [], pagination: null };
  }

  async getPublicPrompt(_id: number): Promise<Prompt> {
    throw NOT_AVAILABLE;
  }

  async getCommunityStats(): Promise<{ followers_count: number; published_prompts_count: number }> {
    return { followers_count: 0, published_prompts_count: 0 };
  }

  async followAuthor(_authorId: number, _follow: boolean): Promise<boolean> {
    throw NOT_AVAILABLE;
  }

  async getForkChain(_promptId: number): Promise<ForkChainResponse> {
    throw NOT_AVAILABLE;
  }

  async forkPrompt(_promptId: number): Promise<Prompt> {
    throw NOT_AVAILABLE;
  }

  async createChangeRequest(_promptId: number, _data: any): Promise<PromptChangeRequestInterface> {
    throw NOT_AVAILABLE;
  }

  async getChangeRequests(_promptId: number): Promise<PromptChangeRequestInterface[]> {
    return [];
  }

  async reviewChangeRequest(_changeRequestId: number, _action: "approved" | "rejected", _reviewNote?: string): Promise<void> {
    throw NOT_AVAILABLE;
  }

  async getMyChangeRequests(): Promise<PromptChangeRequestInterface[]> {
    return [];
  }

  async getSharedWithMe(_params?: { page?: number; perPage?: number }): Promise<{ prompts: Prompt[]; pagination: any }> {
    return { prompts: [], pagination: null };
  }

  async sharePrompt(_promptId: number, _sharedWith: number, _permission: "view" | "edit" = "view"): Promise<any> {
    throw NOT_AVAILABLE;
  }

  async unsharePrompt(_promptId: number, _userId: number): Promise<void> {
    throw NOT_AVAILABLE;
  }

  async getPromptShares(_promptId: number): Promise<any[]> {
    return [];
  }

  async searchUsers(_query: string): Promise<any[]> {
    return [];
  }

  // ── Categories & Tags ──

  async loadCategories(_scope: 'mine' | 'public' = 'mine'): Promise<void> {
    this.categories.set(await this.data.call<PromptCategoryInterface[]>("promptCategories.list"));
  }

  async loadTags(): Promise<void> {
    this.tags.set(await this.data.call<PromptTagInterface[]>("promptTags.list"));
  }

  async createCategory(
    name: string,
    description?: string,
    color?: string
  ): Promise<PromptCategoryInterface> {
    const category = await this.data.call<PromptCategoryInterface>("promptCategories.create", { name, description, color });
    await this.loadCategories();
    return category;
  }

  async createTag(name: string): Promise<PromptTagInterface> {
    const tag = await this.data.call<PromptTagInterface>("promptTags.create", { name });
    await this.loadTags();
    return tag;
  }
}
