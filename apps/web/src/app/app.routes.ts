import { Routes } from "@angular/router";
import { LayoutComponent } from "@layouts/layout/layout.component";
import { AuthGuard } from "@core/guard/auth.guard";

/** App routes. Everything lives under /admin; there is no sign-in page. */
export const routes: Routes = [
  // Root → admin
  { path: "", redirectTo: "admin", pathMatch: "full" },

  // Authenticated admin routes
  {
    path: "",
    component: LayoutComponent,
    loadChildren: () =>
      import("./views/views.route").then((mod) => mod.VIEWS_ROUTES),
    canActivate: [AuthGuard],
  },

  // Wildcard → admin
  { path: "**", redirectTo: "admin" },
];
