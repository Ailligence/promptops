import { Routes } from "@angular/router";
import { cloudFeatureRoute } from "@core/guard/cloud-feature.guard";
import { PromptListComponent } from "./prompt-list/prompt-list.component";
import { PromptFormComponent } from "./prompt-form/prompt-form.component";
import { PromptDetailComponent } from "./prompt-detail/prompt-detail.component";
import { PromptVersionHistoryComponent } from "./prompt-version-history/prompt-version-history.component";

export const PROMPT_LIBRARY_ROUTES: Routes = [
  { path: "", component: PromptListComponent },
  { path: "new", component: PromptFormComponent },
  // Sharing, forks and change requests need other people, so they need PromptOps Cloud.
  cloudFeatureRoute("explore", "explore"),
  cloudFeatureRoute("explore/:id", "explore"),
  cloudFeatureRoute("explore/:id/propose", "explore"),
  { path: ":id/edit", component: PromptFormComponent },
  { path: ":id/versions", component: PromptVersionHistoryComponent },
  cloudFeatureRoute(":id/change-requests", "explore"),
  cloudFeatureRoute(":id/fork-map", "explore"),
  { path: ":id", component: PromptDetailComponent },
];
