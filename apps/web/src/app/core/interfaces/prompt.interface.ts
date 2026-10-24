import { FormControl } from "@angular/forms";

export interface PromptInterface {
  title?: FormControl<string | null>;
  body?: FormControl<string | null>;
  category_id?: FormControl<number | null>;
  tags?: FormControl<number[] | null>;
  notes?: FormControl<string | null>;
  ai_model?: FormControl<string | null>;
  provider_ids?: FormControl<string[] | null>;
  temperature?: FormControl<number | null>;
  max_tokens?: FormControl<number | null>;
  system_prompt?: FormControl<string | null>;
  status?: FormControl<string | null>;
  visibility?: FormControl<string | null>;
}

export interface PromptFiltersInterface {
  querySearch?: FormControl<string | null>;
  category_id?: FormControl<number | null>;
  status?: FormControl<string | null>;
  ai_model?: FormControl<string | null>;
}

export interface PromptFiltersValues {
  querySearch: string | null;
  category_id: number | null;
  status: string | null;
  ai_model: string | null;
  provider_ids?: string[] | null;
}

export interface PromptCategoryInterface {
  id: number;
  name: string;
  slug: string;
  description?: string;
  color: string;
}

export interface PromptTagInterface {
  id: number;
  name: string;
  slug: string;
}

export interface PromptVersionInterface {
  id: number;
  prompt_id: number;
  version_number: number;
  title: string;
  body: string;
  variables: string[];
  category_id: number | null;
  notes: string | null;
  ai_model: string | null;
  provider_ids?: string[] | null;
  temperature: number | null;
  max_tokens: number | null;
  system_prompt: string | null;
  status: string;
  change_summary: string | null;
  created_by: number;
  creator?: { id: number; first_name: string; last_name: string; email: string };
  created_at: string;
}

export interface PromptChangeRequestInterface {
  id: number;
  prompt_id: number;
  user_id: number;
  title: string;
  body: string;
  variables: string[];
  message: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  user?: { id: number; first_name: string; last_name: string; email: string };
  reviewer?: { id: number; first_name: string; last_name: string };
  prompt?: { id: number; title: string };
  created_at: string;
}

/** Single node in fork chain (ancestor or current). */
export interface ForkChainNode {
  id: number | null;
  title: string;
  user: { id: number; first_name: string; last_name: string } | null;
  created_at: string | null;
  forked_at?: string | null;
  forked_from_id?: number | null;
  visibility?: string;
}

/** Recursive descendant (who forked from this prompt and their forks). */
export interface ForkChainDescendant {
  id: number;
  title: string;
  user: { id: number; first_name: string; last_name: string } | null;
  created_at: string;
  children: ForkChainDescendant[];
}

export interface ForkChainResponse {
  current: ForkChainNode;
  ancestors: ForkChainNode[];
  descendants: ForkChainDescendant[];
}

/** Sub-agent definition embedded in a prompt workflow. */
export interface PromptSubAgentInterface {
  id?: number;
  prompt_id?: number;
  name: string;
  role: string;
  icon?: string;
  system_prompt: string;
  execution_order: number;
  auto_run: boolean;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}
