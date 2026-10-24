import type { Route } from "@angular/router";

export const VIEWS_ROUTES: Route[] = [
  {
    path: "admin",
    loadChildren: () =>
      import("./admin-core/admin-core").then((mod) => mod.ADMIN_ROUTES),
  },
];
