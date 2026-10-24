import {
  ApplicationConfig,
  importProvidersFrom,
  isDevMode,
  provideZoneChangeDetection,
} from "@angular/core";
import { provideRouter, withHashLocation } from "@angular/router";
import { provideStoreDevtools } from "@ngrx/store-devtools";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";

import { routes } from "./app.routes";
import { provideStore } from "@ngrx/store";
import { rootReducer } from "@/store";
import { localStorageSyncReducer } from "@/store/layout/layout-reducers";
import { provideEffects } from "@ngrx/effects";
import { AuthenticationEffects } from "@/store/authentication/authentication.effects";
import { SessionEffects } from "@/store/sessions/session.effects";
import { WorkspaceEffects } from "@/store/workspaces/workspace.effects";
import { TokenEfficiencyEffects } from "@/store/token-efficiency/token-efficiency.effects";
import { HttpClient, provideHttpClient, withFetch } from "@angular/common/http";
import { DecimalPipe } from "@angular/common";
import { CookieService } from "ngx-cookie-service";
import { BrowserModule } from "@angular/platform-browser";
import { TranslateModule, TranslateLoader } from "@ngx-translate/core";
import { TranslateHttpLoader } from "@ngx-translate/http-loader";
import { environment } from "@environment/environment";
import { DEMO_PROVIDERS } from "./demo/demo.providers";
import { DataBackend } from "@core/data/data-backend";
import { LocalDataBackend } from "@core/data/local-data-backend";

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http, "./assets/i18n/", ".json");
}

/**
 * Providers shared by every window: the main one (appConfig) and Tauri's detached windows
 * (detached/detached.config.ts). Each adds its own effects and routes: the session and
 * workspace effects start services that must run only once, in the main window.
 */
export const sharedProviders: NonNullable<ApplicationConfig['providers']> = [
    DecimalPipe,
    CookieService,
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideStore(rootReducer, { metaReducers: [localStorageSyncReducer] }),
    importProvidersFrom(
      BrowserAnimationsModule,
      BrowserModule,
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: HttpLoaderFactory,
          deps: [HttpClient],
        },
      })
    ),
    ...(isDevMode() ? [provideStoreDevtools({ maxAge: 25 })] : []),
    // HttpClient loads the bundled translations and a few public files (for
    // example the plugin index). The app's own data goes through
    // DataBackend, never over HTTP.
    provideHttpClient(withFetch()),
    // Where the app's data lives: on this device, through the desktop shell.
    { provide: DataBackend, useClass: LocalDataBackend },
    // Empty in normal builds; the `desktop-demo` build replaces it with the
    // simulation for the videos (src/app/demo, only `npm run dev:demo`).
    ...DEMO_PROVIDERS,
];

export const appConfig: ApplicationConfig = {
  providers: [
    ...sharedProviders,
    provideEffects(AuthenticationEffects, SessionEffects, WorkspaceEffects, TokenEfficiencyEffects),
    provideRouter(routes, ...(environment.desktop ? [withHashLocation()] : [])),
  ],
};
