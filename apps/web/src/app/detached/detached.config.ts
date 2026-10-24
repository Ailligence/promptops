import { ApplicationConfig } from '@angular/core';
import { Routes, provideRouter, withHashLocation } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { AuthenticationEffects } from '@/store/authentication/authentication.effects';
import { SessionEffects } from '@/store/sessions/session.effects';
import { WorkspaceEffects } from '@/store/workspaces/workspace.effects';
import { TokenEfficiencyEffects } from '@/store/token-efficiency/token-efficiency.effects';
import { sessionWindowId } from './detached-window';
import { sharedProviders } from '../app.config';
import { AuthGuard } from '@core/guard/auth.guard';
import { DetachedForwardComponent } from './detached-forward.component';

/** Routes of a detached window: the floor plan, or one session in its own window. */
const DETACHED_ROUTES: Routes = [
  {
    path: 'floor-plan',
    loadComponent: () => import('../views/admin-core/sessions/floor-plan/floor-plan-window.component').then((m) => m.FloorPlanWindowComponent),
  },
  {
    // One session in its own child window: only its terminals, data from the main window.
    path: 'session/:id',
    canActivate: [AuthGuard],
    loadComponent: () => import('../views/admin-core/sessions/session-view/session-view.component').then((m) => m.SessionViewComponent),
  },
  { path: '**', component: DetachedForwardComponent },
];

export const detachedConfig: ApplicationConfig = {
  providers: [
    ...sharedProviders,
    // A session window is the full sessions view, so it needs the same effects as the main window
    // (sub-agent resume and restore are forwarded to the main window inside SessionEffects).
    // The floor plan only needs the profile.
    sessionWindowId()
      ? provideEffects(AuthenticationEffects, SessionEffects, WorkspaceEffects, TokenEfficiencyEffects)
      : provideEffects(AuthenticationEffects),
    provideRouter(DETACHED_ROUTES, withHashLocation()),
  ],
};
