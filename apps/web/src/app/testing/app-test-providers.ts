import { importProvidersFrom } from "@angular/core";
import { provideHttpClient, withXhr } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import { provideStore } from "@ngrx/store";
import { TranslateModule } from "@ngx-translate/core";
import { rootReducer } from "@/store";
import { DataBackend } from "@core/data/data-backend";
import { LocalDataBackend } from "@core/data/local-data-backend";

/** What a layout-level component needs to render in a spec: store, router, HTTP, data and translations. */
export const appTestProviders = [
  provideStore(rootReducer),
  provideRouter([]),
  provideHttpClient(withXhr()),
  provideHttpClientTesting(),
  { provide: DataBackend, useClass: LocalDataBackend },
  importProvidersFrom(TranslateModule.forRoot()),
];
