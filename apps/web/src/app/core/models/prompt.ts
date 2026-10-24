import { FormGroup } from "@angular/forms";
import {
  PromptInterface,
  PromptCategoryInterface,
  PromptTagInterface,
  PromptSubAgentInterface,
} from "@core/interfaces/prompt.interface";

export class Prompt {
  id?: number;
  user_id?: number;
  title?: string;
  body?: string;
  variables?: string[];
  category_id?: number;
  category?: PromptCategoryInterface;
  tags?: PromptTagInterface[];
  notes?: string;
  ai_model?: string;
  provider_ids?: string[] | null;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  status?: string;
  visibility?: string;
  current_version?: number;
  forked_from_id?: number;
  forked_from?: Prompt;
  stars_count?: number;
  forks_count?: number;
  is_starred?: boolean;
  is_following_author?: boolean;
  can_follow_author?: boolean;
  is_fork?: boolean;
  user?: { id: number; first_name: string; last_name: string; email: string; username?: string; avatar?: string; avatar_url?: string };
  created_at?: string;
  updated_at?: string;
  sub_agents?: PromptSubAgentInterface[];
  sub_agents_count?: number;
  is_workflow?: boolean;

  static generateModel(
    form: FormGroup<PromptInterface>,
    prompt?: Prompt,
    subAgents?: PromptSubAgentInterface[]
  ): any {
    const formValues = form.getRawValue();
    const payload: any = {
      ...formValues,
      ...(prompt?.id ? { id: prompt.id } : {}),
    };
    if (subAgents !== undefined) {
      payload.sub_agents = subAgents;
    }
    return payload;
  }
}
