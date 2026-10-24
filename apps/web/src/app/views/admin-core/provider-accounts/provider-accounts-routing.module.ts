import { Route } from "@angular/router";
import { ProviderAccountsComponent } from "./provider-accounts.component";

export const PROVIDER_ACCOUNTS_ROUTES: Route[] = [
  {
    path: "",
    component: ProviderAccountsComponent,
    data: { title: "AI Accounts" },
  },
];
