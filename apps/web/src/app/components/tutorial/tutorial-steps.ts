import { TutorialStep } from './tutorial.model';

/**
 * Menu link helper. Suffix match: with hash routing (desktop) the anchor's
 * href is `#/admin/…`, with path routing it is `/admin/…`.
 */
const nav = (url: string) => `.po-sidebar a[href$="${url}"]`;

/**
 * Steps whose target is hidden in the active interface style (topbar and quick
 * access in the rail UI, the rail footer in the classic one) are dropped when
 * the tour starts — see TutorialService.start().
 *
 * Tour of the app shell (topbar, menu, bottom bar). The inside of a session
 * — workspace, main session, spawn composer, sub-agents — is shown by the
 * dedicated Sessions guide, which the last step launches: one tour per area,
 * no fake copy of the session view to keep in sync with the real one.
 */
export const APP_TUTORIAL_STEPS: TutorialStep[] = [
  {
    target: '.po-topbar',
    titleKey: 'TUTORIAL.steps.header.title',
    descriptionKey: 'TUTORIAL.steps.header.description',
    position: 'bottom',
  },
  {
    // Rail UI: no topbar, notifications and profile sit at the foot of the menu.
    target: '.sidenav-minimal-footer',
    titleKey: 'TUTORIAL.steps.profile.title',
    descriptionKey: 'TUTORIAL.steps.profile.description',
    position: 'right',
  },
  {
    target: '.po-sidebar',
    titleKey: 'TUTORIAL.steps.sidebar.title',
    descriptionKey: 'TUTORIAL.steps.sidebar.description',
    position: 'right',
  },
  {
    target: '.quick-access-section',
    titleKey: 'TUTORIAL.steps.quickAccess.title',
    descriptionKey: 'TUTORIAL.steps.quickAccess.description',
    position: 'right',
  },
  {
    target: nav('/admin/sessions'),
    titleKey: 'TUTORIAL.steps.sessions.title',
    descriptionKey: 'TUTORIAL.steps.sessions.description',
    position: 'right',
  },
  {
    target: nav('/admin/provider-accounts'),
    titleKey: 'TUTORIAL.steps.providers.title',
    descriptionKey: 'TUTORIAL.steps.providers.description',
    position: 'right',
  },
  {
    target: nav('/admin/usage'),
    titleKey: 'TUTORIAL.steps.usage.title',
    descriptionKey: 'TUTORIAL.steps.usage.description',
    position: 'right',
  },
  {
    target: nav('/admin/plugins'),
    titleKey: 'TUTORIAL.steps.plugins.title',
    descriptionKey: 'TUTORIAL.steps.plugins.description',
    position: 'right',
  },
  {
    target: nav('/admin/prompt-library'),
    titleKey: 'TUTORIAL.steps.promptLibrary.title',
    descriptionKey: 'TUTORIAL.steps.promptLibrary.description',
    position: 'right',
  },
  {
    target: nav('/admin/ranking'),
    titleKey: 'TUTORIAL.steps.ranking.title',
    descriptionKey: 'TUTORIAL.steps.ranking.description',
    position: 'right',
  },
  {
    target: '.bottom-bar',
    titleKey: 'TUTORIAL.steps.bottomBar.title',
    descriptionKey: 'TUTORIAL.steps.bottomBar.description',
    position: 'top',
  },
  {
    // Always present: the tour must end on a reachable step.
    target: `${nav('/admin/sessions')}, .po-topbar`,
    titleKey: 'TUTORIAL.steps.sessionsTour.title',
    descriptionKey: 'TUTORIAL.steps.sessionsTour.description',
    position: 'right',
    actionKey: 'TUTORIAL.steps.sessionsTour.action',
    action: 'sessionsTour',
  },
];
