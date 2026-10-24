import { inject } from "@angular/core";
import { Route, Router, UrlTree } from "@angular/router";
import { NgbModal } from "@ng-bootstrap/ng-bootstrap";
import { CloudFeatureModalComponent, type CloudFeature } from "@components/cloud-feature-modal/cloud-feature-modal.component";
import { openExternal } from "@core/local-mode";

/**
 * Route for a feature that needs PromptOps Cloud. It has no component: opening
 * it shows the "available in PromptOps Desktop" dialog and stays on Sessions,
 * so none of the feature's code is part of this build.
 */
export function cloudFeatureRoute(path: string, feature: CloudFeature): Route {
  return {
    path,
    children: [],
    canActivate: [
      (): UrlTree => {
        CloudFeatureModalComponent.open(inject(NgbModal), feature);
        return inject(Router).createUrlTree(["/admin/sessions"]);
      },
    ],
  };
}

/** Route that opens a web page in the system browser and stays on Sessions. */
export function externalLinkRoute(path: string, url: string): Route {
  return {
    path,
    children: [],
    canActivate: [
      (): UrlTree => {
        openExternal(url);
        return inject(Router).createUrlTree(["/admin/sessions"]);
      },
    ],
  };
}
